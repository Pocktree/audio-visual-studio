import { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { FluidShaderCanvas } from './FluidShader'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'

const WIDE_GAMUT = {
  red: 'color(display-p3 1 0 0)',
  green: 'color(display-p3 0 1 0)',
  white: 'color(display-p3 1 1 1)',
  black: '#000000',
}
// AUDIO-VISUAL 下半区默认块色：西柚色 / 薄荷绿
const BLOCK_COLORS = {
  heavy: '#ff7f50',   // 西柚色
  light: '#00FFCC',  // 薄荷绿
}

// SMPTE 75% 彩条
const SMPTE_BARS = [
  { name: '灰', hex: '#BFBFBF' },
  { name: '黄', hex: '#E6E600' },
  { name: '青', hex: '#00E6E6' },
  { name: '绿', hex: '#00E600' },
  { name: '品', hex: '#E600E6' },
  { name: '红', hex: '#E60000' },
  { name: '蓝', hex: '#0000E6' },
  { name: '黑', hex: '#000000' },
]

const GRAYSCALE_STEPS = 24
const SMPTE_COLORS = SMPTE_BARS.map((b) => b.hex)
const GRAYSCALE_COLORS = Array.from({ length: GRAYSCALE_STEPS }, (_, i) => {
  const v = Math.round((i / (GRAYSCALE_STEPS - 1)) * 255)
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`
})

const BAR_TRANSITION = 'background-color 0.2s linear'

/** 字体加载检测 - 简化版，直接返回true因为我们用SVG Logo不需要加载字体 */
function useFontLoaded() {
  return true
}

export function IndustrialTypoModule({ fontFamily }) {
  const [fontWeight, setFontWeight] = useState(100)
  const [invertColors, setInvertColors] = useState(false)
  const [colorTestMode, setColorTestMode] = useState('fluid') // 'none' | 'smpte' | 'grayscale' | 'fluid'，默认 fluid
  const [bottomLogoColor, setBottomLogoColor] = useState('#000000') // 下半部分 Logo 颜色
  const [showColorButtons, setShowColorButtons] = useState(false) // 鼠标靠近时三按钮一起显示
  const [paused, setPaused] = useState(false) // 仅下半区 SMPTE/GRAY/FLUID 的播放/暂停，默认播放
  const [liveTime, setLiveTime] = useState(0) // 实时计时（秒），用于左下角速率/频率类显示
  const fontLoaded = useFontLoaded()

  // ════════════════════════════════════════════════════════════════════════
  // AISA × FASCA 规范：Tone.js 双合成器 + 十字渐变音频系统
  // ─ 示波器模式（上部）：FMSynth 离散扫描滴声
  // ─ 流体模式（下部）：AMSynth 调幅 Drone + LFO 呼吸滤波
  // ─ 鼠标 Y 位置控制两极 Crossfade
  // ════════════════════════════════════════════════════════════════════════

  const [audioInitialized, setAudioInitialized] = useState(false)
  const [audioWanted, setAudioWanted] = useState(true)
  const [oscVol, setOscVol] = useState(0) // 实时显示用
  const [fluidVol, setFluidVol] = useState(0)
  const [stereoMode, setStereoMode] = useState('pingpong') // pingpong | crossover | phase
  const [phaseInverted, setPhaseInverted] = useState(false)
  const [phaseAlert, setPhaseAlert] = useState(false)
  const [blindTarget, setBlindTarget] = useState('')
  const [blindHint, setBlindHint] = useState('') // 盲测反馈
  const [leftRatio, setLeftRatio] = useState(50)
  const [rightRatio, setRightRatio] = useState(50)

  // Tone.js 合成器实例（ref，effect 外创建）
  const fmSynthRef = useRef(null)
  const amSynthRef = useRef(null)
  const fluidFilterRef = useRef(null)
  const fluidLFORef = useRef(null)
  const oscPannerRef = useRef(null)
  const fluidPannerRef = useRef(null)
  const oscDelayRef = useRef(null)
  const oscDetuneLfoRef = useRef(null)
  const oscGainRef = useRef(null)
  const fluidGainRef = useRef(null)
  const phaseLeftSynthRef = useRef(null)
  const phaseRightSynthRef = useRef(null)
  const phaseLeftGainRef = useRef(null)
  const phaseRightGainRef = useRef(null)
  const masterGainRef = useRef(null)
  const audioInitializedRef = useRef(false)
  const rafIdRef = useRef(null)
  const tickCounterRef = useRef(0)
  const mouseYRef = useRef(0.5) // 0=top, 1=bottom
  const mouseXRef = useRef(0.5) // 0=left, 1=right
  const tickIntervalRef = useRef(null)
  const blindUntilRef = useRef(0)

  // 初始化所有合成器（首次用户交互后调用）
  const initAudio = useCallback(async () => {
    if (audioInitializedRef.current) return

    // 先创建节点，触发 Tone.js 创建 AudioContext（此时为 suspended）
    const master = new Tone.Gain(0.92).toDestination()
    masterGainRef.current = master

    // ── 示波器滴声：FMSynth（调频合成，金属质感）──────────────────
    const oscGain = new Tone.Gain(0.0).connect(master)
    oscGainRef.current = oscGain
    const oscPan = new Tone.Panner(-1)
    oscPannerRef.current = oscPan
    const oscDelay = new Tone.PingPongDelay({
      delayTime: '16n',
      feedback: 0.16,
      wet: 0.12,
    }).connect(oscGain)
    oscDelayRef.current = oscDelay
    oscPan.connect(oscDelay)
    const fm = new Tone.FMSynth({
      harmonicity: 2.8,
      modulationIndex: 4.8,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.05,
        decay: 0.4,
        sustain: 0.2,
        release: 0.8,
      },
      modulationEnvelope: {
        attack: 0.02,
        decay: 0.28,
        sustain: 0.08,
        release: 0.6,
      },
    }).connect(oscPan)
    fmSynthRef.current = fm
    const oscDetuneLfo = new Tone.LFO({
      frequency: 0.34,
      min: -11,
      max: 11,
    }).connect(fm.detune)
    oscDetuneLfoRef.current = oscDetuneLfo

    // ── 流体 Drone：AMSynth 调幅合成 + LFO 呼吸滤波器 ───────────
    const fGain = new Tone.Gain(0.0).connect(master)
    fluidGainRef.current = fGain
    const fluidFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 400,
      Q: 3.5,
    })
    fluidFilterRef.current = fluidFilter
    const fluidPan = new Tone.Panner(1).connect(fGain)
    fluidPannerRef.current = fluidPan
    const am = new Tone.AMSynth({
      harmonicity: 0.25,
      modulationIndex: 12,
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.4,
        decay: 0.2,
        sustain: 0.85,
        release: 1.8,
      },
      modulationEnvelope: {
        attack: 0.3,
        decay: 0.4,
        sustain: 0.7,
        release: 1.2,
      },
    })
    amSynthRef.current = am
    // LFO：控制滤波器截止频率在 180-700Hz 之间呼吸
    const lfo = new Tone.LFO({
      frequency: 0.18,  // 0.18Hz ≈ 5.5s 一周期
      min: 180,
      max: 700,
    }).connect(fluidFilter.frequency)
    fluidLFORef.current = lfo
    am.connect(fluidFilter)
    fluidFilter.connect(fluidPan)

    // ── 相位检测通道：同频双正弦（可翻转右声道相位）──────────────
    const phaseLeftGain = new Tone.Gain(0).connect(master)
    const phaseRightGain = new Tone.Gain(0).connect(master)
    phaseLeftGainRef.current = phaseLeftGain
    phaseRightGainRef.current = phaseRightGain
    const phaseLeftPan = new Tone.Panner(-1).connect(phaseLeftGain)
    const phaseRightPan = new Tone.Panner(1).connect(phaseRightGain)
    const phaseLeftSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.08, sustain: 1, release: 0.2 },
    }).connect(phaseLeftPan)
    const phaseRightSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.08, sustain: 1, release: 0.2 },
    }).connect(phaseRightPan)
    phaseLeftSynthRef.current = phaseLeftSynth
    phaseRightSynthRef.current = phaseRightSynth

    // 必须在用户手势中调用 Tone.start()，再启动 LFO/触发音源，避免 suspended 警告
    try {
      await Tone.start()
      const ctx = Tone.getContext()
      if (ctx.state !== 'running') await ctx.resume()
    } catch (e) {
      console.warn('[AISA] Tone.start failed:', e)
      return
    }

    lfo.start()
    oscDetuneLfo.start()
    // Drone 作为底层持续音源，靠 crossfade/gain 控制可听占比
    // 轻微抬高 Fluid 基频，让低频感稍微更高一些
    am.triggerAttack(124)
    phaseLeftSynth.triggerAttack(110)
    phaseRightSynth.triggerAttack(110)

    // 真实音频引擎状态：驱动后续 RAF crossfade/tick 逻辑
    audioInitializedRef.current = true
    setAudioInitialized(true)
  }, [])

  // 触发示波器滴声（周期约 550ms，由 CSS animateMotion 周期决定）
  const triggerTick = (mouseY) => {
    const fm = fmSynthRef.current
    if (!fm) return
    // 模式音色微调：A 更亮更脆，B 适中，C 仅保留轻量检测音色
    let baseFreq = 900 + (1 - mouseY) * 1200
    let duration = 0.16
    if (stereoMode === 'pingpong') {
      baseFreq = 1400 + (1 - mouseY) * 2200
      duration = 0.1
    } else if (stereoMode === 'phase') {
      baseFreq = 700 + (1 - mouseY) * 600
      duration = 0.2
    }
    // ±大二度范围内随机偏移，模拟不规则扫描
    const freq = baseFreq * (1 + (Math.random() - 0.5) * 0.06)
    // X 位置控制声像（左右）
    if (oscPannerRef.current) {
      oscPannerRef.current.pan.rampTo((mouseXRef.current - 0.5) * 2, 0.02)
    }
    fm.triggerAttackRelease(freq, duration)
  }

  // 清除所有音频资源
  const disposeAudio = () => {
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    fmSynthRef.current?.dispose()
    try {
      oscDetuneLfoRef.current?.stop()
    } catch {
      /* */
    }
    oscDetuneLfoRef.current?.dispose()
    try {
      amSynthRef.current?.triggerRelease()
    } catch {
      /* */
    }
    amSynthRef.current?.dispose()
    fluidFilterRef.current?.dispose()
    fluidPannerRef.current?.dispose()
    fluidLFORef.current?.dispose()
    try {
      phaseLeftSynthRef.current?.triggerRelease()
      phaseRightSynthRef.current?.triggerRelease()
    } catch {
      /* */
    }
    phaseLeftSynthRef.current?.dispose()
    phaseRightSynthRef.current?.dispose()
    phaseLeftGainRef.current?.dispose()
    phaseRightGainRef.current?.dispose()
    oscDelayRef.current?.dispose()
    oscPannerRef.current?.dispose()
    oscGainRef.current?.dispose()
    fluidGainRef.current?.dispose()
    masterGainRef.current?.dispose()
    fmSynthRef.current = null
    amSynthRef.current = null
    fluidFilterRef.current = null
    fluidLFORef.current = null
    fluidPannerRef.current = null
    oscDelayRef.current = null
    oscDetuneLfoRef.current = null
    oscPannerRef.current = null
    oscGainRef.current = null
    fluidGainRef.current = null
    phaseLeftSynthRef.current = null
    phaseRightSynthRef.current = null
    phaseLeftGainRef.current = null
    phaseRightGainRef.current = null
    masterGainRef.current = null
    audioInitializedRef.current = false
  }

  // 切换离开 studio 模式时，确保声音立即停止
  useEffect(() => {
    return () => {
      disposeAudio()
    }
  }, [])

  // Studio 模式默认开声：页面已激活则立即播，否则首次手势自动补开
  useEffect(() => {
    let disposed = false
    const tryInit = async () => {
      if (disposed || !audioWanted || audioInitializedRef.current) return
      try {
        await initAudio()
      } catch {
        /* */
      }
    }
    const onFirstGesture = () => {
      if (!audioWanted || audioInitializedRef.current) return
      void tryInit()
    }

    const userActivation = navigator.userActivation
    if (userActivation?.hasBeenActive) {
      void tryInit()
    } else if (audioWanted && !audioInitializedRef.current) {
      window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true })
      window.addEventListener('keydown', onFirstGesture, { once: true })
    }

    return () => {
      disposed = true
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('keydown', onFirstGesture)
    }
  }, [audioWanted, initAudio])

  // 鼠标位置监听（控制 Crossfade）
  useEffect(() => {
    const container = document.getElementById('industrial-typo-root')
    if (!container) return
    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      mouseXRef.current = x
      mouseYRef.current = y
    }
    container.addEventListener('mousemove', handleMouseMove)
    return () => container.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // 主音频循环（三模式立体声检测）
  useEffect(() => {
    if (!audioInitializedRef.current) return

    const T = 50 // ms

    const tickRaf = () => {
      tickCounterRef.current = (tickCounterRef.current + 1) || 0
      const nowSec = performance.now() / 1000
      const blindActive = nowSec < blindUntilRef.current && (blindTarget === 'LEFT' || blindTarget === 'RIGHT')
      const side = Math.floor(nowSec / 2) % 2 === 0 ? 'LEFT' : 'RIGHT'
      const activeSide = blindActive ? blindTarget : side
      const t = Math.max(0, Math.min(1, mouseYRef.current))
      const cross = t * t * (3 - 2 * t) // smoothstep
      const baseOsc = 1 - cross
      const baseFluid = cross
      const balanceNorm = Math.max(0, Math.min(1, mouseXRef.current))
      const leftMul = 0.2 + (1 - balanceNorm) * 1.6
      const rightMul = 0.2 + balanceNorm * 1.6

      let oscWeight = baseOsc
      let fluidWeight = baseFluid
      let phaseL = 0
      let phaseR = 0

      if (stereoMode === 'pingpong') {
        const leftFocus = activeSide === 'LEFT' ? 1 : 0.3
        const rightFocus = activeSide === 'RIGHT' ? 1 : 0.3
        oscWeight = baseOsc * leftFocus
        fluidWeight = baseFluid * rightFocus
      } else if (stereoMode === 'crossover') {
        if (blindActive) {
          oscWeight = activeSide === 'LEFT' ? 1 : 0
          fluidWeight = activeSide === 'RIGHT' ? 1 : 0
        } else {
          oscWeight = Math.max(0.22, baseOsc * 0.9)
          fluidWeight = Math.max(0.22, baseFluid * 0.9)
        }
      } else {
        // Phase 模式仍保留鼠标上下主映射，但幅度更克制
        oscWeight = baseOsc * 0.36
        fluidWeight = baseFluid * 0.36
        phaseL = (blindActive ? (activeSide === 'LEFT' ? 0.35 : 0) : 0.35) * leftMul
        phaseR = (blindActive ? (activeSide === 'RIGHT' ? 0.35 : 0) : (phaseInverted ? -0.35 : 0.35)) * rightMul
      }

      if (oscPannerRef.current) {
        oscPannerRef.current.pan.rampTo(-1, 0.02)
      }
      if (fluidPannerRef.current) {
        fluidPannerRef.current.pan.rampTo(1, 0.02)
      }

      // 仅在 phase 模式启用 phase 通道
      if (phaseLeftGainRef.current) phaseLeftGainRef.current.gain.rampTo(phaseL, 0.01)
      if (phaseRightGainRef.current) phaseRightGainRef.current.gain.rampTo(phaseR, 0.01)
      if (oscGainRef.current) oscGainRef.current.gain.rampTo(oscWeight * 0.55 * leftMul, 0.008)
      if (fluidGainRef.current) fluidGainRef.current.gain.rampTo(fluidWeight * 0.35 * rightMul, 0.008)
      setLeftRatio(Math.round((1 - balanceNorm) * 100))
      setRightRatio(Math.round(balanceNorm * 100))

      setOscVol(oscWeight)
      setFluidVol(fluidWeight)
      setPhaseAlert(stereoMode === 'phase' && phaseInverted)

      // 高频左声道脉冲
      if (tickCounterRef.current % 16 === 0 && oscWeight > 0.05) {
        triggerTick(0.04)
      }

      // LFO 频率跟随 hue drift 速率（hue 越快 → LFO 越快 → 呼吸越急促）
      const driftRate = 14 // HUE_DRIFT_DPS
      const lfoFreq = 0.12 + (driftRate / 14) * 0.45  // 0.12-0.57Hz
      if (fluidLFORef.current) {
        fluidLFORef.current.frequency.rampTo(lfoFreq, T / 1000 * 2)
      }

      rafIdRef.current = requestAnimationFrame(tickRaf)
    }

    rafIdRef.current = requestAnimationFrame(tickRaf)
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [audioInitialized, blindTarget, phaseInverted, stereoMode])

  // 模式切换时做轻量音色重标定
  useEffect(() => {
    if (!audioInitializedRef.current) return
    if (stereoMode === 'pingpong') {
      fmSynthRef.current?.set({
        harmonicity: 3.4,
        modulationIndex: 6.2,
        envelope: { attack: 0.004, decay: 0.09, sustain: 0.02, release: 0.14 },
      })
      amSynthRef.current?.set({
        harmonicity: 0.2,
        modulationIndex: 9,
      })
      try {
        amSynthRef.current?.setNote(92)
        phaseLeftSynthRef.current?.setNote(110)
        phaseRightSynthRef.current?.setNote(110)
      } catch {
        /* */
      }
    } else if (stereoMode === 'crossover') {
      fmSynthRef.current?.set({
        harmonicity: 2.6,
        modulationIndex: 4.8,
        envelope: { attack: 0.01, decay: 0.14, sustain: 0.04, release: 0.2 },
      })
      amSynthRef.current?.set({
        harmonicity: 0.3,
        modulationIndex: 10,
      })
      try {
        amSynthRef.current?.setNote(118)
        phaseLeftSynthRef.current?.setNote(110)
        phaseRightSynthRef.current?.setNote(110)
      } catch {
        /* */
      }
    } else {
      fmSynthRef.current?.set({
        harmonicity: 2.2,
        modulationIndex: 3.8,
        envelope: { attack: 0.015, decay: 0.2, sustain: 0.02, release: 0.24 },
      })
      amSynthRef.current?.set({
        harmonicity: 0.24,
        modulationIndex: 8,
      })
      try {
        amSynthRef.current?.setNote(110)
        phaseLeftSynthRef.current?.setNote(96)
        phaseRightSynthRef.current?.setNote(96)
      } catch {
        /* */
      }
    }
  }, [audioInitialized, stereoMode])

  // 音频开启/关闭：默认希望为开启状态
  const toggleAudio = async () => {
    if (audioInitializedRef.current) {
      disposeAudio()
      setAudioInitialized(false)
      setOscVol(0)
      setFluidVol(0)
      setAudioWanted(false)
    } else {
      setAudioWanted(true)
      await initAudio()
    }
  }

  const startBlindTest = () => {
    const target = Math.random() > 0.5 ? 'LEFT' : 'RIGHT'
    blindUntilRef.current = performance.now() / 1000 + 1.4
    setBlindTarget(target)
    setBlindHint('Blind: which side is playing? click top=LEFT / bottom=RIGHT')
  }

  const handleStudioClick = (e) => {
    setBottomLogoColor((c) => (c === '#000000' ? '#FFFFFF' : '#000000'))
    if (performance.now() / 1000 <= blindUntilRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      const y = (e.clientY - rect.top) / rect.height
      const guess = y < 0.5 ? 'LEFT' : 'RIGHT'
      setBlindHint(guess === blindTarget ? 'Blind test: correct' : `Blind test: wrong (${blindTarget})`)
      blindUntilRef.current = 0
      setBlindTarget('')
    }
  }

  // 实时计时：每 100ms 更新，供左下角显示
  const liveStartRef = useRef(0)
  useEffect(() => {
    liveStartRef.current = performance.now() / 1000
    const t = setInterval(() => {
      setLiveTime(((performance.now() / 1000) - liveStartRef.current))
    }, 100)
    return () => clearInterval(t)
  }, [])

  // 动态粗细：点击切换 100 <-> 900
  useEffect(() => {
    const handleClick = () => {
      setFontWeight((prev) => (prev === 100 ? 900 : 100))
      setInvertColors((prev) => !prev)
    }

    const handleKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFontWeight((prev) => (prev === 100 ? 900 : 100))
        setInvertColors((prev) => !prev)
      }
    }

    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [])

  // 背景和文字颜色
  const bgColor = invertColors ? WIDE_GAMUT.white : WIDE_GAMUT.black
  const textColor = invertColors ? WIDE_GAMUT.black : WIDE_GAMUT.white
  const blockColor = fontWeight === 900 ? BLOCK_COLORS.heavy : BLOCK_COLORS.light
  // 本模式使用的色值（用于左上角显示）
  const traceColorHex = invertColors ? '#FF6B4A' : '#00FFCC'
  // 走马灯颜色切换速率（SMPTE/GRAY 为 1 index/s，FLUID 无）
  const creepSpeed = 1
  const creepRateLabel = colorTestMode === 'smpte' || colorTestMode === 'grayscale' ? `${creepSpeed}/s` : '—'
  
  // 颜色测试选项
  const colorModes = [
    { id: 'smpte', label: 'SMPTE' },
    { id: 'grayscale', label: 'GRAY' },
    { id: 'fluid', label: 'FLUID' },
  ]

  // 样式
  const containerStyle = {
    backgroundColor: bgColor,
    color: textColor,
  }

  // 四角小字：灰色注释，任意背景下可见，不随点击改变
  const labelStyle = {
    fontFamily: 'Monaco, Menlo, monospace',
    fontSize: '10px',
    color: 'rgba(140,140,140,0.9)',
    textShadow: '0 0 2px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
  }
  const channelLabelStyle = {
    ...labelStyle,
    textShadow: 'none',
  }

  // 字体未加载时显示Loading
  if (!fontLoaded) {
    return (
      <div 
        className="w-full h-full flex flex-col"
        style={{ backgroundColor: WIDE_GAMUT.red }}
      >
        <div className="flex-1" />
        <div className="h-[50%]" style={{ backgroundColor: WIDE_GAMUT.black }} />
      </div>
    )
  }

  return (
    <div
      id="industrial-typo-root"
      className="w-full h-full flex flex-col relative cursor-pointer"
      style={{ ...containerStyle, fontFamily: fontFamily ?? 'Inter, sans-serif' }}
      onClick={handleStudioClick}
    >
      {/* 左上角 - 色值 + 走马灯速率，小字固定白+描边始终可见 */}
      <div className="absolute top-4 left-4 font-mono z-[30]" style={labelStyle}>
        <div title="中心区背景">Center: #050508</div>
        <div title="轨迹/高亮">Trace: {traceColorHex}</div>
        <div title="走马灯颜色切换速率 (index/s)">Creep: {creepRateLabel}</div>
      </div>
      <div className="absolute top-1/4 -translate-y-1/2 right-4 z-[30] font-mono text-[10px]" style={channelLabelStyle}>
        CH-L {leftRatio}%
      </div>
      <div className="absolute top-3/4 -translate-y-1/2 right-4 z-[30] font-mono text-[10px]" style={channelLabelStyle}>
        CH-R {rightRatio}%
      </div>

      {/* 中心 SVG Logo 示波器追踪模式 */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#050508' }}>
        {/* 10px 像素网格背景 */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0,255,204,0.08) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,255,204,0.08) 1px, transparent 1px)
            `,
            backgroundSize: '10px 10px',
          }}
        />
        
        {/* 示波器 Logo */}
        <OscilloscopeLogo 
          invertColors={invertColors} 
          triggerGlitch={fontWeight}
        />
        
        {/* 电子火花粒子 */}
        <ElectronSparks />
      </div>

      {/* 下方50%高度 - 颜色测试区域 */}
      <div className="w-full h-[50%] relative overflow-hidden">
        
        {/* 固定中间的 Logo - 始终显示 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 10 }}>
          <svg
            viewBox="0 0 310.61 122.86"
            className="w-[clamp(200px,50vw,500px)] h-auto"
          >
            <path fill={bottomLogoColor} d="M63.25,32.32v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z"/>
            <path fill={bottomLogoColor} d="M97.48,21.6v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01,0-8.25,5.19-13.8,12.83-13.8,4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM90.86,45.84c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z"/>
            <path fill={bottomLogoColor} d="M110.7,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM110.45,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z"/>
            <path fill={bottomLogoColor} d="M202.29,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67c0-2.14,1.48-3.67,3.57-3.67s3.57,1.53,3.57,3.67ZM202.04,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z"/>
            <path fill={bottomLogoColor} d="M216.61,37.03c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z"/>
            <path fill={bottomLogoColor} d="M17.88,81.75c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z"/>
            <path fill={bottomLogoColor} d="M257.3,32.14v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z"/>
            <path fill={bottomLogoColor} d="M279.2,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52ZM279.15,49.92v-2.45s-6.88,0-6.88,0c-3.51,0-5.14.97-5.14,3.36s1.83,3.77,4.84,3.77c3.82,0,6.82-2.04,7.18-4.69Z"/>
            <path fill={bottomLogoColor} d="M24.96,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52ZM24.91,49.92v-2.45s-6.88,0-6.88,0c-3.51,0-5.14.97-5.14,3.36s1.83,3.77,4.84,3.77c3.82,0,6.82-2.04,7.18-4.69Z"/>
            <path fill={bottomLogoColor} d="M296.91,21.6v37.79s-6.62,0-6.62,0V21.6s6.62,0,6.62,0Z"/>
            <path fill={bottomLogoColor} d="M50.23,102.27c-2.09,1.27-4.43,1.99-6.82,1.99-4.43,0-8-2.55-8-8.15v-13.45s-3.82,0-3.82,0l-.05-4.84h3.87s0-7.49,0-7.49h6.57v7.49s5.67,0,5.67,0v4.84h-5.67s0,12.27,0,12.27c0,2.6,1.07,3.46,2.85,3.46,1.12,0,2.39-.41,3.87-1.12l1.53,4.99Z"/>
            <path fill={bottomLogoColor} d="M78.43,76.67v27.25s-6.67,0-6.67,0v-5.04c-1.42,3.72-4.12,5.3-8.45,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,5.8-3.41,5.8-7.79v-13.45h6.67Z"/>
            <path fill={bottomLogoColor} d="M110.45,66.16v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01s5.19-13.8,12.83-13.8c4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM103.83,90.4c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z"/>
            <path fill={bottomLogoColor} d="M124.26,68.91c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM124,76.7v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z"/>
            <path fill={bottomLogoColor} d="M287.47,84.02c-2.79-3.29-6.26-7.39-13-7.39s-10.21,4.1-12.99,7.39c-2.82,3.33-4.75,5.36-8.63,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.62,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.61,5.36s-5.58-2.04-8.28-5.36c-.73-.9-1.51-1.86-2.39-2.78-1.12-1.33-2.52-2.42-4.15-3.21-.38-.2-.8-.36-1.22-.52-.01,0-.02,0-.03-.01-.65-.25-1.35-.45-2.09-.59-.29-.06-.59-.13-.89-.17-.11-.01-.21-.03-.33-.04-.81-.11-1.64-.18-2.51-.18-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,7.66,0,13.12-4.56,14.13-11.53,2,1.42,4.47,2.43,7.75,2.43,6.73,0,10.2-4.1,12.99-7.39,2.82-3.32,4.74-5.36,8.62-5.36s5,2.04,8.62,5.36c2.79,3.29,6,7.39,12.99,7.39s10.2-4.1,12.99-7.39c2.82-3.33,4.74-5.36,8.62-5.36s5.8,2.04,8.62,5.36c2.79,3.29,6.26,7.39,12.99,7.39s10.21-4.1,13-7.39c2.82-3.32,4.75-5.36,8.63-5.36s5,2.04,8.63,5.36c2.79,3.29,7.08,7.39,13.81,7.39v-5.73c-3.88,0-6.62-2.04-9.44-5.36ZM144.53,98.66c-4.58,0-7.74-3.36-7.74-8.25s3.16-8.25,7.74-8.25,7.64,3.36,7.64,8.25-3.16,8.25-7.64,8.25Z"/>
            <path fill={bottomLogoColor} d="M182.33,45.55c-1.13,3.03-3.02,8.11-4.57,8.11s-3.43-5.08-4.56-8.11c-2.06-5.55-4.41-11.85-9.93-11.85-5.31,0-7.6,4.6-9.28,7.96-1.62,3.26-2.56,4.79-4.15,4.79s-2.71-1.57-4.55-4.9c-1.03-1.86-2.21-3.94-3.85-5.5-2.53-2.76-6.31-4.37-10.87-4.37-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,6.88,0,11.98-3.66,13.69-9.45,1.43,1.32,3.21,2.24,5.59,2.24,5.31,0,7.6-4.6,9.28-7.96,1.62-3.26,2.56-4.79,4.15-4.79s3.43,5.08,4.56,8.11c2.06,5.55,4.41,11.85,9.93,11.85s7.87-6.29,9.94-11.85c1.13-3.03,3.02-8.11,4.57-8.11v-5.73c-5.53,0-7.87,6.29-9.94,11.85ZM130.56,53.84c-4.58,0-7.74-3.36-7.74-8.25s3.16-8.25,7.74-8.25,7.64,3.36,7.64,8.25-3.16,8.25-7.64,8.25Z"/>
          </svg>
        </div>
        
        {/* 中央消隐控制区：单排统一样式 */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 z-20 w-[min(98vw,1120px)] h-14 flex items-center justify-center"
          onMouseEnter={() => setShowColorButtons(true)}
          onMouseLeave={() => setShowColorButtons(false)}
        >
          <div
            className={`flex items-center gap-1 whitespace-nowrap transition-opacity duration-200 ${
              showColorButtons ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          >
            {colorModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setColorTestMode(colorTestMode === mode.id ? 'none' : mode.id)}
                className="px-2 py-1 text-[9px] font-mono rounded transition-all"
                style={{
                  backgroundColor: colorTestMode === mode.id ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.6)',
                  color: colorTestMode === mode.id ? '#000' : 'rgba(255,255,255,0.82)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
              >
                {mode.label}
              </button>
            ))}
            {[
              { id: 'pingpong', label: 'PingPong' },
              { id: 'crossover', label: 'Xover' },
              { id: 'phase', label: 'Phase' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setStereoMode(m.id)}
                className="px-2 py-1 text-[9px] font-mono rounded transition-all"
                style={{
                  backgroundColor: stereoMode === m.id ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.6)',
                  color: stereoMode === m.id ? '#000' : 'rgba(255,255,255,0.82)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
                title={`mode ${m.label}`}
              >
                {m.label}
              </button>
            ))}
            <button
              onClick={startBlindTest}
              className="px-2 py-1 text-[9px] font-mono rounded transition-all"
              style={{
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
              title="随机播放单边，点击上下区域作答"
            >
              blind
            </button>
            {stereoMode === 'phase' && (
              <button
                onClick={() => setPhaseInverted((v) => !v)}
                className="px-2 py-1 text-[9px] font-mono rounded transition-all"
                style={{
                  backgroundColor: phaseInverted ? 'rgba(255,80,80,0.18)' : 'rgba(0,0,0,0.6)',
                  color: phaseInverted ? '#ff8a8a' : 'rgba(255,255,255,0.82)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
              >
                phase {phaseInverted ? 'inv' : 'norm'}
              </button>
            )}
            <button
              onClick={() => setPaused((p) => !p)}
              className="px-2 py-1 text-[9px] font-mono rounded transition-all"
              style={{
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
              title={paused ? '播放 (下半区 SMPTE/GRAY/FLUID)' : '暂停 (下半区)'}
              aria-label={paused ? '播放' : '暂停'}
            >
              {paused ? 'play' : 'pause'}
            </button>
            <button
              onClick={toggleAudio}
              className="px-2 py-1 text-[9px] font-mono rounded transition-all"
              style={{
                backgroundColor: audioInitialized
                  ? (oscVol > fluidVol ? 'rgba(0,200,255,0.15)' : 'rgba(255,120,0,0.15)')
                  : 'rgba(0,0,0,0.6)',
                color: audioInitialized ? (oscVol > fluidVol ? '#00C8FF' : '#FF7800') : 'rgba(255,255,255,0.82)',
                border: `1px solid ${
                  audioInitialized
                    ? (oscVol > fluidVol ? 'rgba(0,200,255,0.6)' : 'rgba(255,120,0,0.6)')
                    : 'rgba(255,255,255,0.25)'
                }`,
              }}
              title={audioInitialized ? '点击关闭音频' : '音频 OFF · 点击开启'}
              aria-label={audioInitialized ? '关闭音频' : '开启音频'}
            >
              audio
            </button>
          </div>
        </div>

        {stereoMode === 'phase' && (
          <div
            className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] pointer-events-none"
            style={{
              backgroundColor: phaseAlert ? 'rgba(255,90,90,0.95)' : 'rgba(255,255,255,0.35)',
              boxShadow: phaseAlert ? '0 0 10px rgba(255,90,90,0.9)' : 'none',
              opacity: phaseAlert ? (0.55 + Math.abs(Math.sin(liveTime * 8)) * 0.45) : 0.6,
              transition: 'opacity 0.08s linear',
            }}
          />
        )}

        {/* SMPTE 彩条 - 色彩索引平移，rAF 驱动，无重渲染 */}
        {colorTestMode === 'smpte' && <SMPTECreepBars speed={1} paused={paused} />}

        {/* 灰度渐变 - 明暗波浪流动，CSS 变量 + rAF */}
        {colorTestMode === 'grayscale' && <GrayscaleCreepBars speed={1} paused={paused} />}

        {/* 流体 - GPU Shader 西柚色系 + 拓扑等高线 */}
        {colorTestMode === 'fluid' && (
          <div className="absolute inset-0 overflow-hidden">
            <FluidShaderCanvas paused={paused} />
          </div>
        )}

        {/* 默认状态：西柚色 / 薄荷绿块，无数字 */}
        {colorTestMode === 'none' && (
          <div className="w-full h-full" style={{ backgroundColor: blockColor }} />
        )}
      </div>

      {/* 左下角 - 实时参数（计时）+ 操作说明，小字固定白+描边始终可见 */}
      <div className="absolute bottom-[52%] left-4 font-mono z-[30]" style={labelStyle}>
        <div title="运行时间 Run time (s)">T · Time: {liveTime.toFixed(2)} s</div>
        <div title="下半区顶部靠近唤出 SMPTE/GRAY/FLUID">Color: hover top to show</div>
        <div title="立体声检测模式">Stereo: {stereoMode}</div>
        {blindHint ? <div title="盲测反馈">{blindHint}</div> : null}
        <GlobalShortcutsHint variant="inline" color="rgba(140,140,140,0.9)" />
      </div>

      {/* 右下角 - 色彩模式 + 音频状态 */}
      <div className="absolute bottom-[52%] right-4 font-mono text-right z-[30]" style={labelStyle}>
        <div title="下半区色彩模式 Color test mode">COLOR · Mode: {colorTestMode}</div>
        {audioInitialized && (
          <div style={{ color: oscVol > fluidVol ? 'rgba(0,200,255,0.6)' : 'rgba(255,120,0,0.6)' }}>
            {oscVol > fluidVol
              ? `OSCi ◇ ${(oscVol * 100).toFixed(0)}%`
              : `FLUID ◇ ${(fluidVol * 100).toFixed(0)}%`}
          </div>
        )}
      </div>
    </div>
  )
}

/** SMPTE 彩条 - 色彩索引平移：固定 8 个条位，颜色数组循环更替，rAF 驱动，直接写 DOM，无 setState */
function SMPTECreepBars({ speed = 1, paused = false }) {
  const refs = useRef([])
  const offsetRef = useRef(0)
  const lastTimeRef = useRef(null)
  const speedRef = useRef(speed)
  const pausedRef = useRef(paused)
  speedRef.current = speed
  pausedRef.current = paused

  useEffect(() => {
    const n = SMPTE_COLORS.length
    let rafId = null
    const tick = (now) => {
      if (pausedRef.current) {
        rafId = requestAnimationFrame(tick)
        return
      }
      lastTimeRef.current ??= now
      const deltaSec = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      offsetRef.current += deltaSec * speedRef.current
      const offset = offsetRef.current
      for (let i = 0; i < n; i++) {
        const el = refs.current[i]
        if (!el) continue
        const idx = (i + Math.floor(offset)) % n
        if (el.style.backgroundColor !== SMPTE_COLORS[idx]) {
          el.style.backgroundColor = SMPTE_COLORS[idx]
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      lastTimeRef.current = null
    }
  }, [paused])

  return (
    <div className="absolute inset-0 flex">
      {SMPTE_COLORS.map((_, i) => (
        <div
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className="flex-1 h-full"
          style={{
            backgroundColor: SMPTE_COLORS[i],
            transition: BAR_TRANSITION,
          }}
        />
      ))}
    </div>
  )
}

/** 灰度渐变 - 明暗波浪流动：CSS 变量 --bg-color，rAF 驱动索引平移，直接写 DOM */
function GrayscaleCreepBars({ speed = 1, paused = false }) {
  const refs = useRef([])
  const offsetRef = useRef(0)
  const lastTimeRef = useRef(null)
  const speedRef = useRef(speed)
  const pausedRef = useRef(paused)
  speedRef.current = speed
  pausedRef.current = paused

  useEffect(() => {
    const n = GRAYSCALE_COLORS.length
    let rafId = null
    const tick = (now) => {
      if (pausedRef.current) {
        rafId = requestAnimationFrame(tick)
        return
      }
      lastTimeRef.current ??= now
      const deltaSec = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      offsetRef.current += deltaSec * speedRef.current
      const offset = offsetRef.current
      for (let i = 0; i < n; i++) {
        const el = refs.current[i]
        if (!el) continue
        const idx = (i + Math.floor(offset)) % n
        const hex = GRAYSCALE_COLORS[idx]
        if (el.style.getPropertyValue('--bg-color') !== hex) {
          el.style.setProperty('--bg-color', hex)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      lastTimeRef.current = null
    }
  }, [paused])

  return (
    <div className="absolute inset-0 flex">
      {GRAYSCALE_COLORS.map((hex, i) => (
        <div
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className="flex-1 h-full"
          style={{
            backgroundColor: 'var(--bg-color)',
            ['--bg-color']: hex,
            transition: BAR_TRANSITION,
          }}
        />
      ))}
    </div>
  )
}

// ==================== 示波器追踪 Logo 组件 ====================
function OscilloscopeLogo({ invertColors, triggerGlitch }) {
  const svgRef = useRef(null)
  const pathLengths = Array.from({ length: 16 }, (_, i) => 500 + ((i * 97) % 500))
  const [glitchActive, setGlitchActive] = useState(false)
  const [jitterOffset, setJitterOffset] = useState({ x: 0, y: 0 })
  
  // 示波器青色
  const traceColor = invertColors ? '#FF6B4A' : '#00FFCC'
  
  // Logo 路径数据
  const logoPaths = [
    "M63.25,32.32v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z",
    "M97.48,21.6v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01,0-8.25,5.19-13.8,12.83-13.8,4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM90.86,45.84c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z",
    "M110.7,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM110.45,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z",
    "M202.29,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67c0-2.14,1.48-3.67,3.57-3.67s3.57,1.53,3.57,3.67ZM202.04,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z",
    "M216.61,37.03c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z",
    "M17.88,81.75c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z",
    "M257.3,32.14v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z",
    "M279.2,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52Z",
    "M24.96,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52Z",
    "M296.91,21.6v37.79s-6.62,0-6.62,0V21.6s6.62,0,6.62,0Z",
    "M50.23,102.27c-2.09,1.27-4.43,1.99-6.82,1.99-4.43,0-8-2.55-8-8.15v-13.45s-3.82,0-3.82,0l-.05-4.84h3.87s0-7.49,0-7.49h6.57v7.49s5.67,0,5.67,0v4.84h-5.67s0,12.27,0,12.27c0,2.6,1.07,3.46,2.85,3.46,1.12,0,2.39-.41,3.87-1.12l1.53,4.99Z",
    "M78.43,76.67v27.25s-6.67,0-6.67,0v-5.04c-1.42,3.72-4.12,5.3-8.45,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,5.8-3.41,5.8-7.79v-13.45h6.67Z",
    "M110.45,66.16v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01s5.19-13.8,12.83-13.8c4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM103.83,90.4c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z",
    "M124.26,68.91c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.7,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM124,76.7v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z",
    "M287.47,84.02c-2.79-3.29-6.26-7.39-13-7.39s-10.21,4.1-12.99,7.39c-2.82,3.33-4.75,5.36-8.63,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.62,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.61,5.36s-5.58-2.04-8.28-5.36c-.73-.9-1.51-1.86-2.39-2.78-1.12-1.33-2.52-2.42-4.15-3.21-.38-.2-.8-.36-1.22-.52-.01,0-.02,0-.03-.01-.65-.25-1.35-.45-2.09-.59-.29-.06-.59-.13-.89-.17-.11-.01-.21-.03-.33-.04-.81-.11-1.64-.18-2.51-.18-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,7.66,0,13.12-4.56,14.13-11.53,2,1.42,4.47,2.43,7.75,2.43,6.73,0,10.2-4.1,12.99-7.39,2.82-3.32,4.74-5.36,8.62-5.36s5,2.04,8.62,5.36c2.79,3.29,6,7.39,12.99,7.39s10.2-4.1,12.99-7.39c2.82-3.33,4.74-5.36,8.62-5.36s5.8,2.04,8.62,5.36c2.79,3.29,6.26,7.39,12.99,7.39s10.21-4.1,13-7.39c2.82-3.32,4.75-5.36,8.63-5.36s5,2.04,8.63,5.36c2.79,3.29,7.08,7.39,13.81,7.39v-5.73c-3.88,0-6.62-2.04-9.44-5.36Z",
    "M182.33,45.55c-1.13,3.03-3.02,8.11-4.57,8.11s-3.43-5.08-4.56-8.11c-2.06-5.55-4.41-11.85-9.93-11.85-5.31,0-7.6,4.6-9.28,7.96-1.62,3.26-2.56,4.79-4.15,4.79s-2.71-1.57-4.55-4.9c-1.03-1.86-2.21-3.94-3.85-5.5-2.53-2.76-6.31-4.37-10.87-4.37-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,6.88,0,11.98-3.66,13.69-9.45,1.43,1.32,3.21,2.24,5.59,2.24,5.31,0,7.6-4.6,9.28-7.96,1.62-3.26,2.56-4.79,4.15-4.79s3.43,5.08,4.56,8.11c2.06,5.55,4.41,11.85,9.93,11.85s7.87-6.29,9.94-11.85c1.13-3.03,3.02-8.11,4.57-8.11v-5.73c-5.53,0-7.87,6.29-9.94,11.85Z",
  ]
  
  // 信号震动
  useEffect(() => {
    const interval = setInterval(() => {
      setJitterOffset({
        x: (Math.random() - 0.5) * 1.5,
        y: (Math.random() - 0.5) * 1.5,
      })
    }, 50)
    return () => clearInterval(interval)
  }, [])
  
  useEffect(() => {
    const startId = setTimeout(() => setGlitchActive(true), 0)
    const stopId = setTimeout(() => setGlitchActive(false), 400)
    return () => {
      clearTimeout(startId)
      clearTimeout(stopId)
    }
  }, [triggerGlitch])

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 310.61 122.86"
      className="w-[clamp(200px,50vw,500px)] h-auto"
      style={{ filter: glitchActive ? 'url(#glitchFilter)' : 'none' }}
    >
      <defs>
        <filter id="glitchFilter" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="glowFilter">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      {/* 基础轨迹 - 暗淡的轨迹 */}
      {logoPaths.map((d, i) => (
        <path
          key={`base-${i}`}
          d={d}
          fill="none"
          stroke={traceColor}
          strokeWidth="0.35"
          strokeOpacity="0.15"
          style={{ 
            transform: `translate(${jitterOffset.x}px, ${jitterOffset.y}px)`,
            transition: 'transform 0.05s',
          }}
        />
      ))}
      
      {/* 扫描轨迹 */}
      {logoPaths.map((d, i) => {
        const length = pathLengths[i] || 500
        return (
          <path
            key={`trace-${i}`}
            d={d}
            fill="none"
            stroke={traceColor}
            strokeWidth="0.6"
            strokeLinecap="round"
            filter="url(#glowFilter)"
            style={{
              strokeDasharray: `${length * 0.3} ${length * 0.7}`,
              strokeDashoffset: glitchActive ? 0 : -length,
              animation: `traceFlow ${4 + i * 0.2}s linear infinite`,
              animationDelay: `${i * 0.1}s`,
              transform: `translate(${jitterOffset.x}px, ${jitterOffset.y}px)`,
              opacity: glitchActive ? 0.3 : 1,
            }}
          />
        )
      })}
      
      {/* 扫描头亮点 */}
      {logoPaths.map((d, i) => (
        <circle key={`head-${i}`} r="2" fill={traceColor} filter="url(#glowFilter)">
          <animateMotion dur={`${4 + i * 0.15}s`} repeatCount="indefinite" path={d} />
        </circle>
      ))}
      
      <style>{`
        @keyframes traceFlow {
          0% { stroke-dashoffset: 1000; }
          100% { stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  )
}

// ==================== 电子火花粒子组件 ====================
function ElectronSparks() {
  const [sparks, setSparks] = useState([])
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.55) {
        const newSpark = { id: Date.now() + Math.random(), x: 30 + Math.random() * 250, y: 100, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, life: 1, size: 1 + Math.random() * 2 }
        setSparks(prev => [...prev.slice(-32), newSpark])
      }
    }, 100)
    return () => clearInterval(interval)
  }, [])
  
  useEffect(() => {
    const interval = setInterval(() => {
      setSparks(prev => prev.map(s => ({ ...s, x: s.x + s.vx, y: s.y + s.vy, vy: s.vy + 0.1, life: s.life - 0.02 })).filter(s => s.life > 0 && s.y < 300))
    }, 16)
    return () => clearInterval(interval)
  }, [])
  
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {sparks.map(spark => (
        <div key={spark.id} className="absolute rounded-full" style={{ left: spark.x, top: spark.y, width: spark.size, height: spark.size, backgroundColor: '#00FFCC', opacity: spark.life, boxShadow: `0 0 ${spark.size * 2}px #00FFCC` }} />
      ))}
    </div>
  )
}
