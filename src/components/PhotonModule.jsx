/**
 * PHOTON：Canvas 2D 全屏粒子。
 * getContext('2d', { alpha: false, desynchronized: true }) — 不透明背景、降低合成开销；
 * 胧胧光感用径向渐变 + globalCompositeOperation 'lighter'（对数千粒子逐帧 shadowBlur 会极卡）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'

const BG = '#000000'
const SAT_LOCK = 100
const SIZE_MIN = 2
const SIZE_MAX = 15
const DENSITY_MIN = 0
const DENSITY_MAX = 5000
const MAP_ALPHA = 0.05
// 扩散达到「最大」后才开始淡出；淡出时长随机，单位 ms
const FADE_MS_MIN = 700
const FADE_MS_MAX = 2400
/** 归一化扩散距离 t ∈ [0,1] 达到该阈值视为尺寸已到最大，进入淡出 */
const MAX_SPREAD_T = 0.987
/** 尺寸随 t 的缓动：指数越大，初期相对「变大」越快（ease-out） */
const SPREAD_EASE_POWER = 3.2

function luminanceAt(data, w, h, ix, iy) {
  if (!data || ix < 0 || iy < 0 || ix >= w || iy >= h) return 0.5
  const i = (iy * w + ix) * 4
  const r = data[i] / 255
  const g = data[i + 1] / 255
  const b = data[i + 2] / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function initParticles(count, cw, ch) {
  const list = []
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
    })
  }
  return list
}

export function PhotonModule() {
  const canvasRef = useRef(null)
  const particlesRef = useRef([])
  const rafRef = useRef(null)
  const lastTRef = useRef(null)
  const imgDataRef = useRef(null)
  const imgDimsRef = useRef({ w: 0, h: 0 })
  const mapImgRef = useRef(null)
  const panelRef = useRef(null)

  const [hue, setHue] = useState(0)
  const [lightness, setLightness] = useState(55)
  const [transparency, setTransparency] = useState(0.08)
  const [blurIntensity, setBlurIntensity] = useState(0.38)
  const [flowVelocity, setFlowVelocity] = useState(12)
  const [density, setDensity] = useState(3000)
  const [mapFileName, setMapFileName] = useState('—')
  const [thumbUrl, setThumbUrl] = useState(null)
  const [showControls, setShowControls] = useState(false)
  const [hudFps, setHudFps] = useState(0)

  const hueRef = useRef(hue)
  const lightnessRef = useRef(lightness)
  const transparencyRef = useRef(transparency)
  const blurIntensityRef = useRef(blurIntensity)
  const flowVelocityRef = useRef(flowVelocity)
  const densityRef = useRef(density)

  hueRef.current = hue
  lightnessRef.current = lightness
  transparencyRef.current = transparency
  blurIntensityRef.current = blurIntensity
  flowVelocityRef.current = flowVelocity
  densityRef.current = density

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
    particlesRef.current = initParticles(count, w, h)
  }, [])

  useEffect(() => {
    resizeAndReset()
    const onResize = () => resizeAndReset()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resizeAndReset])

  useEffect(() => {
    resizeAndReset()
  }, [density, resizeAndReset])

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setMapFileName(file.name)
    const url = URL.createObjectURL(file)
    setThumbUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => {
      mapImgRef.current = im
      const oc = document.createElement('canvas')
      oc.width = im.naturalWidth
      oc.height = im.naturalHeight
      const octx = oc.getContext('2d', { willReadFrequently: true })
      octx.drawImage(im, 0, 0)
      imgDataRef.current = octx.getImageData(0, 0, oc.width, oc.height).data
      imgDimsRef.current = { w: oc.width, h: oc.height }
    }
    im.src = url
  }

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

    const tick = (now) => {
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

      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const mapIm = mapImgRef.current
      const data = imgDataRef.current
      const { w: iw, h: ih } = imgDimsRef.current
      if (mapIm && iw > 0) {
        ctx.save()
        ctx.globalAlpha = MAP_ALPHA
        ctx.drawImage(mapIm, 0, 0, w, h)
        ctx.restore()
      }

      const H = hueRef.current
      const Lb = lightnessRef.current
      const Ta = transparencyRef.current
      const blurK = blurIntensityRef.current
      const vPps = flowVelocityRef.current

      const glowSpread = 1.12 + blurK * 1.85

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

        let lum = 0.5
        if (data && iw > 0) {
          const ix = Math.floor((p.x / w) * iw)
          const iy = Math.floor((p.y / h) * ih)
          lum = luminanceAt(data, iw, ih, ix, iy)
        }

        const sizeMul = 0.55 + 0.9 * lum
        const alphaBright = 0.35 + 0.5 * (1 - lum)
        const opacityFade =
          p.phase === 'fading'
            ? Math.max(0, (p.fadeLeft || 0) / (p.fadeTotal || 1))
            : 1
        if (opacityFade <= 0) continue
        const a = Math.min(1, Ta * (0.4 + 0.55 * alphaBright)) * opacityFade
        const radiusCore = Math.max(0.5, baseSize * sizeMul * 0.48)
        const outerScale = 1 + 4 * easedT
        const radius = radiusCore * outerScale
        const outer = radius * glowSpread

        const lightMul = Math.min(100, Lb + (100 - Lb) * 0.35 * lum)
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

      rafRef.current = requestAnimationFrame(tick)
    }

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
        <label
          className="block w-full cursor-pointer rounded-md border py-1 pl-2 pr-2 text-left text-[10px] font-ui transition-colors hover:bg-white/5"
          style={{ borderColor: btnBorder, color: textColorPanel }}
        >
          <span className="block truncate">map: upload</span>
          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
        </label>
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt=""
            className="h-auto max-h-24 w-full rounded-sm object-contain"
            style={{ border: `1px solid ${panelBorder}` }}
          />
        )}

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
        <div className="truncate" title={mapFileName}>
          MAP SOURCE · {mapFileName}
        </div>
      </div>
    </div>
  )
}
