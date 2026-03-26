import { useState, useEffect, useRef } from 'react'
import { RippleButton } from './RippleButton'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'

const WIDE_GAMUT = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
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
  const animationRef = useRef(null)
  const linesRef = useRef([])
  const speedRef = useRef(5)
  const densityRef = useRef(50)
  const showGridRef = useRef(true)
  const showLabelsRef = useRef(true)
  const isLightModeRef = useRef(false)
  const colorSchemeRef = useRef('default') // 'default' | 'water'
  const lastFpsRef = useRef(0) // 动画循环内每 500ms 更新，用于压力测试时禁止 FPS 跌破半刷新率后继续 +
  const cycleDirectionRef = useRef(1) // 1=递增 -1=递减，用于左下角密度自动循环

  // 控制参数 - 用于 UI 显示，初始随机
  const [speed, setSpeed] = useState(() => 3 + Math.floor(Math.random() * 10))
  const [density, setDensity] = useState(() => 30 + Math.floor(Math.random() * 80))
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [isLightMode, setIsLightMode] = useState(false)
  const [colorScheme, setColorScheme] = useState('default') // 'default' | 'water' 水蓝雨+粉网格
  const [showControls, setShowControls] = useState(false)

  // 鼠标靠近右上角显示控制面板，移开后延迟隐藏
  useEffect(() => {
    const threshold = 150
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
      : (Math.random() > 0.7 ? '#FF0000' : (isLightMode ? '#000000' : '#FFFFFF'))
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
      }

      // 使用 CSS 尺寸而不是绘图表面尺寸
      const w = window.innerWidth
      const h = window.innerHeight
      const currentSpeed = speedRef.current
      const currentDensity = densityRef.current
      const currentShowGrid = showGridRef.current
      const currentShowLabels = showLabelsRef.current
      const isLight = isLightModeRef.current
      const scheme = colorSchemeRef.current

      // LIGHT 控制整体深浅：背景只随 LIGHT；WATER 只改网格和雨色，不改背景
      const isWater = scheme === 'water'
      const bgColor = isLight ? '#FFFFFF' : '#000000'
      const gridColor = isWater ? 'rgba(255, 182, 193, 0.35)' : (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')
      const textColor = isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)'
      const panelBg = isLight ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)'
      const panelBorder = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)'
      const btnBorder = isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'
      const btnActive = isLight ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)'
      
      // 清除画布 - 清除整个绘图表面
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
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
          line.y = -line.length
          line.x = Math.random() * w
          line.velocity = currentSpeed * (0.5 + Math.random() * 0.5)
          // 重置颜色（水蓝配色时从水蓝色系中随机）
          line.color = isWater
            ? WATER_BLUE_PALETTE[Math.floor(Math.random() * WATER_BLUE_PALETTE.length)]
            : (Math.random() > 0.7 ? '#FF0000' : (isLight ? '#000000' : '#FFFFFF'))
        }

        // 绘制线条（WATER on 用水蓝；WATER off 时 LIGHT on 黑+红、LIGHT off 白+红）
        ctx.strokeStyle = line.color
        ctx.lineWidth = line.width
        ctx.beginPath()
        ctx.moveTo(line.x, line.y)
        ctx.lineTo(line.x, line.y + line.length)
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
  }, [])

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

      {/* 控制面板 - 右上角，light on 时滑块圆形 thumb 加 1px 灰框 */}
      <div 
        className={`absolute top-4 right-4 z-50 flex flex-col gap-2 p-3 w-[140px] rounded-lg transition-opacity duration-300 ${isLightMode ? 'rain-panel-light' : ''} ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ 
          background: panelBg, 
          border: `1px solid ${panelBorder}`,
          color: textColor
        }}
      >
        <div>
          <label 
            className="block text-[10px] font-ui mb-1"
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
            className="block text-[10px] font-ui mb-1"
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
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{ 
            borderColor: btnBorder,
            color: showGrid ? btnActive : textColor
          }}
        >
          grid: {showGrid ? 'on' : 'off'}
        </RippleButton>
        <RippleButton
          onClick={() => setShowLabels(!showLabels)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{ 
            borderColor: btnBorder,
            color: showLabels ? btnActive : textColor
          }}
        >
          labels: {showLabels ? 'on' : 'off'}
        </RippleButton>
        <RippleButton
          onClick={() => setIsLightMode(!isLightMode)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{ 
            borderColor: btnBorder,
            color: isLightMode ? btnActive : textColor,
            background: isLightMode ? 'rgba(0,0,0,0.1)' : 'transparent'
          }}
        >
          light: {isLightMode ? 'on' : 'off'}
        </RippleButton>
        <RippleButton
          onClick={() => setColorScheme(s => s === 'water' ? 'default' : 'water')}
          className="text-[10px] font-ui py-1 px-2 border rounded-md w-full text-left"
          style={{ 
            borderColor: btnBorder,
            color: colorScheme === 'water' ? btnActive : textColor,
            background: colorScheme === 'water' ? 'rgba(0,191,255,0.15)' : 'transparent'
          }}
        >
          water: {colorScheme === 'water' ? 'on' : 'off'}
        </RippleButton>

        <GlobalShortcutsHint color={isLightMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)'} />
      </div>
      <style>{`
        .rain-panel-light input[type="range"]::-webkit-slider-thumb {
          border: 1px solid rgba(0,0,0,0.3);
        }
        .rain-panel-light input[type="range"]::-moz-range-thumb {
          border: 1px solid rgba(0,0,0,0.3);
        }
      `}</style>
      
      {/* 左下角：实时粒子数 + 压力测试提示 */}
      <div 
        className="absolute bottom-4 left-4 text-[10px] font-ui"
        style={{ color: 'rgba(255,255,255,0.4)' }}
      >
        <div title="当前粒子数">particles: {density}</div>
        <div title="+ 暴增 500 / − 减少 500；FPS 低于半刷新率时不可再 +">stress: + / − key ±500</div>
      </div>
    </div>
  )
}
