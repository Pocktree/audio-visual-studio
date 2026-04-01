/**
 * PHOTON：Canvas 2D 全屏粒子 + 音频频谱联动。
 * getContext('2d', { alpha: false, desynchronized: true }) — 不透明背景、降低合成开销；
 * 胧胧光感用径向渐变 + globalCompositeOperation 'lighter'（对数千粒子逐帧 shadowBlur 会极卡）。
 * 粒子：呼吸/闪烁调制；部分为锐利高亮光子（十字眩光 + 亮核）。
 *
 * 音频联动（AISA + IPAS 规范）：
 * - 低频（Bass，bins 0-20）→ 控制粒子整体亮度与扩散能量
 * - 高频（Treble，bins ~60-120）→ 控制粒子闪烁频率
 * - 需要用户点击激活音频（浏览器 Autoplay 策略）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'

const BG = '#000000'
const SAT_LOCK = 100
/** hue 自动漂移速度（度/秒） */
const HUE_DRIFT_DPS = 14
const SIZE_MIN = 2
const SIZE_MAX = 15
const DENSITY_MIN = 0
const DENSITY_MAX = 5000
// 扩散达到「最大」后才开始淡出；淡出时长随机，单位 ms
const FADE_MS_MIN = 700
const FADE_MS_MAX = 2400
/** 归一化扩散距离 t ∈ [0,1] 达到该阈值视为尺寸已到最大，进入淡出 */
const MAX_SPREAD_T = 0.987
/** 尺寸随 t 的缓动：指数越大，初期相对「变大」越快（ease-out） */
const SPREAD_EASE_POWER = 3.2
const QUANTUM_SCALE = ['C4', 'Eb4', 'F4', 'G4', 'Bb4', 'C5', 'Eb5', 'F5', 'G5', 'Bb5', 'C6']
const SPAWN_HIGH_POOL = ['G5', 'Bb5', 'C6', 'Eb6', 'F6', 'G6', 'Bb6']

function detectPhotonRenderTrack() {
  // 严格区分：Blink(Chrome/Edge) vs WebKit(Safari)。
  // 其它浏览器暂时复用 Blink 渲染（保持视觉一致 + 避免引入额外风险）。
  if (typeof navigator === 'undefined') return 'blink'
  const ua = navigator.userAgent || ''
  const isSafari = /Safari/.test(ua)
  const hasBlinkToken = /Chrome|Chromium|CriOS|Edg|OPR/.test(ua)
  if (isSafari && !hasBlinkToken) return 'webkit'
  return 'blink'
}

function initParticles(count, cw, ch, sharpRatio) {
  const list = []
  const sr = Math.max(0, Math.min(1, sharpRatio))
  for (let n = 0; n < count; n++) {
    const x = Math.random() * cw
    const y = Math.random() * ch
    const angle = Math.random() * Math.PI * 2
    const spdJ = 0.75 + Math.random() * 0.5
    list.push({
      x,
      y,
      spawnX: x,
      spawnY: y,
      offsetX: 0,
      offsetY: 0,
      assignedFrequency: 180 + Math.random() * 2200,
      vx: Math.cos(angle),
      vy: Math.sin(angle),
      spdJ,
      phase: 'growing',
      fadeTotal: 0,
      fadeLeft: 0,
      breathPhase: Math.random() * Math.PI * 2,
      flickerPhase: Math.random() * Math.PI * 2,
      isSharpPhoton: Math.random() < sr,
    })
  }
  return list
}

export function PhotonModule() {
  const canvasRef = useRef(null)
  const particlesRef = useRef([])
  const rafRef = useRef(null)
  const lastTRef = useRef(null)
  const panelRef = useRef(null)
  const [renderTrack] = useState(() => detectPhotonRenderTrack())

  const [hue, setHue] = useState(0)
  const [hueDriftPaused, setHueDriftPaused] = useState(false)
  const [lightness, setLightness] = useState(42)
  const [transparency, setTransparency] = useState(0.09)
  const [blurIntensity, setBlurIntensity] = useState(0.26)
  const [flowVelocity, setFlowVelocity] = useState(21)
  const [density, setDensity] = useState(3000)
  const [breathIntensity, setBreathIntensity] = useState(0.89)
  const [breathHz, setBreathHz] = useState(0.49)
  const [flickerIntensity, setFlickerIntensity] = useState(0.18)
  const [sharpPhotonRatio, setSharpPhotonRatio] = useState(0.35)
  const [sharpPhotonBoost, setSharpPhotonBoost] = useState(1.15)
  const [showControls, setShowControls] = useState(false)
  const [hudFps, setHudFps] = useState(0)
  /** 音频激活状态（用户点击后开启 PHOTON 声音引擎） */
  const [audioEnabled, setAudioEnabled] = useState(false)
  const audioEnabledRef = useRef(false)
  const audioReadyRef = useRef(false)
  const photonSynthRef = useRef(null)
  const photonReverbRef = useRef(null)
  const photonLimiterRef = useRef(null)
  const photonWidenerRef = useRef(null)
  const photonMasterRef = useRef(null)
  const photonMeterRef = useRef(null)
  const photonFftRef = useRef(null)
  const lastBleepAtRef = useRef(0)
  const lastAmbientBleepAtRef = useRef(0)
  const lastSpawnBurstAtRef = useRef(0)
  const audioMotionRef = useRef(0)
  const audioLevelRef = useRef(0)
  const audioFreqNormRef = useRef(0)
  const fmIndexRef = useRef(3)
  /** 当前帧的音频派生参数（用于动画循环，不触发 React 重渲染） */
  const audioBassRef = useRef(0)
  const audioTrebleRef = useRef(0)

  const hueRef = useRef(hue)
  const lightnessRef = useRef(lightness)
  const transparencyRef = useRef(transparency)
  const blurIntensityRef = useRef(blurIntensity)
  const flowVelocityRef = useRef(flowVelocity)
  const densityRef = useRef(density)
  const breathIntensityRef = useRef(breathIntensity)
  const breathHzRef = useRef(breathHz)
  const flickerIntensityRef = useRef(flickerIntensity)
  const sharpPhotonRatioRef = useRef(sharpPhotonRatio)
  const sharpPhotonBoostRef = useRef(sharpPhotonBoost)

  hueRef.current = hue
  lightnessRef.current = lightness
  transparencyRef.current = transparency
  blurIntensityRef.current = blurIntensity
  flowVelocityRef.current = flowVelocity
  densityRef.current = density
  breathIntensityRef.current = breathIntensity
  breathHzRef.current = breathHz
  flickerIntensityRef.current = flickerIntensity
  sharpPhotonRatioRef.current = sharpPhotonRatio
  sharpPhotonBoostRef.current = sharpPhotonBoost

  useEffect(() => {
    audioEnabledRef.current = audioEnabled
  }, [audioEnabled])

  const initPhotonAudio = useCallback(async () => {
    if (audioReadyRef.current) return true
    try {
      await Tone.start()
      const ctx = Tone.getContext()
      if (ctx.state !== 'running') await ctx.resume()

      const master = new Tone.Gain(0.86).toDestination()
      const reverb = new Tone.Reverb({
        decay: 5.4,
        preDelay: 0.05,
        wet: 0.68,
      }).connect(master)
      const widener = new Tone.StereoWidener(0.11).connect(reverb)
      const limiter = new Tone.Limiter(-6).connect(widener)
      const meter = new Tone.Meter()
      const fft = new Tone.FFT(32)
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 6,
        volume: -12,
        harmonicity: 2,
        modulationIndex: 3,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: {
          attack: 0.003,
          decay: 0.1,
          sustain: 0,
          release: 0.12,
        },
        modulationEnvelope: {
          attack: 0.001,
          decay: 0.09,
          sustain: 0,
          release: 0.08,
        },
      })
      synth.connect(limiter)
      synth.connect(meter)
      synth.connect(fft)

      photonMasterRef.current = master
      photonReverbRef.current = reverb
      photonLimiterRef.current = limiter
      photonWidenerRef.current = widener
      photonMeterRef.current = meter
      photonFftRef.current = fft
      photonSynthRef.current = synth
      fmIndexRef.current = 3
      audioReadyRef.current = true
      return true
    } catch {
      return false
    }
  }, [])

  const triggerPhotonBleep = useCallback(
    (energy = 0.5, size = 0.5, yNorm = 0.5) => {
      if (!audioEnabledRef.current || !audioReadyRef.current || !photonSynthRef.current) return
      const nowMs = performance.now()
      if (nowMs - lastBleepAtRef.current < 108) return
      lastBleepAtRef.current = nowMs

      const synth = photonSynthRef.current
      const e = Math.max(0, Math.min(1, energy))
      const s = Math.max(0, Math.min(1, size))
      const y = Math.max(0, Math.min(1, yNorm))

      const idxBase = Math.floor((1 - y) * (QUANTUM_SCALE.length - 1))
      const jitter = Math.floor(Math.random() * 3) - 1
      const idx = Math.max(0, Math.min(QUANTUM_SCALE.length - 1, idxBase + jitter))
      const note = QUANTUM_SCALE[idx]
      const velocity = Math.max(0.08, Math.min(0.95, 0.2 + e * 0.55 + s * 0.2))
      const modulationIndex = 2 + e * 2.8
      const harmonicity = 1.7 + s * 0.9
      synth.set({ modulationIndex, harmonicity })
      fmIndexRef.current = modulationIndex
      synth.triggerAttackRelease(note, '32n', undefined, velocity)

      audioTrebleRef.current = Math.max(audioTrebleRef.current, 0.2 + e * 0.8)
      audioBassRef.current = Math.max(audioBassRef.current, 0.08 + (1 - y) * 0.5)
    },
    [],
  )

  const triggerSpawnChordBurst = useCallback((strength = 0.8) => {
    if (!audioEnabledRef.current || !audioReadyRef.current || !photonSynthRef.current) return
    const nowMs = performance.now()
    if (nowMs - lastSpawnBurstAtRef.current < 220) return
    lastSpawnBurstAtRef.current = nowMs

    const synth = photonSynthRef.current
    const s = Math.max(0, Math.min(1, strength))
    synth.set({
      modulationIndex: 2.2 + s * 2.2,
      harmonicity: 1.85 + s * 0.45,
    })
    fmIndexRef.current = 2.2 + s * 2.2

    const now = Tone.now()
    const pool = [...SPAWN_HIGH_POOL]
    const count = 3 + Math.floor(Math.random() * 2)
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      const note = pool.splice(idx, 1)[0] || 'C6'
      const vel = Math.max(0.16, Math.min(0.9, 0.34 + s * 0.34 - i * 0.04))
      const dur = i === 0 ? '16n' : '32n'
      synth.triggerAttackRelease(note, dur, now + i * 0.017, vel)
    }

    audioTrebleRef.current = Math.max(audioTrebleRef.current, 0.72 + s * 0.22)
    audioBassRef.current = Math.max(audioBassRef.current, 0.12 + s * 0.12)
  }, [])

  const resizeAndReset = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    c.width = Math.floor(w * dpr)
    c.height = Math.floor(h * dpr)
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d', {
      alpha: false,
      desynchronized: true,
    })
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const count = Math.round(
      Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, densityRef.current)),
    )
    if (count === 0) {
      particlesRef.current = []
      return
    }
    particlesRef.current = initParticles(count, w, h, sharpPhotonRatioRef.current)
  }, [])

  useEffect(() => {
    resizeAndReset()
    const onResize = () => resizeAndReset()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resizeAndReset])

  useEffect(() => {
    resizeAndReset()
  }, [density, sharpPhotonRatio, resizeAndReset])

  useEffect(() => {
    if (hueDriftPaused) return
    let raf = 0
    let last = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setHue((h) => {
        const n = h + HUE_DRIFT_DPS * dt
        return ((n % 360) + 360) % 360
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hueDriftPaused])

  useEffect(() => {
    const threshold = 60
    let hideTimeout = null
    const handleMouseMove = (e) => {
      const isInCorner = e.clientX > window.innerWidth - threshold && e.clientY < threshold
      let isOverPanel = false
      if (panelRef.current) {
        const r = panelRef.current.getBoundingClientRect()
        isOverPanel =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      }
      if (isInCorner || isOverPanel) {
        if (hideTimeout) clearTimeout(hideTimeout)
        hideTimeout = null
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

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) return

    let frame = 0
    let lastHud = performance.now()

    const track = renderTrack

    // Safari/WebKit：避免逐粒子 `createRadialGradient`（GC + CPU 压力大，易掉帧）
    // -> 用“离散 easedT 尺寸”的预渲染粒子精灵（Sprite）进行 drawImage。
    const SPRITE_BINS = 24
    const MIN_SPRITE_RADIUS = 2
    let spriteCacheKey = null
    let spriteCanvases = []
    let spriteRadii = []

    const buildWebKitSpriteCache = ({ H, Lb, glowSpread }) => {
      const lightMul = Math.min(100, Lb + (100 - Lb) * 0.175)
      const coreL = Math.max(0, Math.min(100, lightMul - 8))
      const darkL = Math.max(0, Math.min(100, lightMul - 16))
      const rimL = Math.min(100, lightMul + 10)

      const nextCanvases = new Array(SPRITE_BINS)
      const nextRadii = new Array(SPRITE_BINS)

      for (let i = 0; i < SPRITE_BINS; i++) {
        const easedT = SPRITE_BINS <= 1 ? 0 : i / (SPRITE_BINS - 1)
        const baseSize = SIZE_MIN + easedT * (SIZE_MAX - SIZE_MIN)
        const radiusCore = Math.max(0.5, baseSize * 0.48)
        const outerScale = 1 + 4 * easedT
        const outer = radiusCore * outerScale * glowSpread

        const radiusInt = Math.max(MIN_SPRITE_RADIUS, Math.ceil(outer))
        const dim = radiusInt * 2

        const off = document.createElement('canvas')
        off.width = dim
        off.height = dim
        const offCtx = off.getContext('2d', { alpha: true, desynchronized: true })

        if (!offCtx) {
          nextCanvases[i] = off
          nextRadii[i] = radiusInt
          continue
        }

        const cx = radiusInt
        const cy = radiusInt
        const g = offCtx.createRadialGradient(cx, cy, 0, cx, cy, radiusInt)
        g.addColorStop(0, `hsla(${H}, ${SAT_LOCK}%, ${coreL}%, 0.88)`)
        g.addColorStop(0.38, `hsla(${H}, ${SAT_LOCK}%, ${darkL}%, 0.72)`)
        g.addColorStop(0.68, `hsla(${H}, ${SAT_LOCK}%, ${lightMul}%, 0.42)`)
        g.addColorStop(0.9, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, 0.92)`)
        g.addColorStop(1, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, 0)`)

        offCtx.clearRect(0, 0, dim, dim)
        offCtx.fillStyle = g
        offCtx.beginPath()
        offCtx.arc(cx, cy, radiusInt, 0, Math.PI * 2)
        offCtx.fill()

        nextCanvases[i] = off
        nextRadii[i] = radiusInt
      }

      spriteCacheKey = `${H}|${Lb}|${Math.round(glowSpread * 1000) / 1000}`
      spriteCanvases = nextCanvases
      spriteRadii = nextRadii
    }

    const tickBlink = (now) => {
      frame++
      if (now - lastHud > 500) {
        const dt = (now - lastHud) / 1000
        setHudFps(frame / dt)
        frame = 0
        lastHud = now
      }

      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cx = w / 2
      const cy = h / 2
      const maxDiff = Math.hypot(w, h) * 0.5

      const dt =
        lastTRef.current != null
          ? Math.min(0.05, (now - lastTRef.current) / 1000)
          : 0.016
      lastTRef.current = now

      const H = hueRef.current
      const Lb = lightnessRef.current
      const Ta = transparencyRef.current
      const blurK = blurIntensityRef.current
      const vPps = flowVelocityRef.current
      const baseBrI = breathIntensityRef.current
      const baseBrHz = breathHzRef.current
      const fkI = flickerIntensityRef.current
      const sharpBoost = sharpPhotonBoostRef.current

      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const glowSpread = 1.12 + blurK * 1.85

      audioBassRef.current *= 0.97
      audioTrebleRef.current *= 0.97
      if (audioEnabledRef.current) {
        const nowMs = performance.now()
        // 保底脉冲：当长时间没有边界反弹声时，补一颗空灵滴声，避免“几乎无声”。
        if (nowMs - lastBleepAtRef.current > 1200 && nowMs - lastAmbientBleepAtRef.current > 900) {
          lastAmbientBleepAtRef.current = nowMs
          triggerPhotonBleep(0.34 + Math.random() * 0.22, 0.35 + Math.random() * 0.28, Math.random())
        }
      }
      if (audioEnabledRef.current && photonMeterRef.current && photonFftRef.current) {
        const meterVal = photonMeterRef.current.getValue()
        const db = Number.isFinite(meterVal) ? meterVal : -120
        const levelTarget = Math.max(0, Math.min(1, Tone.dbToGain(db) * 2.2))
        audioLevelRef.current += (levelTarget - audioLevelRef.current) * 0.16

        const fftVals = photonFftRef.current.getValue()
        let low = 0
        let high = 0
        let lowN = 0
        let highN = 0
        for (let i = 1; i <= 6 && i < fftVals.length; i++) {
          low += Math.max(0, (fftVals[i] + 120) / 120)
          lowN++
        }
        for (let i = 10; i <= 24 && i < fftVals.length; i++) {
          high += Math.max(0, (fftVals[i] + 120) / 120)
          highN++
        }
        const lowAvg = lowN ? low / lowN : 0
        const highAvg = highN ? high / highN : 0
        const freqTarget = highAvg / (highAvg + lowAvg + 1e-4)
        audioFreqNormRef.current += (freqTarget - audioFreqNormRef.current) * 0.14
      } else {
        audioLevelRef.current *= 0.96
        audioFreqNormRef.current *= 0.96
      }
      const targetMotion = Math.max(
        0,
        Math.min(1, audioTrebleRef.current * 0.9 + audioBassRef.current * 0.35),
      )
      audioMotionRef.current += (targetMotion - audioMotionRef.current) * 0.08
      const motion = audioMotionRef.current
      const audioBoost = 1 + audioBassRef.current * 0.32
      const brI = Math.min(1, baseBrI * (0.88 + motion * 0.45) * audioBoost)
      const brHz = baseBrHz * (0.72 + motion * 0.38)

      const tSec = now * 0.001
      const omega = Math.PI * 2 * brHz

      const parts = particlesRef.current
      let frameRespawns = 0
      const respawnAtCenter = (p) => {
        const ang = Math.random() * Math.PI * 2
        p.x = cx + (Math.random() - 0.5) * 4
        p.y = cy + (Math.random() - 0.5) * 4
        p.spawnX = p.x
        p.spawnY = p.y
        p.vx = Math.cos(ang)
        p.vy = Math.sin(ang)
        p.spdJ = 0.75 + Math.random() * 0.5
        p.phase = 'growing'
        p.fadeTotal = 0
        p.fadeLeft = 0
        p.breathPhase = Math.random() * Math.PI * 2
        p.flickerPhase = Math.random() * Math.PI * 2
        p.isSharpPhoton = Math.random() < sharpPhotonRatioRef.current
        p.offsetX = 0
        p.offsetY = 0
        p.assignedFrequency = 180 + Math.random() * 2200
        frameRespawns += 1
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        p.x += p.vx * vPps * p.spdJ * dt
        p.y += p.vy * vPps * p.spdJ * dt
        const amp = audioLevelRef.current
        const freqNorm = audioFreqNormRef.current
        const pNorm = Math.max(0.08, Math.min(1.8, (p.assignedFrequency || 600) / 1200))
        const jitterRate = 0.8 + freqNorm * 8.2 * pNorm
        const vibAmp = amp * (5 + 14 * pNorm)
        const targetOx = Math.sin(tSec * jitterRate + (p.breathPhase || 0)) * vibAmp
        const targetOy = Math.cos(tSec * (jitterRate * 0.83) + (p.flickerPhase || 0)) * vibAmp * 0.72
        const settle = 0.12 + amp * 0.2
        p.offsetX = (p.offsetX || 0) + (targetOx - (p.offsetX || 0)) * settle
        p.offsetY = (p.offsetY || 0) + (targetOy - (p.offsetY || 0)) * settle
        const microJitter = amp * (0.22 + freqNorm * 1.05) * pNorm
        p.offsetX += (Math.random() - 0.5) * microJitter
        p.offsetY += (Math.random() - 0.5) * microJitter
        const convergence = 0.82 + (1 - amp) * 0.14
        p.offsetX *= convergence
        p.offsetY *= convergence

        const rawDiff =
          Math.hypot(p.x - p.spawnX, p.y - p.spawnY) / (maxDiff || 1)
        const spreadT = Math.max(0, Math.min(1, rawDiff))

        if (p.phase === 'growing' || !p.phase) {
          if (spreadT >= MAX_SPREAD_T) {
            p.phase = 'fading'
            const fd = FADE_MS_MIN + Math.random() * (FADE_MS_MAX - FADE_MS_MIN)
            p.fadeTotal = fd
            p.fadeLeft = fd
          }
        } else if (p.phase === 'fading') {
          p.fadeLeft -= dt * 1000
          if (p.fadeLeft <= 0) {
            respawnAtCenter(p)
            continue
          }
        }

        if (p.x < -32 || p.x > w + 32 || p.y < -32 || p.y > h + 32) {
          respawnAtCenter(p)
        }

      }
      if (audioEnabledRef.current && frameRespawns >= 8) {
        triggerSpawnChordBurst(Math.min(1, 0.62 + frameRespawns * 0.03))
      }

      ctx.globalCompositeOperation = 'lighter'

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        const drawX = p.x + (p.offsetX || 0)
        const drawY = p.y + (p.offsetY || 0)
        const diff =
          Math.hypot(drawX - p.spawnX, drawY - p.spawnY) / (maxDiff || 1)
        // 扩散距离增长采用 ease-out：先快后慢（d 越小增长越快，d 越大越接近上限）
        const t = Math.max(0, Math.min(1, diff))
        const easedT = 1 - Math.pow(1 - t, SPREAD_EASE_POWER)
        let baseSize = SIZE_MIN + easedT * (SIZE_MAX - SIZE_MIN)

        const sizeMul = 1
        const alphaBright = 0.6
        const opacityFade =
          p.phase === 'fading'
            ? Math.max(0, (p.fadeLeft || 0) / (p.fadeTotal || 1))
            : 1
        if (opacityFade <= 0) continue

        const breathWave =
          1 -
          brI +
          brI * (0.5 + 0.5 * Math.sin(omega * tSec + (p.breathPhase || 0)))
        const flickerDepth = Math.min(0.42, fkI * (0.28 + motion * 0.34))
        const flickerWave =
          1 -
          flickerDepth +
          flickerDepth * (0.5 + 0.5 * Math.sin(omega * 2.15 * tSec + (p.flickerPhase || 0)))
        const pulse = Math.max(0.34, breathWave * 0.72 + flickerWave * 0.28)

        const a =
          Math.min(1, Ta * (0.4 + 0.55 * alphaBright)) * opacityFade * pulse
        const fmNorm = Math.max(0, Math.min(1, (fmIndexRef.current - 2) / 4.5))
        const radiusCore = Math.max(0.5, baseSize * sizeMul * 0.48)
        const outerScale = 1 + 4 * easedT
        const radius = radiusCore * outerScale
        const outer = radius * glowSpread * (1 + fmNorm * 0.18)

        if (p.isSharpPhoton) {
          const boost = Math.min(2.4, sharpBoost)
          const ac = Math.min(1, a * 2.35 * boost)
          const gl = radius * (1.15 + (1 - easedT) * 0.35)
          ctx.strokeStyle = `hsla(${H}, ${SAT_LOCK}%, 96%, ${ac * 0.88})`
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(drawX - gl, drawY)
          ctx.lineTo(drawX + gl, drawY)
          ctx.moveTo(drawX, drawY - gl)
          ctx.lineTo(drawX, drawY + gl)
          ctx.stroke()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, 100%, ${ac})`
          ctx.beginPath()
          ctx.arc(drawX, drawY, Math.max(0.65, radiusCore * 0.22), 0, Math.PI * 2)
          ctx.fill()
          const tight = outer * (0.38 + fmNorm * 0.08)
          const lightMulS = Math.min(100, Lb + (100 - Lb) * 0.35)
          const gs = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, tight)
          gs.addColorStop(0, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS}%, ${ac * 0.55})`)
          gs.addColorStop(0.55, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS - 8}%, ${ac * 0.12})`)
          gs.addColorStop(1, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS}%, 0)`)
          ctx.fillStyle = gs
          ctx.beginPath()
          ctx.arc(drawX, drawY, tight, 0, Math.PI * 2)
          ctx.fill()
          if (fmNorm > 0.18) {
            const cs = Math.max(0.25, fmNorm * 0.95)
            ctx.strokeStyle = `hsla(${(H + 22) % 360}, ${SAT_LOCK}%, 92%, ${ac * 0.18})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.arc(drawX + cs, drawY, Math.max(0.7, radiusCore * 0.24), 0, Math.PI * 2)
            ctx.stroke()
          }
          continue
        }

        const lightMul = Math.min(100, Lb + (100 - Lb) * 0.175)
        const coreL = Math.max(0, Math.min(100, lightMul - 8))
        const darkL = Math.max(0, Math.min(100, lightMul - 16))
        const rimL = Math.min(100, lightMul + 10)

        const g = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, outer)
        g.addColorStop(0, `hsla(${H}, ${SAT_LOCK}%, ${coreL}%, ${a * 0.88})`)
        g.addColorStop(0.38, `hsla(${H}, ${SAT_LOCK}%, ${darkL}%, ${a * 0.72})`)
        g.addColorStop(0.68, `hsla(${H}, ${SAT_LOCK}%, ${lightMul}%, ${a * 0.42})`)
        g.addColorStop(0.9, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, ${a * 0.92})`)
        g.addColorStop(1, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, 0)`)

        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(drawX, drawY, outer, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'

      rafRef.current = requestAnimationFrame(tickBlink)
    }

    const tickWebKit = (now) => {
      frame++
      if (now - lastHud > 500) {
        const dt = (now - lastHud) / 1000
        setHudFps(frame / dt)
        frame = 0
        lastHud = now
      }

      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cx = w / 2
      const cy = h / 2
      const maxDiff = Math.hypot(w, h) * 0.5

      const dt =
        lastTRef.current != null
          ? Math.min(0.05, (now - lastTRef.current) / 1000)
          : 0.016
      lastTRef.current = now

      const H = hueRef.current
      const Lb = lightnessRef.current
      const Ta = transparencyRef.current
      const blurK = blurIntensityRef.current
      const vPps = flowVelocityRef.current
      const baseBrI = breathIntensityRef.current
      const baseBrHz = breathHzRef.current
      const fkI = flickerIntensityRef.current
      const sharpBoost = sharpPhotonBoostRef.current

      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const glowSpread = 1.12 + blurK * 1.85

      audioBassRef.current *= 0.97
      audioTrebleRef.current *= 0.97
      if (audioEnabledRef.current) {
        const nowMs = performance.now()
        if (nowMs - lastBleepAtRef.current > 1200 && nowMs - lastAmbientBleepAtRef.current > 900) {
          lastAmbientBleepAtRef.current = nowMs
          triggerPhotonBleep(0.34 + Math.random() * 0.22, 0.35 + Math.random() * 0.28, Math.random())
        }
      }
      if (audioEnabledRef.current && photonMeterRef.current && photonFftRef.current) {
        const meterVal = photonMeterRef.current.getValue()
        const db = Number.isFinite(meterVal) ? meterVal : -120
        const levelTarget = Math.max(0, Math.min(1, Tone.dbToGain(db) * 2.2))
        audioLevelRef.current += (levelTarget - audioLevelRef.current) * 0.16

        const fftVals = photonFftRef.current.getValue()
        let low = 0
        let high = 0
        let lowN = 0
        let highN = 0
        for (let i = 1; i <= 6 && i < fftVals.length; i++) {
          low += Math.max(0, (fftVals[i] + 120) / 120)
          lowN++
        }
        for (let i = 10; i <= 24 && i < fftVals.length; i++) {
          high += Math.max(0, (fftVals[i] + 120) / 120)
          highN++
        }
        const lowAvg = lowN ? low / lowN : 0
        const highAvg = highN ? high / highN : 0
        const freqTarget = highAvg / (highAvg + lowAvg + 1e-4)
        audioFreqNormRef.current += (freqTarget - audioFreqNormRef.current) * 0.14
      } else {
        audioLevelRef.current *= 0.96
        audioFreqNormRef.current *= 0.96
      }
      const targetMotion = Math.max(
        0,
        Math.min(1, audioTrebleRef.current * 0.9 + audioBassRef.current * 0.35),
      )
      audioMotionRef.current += (targetMotion - audioMotionRef.current) * 0.08
      const motion = audioMotionRef.current
      const audioBoost = 1 + audioBassRef.current * 0.32
      const brI = Math.min(1, baseBrI * (0.88 + motion * 0.45) * audioBoost)
      const brHz = baseBrHz * (0.72 + motion * 0.38)

      // 仅用于 WebKit 路径：预渲染 sprite
      const desiredKey = `${H}|${Lb}|${Math.round(glowSpread * 1000) / 1000}`
      if (spriteCacheKey !== desiredKey || spriteCanvases.length === 0) {
        buildWebKitSpriteCache({ H, Lb, glowSpread })
      }

      const aBase = Math.min(1, Ta * (0.4 + 0.55 * 0.6))

      const tSec = now * 0.001
      const omega = Math.PI * 2 * brHz

      const parts = particlesRef.current
      let frameRespawns = 0
      const respawnAtCenter = (p) => {
        const ang = Math.random() * Math.PI * 2
        p.x = cx + (Math.random() - 0.5) * 4
        p.y = cy + (Math.random() - 0.5) * 4
        p.spawnX = p.x
        p.spawnY = p.y
        p.vx = Math.cos(ang)
        p.vy = Math.sin(ang)
        p.spdJ = 0.75 + Math.random() * 0.5
        p.phase = 'growing'
        p.fadeTotal = 0
        p.fadeLeft = 0
        p.breathPhase = Math.random() * Math.PI * 2
        p.flickerPhase = Math.random() * Math.PI * 2
        p.isSharpPhoton = Math.random() < sharpPhotonRatioRef.current
        p.offsetX = 0
        p.offsetY = 0
        p.assignedFrequency = 180 + Math.random() * 2200
        frameRespawns += 1
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        p.x += p.vx * vPps * p.spdJ * dt
        p.y += p.vy * vPps * p.spdJ * dt
        const amp = audioLevelRef.current
        const freqNorm = audioFreqNormRef.current
        const pNorm = Math.max(0.08, Math.min(1.8, (p.assignedFrequency || 600) / 1200))
        const jitterRate = 0.8 + freqNorm * 8.2 * pNorm
        const vibAmp = amp * (5 + 14 * pNorm)
        const targetOx = Math.sin(tSec * jitterRate + (p.breathPhase || 0)) * vibAmp
        const targetOy = Math.cos(tSec * (jitterRate * 0.83) + (p.flickerPhase || 0)) * vibAmp * 0.72
        const settle = 0.12 + amp * 0.2
        p.offsetX = (p.offsetX || 0) + (targetOx - (p.offsetX || 0)) * settle
        p.offsetY = (p.offsetY || 0) + (targetOy - (p.offsetY || 0)) * settle
        const microJitter = amp * (0.22 + freqNorm * 1.05) * pNorm
        p.offsetX += (Math.random() - 0.5) * microJitter
        p.offsetY += (Math.random() - 0.5) * microJitter
        const convergence = 0.82 + (1 - amp) * 0.14
        p.offsetX *= convergence
        p.offsetY *= convergence

        const rawDiff =
          Math.hypot(p.x - p.spawnX, p.y - p.spawnY) / (maxDiff || 1)
        const spreadT = Math.max(0, Math.min(1, rawDiff))

        if (p.phase === 'growing' || !p.phase) {
          if (spreadT >= MAX_SPREAD_T) {
            p.phase = 'fading'
            const fd = FADE_MS_MIN + Math.random() * (FADE_MS_MAX - FADE_MS_MIN)
            p.fadeTotal = fd
            p.fadeLeft = fd
          }
        } else if (p.phase === 'fading') {
          p.fadeLeft -= dt * 1000
          if (p.fadeLeft <= 0) {
            respawnAtCenter(p)
            continue
          }
        }

        if (p.x < -32 || p.x > w + 32 || p.y < -32 || p.y > h + 32) {
          respawnAtCenter(p)
        }

      }
      if (audioEnabledRef.current && frameRespawns >= 8) {
        triggerSpawnChordBurst(Math.min(1, 0.62 + frameRespawns * 0.03))
      }

      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 1

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        const drawX = p.x + (p.offsetX || 0)
        const drawY = p.y + (p.offsetY || 0)
        const diff =
          Math.hypot(drawX - p.spawnX, drawY - p.spawnY) / (maxDiff || 1)
        // 扩散距离增长采用 ease-out：先快后慢（d 越小增长越快，d 越大越接近上限）
        const t = Math.max(0, Math.min(1, diff))
        const easedT = 1 - Math.pow(1 - t, SPREAD_EASE_POWER)

        const opacityFade =
          p.phase === 'fading'
            ? Math.max(0, (p.fadeLeft || 0) / (p.fadeTotal || 1))
            : 1
        if (opacityFade <= 0) continue

        const breathWave =
          1 -
          brI +
          brI * (0.5 + 0.5 * Math.sin(omega * tSec + (p.breathPhase || 0)))
        const flickerDepth = Math.min(0.42, fkI * (0.28 + motion * 0.34))
        const flickerWave =
          1 -
          flickerDepth +
          flickerDepth * (0.5 + 0.5 * Math.sin(omega * 2.15 * tSec + (p.flickerPhase || 0)))
        const pulse = Math.max(0.34, breathWave * 0.72 + flickerWave * 0.28)

        const alpha = aBase * opacityFade * pulse
        if (alpha <= 0) continue
        const fmNorm = Math.max(0, Math.min(1, (fmIndexRef.current - 2) / 4.5))

        if (p.isSharpPhoton) {
          const boost = Math.min(2.4, sharpBoost)
          const ac = Math.min(1, alpha * 2.35 * boost)
          const radiusCore = Math.max(
            0.5,
            (SIZE_MIN + easedT * (SIZE_MAX - SIZE_MIN)) * 0.48,
          )
          const outerScale = 1 + 4 * easedT
          const radius = radiusCore * outerScale
          const gl = radius * (1.15 + (1 - easedT) * 0.35)
          ctx.globalAlpha = 1
          ctx.strokeStyle = `hsla(${H}, ${SAT_LOCK}%, 96%, ${ac * 0.88})`
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(drawX - gl, drawY)
          ctx.lineTo(drawX + gl, drawY)
          ctx.moveTo(drawX, drawY - gl)
          ctx.lineTo(drawX, drawY + gl)
          ctx.stroke()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, 100%, ${ac})`
          ctx.beginPath()
          ctx.arc(drawX, drawY, Math.max(0.65, radiusCore * 0.22), 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, ${Math.min(100, Lb + (100 - Lb) * 0.35)}%, ${ac * (0.32 + fmNorm * 0.1)})`
          ctx.beginPath()
          ctx.arc(drawX, drawY, radius * glowSpread * (0.32 + fmNorm * 0.12), 0, Math.PI * 2)
          ctx.fill()
          if (fmNorm > 0.18) {
            const cs = Math.max(0.25, fmNorm * 0.95)
            ctx.strokeStyle = `hsla(${(H + 22) % 360}, ${SAT_LOCK}%, 92%, ${ac * 0.18})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.arc(drawX + cs, drawY, Math.max(0.7, radiusCore * 0.24), 0, Math.PI * 2)
            ctx.stroke()
          }
          continue
        }

        const idx =
          SPRITE_BINS <= 1 ? 0 : Math.max(0, Math.min(SPRITE_BINS - 1, Math.round(easedT * (SPRITE_BINS - 1))))
        const sprite = spriteCanvases[idx]
        const r = spriteRadii[idx]

        ctx.globalAlpha = alpha
        ctx.drawImage(sprite, drawX - r, drawY - r)
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      rafRef.current = requestAnimationFrame(tickWebKit)
    }

    const tick = track === 'webkit' ? tickWebKit : tickBlink
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTRef.current = null
    }
  }, [renderTrack, triggerPhotonBleep, triggerSpawnChordBurst])

  useEffect(() => {
    const onBurst = async (e) => {
      if (!audioEnabledRef.current) {
        const ok = await initPhotonAudio()
        if (!ok) return
        setAudioEnabled(true)
      }
      const burstStrength = 0.78 + Math.random() * 0.2
      triggerSpawnChordBurst(burstStrength)
    }
    window.addEventListener('pointerdown', onBurst)
    return () => window.removeEventListener('pointerdown', onBurst)
  }, [initPhotonAudio, triggerSpawnChordBurst])

  useEffect(() => {
    return () => {
      try {
        photonSynthRef.current?.dispose()
        photonMeterRef.current?.dispose()
        photonFftRef.current?.dispose()
        photonLimiterRef.current?.dispose()
        photonWidenerRef.current?.dispose()
        photonReverbRef.current?.dispose()
        photonMasterRef.current?.dispose()
      } catch {
        // ignore dispose failures during rapid remounts
      }
      photonSynthRef.current = null
      photonMeterRef.current = null
      photonFftRef.current = null
      photonLimiterRef.current = null
      photonWidenerRef.current = null
      photonReverbRef.current = null
      photonMasterRef.current = null
      audioLevelRef.current = 0
      audioFreqNormRef.current = 0
      audioMotionRef.current = 0
      audioReadyRef.current = false
    }
  }, [])

  // BASE COLOR 等展示：hsla 中 hue 取整（渲染仍用 hueRef 浮点，色彩连续）
  const hslaStr = `hsla(${Math.round(hue)}, ${SAT_LOCK}%, ${lightness}%, ${transparency})`

  const panelBg = 'rgba(0,0,0,0.85)'
  const panelBorder = 'rgba(255,255,255,0.25)'
  const textColorPanel = 'rgba(255,255,255,0.7)'
  const btnBorder = 'rgba(255,255,255,0.3)'

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ display: 'block' }}
      />

      {/* 左上角小 Logo（与 rain 同款 SVG）：黑色 */}
      <div
        className="absolute top-4 left-4 z-30 w-24 h-auto pointer-events-none"
        aria-hidden
      >
        <svg viewBox={STUDIO_LOGO_VIEWBOX} className="w-full h-auto">
          {STUDIO_LOGO_PATHS.map((d, i) => (
            <path key={i} fill="rgba(140,140,140,0.85)" d={d} />
          ))}
        </svg>
      </div>

      <div
        ref={panelRef}
        className={`absolute top-4 right-4 z-50 flex max-h-[85vh] w-[160px] flex-col gap-2 overflow-y-auto rounded-lg p-3 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          color: textColorPanel,
        }}
      >
        <div>
          <div className="mb-1 flex items-center justify-between gap-1">
            <label className="text-[10px] font-ui" style={{ color: textColorPanel }}>
              hue: {Math.round(hue)}
            </label>
            <button
              type="button"
              onClick={() => setHueDriftPaused((p) => !p)}
              aria-pressed={hueDriftPaused}
              className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-ui uppercase tracking-wide transition-colors hover:bg-white/10"
              style={{
                borderColor: btnBorder,
                color: textColorPanel,
              }}
            >
              {hueDriftPaused ? 'play' : 'pause'}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={Math.round(hue)}
            onChange={(e) => setHue(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            lightness: {lightness}
          </label>
          <input
            type="range"
            min={15}
            max={85}
            value={lightness}
            onChange={(e) => setLightness(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            transparency: {Math.round(transparency * 100)}%
          </label>
          <input
            type="range"
            min={5}
            max={100}
            value={Math.round(transparency * 100)}
            onChange={(e) => setTransparency(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            blur: {(blurIntensity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(blurIntensity * 100)}
            onChange={(e) => setBlurIntensity(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            flow: {flowVelocity} pps
          </label>
          <input
            type="range"
            min={12}
            max={480}
            value={flowVelocity}
            onChange={(e) => setFlowVelocity(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            density: {density}
          </label>
          <input
            type="range"
            min={DENSITY_MIN}
            max={DENSITY_MAX}
            step={10}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            breath: {(breathIntensity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(breathIntensity * 100)}
            onChange={(e) => setBreathIntensity(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            breath Hz: {breathHz.toFixed(2)}
          </label>
          <input
            type="range"
            min={5}
            max={120}
            value={Math.round(breathHz * 100)}
            onChange={(e) => setBreathHz(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            flicker: {(flickerIntensity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(flickerIntensity * 100)}
            onChange={(e) => setFlickerIntensity(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            sharp %: {(sharpPhotonRatio * 100).toFixed(0)}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sharpPhotonRatio * 100)}
            onChange={(e) => setSharpPhotonRatio(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            photon boost: {(sharpPhotonBoost * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={80}
            max={200}
            value={Math.round(sharpPhotonBoost * 100)}
            onChange={(e) => setSharpPhotonBoost(Number(e.target.value) / 100)}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>

        {/* PHOTON 专属音频引擎：玻璃 FM + 深混响 + 量子音阶 */}
        <div>
          <button
            type="button"
            onClick={async () => {
              if (!audioEnabled) {
                const ok = await initPhotonAudio()
                if (ok) setAudioEnabled(true)
              } else {
                audioBassRef.current = 0
                audioTrebleRef.current = 0
                audioLevelRef.current = 0
                audioFreqNormRef.current = 0
                audioMotionRef.current = 0
                setAudioEnabled(false)
              }
            }}
            className="w-full rounded border py-1.5 px-2 text-center text-[10px] font-ui transition-colors"
            style={{
              borderColor: audioEnabled ? '#00FFCC' : btnBorder,
              color: audioEnabled ? '#00FFCC' : textColorPanel,
              background: audioEnabled ? 'rgba(0,255,204,0.08)' : 'transparent',
            }}
          >
            {audioEnabled ? 'AUDIO ON · QUANTUM FM' : 'AUDIO OFF · AUTO ON FIRST TAP'}
          </button>
          {audioEnabled && (
            <div className="mt-1 text-center text-[9px]" style={{ color: 'rgba(0,255,204,0.55)' }}>
              QUANTUM ENERGY {(audioBassRef.current * 100).toFixed(0)}% · GLASS {(audioTrebleRef.current * 100).toFixed(0)}%
            </div>
          )}
        </div>

        <GlobalShortcutsHint color="rgba(255,255,255,0.45)" />
      </div>

      <div
        className="pointer-events-none absolute bottom-4 left-4 z-40 max-w-[min(90vw,420px)] space-y-0.5 text-[10px] font-ui"
        style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.02em' }}
      >
        <div>PHOTON DENSITY · {density}</div>
        <div>
          FLOW VELOCITY · {flowVelocity.toFixed(0)} pps · hud {hudFps.toFixed(0)} fps
        </div>
        <div>BASE COLOR · {hslaStr}</div>
        <div>BLUR LEVEL · {(blurIntensity * 100).toFixed(0)}%</div>
        <div>
          BREATH · {(breathIntensity * 100).toFixed(0)}% @ {breathHz.toFixed(2)} Hz
        </div>
        <div>
          FLICKER · {(flickerIntensity * 100).toFixed(0)}% · SHARP · {(sharpPhotonRatio * 100).toFixed(0)}% · BOOST{' '}
          {(sharpPhotonBoost * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  )
}
