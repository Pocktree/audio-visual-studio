import { useState, useEffect, useRef } from 'react'

/**
 * 全局性能监视器：实时显示 FPS 与 Frame Time（注释小字、灰色）。
 * 用于在 RAIN / Audio-visual 模式下观察高刷屏上的动画表现。
 */
export function PerformanceMonitor() {
  const [fps, setFps] = useState(0)
  const [frameTimeMs, setFrameTimeMs] = useState(0)
  const lastTimeRef = useRef(performance.now())
  const frameTimeAccRef = useRef(0)
  const framesCountRef = useRef(0)
  const rafIdRef = useRef(null)

  // rAF 循环：每帧记录间隔时间
  useEffect(() => {
    const tick = (now) => {
      const delta = now - lastTimeRef.current
      lastTimeRef.current = now
      frameTimeAccRef.current += delta
      framesCountRef.current += 1
      rafIdRef.current = requestAnimationFrame(tick)
    }
    lastTimeRef.current = performance.now()
    rafIdRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  // 每 200ms 更新一次显示，避免 setState 过于频繁影响被测 FPS
  useEffect(() => {
    const interval = setInterval(() => {
      const n = framesCountRef.current
      if (n > 0) {
        const avgMs = frameTimeAccRef.current / n
        setFrameTimeMs(avgMs)
        setFps(1000 / avgMs)
        frameTimeAccRef.current = 0
        framesCountRef.current = 0
      }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  const refreshRate = typeof window.screen?.refreshRate === 'number' ? window.screen.refreshRate : 60
  const thresholdMs = 1000 / refreshRate
  const isOverThreshold = frameTimeMs > thresholdMs
  const valueColor = isOverThreshold ? 'rgba(255,80,80,0.95)' : 'rgba(128,128,128,0.85)'

  return (
    <div
      className="pointer-events-none select-none font-mono"
      style={{
        position: 'fixed',
        top: 10,
        right: 12,
        zIndex: 40,
        fontSize: '10px',
        color: 'rgba(128,128,128,0.85)',
        letterSpacing: '0.02em',
      }}
      aria-hidden
    >
      <span title="Frames per second">FPS</span>
      <span style={{ marginLeft: 4, color: valueColor }}>{fps.toFixed(1)}</span>
      <span style={{ marginLeft: 6, opacity: 0.7 }}>·</span>
      <span style={{ marginLeft: 6, color: valueColor }} title="Frame time (ms)">{frameTimeMs.toFixed(2)} ms</span>
    </div>
  )
}
