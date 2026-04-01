import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { RippleButton } from './RippleButton'
import { GlobalShortcutsHint, KeyCapButton } from './GlobalShortcutsHint'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'
import { useAudioEngine } from '../hooks/useAudioEngine'

const WIDE_GAMUT = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
}

const RAIN_RED = '#FF0000'
const CLIP_YELLOW = '#FFFF00'

/** N 键循环：静音 → 白噪 → 粉噪 → 棕噪 */
const NOISE_MODE_ORDER = ['mute', 'white', 'pink', 'brown']

/** 与滑块 / 压力测试一致：粒子少 → 声小、稀疏；粒子多 → 声大、饱满 */
const DENSITY_AUDIO_MIN = 10
const DENSITY_AUDIO_MAX = 2000

function densityToNoiseGain(d) {
  const t = Math.max(0, Math.min(1, (d - DENSITY_AUDIO_MIN) / (DENSITY_AUDIO_MAX - DENSITY_AUDIO_MIN)))
  // 低密度时显著压低粉/白噪电平（t^2.6），避免「粒子少仍觉噪声很密」
  const shaped = Math.pow(t, 2.6)
  return 0.004 + shaped * 0.3
}

/** 与面板 speed 滑块 1～30 对齐：慢 → 疏、慢；快 → 密、疾 */
const SPEED_MIN = 1
const SPEED_MAX = 30

function speedNorm(s) {
  return Math.max(0, Math.min(1, (s - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)))
}

function speedToNoiseSparseMul(s) {
  const t = speedNorm(s)
  return 0.12 + 0.88 * Math.pow(t, 1.22)
}

/** 缓冲噪声播放速率：慢雨 → 更低 playbackRate，听感更「拖、疏」（最慢档再压低） */
function speedToNoisePlaybackRate(s) {
  const t = speedNorm(s)
  return 0.165 + 1.215 * t
}

// 水蓝色系（雨滴用）
const WATER_BLUE_PALETTE = [
  '#00BFFF', // 深天蓝
  '#87CEEB', // 天蓝
  '#40E0D0', // 青绿
  '#00CED1', // 暗青
  '#48D1CC', // 中绿松石
  '#20B2AA', // 浅海绿
  '#5F9EA0', // 军蓝
  '#7B68EE', // 中板岩蓝
]

/** RainTestModule - 工业极简主义雨滴效果 */
export function RainTestModule() {
  const canvasRef = useRef(null)
  const linesRef = useRef([])
  const speedRef = useRef(5)
  const densityRef = useRef(50)
  const showGridRef = useRef(true)
  const showLabelsRef = useRef(true)
  const isLightModeRef = useRef(false)
  const colorSchemeRef = useRef('default') // 'default' | 'water'
  const lastFpsRef = useRef(0) // 动画循环内每 500ms 更新，用于压力测试时禁止 FPS 跌破半刷新率后继续 +
  const cycleDirectionRef = useRef(1) // 1=递增 -1=递减，用于左下角密度自动循环
  const dripSynthRef = useRef(null)
  const dripPannerRef = useRef(null)
  const dripFilterRef = useRef(null)
  const dripGainRef = useRef(null)
  const dripReadyRef = useRef(false)
  const lastDripAtRef = useRef(0)

  const {
    startPinkNoise,
    startBrownNoise,
    startWhiteNoise,
    stopNoise,
    connectMicrophone,
    disconnectMicrophone,
    setUnderwaterMuffling,
    setMasterGain,
    setNoiseGain,
    setNoisePlaybackRate,
    getVolume,
    checkClipping,
  } = useAudioEngine()

  const [noiseMode, setNoiseMode] = useState('pink')
  const [micOn, setMicOn] = useState(false)
  const [hudFps, setHudFps] = useState(0)
  const [pointerCoords, setPointerCoords] = useState({ x: 0, y: 0 })
  const [speed, setSpeed] = useState(() => 3 + Math.floor(Math.random() * 10))
  const [density, setDensity] = useState(() => 30 + Math.floor(Math.random() * 80))
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [isLightMode, setIsLightMode] = useState(false)
  const [colorScheme, setColorScheme] = useState('default')
  const [showControls, setShowControls] = useState(false)
  const noiseModeRef = useRef('pink')
  noiseModeRef.current = noiseMode

  const applyNoiseMode = useCallback(async (mode) => {
    const d = densityRef.current
    const spd = speedRef.current
    const ng = densityToNoiseGain(d) * speedToNoiseSparseMul(spd)
    const pr = speedToNoisePlaybackRate(spd)
    if (mode === 'mute') {
      stopNoise()
      setMasterGain(0)
      return
    }
    setMasterGain(0.85)
    if (mode === 'white') {
      await startWhiteNoise(ng, pr)
      return
    }
    if (mode === 'pink') {
      await startPinkNoise(ng, pr)
      return
    }
    await startBrownNoise(ng, pr)
  }, [
    startPinkNoise,
    startBrownNoise,
    startWhiteNoise,
    stopNoise,
    setMasterGain,
  ])

  const initImpactDrip = useCallback(async () => {
    if (dripReadyRef.current) return
    try {
      await Tone.start()
      const panner = new Tone.Panner(0)
      const gain = new Tone.Gain(0.082).toDestination()
      const filter = new Tone.Filter({ type: 'bandpass', frequency: 950, Q: 1.6 })
      const synth = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.12 },
      })
      synth.chain(filter, panner, gain)
      dripSynthRef.current = synth
      dripPannerRef.current = panner
      dripFilterRef.current = filter
      dripGainRef.current = gain
      dripReadyRef.current = true
    } catch {
      /* */
    }
  }, [])

  const triggerImpactDrip = useCallback((xNorm, velocityNorm) => {
    if (!dripReadyRef.current || noiseModeRef.current === 'mute') return
    const nowMs = performance.now()
    if (nowMs - lastDripAtRef.current < 34) return
    lastDripAtRef.current = nowMs
    const synth = dripSynthRef.current
    const panner = dripPannerRef.current
    const filter = dripFilterRef.current
    const gain = dripGainRef.current
    if (!synth || !panner || !filter || !gain) return
    const v = Math.max(0, Math.min(1, velocityNorm))
    try {
      panner.pan.rampTo((Math.max(0, Math.min(1, xNorm)) - 0.5) * 1.4, 0.01)
      gain.gain.rampTo(0.04 + v * 0.06, 0.006)
      // 随机脉冲：随机中心频率与 Q，模拟不同材质触底，无明确音高
      filter.frequency.rampTo(420 + Math.random() * 1700, 0.006)
      filter.Q.rampTo(0.6 + Math.random() * 4.2, 0.006)
      synth.triggerAttackRelease(
        0.018 + Math.random() * 0.045,
        Tone.now(),
        0.34 + Math.random() * 0.32,
      )
    } catch {
      /* */
    }
  }, [])

  useEffect(() => {
    const ng = densityToNoiseGain(density) * speedToNoiseSparseMul(speed)
    if (noiseMode !== 'mute') {
      setNoiseGain(ng)
      setNoisePlaybackRate(speedToNoisePlaybackRate(speed))
    }
  }, [
    density,
    speed,
    noiseMode,
    setNoiseGain,
    setNoisePlaybackRate,
  ])

  const getVolumeRef = useRef(getVolume)
  const checkClippingRef = useRef(checkClipping)
  getVolumeRef.current = getVolume
  checkClippingRef.current = checkClipping

  const setHudFpsRef = useRef(setHudFps)
  setHudFpsRef.current = setHudFps

  const vuMeterFillRef = useRef(null)
  const vuPeakRef = useRef(0.02)

  // 首次点击画布区域启动当前噪声模式（与 N 循环一致）
  useEffect(() => {
    const kick = async () => {
      document.removeEventListener('pointerdown', kick)
      try {
        await applyNoiseMode(noiseModeRef.current)
        await initImpactDrip()
      } catch {
        /* */
      }
    }
    document.addEventListener('pointerdown', kick, { passive: true })
    return () => document.removeEventListener('pointerdown', kick)
  }, [applyNoiseMode, initImpactDrip])

  // 进入 RAIN 时立即尝试启动 pink 噪声（useLayoutEffect 更容易复用切模式点击手势）
  useLayoutEffect(() => {
    void applyNoiseMode('pink')
    void initImpactDrip()
    const retry = setTimeout(() => {
      void applyNoiseMode('pink')
    }, 180)
    return () => clearTimeout(retry)
  }, [applyNoiseMode, initImpactDrip])

  useEffect(() => {
    if (!micOn) {
      disconnectMicrophone()
      return
    }
    let cancelled = false
    void connectMicrophone().catch(() => {
      if (!cancelled) setMicOn(false)
    })
    return () => {
      cancelled = true
      disconnectMicrophone()
    }
  }, [micOn, connectMicrophone, disconnectMicrophone])

  useEffect(() => {
    return () => {
      dripReadyRef.current = false
      try {
        dripSynthRef.current?.dispose()
        dripPannerRef.current?.dispose()
        dripFilterRef.current?.dispose()
        dripGainRef.current?.dispose()
      } catch {
        /* */
      }
      dripSynthRef.current = null
      dripPannerRef.current = null
      dripFilterRef.current = null
      dripGainRef.current = null
    }
  }, [])

  const cycleNoiseMode = useCallback(() => {
    const next =
      NOISE_MODE_ORDER[(NOISE_MODE_ORDER.indexOf(noiseModeRef.current) + 1) % NOISE_MODE_ORDER.length]
    noiseModeRef.current = next
    setNoiseMode(next)
    void applyNoiseMode(next)
  }, [applyNoiseMode])

  const toggleMic = useCallback(() => {
    setMicOn((v) => !v)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        cycleNoiseMode()
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMic()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cycleNoiseMode, toggleMic])

  useEffect(() => {
    const onMove = (e) => setPointerCoords({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    setUnderwaterMuffling(colorScheme === 'water')
  }, [colorScheme, setUnderwaterMuffling])

  // 鼠标靠近右上角显示控制面板，移开后延迟隐藏
  useEffect(() => {
    const threshold = 60
    let hideTimeout = null

    const handleMouseMove = (e) => {
      const isInCorner = e.clientX > window.innerWidth - threshold && e.clientY < threshold

      if (isInCorner) {
        if (hideTimeout) {
          clearTimeout(hideTimeout)
          hideTimeout = null
        }
        setShowControls(true)
      } else {
        if (hideTimeout) clearTimeout(hideTimeout)
        hideTimeout = setTimeout(() => {
          setShowControls(false)
          hideTimeout = null
        }, 300)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeout) clearTimeout(hideTimeout)
    }
  }, [])

  // 同步到 ref
  speedRef.current = speed
  densityRef.current = density
  showGridRef.current = showGrid
  showLabelsRef.current = showLabels
  isLightModeRef.current = isLightMode
  colorSchemeRef.current = colorScheme

  // 压力测试：+ 以 500 暴增（FPS 低于半刷新率时禁止），- 以 500 减少
  useEffect(() => {
    const refreshRate = typeof window.screen?.refreshRate === 'number' ? window.screen.refreshRate : 60
    const halfRefresh = refreshRate / 2

    const handleKey = (e) => {
      if (e.key === '+') {
        e.preventDefault()
        const fps = lastFpsRef.current
        if (fps > 0 && fps < halfRefresh) return // FPS 已跌破半刷新率，不再允许加粒子
        setDensity((prev) => prev + 500)
      }
      const isMinus = e.key === '-' || e.key === '−' || e.code === 'Minus' || e.code === 'NumpadSubtract'
      if (isMinus) {
        e.preventDefault()
        setDensity((prev) => Math.max(10, prev - 500))
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [])

  // RAIN 模式：每秒 ±10 粒子，100 ↔ 2000 往复循环
  const DENSITY_MIN = 100
  const DENSITY_MAX = 2000
  useEffect(() => {
    const id = setInterval(() => {
      setDensity((prev) => {
        const step = 10 * cycleDirectionRef.current
        let next = prev + step
        if (next >= DENSITY_MAX) {
          cycleDirectionRef.current = -1
          return DENSITY_MAX
        }
        if (next <= DENSITY_MIN) {
          cycleDirectionRef.current = 1
          return DENSITY_MIN
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // 创建单条线（颜色随配色方案：default 或 water 水蓝系）
  const createLine = (w, h) => {
    const isWater = colorSchemeRef.current === 'water'
    const lineColor = isWater
      ? WATER_BLUE_PALETTE[Math.floor(Math.random() * WATER_BLUE_PALETTE.length)]
      : (Math.random() > 0.7 ? RAIN_RED : (isLightMode ? '#000000' : '#FFFFFF'))
    return {
      x: Math.random() * w,
      y: Math.random() * -h * 2,
      length: 20 + Math.random() * 260,
      width: Math.random() > 0.5 ? 1 : 2,
      velocity: speed * (0.5 + Math.random() * 0.5),
      color: lineColor,
      showLabel: Math.random() > 0.9,
    }
  }

  // 动画循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 获取设备像素比
    const dpr = window.devicePixelRatio || 1
    
    // 设置 Canvas 尺寸
    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      // 绘图表面尺寸 × 设备像素比
      canvas.width = w * dpr
      canvas.height = h * dpr
      // CSS 尺寸保持窗口大小
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      // 上下文缩放 - 确保所有绘制对齐物理像素
      ctx.setTransform(1, 0, 0, 1, 0, 0) // 重置变换
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    // 初始化线条
    const lines = []
    for (let i = 0; i < densityRef.current; i++) {
      lines.push(createLine(window.innerWidth, window.innerHeight))
    }
    linesRef.current = lines

    let animationId
    let frameCount = 0
    let lastFpsTime = performance.now()

    const animate = () => {
      frameCount++
      const now = performance.now()
      if (now - lastFpsTime >= 500) {
        lastFpsRef.current = frameCount / ((now - lastFpsTime) / 1000)
        frameCount = 0
        lastFpsTime = now
        setHudFpsRef.current(lastFpsRef.current)
      }

      // 使用 CSS 尺寸而不是绘图表面尺寸
      const w = window.innerWidth
      const h = window.innerHeight
      const currentSpeed = speedRef.current
      const baseDensity = densityRef.current
      const vol = getVolumeRef.current()
      const vuEl = vuMeterFillRef.current
      if (vuEl) {
        // 输入音量映射：快速抬峰、慢速回落；接近峰值时直接打满
        const peak =
          vol > vuPeakRef.current
            ? vol
            : Math.max(0.02, vuPeakRef.current * 0.996)
        vuPeakRef.current = peak
        const norm = peak > 1e-6 ? vol / peak : 0
        const vuLvl = norm >= 0.9 ? 1 : Math.max(0, Math.min(1, Math.pow(norm, 0.45)))
        vuEl.style.transform = `scaleY(${vuLvl})`
      }
      const amp = Math.min(1, vol * 4.2)
      const currentDensity = Math.min(
        2000,
        Math.max(10, Math.round(baseDensity * (0.42 + amp * 1.15))),
      )
      const clipping = checkClippingRef.current()
      const currentShowGrid = showGridRef.current
      const currentShowLabels = showLabelsRef.current
      const isLight = isLightModeRef.current
      const scheme = colorSchemeRef.current

      // LIGHT 控制整体深浅：背景只随 LIGHT；WATER 只改网格和雨色，不改背景
      const isWater = scheme === 'water'
      const bgColor = isLight ? '#FFFFFF' : '#000000'
      const gridColor = isWater ? 'rgba(255, 182, 193, 0.35)' : (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')
      const textColor = isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)'

      // 清除画布（逻辑坐标 w×h，与 scale(dpr) 及 30px 网格一致）
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, w, h)
      
      // 绘制网格背景 - 使用 CSS 尺寸
      if (currentShowGrid) {
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 1
        for (let x = 0; x <= w; x += 30) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
        }
        for (let y = 0; y <= h; y += 30) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
      }
      
      // 确保线条数量正确
      while (linesRef.current.length < currentDensity) {
        linesRef.current.push(createLine(w, h))
      }
      while (linesRef.current.length > currentDensity) {
        linesRef.current.pop()
      }

      // 更新和绘制线条
      linesRef.current.forEach(line => {
        // 更新位置
        line.y += line.velocity * (currentSpeed / 5)
        
        // 如果超出底部，重置到顶部
        if (line.y > h) {
          // 触底低频滴答（密度越高，概率越低，避免过密）
          const impactProb = Math.max(0.04, Math.min(0.62, 36 / Math.max(50, currentDensity)))
          if (Math.random() < impactProb) {
            const xNorm = line.x / Math.max(1, w)
            const vNorm = Math.max(0, Math.min(1, line.velocity / Math.max(1, currentSpeed)))
            triggerImpactDrip(xNorm, vNorm)
          }
          line.y = -line.length
          line.x = Math.random() * w
          line.velocity = currentSpeed * (0.5 + Math.random() * 0.5)
          // 重置颜色（水蓝配色时从水蓝色系中随机）
          line.color = isWater
            ? WATER_BLUE_PALETTE[Math.floor(Math.random() * WATER_BLUE_PALETTE.length)]
            : (Math.random() > 0.7 ? RAIN_RED : (isLight ? '#000000' : '#FFFFFF'))
        }

        // 绘制线条（WATER on 用水蓝；失真：原红雨变为黄 + 微小抖动）
        let stroke = line.color
        let jx = 0
        let jy = 0
        if (!isWater && line.color === RAIN_RED && clipping) {
          stroke = CLIP_YELLOW
          jx = (Math.random() - 0.5) * 3.2
          jy = (Math.random() - 0.5) * 3.2
        }
        ctx.strokeStyle = stroke
        ctx.lineWidth = line.width
        ctx.beginPath()
        ctx.moveTo(line.x + jx, line.y + jy)
        ctx.lineTo(line.x + jx, line.y + line.length + jy)
        ctx.stroke()
        
        // 绘制标签
        if (currentShowLabels && line.showLabel && line.y > 0 && line.y < h) {
          ctx.font = '10px Monaco, Menlo, monospace'
          ctx.fillStyle = textColor
          ctx.fillText(`y:${Math.round(line.y)} v:${line.velocity.toFixed(1)}`, line.x + 8, line.y + line.length / 2)
        }
      })
      
      animationId = requestAnimationFrame(animate)
    }
    
    animate()
    
    return () => {
      window.removeEventListener('resize', resize)
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [triggerImpactDrip])

  // 键盘控制
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSpeed(s => Math.min(30, s + 2))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSpeed(s => Math.max(1, s - 2))
      }
    }
    
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // 控制面板样式（与 animate 内一致，供 JSX 使用）
  const panelBg = isLightMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)'
  const panelBorder = isLightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)'
  const textColor = isLightMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)'
  const btnBorder = isLightMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'
  const btnActive = isLightMode ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)'

  const logoFill = isLightMode ? '#000000' : '#FFFFFF'
  const hintShortcutColor = isLightMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)'

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ backgroundColor: '#000000' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} />

      {/* 左上角小 Logo（与 audio-visual 同款 SVG）：黑底白字 / 白底黑字 */}
      <div className="absolute top-4 left-4 z-30 w-24 h-auto pointer-events-none" aria-hidden>
        <svg viewBox={STUDIO_LOGO_VIEWBOX} className="w-full h-auto">
          {STUDIO_LOGO_PATHS.map((d, i) => (
            <path key={i} fill={logoFill} d={d} />
          ))}
        </svg>
      </div>

      {/* 右上角：视觉面板 + 声音/快捷键面板，小间距堆叠 */}
      <div
        className={`absolute top-4 right-4 z-50 flex w-[160px] flex-col gap-1 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div
          className={`flex max-h-[min(48vh,360px)] flex-col gap-2 overflow-y-auto rounded-lg p-3 ${isLightMode ? 'rain-panel-light' : ''}`}
          style={{
            background: panelBg,
            border: `1px solid ${panelBorder}`,
            color: textColor,
          }}
        >
          <div>
            <label
              className="mb-1 block text-[10px] font-ui"
              style={{ color: textColor }}
            >
              speed: {speed} (↑↓)
            </label>
            <input
              type="range"
              min="1"
              max="30"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: 'white' }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-[10px] font-ui"
              style={{ color: textColor }}
            >
              density: {density} (+/−500, + disabled if FPS &lt; ½ refresh)
            </label>
            <input
              type="range"
              min="10"
              max="2000"
              value={Math.min(density, 2000)}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: 'white' }}
            />
          </div>
          <RippleButton
            onClick={() => setShowGrid(!showGrid)}
            className="w-full rounded-md border px-2 py-1 text-left text-[10px] font-ui"
            style={{
              borderColor: btnBorder,
              color: showGrid ? btnActive : textColor,
            }}
          >
            grid: {showGrid ? 'on' : 'off'}
          </RippleButton>
          <RippleButton
            onClick={() => setShowLabels(!showLabels)}
            className="w-full rounded-md border px-2 py-1 text-left text-[10px] font-ui"
            style={{
              borderColor: btnBorder,
              color: showLabels ? btnActive : textColor,
            }}
          >
            labels: {showLabels ? 'on' : 'off'}
          </RippleButton>
          <RippleButton
            onClick={() => setIsLightMode(!isLightMode)}
            className="w-full rounded-md border px-2 py-1 text-left text-[10px] font-ui"
            style={{
              borderColor: btnBorder,
              color: isLightMode ? btnActive : textColor,
              background: isLightMode ? 'rgba(0,0,0,0.1)' : 'transparent',
            }}
          >
            light: {isLightMode ? 'on' : 'off'}
          </RippleButton>
          <RippleButton
            onClick={() => setColorScheme((s) => (s === 'water' ? 'default' : 'water'))}
            className="w-full rounded-md border px-2 py-1 text-left text-[10px] font-ui"
            style={{
              borderColor: btnBorder,
              color: colorScheme === 'water' ? btnActive : textColor,
              background: colorScheme === 'water' ? 'rgba(0,191,255,0.15)' : 'transparent',
            }}
          >
            water: {colorScheme === 'water' ? 'on' : 'off'}
          </RippleButton>
        </div>

        <div
          className={`flex max-h-[min(42vh,320px)] flex-col gap-2 overflow-y-auto rounded-lg p-3 ${isLightMode ? 'rain-panel-light' : ''}`}
          style={{
            background: panelBg,
            border: `1px solid ${panelBorder}`,
            color: textColor,
          }}
        >
          <div
            className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-[9px] font-ui leading-snug"
            style={{ color: hintShortcutColor }}
          >
            <div className="flex items-center gap-1.5">
              <KeyCapButton
                letter="N"
                title="N · 噪声模式 · 静音 → 白 → 粉 → 棕 · 点击切换"
                onActivate={cycleNoiseMode}
              />
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0 font-ui">噪声</span>
                <span className="text-[0.65rem] opacity-70 font-ui">noise · {noiseMode}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <KeyCapButton
                letter="M"
                title="M · 麦克风环境声 → 雨滴分析 · 点击开关"
                onActivate={toggleMic}
              />
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0 font-ui">麦克风</span>
                <span className="text-[0.65rem] opacity-70 font-ui">mic · {micOn ? 'on' : 'off'}</span>
              </span>
            </div>
            <GlobalShortcutsHint color={hintShortcutColor} noOuterBorder />
          </div>
        </div>
      </div>
      <style>{`
        .rain-panel-light input[type="range"]::-webkit-slider-thumb {
          border: 1px solid rgba(0,0,0,0.3);
        }
        .rain-panel-light input[type="range"]::-moz-range-thumb {
          border: 1px solid rgba(0,0,0,0.3);
        }
      `}</style>
      
      {/* 左下角：display-p3 VU 在左，注释在右，同高对齐 */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-40 flex items-stretch gap-3">
        <div
          className="relative w-2.5 shrink-0 overflow-hidden rounded-sm border"
          style={{ borderColor: isLightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.28)' }}
          title="VU meter · display-p3 gradient"
          aria-hidden
        >
          <div
            ref={vuMeterFillRef}
            className="absolute bottom-0 left-0 right-0 h-full w-full origin-bottom"
            style={{
              transform: 'scaleY(0)',
              transformOrigin: 'bottom center',
              backgroundImage:
                'linear-gradient(to top, #ff3b2e, #f5d020, #22e066), linear-gradient(to top, color(display-p3 0.98 0.18 0.12), color(display-p3 0.95 0.85 0.08), color(display-p3 0.12 0.95 0.42))',
            }}
          />
        </div>
        <div
          className="flex max-w-[min(52vw,280px)] flex-col justify-center space-y-0.5 self-stretch text-[10px] font-ui leading-snug"
          style={{ color: isLightMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)' }}
        >
          <div>
            fps: {hudFps.toFixed(0)} · xy: {pointerCoords.x},{pointerCoords.y}
          </div>
          <div title="基准密度（UI）；实际条数随音量调制">particles: {density} (audio-mod)</div>
          <div title="声音条为输入音量映射（非 density 映射）">
            volume meter: mapped from input loudness
          </div>
          <div>
            audio: {noiseMode} · mic: {micOn ? 'on' : 'off'}
            {colorScheme === 'water' ? ' · LP underwater' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
