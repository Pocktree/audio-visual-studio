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

// 模块定义 - 自动轮播（已取消 invert，并入 big）
const MODULES = [
  { id: 'grid', name: 'GRID', label: 'GRID MODULE' },
  { id: 'bigtypo', name: 'BIG', label: 'BIG' },
  { id: 'scroll', name: 'SCROLL', label: 'SCROLL TEST' },
  { id: 'rain', name: 'RAIN', label: 'RAIN TEST' },
  { id: 'audiovisual', name: 'AUDIO-VISUAL', label: 'AUDIO-VISUAL STUDIO' },
]

const AUTO_CYCLE_INTERVAL = 20000 // 20秒

function App() {
  const { settings, loading } = useSettings()
  const [activeModule, setActiveModule] = useState('grid')
  const [isNavVisible, setIsNavVisible] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isAutoPlay, setIsAutoPlay] = useState(true) // 自动轮播开关
  const pendingModuleRef = useRef(null)

  // 自动轮播 - 受 isAutoPlay 控制
  useEffect(() => {
    if (!isAutoPlay) return
    const interval = setInterval(() => {
      setActiveModule((prev) => {
        const currentIndex = MODULES.findIndex((m) => m.id === prev)
        const nextIndex = (currentIndex + 1) % MODULES.length
        return MODULES[nextIndex].id
      })
    }, AUTO_CYCLE_INTERVAL)
    return () => clearInterval(interval)
  }, [isAutoPlay])

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
    <div className="fixed inset-0 bg-black">
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
          style={{ color: isAutoPlay ? 'rgba(255,255,255,0.5)' : 'rgba(255,100,100,0.7)' }}
        >
          {isAutoPlay ? 'auto' : 'paused'}
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
