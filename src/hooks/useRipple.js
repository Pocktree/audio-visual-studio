import { useCallback, useRef } from 'react'

/**
 * 点击时在按钮上产生平滑水波纹效果
 * @returns { ref, onClick } - ref 绑到按钮容器，onClick 合并到按钮的 onClick
 */
export function useRipple() {
  const containerRef = useRef(null)

  const addRipple = useCallback((e) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = Math.max(rect.width, rect.height) * 2
    const span = document.createElement('span')
    span.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      margin-left: -${size / 2}px;
      margin-top: -${size / 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.35);
      transform: scale(0);
      pointer-events: none;
      animation: ripple 0.6s ease-out forwards;
    `
    el.style.position = el.style.position || 'relative'
    el.style.overflow = 'hidden'
    el.appendChild(span)
    const onEnd = () => {
      span.remove()
      span.removeEventListener('animationend', onEnd)
    }
    span.addEventListener('animationend', onEnd)
  }, [])

  return { rippleRef: containerRef, addRipple }
}
