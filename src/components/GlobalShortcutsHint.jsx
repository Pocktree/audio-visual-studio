/**
 * App 级快捷键（见 App.jsx）：全屏、轮播暂停。
 * 键帽点击通过 window 自定义事件与键盘 F / P 行为一致。
 */

/** 与 App.jsx 中监听器名称一致 */
export const AVS_KEYCAP_EVENTS = {
  fullscreen: 'avs-keycap-fullscreen',
  carousel: 'avs-keycap-carousel',
}

const KEY_GRAY = '#888888'

function KeyCapButton({ letter, title, eventName }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        window.dispatchEvent(new CustomEvent(eventName))
      }}
      className="inline-flex h-5 min-w-[1.125rem] shrink-0 cursor-pointer items-center justify-center rounded border bg-transparent px-1 font-mono text-[0.65rem] leading-none transition-opacity hover:opacity-80"
      style={{ borderColor: KEY_GRAY, color: KEY_GRAY }}
    >
      {letter}
    </button>
  )
}

export function GlobalShortcutsHint({ color = 'rgba(255,255,255,0.45)', variant = 'panel' }) {
  const row = 'flex items-center gap-1.5'
  const zhFont = variant === 'inline' ? 'font-mono' : 'font-ui'
  const enFont = variant === 'inline' ? 'font-mono' : 'font-ui'
  const labelZh = `shrink-0 ${zhFont}`
  const labelEn = `text-[0.65rem] opacity-70 ${enFont}`

  const inner = (
    <>
      <div className={row}>
        <KeyCapButton
          letter="F"
          title="F · fullscreen · 全屏 · 点击切换全屏"
          eventName={AVS_KEYCAP_EVENTS.fullscreen}
        />
        <span className="flex min-w-0 items-baseline gap-1" style={{ color }}>
          <span className={labelZh}>全屏</span>
          <span className={labelEn}>FS</span>
        </span>
      </div>
      <div className={row}>
        <KeyCapButton
          letter="P"
          title="P · pause / resume carousel · 暂停/恢复轮播 · 点击切换"
          eventName={AVS_KEYCAP_EVENTS.carousel}
        />
        <span className="flex min-w-0 items-baseline gap-1" style={{ color }}>
          <span className={labelZh}>轮播</span>
          <span className={labelEn}>pause</span>
        </span>
      </div>
    </>
  )

  if (variant === 'inline') {
    return (
      <div className="mt-1.5 space-y-1" style={{ color }}>
        {inner}
      </div>
    )
  }

  return (
    <div
      className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-[9px] font-ui leading-snug"
      style={{ color }}
    >
      {inner}
    </div>
  )
}
