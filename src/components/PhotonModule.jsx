/**
 * PHOTON：Canvas 2D 全屏粒子。
 * getContext('2d', { alpha: false, desynchronized: true }) — 不透明背景、降低合成开销；
 * 胧胧光感用径向渐变 + globalCompositeOperation 'lighter'（对数千粒子逐帧 shadowBlur 会极卡）。
 * 粒子：呼吸/闪烁调制；部分为锐利高亮光子（十字眩光 + 亮核）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'

const BG = '#000000'
const SAT_LOCK = 100
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
    const cx = w / 2
    const cy = h / 2
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
    const threshold = 150
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
      const brI = breathIntensityRef.current
      const brHz = breathHzRef.current
      const fkI = flickerIntensityRef.current
      const sharpBoost = sharpPhotonBoostRef.current

      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const glowSpread = 1.12 + blurK * 1.85

      const tSec = now * 0.001
      const omega = Math.PI * 2 * brHz

      const parts = particlesRef.current
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
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        p.x += p.vx * vPps * p.spdJ * dt
        p.y += p.vy * vPps * p.spdJ * dt

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

      ctx.globalCompositeOperation = 'lighter'

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        const diff =
          Math.hypot(p.x - p.spawnX, p.y - p.spawnY) / (maxDiff || 1)
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
        const flickerWave =
          1 -
          fkI +
          fkI * (0.5 + 0.5 * Math.sin(omega * 5.15 * tSec + (p.flickerPhase || 0)))
        const pulse = Math.max(0.12, breathWave * flickerWave)

        const a =
          Math.min(1, Ta * (0.4 + 0.55 * alphaBright)) * opacityFade * pulse
        const radiusCore = Math.max(0.5, baseSize * sizeMul * 0.48)
        const outerScale = 1 + 4 * easedT
        const radius = radiusCore * outerScale
        const outer = radius * glowSpread

        if (p.isSharpPhoton) {
          const boost = Math.min(2.4, sharpBoost)
          const ac = Math.min(1, a * 2.35 * boost)
          const gl = radius * (1.15 + (1 - easedT) * 0.35)
          ctx.strokeStyle = `hsla(${H}, ${SAT_LOCK}%, 96%, ${ac * 0.88})`
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(p.x - gl, p.y)
          ctx.lineTo(p.x + gl, p.y)
          ctx.moveTo(p.x, p.y - gl)
          ctx.lineTo(p.x, p.y + gl)
          ctx.stroke()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, 100%, ${ac})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(0.65, radiusCore * 0.22), 0, Math.PI * 2)
          ctx.fill()
          const tight = outer * 0.42
          const lightMulS = Math.min(100, Lb + (100 - Lb) * 0.35)
          const gs = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, tight)
          gs.addColorStop(0, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS}%, ${ac * 0.55})`)
          gs.addColorStop(0.55, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS - 8}%, ${ac * 0.12})`)
          gs.addColorStop(1, `hsla(${H}, ${SAT_LOCK}%, ${lightMulS}%, 0)`)
          ctx.fillStyle = gs
          ctx.beginPath()
          ctx.arc(p.x, p.y, tight, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        const lightMul = Math.min(100, Lb + (100 - Lb) * 0.175)
        const coreL = Math.max(0, Math.min(100, lightMul - 8))
        const darkL = Math.max(0, Math.min(100, lightMul - 16))
        const rimL = Math.min(100, lightMul + 10)

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, outer)
        g.addColorStop(0, `hsla(${H}, ${SAT_LOCK}%, ${coreL}%, ${a * 0.88})`)
        g.addColorStop(0.38, `hsla(${H}, ${SAT_LOCK}%, ${darkL}%, ${a * 0.72})`)
        g.addColorStop(0.68, `hsla(${H}, ${SAT_LOCK}%, ${lightMul}%, ${a * 0.42})`)
        g.addColorStop(0.9, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, ${a * 0.92})`)
        g.addColorStop(1, `hsla(${H}, ${SAT_LOCK}%, ${rimL}%, 0)`)

        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, outer, 0, Math.PI * 2)
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
      const brI = breathIntensityRef.current
      const brHz = breathHzRef.current
      const fkI = flickerIntensityRef.current
      const sharpBoost = sharpPhotonBoostRef.current

      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const glowSpread = 1.12 + blurK * 1.85

      // 仅用于 WebKit 路径：预渲染 sprite
      const desiredKey = `${H}|${Lb}|${Math.round(glowSpread * 1000) / 1000}`
      if (spriteCacheKey !== desiredKey || spriteCanvases.length === 0) {
        buildWebKitSpriteCache({ H, Lb, glowSpread })
      }

      const aBase = Math.min(1, Ta * (0.4 + 0.55 * 0.6))

      const tSec = now * 0.001
      const omega = Math.PI * 2 * brHz

      const parts = particlesRef.current
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
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        p.x += p.vx * vPps * p.spdJ * dt
        p.y += p.vy * vPps * p.spdJ * dt

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

      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 1

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        const diff =
          Math.hypot(p.x - p.spawnX, p.y - p.spawnY) / (maxDiff || 1)
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
        const flickerWave =
          1 -
          fkI +
          fkI * (0.5 + 0.5 * Math.sin(omega * 5.15 * tSec + (p.flickerPhase || 0)))
        const pulse = Math.max(0.12, breathWave * flickerWave)

        const alpha = aBase * opacityFade * pulse
        if (alpha <= 0) continue

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
          ctx.moveTo(p.x - gl, p.y)
          ctx.lineTo(p.x + gl, p.y)
          ctx.moveTo(p.x, p.y - gl)
          ctx.lineTo(p.x, p.y + gl)
          ctx.stroke()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, 100%, ${ac})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(0.65, radiusCore * 0.22), 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = `hsla(${H}, ${SAT_LOCK}%, ${Math.min(100, Lb + (100 - Lb) * 0.35)}%, ${ac * 0.38})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, radius * glowSpread * 0.36, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        const idx =
          SPRITE_BINS <= 1 ? 0 : Math.max(0, Math.min(SPRITE_BINS - 1, Math.round(easedT * (SPRITE_BINS - 1))))
        const sprite = spriteCanvases[idx]
        const r = spriteRadii[idx]

        ctx.globalAlpha = alpha
        ctx.drawImage(sprite, p.x - r, p.y - r)
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
  }, [])

  const hslaStr = `hsla(${hue}, ${SAT_LOCK}%, ${lightness}%, ${transparency})`

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
          <label className="mb-1 block text-[10px] font-ui" style={{ color: textColorPanel }}>
            hue: {hue}
          </label>
          <input
            type="range"
            min={0}
            max={360}
            value={hue}
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
