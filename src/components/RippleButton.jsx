import { useRipple } from '../hooks/useRipple'

/**
 * 带水波纹点击效果的按钮，用于导航与面板
 */
export function RippleButton({ children, onClick, className = '', style = {}, ...props }) {
  const { rippleRef, addRipple } = useRipple()
  return (
    <button
      ref={rippleRef}
      type="button"
      className={className}
      style={style}
      onClick={(e) => {
        addRipple(e)
        onClick?.(e)
      }}
      {...props}
    >
      {children}
    </button>
  )
}
