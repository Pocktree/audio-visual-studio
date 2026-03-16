import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// 波浪参数：baseFrequency 可调，初始 0.02；numOctaves 固定 1
const FREQ_STEP = 0.001
const AMP_STEP = 2
const FREQ_MIN = 0.005
const FREQ_MAX = 0.05
const AMP_MIN = 0
const AMP_MAX = 80

/** 全屏硬核贴边版 - 动态 BBox 计算 + 终极贴边 */
export function FullWindowType() {
  const [letter, setLetter] = useState(() => LETTERS[Math.floor(Math.random() * LETTERS.length)])
  const [intervalMs, setIntervalMs] = useState(800)
  const [inverted, setInverted] = useState(false)
  const [outlineMode, setOutlineMode] = useState(false)
  const [fontWeight, setFontWeight] = useState(700)
  const [showControls, setShowControls] = useState(false)
  const [showOverscanRuler, setShowOverscanRuler] = useState(true) // 几何畸变与边框校准标尺，默认显示
  const [viewport, setViewport] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 }))
  
  // Wave 参数
  const [waveEnabled, setWaveEnabled] = useState(true)
  const [waveFrequency, setWaveFrequency] = useState(0.02)  // baseFrequency 初始 0.02
  const [waveAmplitude, setWaveAmplitude] = useState(40)
  const [waveSpeed, setWaveSpeed] = useState(120)  // 周期(秒)，速度 = 1/waveSpeed，用 delta time 一致
  
  const [outlineWidth, setOutlineWidth] = useState(2)
  const [viewBox, setViewBox] = useState('0 0 100 100')
  const [debugBounds, setDebugBounds] = useState(false)
  const [lastBbox, setLastBbox] = useState(null)
  const textRef = useRef(null)
  const containerRef = useRef(null)
  const panelRef = useRef(null)
  const turbulenceRef = useRef(null)
  const waveTimeRef = useRef(0)
  const lastFrameRef = useRef(null)

  // 方案 B：暴力溢出裁切 — 缩小取景框，把字体内部留白推到屏外，窄/宽/超宽屏统一触边
  const CROP_Y_OFFSET = 0.14   // viewBox y 下移 14%
  const CROP_HEIGHT = 0.70    // height 取 70%（上下继续裁切撑满）
  const CROP_X = 0.06         // 左右各裁 6%（负 margin 效果）
  const updateViewBoxFromBBox = useCallback(() => {
    const el = textRef.current
    if (!el || typeof el.getBBox !== 'function') return
    const bbox = el.getBBox()
    if (bbox.width <= 0 || bbox.height <= 0) return
    setLastBbox(bbox)
    const vy = bbox.y + bbox.height * CROP_Y_OFFSET
    const vh = bbox.height * CROP_HEIGHT
    const vx = bbox.x + bbox.width * CROP_X
    const vw = bbox.width * (1 - 2 * CROP_X)
    if (vw <= 0 || vh <= 0) return
    setViewBox(`${vx} ${vy} ${vw} ${vh}`)
  }, [])

  // 初始化 + resize 监听
  useLayoutEffect(() => {
    // 延迟一下确保字体加载完成
    const timer = setTimeout(updateViewBoxFromBBox, 50)
    
    const onResize = () => {
      // 使用 requestAnimationFrame 保证在下一帧计算
      requestAnimationFrame(() => {
        setTimeout(updateViewBoxFromBBox, 16)
      })
    }
    
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [updateViewBoxFromBBox])

  // 标尺用视口尺寸（刻度/十字按像素计算）
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 字母/字重变化时重新计算
  useEffect(() => {
    const timer = setTimeout(updateViewBoxFromBBox, 50)
    return () => clearTimeout(timer)
  }, [letter, fontWeight, outlineMode, updateViewBoxFromBBox])

  // 随机字母轮播
  useEffect(() => {
    const t = setInterval(() => {
      setLetter(LETTERS[Math.floor(Math.random() * LETTERS.length)])
    }, intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])

  // 键盘实时调节波浪
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '7') {
        setWaveAmplitude((a) => Math.max(AMP_MIN, a - AMP_STEP))
        e.preventDefault()
      } else if (e.key === '8') {
        setWaveAmplitude((a) => Math.min(AMP_MAX, a + AMP_STEP))
        e.preventDefault()
      } else if (e.key === '9') {
        setWaveFrequency((f) => Math.max(FREQ_MIN, f - FREQ_STEP))
        e.preventDefault()
      } else if (e.key === '0') {
        setWaveFrequency((f) => Math.min(FREQ_MAX, f + FREQ_STEP))
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Delta time 驱动波浪：requestAnimationFrame，累加 time * speed，不触发 setState
  useEffect(() => {
    if (!waveEnabled) return
    let rafId = null
    const cycleRange = 1000
    const tick = (now) => {
      lastFrameRef.current ??= now
      const deltaMs = now - lastFrameRef.current
      lastFrameRef.current = now
      waveTimeRef.current += (deltaMs / 1000) * (cycleRange / Math.max(1, waveSpeed))
      const seed = Math.floor(waveTimeRef.current % cycleRange)
      if (turbulenceRef.current) {
        turbulenceRef.current.setAttribute('seed', String(seed))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      lastFrameRef.current = null
    }
  }, [waveEnabled, waveSpeed])

  // 右上角显示/隐藏面板：鼠标在角区或面板内时保持显示，点完按钮不会立刻消失
  useEffect(() => {
    const threshold = 150
    let hideTimeout = null
    const handleMouseMove = (e) => {
      const isInCorner = e.clientX > window.innerWidth - threshold && e.clientY < threshold
      let isOverPanel = false
      if (panelRef.current) {
        const r = panelRef.current.getBoundingClientRect()
        isOverPanel = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      }
      if (isInCorner || isOverPanel) {
        if (hideTimeout) clearTimeout(hideTimeout); hideTimeout = null
        setShowControls(true)
      } else {
        if (hideTimeout) clearTimeout(hideTimeout)
        hideTimeout = setTimeout(() => { setShowControls(false); hideTimeout = null }, 300)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeout) clearTimeout(hideTimeout)
    }
  }, [])

  const panelBg = 'rgba(0,0,0,0.85)'
  const panelBorder = 'rgba(255,255,255,0.25)'
  const textColorPanel = 'rgba(255,255,255,0.7)'
  const btnBorder = 'rgba(255,255,255,0.3)'
  const btnActive = 'rgba(255,255,255,0.9)'

  const bgColor = inverted ? '#ffffff' : '#000000'
  const textColor = inverted ? '#000000' : '#ffffff'

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 w-full h-full overflow-hidden"
      style={{ 
        margin: 0, 
        padding: 0, 
        background: bgColor,
        border: 'none',
        contain: 'layout paint',
      }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={viewBox}
        preserveAspectRatio="none"
        style={{
          display: 'block',
          margin: 0,
          padding: 0,
          border: 'none',
          transform: 'scale(1.0)',
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        <defs>
          <filter
            id="waveDistortion"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              ref={turbulenceRef}
              type="fractalNoise"
              baseFrequency={`${waveFrequency} 0.02`}
              numOctaves="1"
              result="noise"
              seed="0"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={waveEnabled ? waveAmplitude : 0}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        
        <g
          filter="url(#waveDistortion)"
          style={{
            transform: 'translateZ(0)',
            willChange: 'transform, filter',
            backfaceVisibility: 'hidden',
          }}
        >
          {debugBounds && lastBbox && (
            <rect
              x={lastBbox.x}
              y={lastBbox.y}
              width={lastBbox.width}
              height={lastBbox.height}
              fill="rgba(255,0,0,0.3)"
              stroke="rgba(255,0,0,0.8)"
              strokeWidth="0.5"
            />
          )}
          <text
            ref={textRef}
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="100"
            fontFamily="Inter, 'Archivo Black', system-ui, sans-serif"
            fontWeight={fontWeight}
            fill={outlineMode ? 'none' : textColor}
            stroke={outlineMode ? textColor : waveEnabled ? textColor : 'none'}
            strokeWidth={outlineMode ? outlineWidth / 8 : waveEnabled ? 0.4 : 0}
              paintOrder="stroke fill"
              style={{
                textRendering: 'geometricPrecision',
              }}
            >
              {letter}
            </text>
        </g>
      </svg>

      {/* Calibration Ruler：物理层级隔离，独立 SVG Overlay，viewBox 与窗口 1:1 防锯齿 */}
      {showOverscanRuler && (() => {
        const { w, h } = viewport
        const majorPx = 8
        const minorPx = 4
        const gapPx = 4
        const crossHalf = 20
        const cx = w / 2
        const cy = h / 2
        const labelYTop = majorPx + gapPx + 5
        const labelYBottom = h - majorPx - gapPx - 5
        const labelXLeft = majorPx + gapPx
        const labelXRight = w - majorPx - gapPx - 1
        return (
          <div
            className="CalibrationFrame"
            aria-hidden
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: w,
              height: h,
              zIndex: 999,
              pointerEvents: 'none',
              isolation: 'isolate',
            }}
          >
            <svg
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              preserveAspectRatio="none"
              shapeRendering="crispEdges"
              style={{ display: 'block' }}
            >
              {/* 红色外边框：100vw×100vh 对应 viewBox，1px 不缩放 */}
              <rect x={0} y={0} width={w} height={h} fill="none" stroke="#FF0000" strokeWidth="1px" vectorEffect="nonScalingStroke" />
              {/* 内部刻度线：#444444，1px，主 8px / 子 4px */}
              <g stroke="#444444" strokeWidth="1px" vectorEffect="nonScalingStroke">
                {Array.from({ length: 99 }, (_, i) => i + 1).map((p) => {
                  const x = (w * p) / 100
                  const len = p % 10 === 0 ? majorPx : minorPx
                  return <line key={`t-${p}`} x1={x} y1={0} x2={x} y2={len} />
                })}
                {Array.from({ length: 99 }, (_, i) => i + 1).map((p) => {
                  const x = (w * p) / 100
                  const len = p % 10 === 0 ? majorPx : minorPx
                  return <line key={`b-${p}`} x1={x} y1={h} x2={x} y2={h - len} />
                })}
                {Array.from({ length: 99 }, (_, i) => i + 1).map((p) => {
                  const y = (h * p) / 100
                  const len = p % 10 === 0 ? majorPx : minorPx
                  return <line key={`l-${p}`} x1={0} y1={y} x2={len} y2={y} />
                })}
                {Array.from({ length: 99 }, (_, i) => i + 1).map((p) => {
                  const y = (h * p) / 100
                  const len = p % 10 === 0 ? majorPx : minorPx
                  return <line key={`r-${p}`} x1={w} y1={y} x2={w - len} y2={y} />
                })}
              </g>
              {/* 中心十字：两根 40px 直线，相交于中心，#888888 1px，非矩形 */}
              <line x1={cx} y1={cy - crossHalf} x2={cx} y2={cy + crossHalf} stroke="#888888" strokeWidth="1px" vectorEffect="nonScalingStroke" />
              <line x1={cx - crossHalf} y1={cy} x2={cx + crossHalf} y2={cy} stroke="#888888" strokeWidth="1px" vectorEffect="nonScalingStroke" />
              {/* 数字浮在最上层：Montserrat 10px #888888，黑色背景可读 */}
              <g style={{ isolation: 'isolate' }}>
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
                  <text
                    key={`tl-${p}`}
                    x={(w * p) / 100}
                    y={labelYTop}
                    textAnchor="middle"
                    fill="#888888"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '10px', fontWeight: 400 }}
                  >
                    {p}%
                  </text>
                ))}
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
                  <text
                    key={`bl-${p}`}
                    x={(w * p) / 100}
                    y={labelYBottom}
                    textAnchor="middle"
                    fill="#888888"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '10px', fontWeight: 400 }}
                  >
                    {p}%
                  </text>
                ))}
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
                  <text
                    key={`ll-${p}`}
                    x={labelXLeft}
                    y={(h * p) / 100 + 3}
                    textAnchor="start"
                    fill="#888888"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '10px', fontWeight: 400 }}
                  >
                    {p}%
                  </text>
                ))}
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
                  <text
                    key={`rl-${p}`}
                    x={labelXRight}
                    y={(h * p) / 100 + 3}
                    textAnchor="end"
                    fill="#888888"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '10px', fontWeight: 400 }}
                  >
                    {p}%
                  </text>
                ))}
              </g>
            </svg>
          </div>
        )
      })()}

      {/* 右上角控制面板 */}
      <div
        ref={panelRef}
        className={`absolute top-4 right-4 z-50 flex flex-col gap-2 p-3 w-[160px] rounded-lg transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          color: textColorPanel,
        }}
      >
        {/* 滑块组 */}
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            interval: {intervalMs}ms
          </label>
          <input
            type="range"
            min="200"
            max="3000"
            step="100"
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            weight: {fontWeight}
          </label>
          <input
            type="range"
            min="100"
            max="900"
            value={fontWeight}
            onChange={(e) => setFontWeight(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        
        {/* Wave 频率 - 更慢范围：最小=最慢波，最大=原最慢(现最快) */}
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            wave freq: {waveFrequency.toFixed(3)} (9/0)
          </label>
          <input
            type="range"
            min={FREQ_MIN}
            max={FREQ_MAX}
            step={FREQ_STEP}
            value={waveFrequency}
            onChange={(e) => setWaveFrequency(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        
        {/* Wave 振幅 */}
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            amplitude: {waveAmplitude} (7/8)
          </label>
          <input
            type="range"
            min="0"
            max="80"
            step="2"
            value={waveAmplitude}
            onChange={(e) => setWaveAmplitude(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        
        {/* Wave 动画速度：原最慢 60s 现为最快，可更慢 */}
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            wave speed: {waveSpeed}s
          </label>
          <input
            type="range"
            min="60"
            max="300"
            step="5"
            value={waveSpeed}
            onChange={(e) => setWaveSpeed(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>

        {/* Outline 粗细 */}
        {outlineMode && (
          <div>
            <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
              outline: {outlineWidth}px
            </label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={outlineWidth}
              onChange={(e) => setOutlineWidth(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: 'white' }}
            />
          </div>
        )}

        {/* 按钮组 */}
        <button
          type="button"
          onClick={() => setInverted((v) => !v)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: btnBorder,
            color: inverted ? btnActive : textColorPanel,
            background: inverted ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          invert: {inverted ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setWaveEnabled((w) => !w)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: btnBorder,
            color: waveEnabled ? btnActive : textColorPanel,
            background: waveEnabled ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          wave: {waveEnabled ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setOutlineMode((o) => !o)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: btnBorder,
            color: outlineMode ? btnActive : textColorPanel,
            background: outlineMode ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          outline: {outlineMode ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setDebugBounds((d) => !d)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: btnBorder,
            color: debugBounds ? '#ff4444' : textColorPanel,
            background: debugBounds ? 'rgba(255,0,0,0.15)' : 'transparent',
          }}
        >
          debug: {debugBounds ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setShowOverscanRuler((v) => !v)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: btnBorder,
            color: showOverscanRuler ? btnActive : textColorPanel,
            background: showOverscanRuler ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          overscan ruler: {showOverscanRuler ? 'on' : 'off'}
        </button>
        
        <div className="text-[9px] font-ui mt-1 opacity-80" style={{ color: textColorPanel }}>
          7/8 amp · 9/0 freq
        </div>
      </div>
    </div>
  )
}
