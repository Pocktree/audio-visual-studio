/**
 * 统一配置入口：颜色、字体、动画速度等均可在此修改，无需改业务代码。
 * 修改后保存即可生效（开发时热更新）。
 */

export const appConfig = {
  /** 主题：'dark' | 'light' */
  theme: 'dark',

  /** 字体列表（优先使用第一项作为默认） */
  fonts: ['Inter', 'Geist Mono', 'Helvetica Neue', 'Helvetica', 'sans-serif'],

  /** 主色板（用于屏保、色块测试等） */
  colors: {
    background: '#0a0a0a',
    backgroundAlt: '#141316',
    text: '#e8e6ea',
    textMuted: '#9b95a6',
    border: 'rgba(255,255,255,0.08)',
    accent: '#e88a7e',
    /** 测试/展示用色条 */
    testColors: ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#e03c31', '#00a4a6', '#9b59b6'],
  },

  /** 动画与过渡 */
  animation: {
    /** 全局过渡基准速度（秒），用于页面切换、淡入淡出等 */
    speed: 0.8,
    /** 缓动曲线 [x1,y1,x2,y2] */
    easeDefault: [0.4, 0, 0.2, 1],
    easeOut: [0.33, 1, 0.68, 1],
    easeInOut: [0.65, 0, 0.35, 1],
    /** 无操作多少毫秒后进入屏保（30 秒） */
    screensaverIdleMs: 30000,
    /** 退出屏保后多少毫秒内不再因无操作自动进入 */
    screensaverExitCooldownMs: 3000,
    /** 屏保内每个“画面”展示时长（毫秒），之后随机切到下一模块 */
    screensaverSlideDurationMs: 8000,
    /** Ken Burns：缩放范围 [min, max]，如 [1, 1.12] 表示缓慢放大至 1.12 倍 */
    kenBurnsScaleRange: [1, 1.12],
    /** Ken Burns：平移范围（占容器比例），如 0.05 表示最多移动 5% */
    kenBurnsPanRange: 0.05,
    /** Ken Burns：旋转范围（度），如 [-2, 2] 表示 -2° 到 2° */
    kenBurnsRotateRange: [-2, 2],
    /** 按钮点击时缩放比例（微交互） */
    buttonTapScale: 0.97,
    /** 按钮点击动画时长（秒） */
    buttonTapDuration: 0.15,
  },
}

export default appConfig
