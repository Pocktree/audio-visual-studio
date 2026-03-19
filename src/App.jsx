import { useEffect, useState, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import studioSettings from './config/settings.json'
import { appConfig } from './config'
import { useSettings } from './hooks/useSettings'
import { FullWindowType } from './components/FullWindowType'
import { IndustrialTypoModule } from './components/IndustrialTypoModule'
import { GridModule } from './components/GridModule'
import { ScrollTestModule } from './components/ScrollTestModule'
import { RainTestModule } from './components/RainTestModule'
import { PerformanceMonitor } from './components/PerformanceMonitor'
import { RippleButton } from './components/RippleButton'
import './App.css'

// 模块定义 - 首屏为 AUDIO-VISUAL（展示 Studio Logo）
const MODULES = [
  { id: 'audiovisual', name: 'STUDIO', label: 'STUDIO LOGO' },
  { id: 'grid', name: 'GRID', label: 'GRID MODULE' },
  { id: 'bigtypo', name: 'BIG', label: 'BIG' },
  { id: 'scroll', name: 'SCROLL', label: 'SCROLL TEST' },
  { id: 'rain', name: 'RAIN', label: 'RAIN TEST' },
]

const AUTO_CYCLE_INTERVAL = 20000 // 20秒

function App() {
  const { settings, loading } = useSettings()
  const [activeModule, setActiveModule] = useState('audiovisual')
  const [isNavVisible, setIsNavVisible] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isAutoPlay, setIsAutoPlay] = useState(true) // 自动轮播开关（如 P 键）
  const [isPaused, setIsPaused] = useState(false)    // 触屏/长按暂停，true 时停止轮播
  const pendingModuleRef = useRef(null)

  // 自动轮播 - 受 isAutoPlay 与 isPaused 控制
  useEffect(() => {
    if (!isAutoPlay || isPaused) return
    const interval = setInterval(() => {
      setActiveModule((prev) => {
        const currentIndex = MODULES.findIndex((m) => m.id === prev)
        const nextIndex = (currentIndex + 1) % MODULES.length
        return MODULES[nextIndex].id
      })
    }, AUTO_CYCLE_INTERVAL)
    return () => clearInterval(interval)
  }, [isAutoPlay, isPaused])

  // 切换模块 - 无闪黑，仅切换内容（闪黑测试仅在 Grid 内）
  const switchModule = useCallback((moduleId) => {
    if (moduleId === activeModule || isTransitioning) return
    pendingModuleRef.current = moduleId
    setIsTransitioning(true)
    setActiveModule(moduleId)
    requestAnimationFrame(() => {
      setIsTransitioning(false)
      pendingModuleRef.current = null
    })
  }, [activeModule, isTransitioning])

  // 导航栏仅当鼠标靠近底部时出现；点击/空格切换模式不会唤出导航
  const NAV_THRESHOLD = 100 // 距离底部 100px 内视为「靠近」
  useEffect(() => {
    const handleMouseMove = (e) => {
      const nearBottom = e.clientY > window.innerHeight - NAV_THRESHOLD
      setIsNavVisible(nearBottom)
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  // 触屏/鼠标长按 ≥200ms：切换 isPaused（暂停/恢复轮播），并显示边缘呼吸光
  const HOLD_MS = 200
  const holdTimerRef = useRef(null)
  const [showHoldGlow, setShowHoldGlow] = useState(false)

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setShowHoldGlow(false)
  }, [])

  useEffect(() => {
    const onHold = () => {
      setShowHoldGlow(true)
      setIsPaused((p) => !p)
    }
    
    // 区分点击与长按：记录 touch 开始位置
    const touchStartPosRef = { x: 0, y: 0 }
    
    const onPointerUp = (e) => {
      // 如果移动距离过大，不触发长按（区分滑动与长按）
      if (e?.type === 'touchend') {
        const moved = Math.abs(touchStartPosRef.x) > 10 || Math.abs(touchStartPosRef.y) > 10
        if (moved) {
          clearHoldTimer()
          return
        }
      }
      clearHoldTimer()
    }
    
    const handlePointerDown = (e) => {
      // 记录 touch 开始位置
      if (e?.type === 'touchstart') {
        touchStartPosRef.x = e.touches?.[0]?.clientX ?? 0
        touchStartPosRef.y = e.touches?.[0]?.clientY ?? 0
        return
      }
      clearHoldTimer()
      holdTimerRef.current = setTimeout(onHold, HOLD_MS)
    }
    
    const root = document.getElementById('app-root')
    if (!root) return
    
    root.addEventListener('touchstart', handlePointerDown, { passive: true })
    root.addEventListener('touchend', onPointerUp, { passive: true })
    root.addEventListener('touchcancel', onPointerUp, { passive: true })
    root.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('mouseleave', onPointerUp)
    
    return () => {
      clearHoldTimer()
      if (root) {
        root.removeEventListener('touchstart', handlePointerDown)
        root.removeEventListener('touchend', onPointerUp)
        root.removeEventListener('touchcancel', onPointerUp)
      }
      root.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('mouseup', onPointerUp)
      window.removeEventListener('mouseleave', onPointerUp)
    }
  }, [clearHoldTimer])

  // 键盘：P 轮播开关、F 全屏、空格下一模块（不用数字键切换模块）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'p' || e.key === 'P') {
        setIsAutoPlay(prev => !prev)
      }
      else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
      else if (e.key === ' ') {
        e.preventDefault()
        const currentIndex = MODULES.findIndex(m => m.id === activeModule)
        const nextIndex = (currentIndex + 1) % MODULES.length
        switchModule(MODULES[nextIndex].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeModule, switchModule])

  // 从 settings 应用主题
  useEffect(() => {
    const root = document.documentElement
    const t = studioSettings?.theme
    if (t?.background) root.style.setProperty('--theme-background', t.background)
    if (t?.primary) root.style.setProperty('--theme-primary', t.primary)
    if (t?.accent) root.style.setProperty('--theme-accent', t.accent)
    if (t?.fontFamily) root.style.setProperty('--font-stack-sans', t.fontFamily)
    if (settings?.defaultFontStack?.sans) root.style.setProperty('--font-stack-sans', settings.defaultFontStack.sans)
    if (settings?.defaultFontStack?.mono) root.style.setProperty('--font-stack-mono', settings.defaultFontStack.mono)
    return () => {
      root.style.removeProperty('--theme-background')
      root.style.removeProperty('--theme-primary')
      root.style.removeProperty('--theme-accent')
      root.style.removeProperty('--font-stack-sans')
      root.style.removeProperty('--font-stack-mono')
    }
  }, [settings?.defaultFontStack])

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen font-ui text-sm gap-2 bg-black"
        style={{ color: '#ffffff' }}
      >
        <span>loading…</span>
      </div>
    )
  }

  const palette = settings.testColors ?? studioSettings?.modes?.colorTest?.colors ?? appConfig.colors.testColors
  const fontFamily = settings.defaultFontStack?.sans ?? 'var(--font-stack-sans)'

  // 渲染当前模块
  const renderModule = () => {
    switch (activeModule) {
      case 'grid':
        return <GridModule fontFamily={fontFamily} onModuleChange={switchModule} onAutoPlayChange={setIsAutoPlay} />
      case 'bigtypo':
        return <FullWindowType />
      case 'scroll':
        return <ScrollTestModule fontFamily={fontFamily} />
      case 'rain':
        return <RainTestModule />
      case 'audiovisual':
        return <IndustrialTypoModule fontFamily={fontFamily} />
      default:
        return <GridModule fontFamily={fontFamily} onModuleChange={switchModule} onAutoPlayChange={setIsAutoPlay} />
    }
  }

  // 当前模块索引
  const currentIndex = MODULES.findIndex(m => m.id === activeModule)

  return (
    <div id="app-root" className="fixed inset-0 bg-black">
      {/* 长按 ≥200ms 时边缘极淡 1px 粉色呼吸光 */}
      {showHoldGlow && (
        <div
          className="pointer-events-none fixed inset-0 z-[100]"
          style={{
            boxShadow: 'inset 0 0 0 1px rgba(255, 100, 120, 0.35)',
            animation: 'hold-glow-breathe 1.2s ease-in-out infinite',
          }}
          aria-hidden
        />
      )}
      {/* 主内容 */}
      <AnimatePresence mode="wait">
        {!isTransitioning && (
          <motion.div
            key={activeModule}
            className="absolute inset-0"
            style={{ zIndex: 1 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
          >
            {renderModule()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 性能监视器：仅在 RAIN / Audio-visual 模式显示，用于观察高刷屏表现 */}
      {(activeModule === 'rain' || activeModule === 'audiovisual') && <PerformanceMonitor />}

      {/* 底部导航栏 - 隐藏式，顶边波浪形裁剪 + 水波纹按钮 */}
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <clipPath id="nav-wavy-top" clipPathUnits="objectBoundingBox">
            <path d="M 0,1 L 0,0.10 Q 0.05,0 0.1,0.10 Q 0.15,0.18 0.2,0.10 Q 0.25,0 0.3,0.10 Q 0.35,0.18 0.4,0.10 Q 0.45,0 0.5,0.10 Q 0.55,0.18 0.6,0.10 Q 0.65,0 0.7,0.10 Q 0.75,0.18 0.8,0.10 Q 0.85,0 0.9,0.10 Q 0.95,0.18 1,0.10 L 1,1 Z" />
          </clipPath>
        </defs>
      </svg>
      <div
        className={`fixed bottom-0 left-0 right-0 h-16 transition-opacity duration-300 z-50`}
        style={{ clipPath: 'url(#nav-wavy-top)', opacity: isNavVisible ? 1 : 0, pointerEvents: isNavVisible ? 'auto' : 'none' }}
      >
        <nav
          className="w-full h-full flex items-center justify-center gap-1"
          style={{ background: 'rgba(0,0,0,0.9)' }}
        >
        {/* 左侧：自动播放状态 */}
        <span
          className="absolute left-4 text-[10px] font-ui flex items-center gap-2"
          style={{ color: isAutoPlay && !isPaused ? 'rgba(255,255,255,0.5)' : 'rgba(255,100,100,0.7)' }}
        >
          {isAutoPlay && !isPaused ? 'auto' : 'paused'}
        </span>

        {/* 中间：模块按钮 - 悬停西柚色，选中无背景仅改字色 */}
        {MODULES.map((m) => (
          <RippleButton
            key={m.id}
            onClick={() => switchModule(m.id)}
            className="nav-mode-btn h-12 px-5 font-ui font-semibold tracking-tight outline-none focus:outline-none focus:ring-0"
            style={{
              fontSize: '16px',
              backgroundColor: 'transparent',
              color: activeModule === m.id ? 'var(--nav-mode-active)' : '#ffffff',
            }}
          >
            {m.name.toLowerCase()}
          </RippleButton>
        ))}
        </nav>
      </div>
    </div>
  )
}

export default App
