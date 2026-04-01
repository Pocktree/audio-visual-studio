import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as Tone from 'tone'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'

const WIDE_GAMUT = {
  white: 'color(display-p3 1 1 1)',
  black: '#000000',
  red: 'color(display-p3 1 0 0)',
  green: 'color(display-p3 0 1 0)',
  blue: 'color(display-p3 0 0 1)',
  yellow: 'color(display-p3 1 1 0)',
  cyan: 'color(display-p3 0 1 1)',
  magenta: 'color(display-p3 1 0 1)',
}

const COLORS = [WIDE_GAMUT.red, WIDE_GAMUT.green, WIDE_GAMUT.blue, WIDE_GAMUT.yellow, WIDE_GAMUT.cyan, WIDE_GAMUT.magenta]

// 鲜艳色：高饱和度、色相区分明显（数量翻倍供随机选用）
const MUTED_PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF69B4', '#7B68EE', '#32CD32',
  '#FF4757', '#2ED573', '#1E90FF', '#FF6348', '#FFA502',
  '#A55EEA', '#26DE81', '#FD9644', '#FC5C65', '#45AAF2',
  '#5F27CD', '#00D2D3', '#FF9FF3', '#54A0FF', '#48DBFB',
]

// Scroll 每行文字随机倍率：150%、125%、100%、75%、50%、25%
const SCALE_OPTIONS = [1.5, 1.25, 1, 0.75, 0.5, 0.25]

// Pursuit Mode：与 Audio-Visual 一致的 Logo 路径 (viewBox 0 0 310.61 122.86)
const PURSUIT_LOGO_PATHS = [
  'M63.25,32.32v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z',
  'M97.48,21.6v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01,0-8.25,5.19-13.8,12.83-13.8,4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM90.86,45.84c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z',
  'M110.7,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM110.45,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z',
  'M202.29,24.35c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67c0-2.14,1.48-3.67,3.57-3.67s3.57,1.53,3.57,3.67ZM202.04,32.14v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z',
  'M216.61,37.03c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z',
  'M17.88,81.75c-2.14,0-3.67.71-3.67,2.39,0,4.58,14.41,2.19,14.41,11.97,0,5.55-4.94,8.25-10.75,8.25-4.13,0-8.4-1.32-11.26-3.82l2.29-4.63c2.5,2.14,6.26,3.36,9.22,3.36,2.29,0,4.02-.76,4.02-2.55,0-5.04-14.21-2.29-14.16-11.97,0-5.6,4.79-8.2,10.29-8.2,3.57,0,7.28,1.07,9.98,2.9l-2.39,4.79c-2.65-1.58-5.65-2.5-8-2.5Z',
  'M257.3,32.14v27.25s-6.67,0-6.67,0v-5.04c-1.88,3.62-5.14,5.3-9.47,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,6.82-3.41,6.82-7.79v-13.45h6.67Z',
  'M279.2,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52ZM279.15,49.92v-2.45s-6.88,0-6.88,0c-3.51,0-5.14.97-5.14,3.36s1.83,3.77,4.84,3.77c3.82,0,6.82-2.04,7.18-4.69Z',
  'M24.96,59.39v-3.31c-1.88,2.39-4.94,3.62-8.81,3.62-5.86,0-9.52-3.62-9.52-8.45s3.72-8.15,10.34-8.2h7.94s0-.71,0-.71c0-3.16-2.09-5.04-6.16-5.04-2.55,0-5.3.87-8.1,2.55l-2.39-4.58c3.92-2.19,6.98-3.36,11.97-3.36,7.13,0,11.15,3.62,11.2,9.68l.05,17.83h-6.52ZM24.91,49.92v-2.45s-6.88,0-6.88,0c-3.51,0-5.14.97-5.14,3.36s1.83,3.77,4.84,3.77c3.82,0,6.82-2.04,7.18-4.69Z',
  'M296.91,21.6v37.79s-6.62,0-6.62,0V21.6s6.62,0,6.62,0Z',
  'M50.23,102.27c-2.09,1.27-4.43,1.99-6.82,1.99-4.43,0-8-2.55-8-8.15v-13.45s-3.82,0-3.82,0l-.05-4.84h3.87s0-7.49,0-7.49h6.57v7.49s5.67,0,5.67,0v4.84h-5.67s0,12.27,0,12.27c0,2.6,1.07,3.46,2.85,3.46,1.12,0,2.39-.41,3.87-1.12l1.53,4.99Z',
  'M78.43,76.67v27.25s-6.67,0-6.67,0v-5.04c-1.42,3.72-4.12,5.3-8.45,5.3-6.11,0-9.88-4.02-9.88-10.44v-17.06s6.67,0,6.67,0v15.13c0,3.82,2.19,6.11,5.86,6.11,4.28-.05,5.8-3.41,5.8-7.79v-13.45h6.67Z',
  'M110.45,66.16v37.79s-6.62,0-6.62,0v-4.38c-1.94,3-5.09,4.69-9.17,4.69-7.79,0-12.99-5.7-12.99-14.01s5.19-13.8,12.83-13.8c4.18,0,7.33,1.68,9.32,4.74v-15.02s6.62,0,6.62,0ZM103.83,90.4c0-4.89-3.16-8.3-7.74-8.3s-7.69,3.46-7.74,8.3c.05,4.89,3.16,8.3,7.74,8.3s7.74-3.41,7.74-8.3Z',
  'M124.26,68.91c0,2.14-1.48,3.67-3.57,3.67s-3.57-1.53-3.57-3.67,1.48-3.67,3.57-3.67,3.57,1.53,3.57,3.67ZM124,76.7v27.25s-6.62,0-6.62,0v-27.25s6.62,0,6.62,0Z',
  'M287.47,84.02c-2.79-3.29-6.26-7.39-13-7.39s-10.21,4.1-12.99,7.39c-2.82,3.33-4.75,5.36-8.63,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.62,5.36s-5.8-2.04-8.62-5.36c-2.79-3.29-6.26-7.39-12.99-7.39s-10.2,4.1-12.99,7.39c-2.82,3.32-4.74,5.36-8.61,5.36s-5.58-2.04-8.28-5.36c-.73-.9-1.51-1.86-2.39-2.78-1.12-1.33-2.52-2.42-4.15-3.21-.38-.2-.8-.36-1.22-.52-.01,0-.02,0-.03-.01-.65-.25-1.35-.45-2.09-.59-.29-.06-.59-.13-.89-.17-.11-.01-.21-.03-.33-.04-.81-.11-1.64-.18-2.51-.18-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,7.66,0,13.12-4.56,14.13-11.53,2,1.42,4.47,2.43,7.75,2.43,6.73,0,10.2-4.1,12.99-7.39,2.82-3.32,4.74-5.36,8.62-5.36s5,2.04,8.62,5.36c2.79,3.29,6,7.39,12.99,7.39s10.2-4.1,12.99-7.39c2.82-3.33,4.74-5.36,8.62-5.36s5.8,2.04,8.62,5.36c2.79,3.29,6.26,7.39,12.99,7.39s10.21-4.1,13-7.39c2.82-3.32,4.75-5.36,8.63-5.36s5,2.04,8.63,5.36c2.79,3.29,7.08,7.39,13.81,7.39v-5.73c-3.88,0-6.62-2.04-9.44-5.36ZM144.53,98.66c-4.58,0-7.74-3.36-7.74-8.25s3.16-8.25,7.74-8.25,7.64,3.36,7.64,8.25-3.16,8.25-7.64,8.25Z',
  'M182.33,45.55c-1.13,3.03-3.02,8.11-4.57,8.11s-3.43-5.08-4.56-8.11c-2.06-5.55-4.41-11.85-9.93-11.85-5.31,0-7.6,4.6-9.28,7.96-1.62,3.26-2.56,4.79-4.15,4.79s-2.71-1.57-4.55-4.9c-1.03-1.86-2.21-3.94-3.85-5.5-2.53-2.76-6.31-4.37-10.87-4.37-8.61,0-14.41,5.55-14.41,13.8,0,8.3,5.81,13.9,14.41,13.9,6.88,0,11.98-3.66,13.69-9.45,1.43,1.32,3.21,2.24,5.59,2.24,5.31,0,7.6-4.6,9.28-7.96,1.62-3.26,2.56-4.79,4.15-4.79s3.43,5.08,4.56,8.11c2.06,5.55,4.41,11.85,9.93,11.85s7.87-6.29,9.94-11.85c1.13-3.03,3.02-8.11,4.57-8.11v-5.73c-5.53,0-7.87,6.29-9.94,11.85ZM130.56,53.84c-4.58,0-7.74-3.36-7.74-8.25s3.16-8.25,7.74-8.25,7.64,3.36,7.64,8.25-3.16,8.25-7.64,8.25Z',
]

const PURSUIT_SPEEDS = [480, 960, 1440] // pps
const TICK_SPACING_PX = 100
const TICK_LENGTH_PX = 12
const LOOM_STRINGS = 20

function rowToNote(rowIdx) {
  const invertedRow = Math.max(0, Math.min(LOOM_STRINGS - 1, LOOM_STRINGS - 1 - rowIdx))
  const scale = [0, 3, 5, 7, 10]
  const octave = 2 + Math.floor(invertedRow / scale.length)
  const degree = scale[invertedRow % scale.length]
  return Tone.Frequency(12 * (octave + 1) + degree, 'midi').toNote()
}

function getPartialsByRow(rowIdx) {
  const t = 1 - rowIdx / Math.max(1, LOOM_STRINGS - 1)
  return [1, 0.2 + t * 0.4, 0.05 + t * 0.35]
}

function isUpperChar(ch) {
  return /[A-Z]/.test(ch)
}

function isLowerChar(ch) {
  return /[a-z]/.test(ch)
}

/** 互补正弦波 clipPath（objectBoundingBox 0-1）：上缘近 0、下缘近 1，奇偶行咬合 */
function getWavyClipPathD(amplitude = 0.06, cycles = 5, segments = 60) {
  const topBase = 0.08
  const bottomBase = 0.92
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const x = i / segments
    const s = Math.sin(2 * Math.PI * cycles * x)
    const c0 = topBase + amplitude * s
    const c1 = bottomBase - amplitude * s
    pts.push({ x, c0, c1 })
  }
  const fmt = (v) => v.toFixed(4)
  // even: 上缘 C0，下缘 C1 → 下一行(odd)上缘 = C1 与本行下缘一致
  let even = `M ${fmt(0)},${fmt(pts[0].c0)}`
  for (let i = 1; i <= segments; i++) even += ` L ${fmt(pts[i].x)},${fmt(pts[i].c0)}`
  even += ` L ${fmt(1)},${fmt(pts[segments].c1)}`
  for (let i = segments - 1; i >= 0; i--) even += ` L ${fmt(pts[i].x)},${fmt(pts[i].c1)}`
  even += ' Z'
  // odd: 上缘 C1，下缘 C0 → 与上一行(even)咬合
  let odd = `M ${fmt(0)},${fmt(pts[0].c1)}`
  for (let i = 1; i <= segments; i++) odd += ` L ${fmt(pts[i].x)},${fmt(pts[i].c1)}`
  odd += ` L ${fmt(1)},${fmt(pts[segments].c0)}`
  for (let i = segments - 1; i >= 0; i--) odd += ` L ${fmt(pts[i].x)},${fmt(pts[i].c0)}`
  odd += ' Z'
  return { even, odd }
}

const WAVY_CLIP_PATHS = getWavyClipPathD()

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// 20种字体配置 - 设计类谚语俗语
const ALL_FONT_STYLES = [
  // Serif
  { name: 'Times New Roman', category: 'Serif', speed: 12, variants: [
    { text: 'LESS IS MORE 少即是多', style: 'italic', weight: 400, invert: false },
    { text: 'FORM FOLLOWS FUNCTION 形式追随功能', style: 'italic', weight: 700, invert: true },
  ]},
  { name: 'Playfair Display', category: 'Serif', speed: 14, variants: [
    { text: 'WHITE SPACE IS NOT EMPTY 留白不是空', style: 'italic', weight: 400, invert: true },
    { text: 'GOOD DESIGN IS HONEST 诚实的设计', style: 'italic', weight: 700, invert: false },
  ]},
  { name: 'Georgia', category: 'Serif', speed: 11, variants: [
    { text: 'CONTENT IS KING 内容为王', style: 'italic', weight: 400, invert: false },
    { text: 'DESIGN IS THINKING MADE VISUAL 思维可视化', style: 'italic', weight: 700, invert: true },
  ]},
  { name: 'Garamond', category: 'Serif', speed: 13, variants: [
    { text: 'THE DEVIL IS IN THE DETAILS 魔鬼在细节', style: 'italic', weight: 400, invert: true },
    { text: 'BEAUTY IS IN THE EYE OF THE BEHOLDER 美在观察者眼中', style: 'italic', weight: 600, invert: false },
  ]},
  // Sans
  { name: 'Inter', category: 'Sans', speed: 16, variants: [
    { text: 'KISS KEEP IT SIMPLE STUPID 简单粗暴', style: 'normal', weight: 100, invert: false },
    { text: 'DONE IS BETTER THAN PERFECT 完成好过完美', style: 'normal', weight: 900, invert: true },
  ]},
  { name: 'Helvetica', category: 'Sans', speed: 15, variants: [
    { text: 'MOVE FAST AND BREAK THINGS 快速打破常规', style: 'normal', weight: 100, invert: true },
    { text: 'SHIPPING IS A FEATURE 发版是功能', style: 'normal', weight: 900, invert: false },
  ]},
  { name: 'Arial', category: 'Sans', speed: 14, variants: [
    { text: 'MAKE IT WORK THEN BETTER 先跑起来再优化', style: 'normal', weight: 400, invert: false },
    { text: 'MOVE FAST BREAK THINGS 快速行动', style: 'normal', weight: 700, invert: true },
  ]},
  { name: 'Verdana', category: 'Sans', speed: 12, variants: [
    { text: 'KEEP CALM AND CARRY ON 保持冷静继续前进', style: 'normal', weight: 400, invert: true },
    { text: 'FIRST MAKE IT WORK 再谈优化', style: 'normal', weight: 700, invert: false },
  ]},
  { name: 'Tahoma', category: 'Sans', speed: 13, variants: [
    { text: 'LESS BUT BETTER 少而精', style: 'normal', weight: 400, invert: false },
    { text: 'CODE IS POETRY 代码是诗', style: 'normal', weight: 700, invert: true },
  ]},
  { name: 'Futura', category: 'Sans', speed: 15, variants: [
    { text: 'FUTURE IS NOW 未来已来', style: 'normal', weight: 400, invert: true },
    { text: 'THINK DIFFERENT 与众不同地思考', style: 'normal', weight: 700, invert: false },
  ]},
  // Display / Art
  { name: 'Arial Black', category: 'Display', speed: 10, variants: [
    { text: 'PIXEL PERFECT IS OVERRATED 像素完美已过时', style: 'normal', weight: 900, invert: false },
    { text: 'DARK MODE OR DIE 暗黑模式还是狗带', style: 'normal', weight: 900, invert: true },
  ]},
  { name: 'Impact', category: 'Display', speed: 9, variants: [
    { text: 'BOLD MOVES WIN 大胆行动获胜', style: 'normal', weight: 900, invert: true },
    { text: 'GO BIG OR GO HOME 要么大要么回家', style: 'normal', weight: 900, invert: false },
  ]},
  { name: 'Comic Sans MS', category: 'Display', speed: 11, variants: [
    { text: 'WHY SO SERIOUS 为何如此严肃', style: 'normal', weight: 400, invert: false },
    { text: 'EVERYONE IS A DESIGNER 人人都是设计师', style: 'normal', weight: 700, invert: true },
  ]},
  { name: 'Courier New', category: 'Mono', speed: 14, variants: [
    { text: 'HACK THE PLANET 入侵星球', style: 'normal', weight: 400, invert: true },
    { text: 'CODE NEVER LIES 代码从不说谎', style: 'normal', weight: 700, invert: false },
  ]},
  { name: 'Monaco', category: 'Mono', speed: 13, variants: [
    { text: 'console.log("HELLO WORLD") 你好世界', style: 'normal', weight: 400, invert: false },
    { text: 'RETURN FALSE 返回假', style: 'normal', weight: 700, invert: true },
  ]},
  { name: 'Consolas', category: 'Mono', speed: 12, variants: [
    { text: 'NULL IS NOT ZERO 空不是零', style: 'normal', weight: 400, invert: true },
    { text: 'UNDEFINED IS NOT A FUNCTION 未定义不是函数', style: 'normal', weight: 700, invert: false },
  ]},
  { name: 'Gill Sans', category: 'Sans', speed: 14, variants: [
    { text: 'SIMPLICITY IS THE ULTIMATE SOPHISTICATION 简约是终极复杂', style: 'normal', weight: 400, invert: false },
    { text: 'DESIGN IS ART 设计是艺术', style: 'normal', weight: 600, invert: true },
  ]},
  { name: 'Optima', category: 'Sans', speed: 13, variants: [
    { text: 'CHANGE IS THE ONLY CONSTANT 变化是唯一常数', style: 'normal', weight: 400, invert: true },
    { text: 'INNOVATION DISTINGUISHES 创新才能区分', style: 'normal', weight: 600, invert: false },
  ]},
  { name: 'Lucida Grande', category: 'Sans', speed: 15, variants: [
    { text: 'JUST SHIP IT 先发布再说', style: 'normal', weight: 400, invert: false },
    { text: 'LEARN BY DOING 在做中学', style: 'normal', weight: 700, invert: true },
  ]},
  { name: 'Trebuchet MS', category: 'Sans', speed: 12, variants: [
    { text: 'THE BEST WAY TO PREDICT 预测未来最好方式', style: 'normal', weight: 400, invert: true },
    { text: 'CREATE THE FUTURE 创造未来', style: 'normal', weight: 700, invert: false },
  ]},
]

/** 横向滚动文字行 - CSS Animation 无限滚动 */
function ScrollingTextRow({ text, speed, fontFamily, category, style, weight, color, forceInvert, speedMultiplier = 1, colorMode = 'bw', rowBgColor }) {
  const rowRef = useRef(null)
  const [isInverted, setIsInverted] = useState(false)
  const effectiveSpeed = speed * speedMultiplier
  const isColor = colorMode === 'color' && rowBgColor
  
  // 计算滚动时长：文字越长，滚动越慢，保持匀速
  // 速度 = 宽度 / 时长  => 时长 = 宽度 / 速度
  // 使用 CSS 变量让动画时长动态计算
  const duration = useMemo(() => {
    // 估算文字宽度（英文每个字符约 0.6vw）
    const estimatedWidth = text.length * 0.6
    // 时长 = 宽度 / 速度，限制在合理范围
    const dur = Math.max(8, Math.min(30, estimatedWidth / effectiveSpeed * 2))
    return dur
  }, [text, effectiveSpeed])

  useEffect(() => {
    const handleScroll = () => {
      if (!rowRef.current) return
      const rect = rowRef.current.getBoundingClientRect()
      const centerY = window.innerHeight / 2
      const rowCenter = rect.top + rect.height / 2
      const inverted = Math.abs(centerY - rowCenter) < rect.height * 0.35
      if (forceInvert !== undefined) {
        setIsInverted(forceInvert)
      } else {
        setIsInverted(inverted)
      }
    }
    
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [forceInvert])

  const scaleFactor = useMemo(() => {
    const seed = `${text}-${fontFamily}-${category}-${weight}`
    let hash = 0
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
    }
    return SCALE_OPTIONS[Math.abs(hash) % SCALE_OPTIONS.length]
  }, [text, fontFamily, category, weight])
  const scaleLabel = `${Math.round(scaleFactor * 100)}%`
  // 比例小时多重复几段文字，避免右侧大片空白
  const repeatCount = useMemo(() => Math.max(3, Math.ceil(3 / scaleFactor)), [scaleFactor])
  const textContent = useMemo(() => Array(repeatCount).fill(text).join(' \u00A0\u00A0 '), [text, repeatCount])
  const textColor = isColor
    ? WIDE_GAMUT.black
    : (isInverted ? WIDE_GAMUT.black : WIDE_GAMUT.white)
  const bgColor = isColor
    ? rowBgColor
    : (isInverted ? WIDE_GAMUT.white : 'transparent')
  const isLight = isColor ? luminance(rowBgColor) > 0.5 : isInverted
  const baseSize = weight >= 700 ? 9 : 6.5
  const size = `${baseSize * scaleFactor}vw`

  return (
    <div 
      ref={rowRef}
      className="relative overflow-hidden"
      style={{ 
        backgroundColor: bgColor,
        transition: 'background-color 0.15s ease',
        padding: 0,
        margin: 0,
        border: 'none',
      }}
    >
      {!isColor && (
        <>
          <div className="absolute left-0 top-0 bottom-0 w-8 z-10" 
            style={{ 
              background: isLight 
                ? 'linear-gradient(to right, rgba(0,0,0,0.15), transparent)' 
                : 'linear-gradient(to right, rgba(0,0,0,0.6), transparent)' 
            }} 
          />
          <div className="absolute right-0 top-0 bottom-0 w-8 z-10" 
            style={{ 
              background: isLight 
                ? 'linear-gradient(to left, rgba(0,0,0,0.15), transparent)' 
                : 'linear-gradient(to left, rgba(0,0,0,0.6), transparent)' 
            }} 
          />
        </>
      )}
      
      <div 
        className="whitespace-nowrap"
        style={{
          fontFamily: `"${fontFamily}", ${category === 'Mono' ? 'monospace' : category === 'Serif' ? 'serif' : 'sans-serif'}`,
          fontStyle: style,
          fontWeight: weight,
          fontSize: size,
          lineHeight: 1.08,
          letterSpacing: weight >= 700 ? '-0.02em' : '0',
          color: textColor,
          display: 'inline-block',
          animation: `scroll-left-${repeatCount} ${duration}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {textContent}
      </div>
      
      <div 
        className="absolute bottom-0.5 left-0 flex items-center gap-2 font-mono"
        style={{
          fontSize: 'clamp(0.35rem, 0.6vw, 0.45rem)',
          color: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.25)',
        }}
      >
        <span>{fontFamily}</span>
        <span>•</span>
        <span style={{ color: color }}>●</span>
        <span>•</span>
        <span>{scaleLabel}</span>
      </div>
      
      <style>{`
        /* FASCA 规范：所有滚动动画使用 translate3d 确保 GPU 加速，避免触发 Reflow */
        @keyframes scroll-left-3 { from { transform: translateX(0); } to { transform: translateX(-33.333%); } }
        @keyframes scroll-left-4 { from { transform: translateX(0); } to { transform: translateX(-25%); } }
        @keyframes scroll-left-6 { from { transform: translateX(0); } to { transform: translateX(-16.666%); } }
        @keyframes scroll-left-12 { from { transform: translateX(0); } to { transform: translateX(-8.333%); } }
      `}</style>
    </div>
  )
}

/** Logo 行：单枚 Logo 固定居中，尺寸适中 */
function ScrollingLogoRow({ colorMode = 'bw', rowBgColor, forceInvert }) {
  const rowRef = useRef(null)
  const [isInverted, setIsInverted] = useState(false)
  const isColor = colorMode === 'color' && rowBgColor

  useEffect(() => {
    const handleScroll = () => {
      if (!rowRef.current) return
      const rect = rowRef.current.getBoundingClientRect()
      const centerY = window.innerHeight / 2
      const rowCenter = rect.top + rect.height / 2
      const inverted = Math.abs(centerY - rowCenter) < rect.height * 0.35
      setIsInverted(forceInvert !== undefined ? forceInvert : inverted)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [forceInvert])

  const logoFill = isColor ? '#000000' : (isInverted ? '#000000' : '#FFFFFF')
  const bgColor = isColor ? rowBgColor : (isInverted ? WIDE_GAMUT.white : 'transparent')
  const isLight = isColor ? luminance(rowBgColor) > 0.5 : isInverted

  return (
    <div
      ref={rowRef}
      className="relative overflow-hidden flex items-center justify-center"
      style={{
        backgroundColor: bgColor,
        transition: 'background-color 0.15s ease',
        padding: '1vh 0',
        margin: 0,
        border: 'none',
        minHeight: '1.2em',
      }}
    >
      <svg viewBox={STUDIO_LOGO_VIEWBOX} className="h-auto shrink-0" style={{ width: 'clamp(90px, 11vw, 200px)', display: 'block' }} aria-hidden>
        {STUDIO_LOGO_PATHS.map((d, j) => (
          <path key={j} fill={logoFill} d={d} />
        ))}
      </svg>
      <div className="absolute bottom-0.5 left-0 flex items-center gap-2 font-mono" style={{ fontSize: 'clamp(0.35rem, 0.6vw, 0.45rem)', color: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.25)' }}>
        <span>Logo</span>
      </div>
    </div>
  )
}

/** Logo 行区块（与 FontStyleItem 同结构，仅内容为 Logo） */
function LogoRowItem({ index, speedMultiplier = 1, colorMode = 'bw', colorPalette = [], wavyEdge = true, prevRowColor }) {
  const palette = colorPalette.length > 0 ? colorPalette : MUTED_PALETTE
  const articleBg = colorMode === 'color' ? palette[(index * 2 + 1) % palette.length] : '#000000'
  const outlineColor = colorMode === 'color' ? palette[(index * 7 + 3) % palette.length] : null
  const wavyClip = wavyEdge ? `url(#scroll-wavy-${index % 2 === 0 ? 'even' : 'odd'})` : undefined

  return (
    <article
      className="relative overflow-hidden block"
      style={{
        backgroundColor: articleBg,
        margin: 0,
        padding: 0,
        marginBottom: wavyEdge ? -1 : 0,
        border: 'none',
        display: 'block',
        width: '100%',
        clipPath: wavyClip,
        '--row-color': articleBg,
      }}
    >
      {outlineColor && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
          <path d="M 0,0.10 Q 0.05,0 0.1,0.10 Q 0.15,0.18 0.2,0.10 Q 0.25,0 0.3,0.10 Q 0.35,0.18 0.4,0.10 Q 0.45,0 0.5,0.10 Q 0.55,0.18 0.6,0.10 Q 0.65,0 0.7,0.10 Q 0.75,0.18 0.8,0.10 Q 0.85,0 0.9,0.10 Q 0.95,0.18 1,0.10" fill="none" stroke={outlineColor} strokeWidth="2" style={{ vectorEffect: 'non-scaling-stroke' }} />
        </svg>
      )}
      <ScrollingLogoRow
        colorMode={colorMode}
        rowBgColor={colorMode === 'color' ? palette[index % palette.length] : undefined}
        speedMultiplier={speedMultiplier}
        waveStripColor={index === 0 ? articleBg : prevRowColor}
      />
    </article>
  )
}

/** 字体区块 */
function FontStyleItem({ style, index, speedMultiplier = 1, colorMode = 'bw', colorPalette = [], wavyEdge = true, prevRowColor }) {
  const color = COLORS[index % COLORS.length]
  const fontFamily = style.name
  const palette = colorPalette.length > 0 ? colorPalette : MUTED_PALETTE
  const articleBg = colorMode === 'color' ? palette[(index * 2 + 1) % palette.length] : '#000000'
  const outlineColor = colorMode === 'color' ? palette[(index * 7 + 3) % palette.length] : null
  const wavyClip = wavyEdge ? `url(#scroll-wavy-${index % 2 === 0 ? 'even' : 'odd'})` : undefined

  return (
    <article 
      className="relative overflow-hidden block"
      style={{
        backgroundColor: articleBg,
        margin: 0,
        padding: 0,
        marginBottom: wavyEdge ? -1 : 0,
        border: 'none',
        display: 'block',
        width: '100%',
        clipPath: wavyClip,
        '--row-color': articleBg,
      }}
    >
      {outlineColor && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
          <path
            d="M 0,0.10 Q 0.05,0 0.1,0.10 Q 0.15,0.18 0.2,0.10 Q 0.25,0 0.3,0.10 Q 0.35,0.18 0.4,0.10 Q 0.45,0 0.5,0.10 Q 0.55,0.18 0.6,0.10 Q 0.65,0 0.7,0.10 Q 0.75,0.18 0.8,0.10 Q 0.85,0 0.9,0.10 Q 0.95,0.18 1,0.10"
            fill="none"
            stroke={outlineColor}
            strokeWidth="2"
            style={{ vectorEffect: 'non-scaling-stroke' }}
          />
        </svg>
      )}
      <ScrollingTextRow
        key={`${style.name}-${index}`}
        text={style.variants[0].text}
        speed={Math.floor(style.speed / 2)}
        speedMultiplier={speedMultiplier}
        colorMode={colorMode}
        rowBgColor={colorMode === 'color' ? palette[index % palette.length] : undefined}
        isFirstRow={true}
        fontFamily={fontFamily}
        category={style.category}
        style={style.variants[0].style}
        weight={style.variants[0].weight}
        color={color}
        forceInvert={style.variants[0].invert}
        wavyEdge={wavyEdge}
        waveStripColor={index === 0 ? articleBg : prevRowColor}
      />
    </article>
  )
}

/** 追踪后方刻度尺宽度与格距 (px) */
const PURSUIT_RULER_WIDTH = 800
const PURSUIT_RULER_TICK_PX = 50

/** Pursuit Mode：纯黑背景、Logo 以恒定 pps 从右向左循环、rAF + translate3d、后方刻度尺、虚拟阴影、估算 GtG */
function PursuitModeView({ speedPps, scale, shadowPx }) {
  const logoWrapperRef = useRef(null)
  const startTimeRef = useRef(null)
  const rafRef = useRef(null)
  const logoRef = useRef(null)
  const speedPpsRef = useRef(speedPps)
  useEffect(() => {
    speedPpsRef.current = speedPps
  }, [speedPps])

  useEffect(() => {
    startTimeRef.current = performance.now()
    const tick = (now) => {
      const start = startTimeRef.current
      if (start == null || !logoWrapperRef.current) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
      let trackWidth = vw + 1100 + (shadowPx || 0) + PURSUIT_RULER_WIDTH
      if (logoRef.current) {
        const logoW = logoRef.current.getBoundingClientRect().width
        if (logoW > 0) trackWidth = vw + logoW + (shadowPx || 0) + PURSUIT_RULER_WIDTH
      }
      const elapsedSec = (now - start) / 1000
      const pps = speedPpsRef.current
      const positionPx = (elapsedSec * pps) % trackWidth
      // FASCA 规范：translate3d 强制 GPU 渲染，禁用 FF/Chrome 线程合成的光栅化步骤
      logoWrapperRef.current.style.transform = `translate3d(${-positionPx}px, 0, 0)`
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [shadowPx])

  const w = typeof window !== 'undefined' ? window.innerWidth : 1920
  const h = typeof window !== 'undefined' ? window.innerHeight : 1080
  const logoHeightPx = Math.round(80 * scale)
  const rowTop = (h - logoHeightPx) / 2
  const tickCount = Math.ceil(w / TICK_SPACING_PX) + 2
  const estimatedGtGMs = speedPps > 0 && shadowPx >= 0 ? ((shadowPx / speedPps) * 1000) : 0

  return (
    <div
      className="fixed inset-0 z-20"
      style={{ backgroundColor: '#000000' }}
    >
      {/* 1px 垂直参考线：屏幕正中 */}
      <div
        className="absolute top-0 bottom-0 w-px left-1/2 -translate-x-px"
        style={{ backgroundColor: 'rgba(255,255,255,0.4)', zIndex: 5 }}
      />
      {/* 上下两组 1px 白色短线，间距 100px，用于判断拖影 */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ zIndex: 4 }}
      >
        {Array.from({ length: tickCount }, (_, i) => {
          const x = i * TICK_SPACING_PX
          return (
            <g key={i}>
              <line x1={x} y1={0} x2={x} y2={TICK_LENGTH_PX} stroke="#ffffff" strokeWidth={1} />
              <line x1={x} y1={h - TICK_LENGTH_PX} x2={x} y2={h} stroke="#ffffff" strokeWidth={1} />
            </g>
          )
        })}
      </svg>
      {/* Logo 行：Logo + 虚拟阴影 + 后方 50% 透明度 1px 刻度尺，整体从右向左循环 */}
      <div
        className="absolute left-0 flex items-center"
        style={{
          top: rowTop,
          height: logoHeightPx,
          width: w,
          overflow: 'hidden',
          willChange: 'transform',
        }}
      >
        <div
          ref={logoWrapperRef}
          className="flex items-center flex-nowrap"
          style={{ willChange: 'transform', height: logoHeightPx }}
        >
          <div style={{ width: w, flexShrink: 0, height: logoHeightPx }} aria-hidden />
          <div ref={logoRef} style={{ height: logoHeightPx, width: 'auto', flexShrink: 0 }}>
            <svg
              viewBox="0 0 310.61 122.86"
              preserveAspectRatio="xMidYMid meet"
              style={{ height: logoHeightPx, width: 'auto', display: 'block' }}
            >
              {PURSUIT_LOGO_PATHS.map((d, i) => (
                <path key={i} fill="#ffffff" d={d} />
              ))}
            </svg>
          </div>
          {/* 虚拟阴影：← → 调整长度，对齐肉眼拖影边缘 */}
          {shadowPx > 0 && (
            <div
              style={{
                width: shadowPx,
                height: logoHeightPx,
                flexShrink: 0,
                background: 'linear-gradient(to right, rgba(255,255,255,0.28), rgba(255,255,255,0.06))',
                pointerEvents: 'none',
              }}
              aria-hidden
            />
          )}
          {/* 参考刻度尺：Logo 后方，1px 细线，透明度 50% */}
          <div
            style={{
              width: PURSUIT_RULER_WIDTH,
              height: logoHeightPx,
              flexShrink: 0,
              position: 'relative',
              opacity: 0.5,
            }}
            aria-hidden
          >
            <svg
              viewBox={`0 0 ${PURSUIT_RULER_WIDTH} ${logoHeightPx}`}
              preserveAspectRatio="none"
              style={{ width: PURSUIT_RULER_WIDTH, height: logoHeightPx, display: 'block' }}
            >
              {Array.from({ length: Math.floor(PURSUIT_RULER_WIDTH / PURSUIT_RULER_TICK_PX) + 1 }, (_, i) => {
                const x = i * PURSUIT_RULER_TICK_PX
                return (
                  <line
                    key={i}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={logoHeightPx}
                    stroke="rgba(255,255,255,1)"
                    strokeWidth={1}
                  />
                )
              })}
            </svg>
          </div>
        </div>
      </div>
      {/* 左下角：速度、缩放、虚拟阴影、估算 GtG */}
      <div
        className="absolute bottom-4 left-4 font-mono text-[10px] flex flex-col gap-0.5"
        style={{ color: 'rgba(255,255,255,0.55)', zIndex: 10 }}
      >
        <span>{speedPps} pps · scale {scale.toFixed(2)} · shadow {shadowPx} px</span>
        <span style={{ color: 'rgba(255,255,255,0.75)' }}>Estimated GtG: {estimatedGtGMs.toFixed(1)} ms</span>
      </div>
      {/* 快捷键提示 */}
      <div
        className="absolute bottom-4 left-32 font-mono text-[10px]"
        style={{ color: 'rgba(255,255,255,0.35)', zIndex: 10 }}
      >
        [ / ] speed · + / - scale · ← → shadow
      </div>
    </div>
  )
}

export function ScrollTestModule() {
  const [shuffledFonts, setShuffledFonts] = useState([])
  const [logoRowIndices, setLogoRowIndices] = useState(() => new Set())
  const [showControls, setShowControls] = useState(false)
  const [scrollSpeedMultiplier, setScrollSpeedMultiplier] = useState(1)
  const [colorMode, setColorMode] = useState('bw') // 'bw' | 'color'
  const [colorSeed, setColorSeed] = useState(0)    // 每次点 color 在彩色模式下自增，重新随机配色
  const [wavyEdge, setWavyEdge] = useState(true) // 波浪纹边缘，默认开启
  const [pursuitMode, setPursuitMode] = useState(false)
  const [audioEnabled] = useState(true)
  const [loomTriggerMode, setLoomTriggerMode] = useState('mouse') // 'auto' | 'mouse'
  const [harmonyDensity, setHarmonyDensity] = useState(0.35)
  const [pursuitSpeedIndex, setPursuitSpeedIndex] = useState(1) // 0=480, 1=960, 2=1440
  const [pursuitScale, setPursuitScale] = useState(1)
  const [pursuitShadowPx, setPursuitShadowPx] = useState(50) // 虚拟阴影长度 (px)，用于估算 GtG
  const panelRef = useRef(null)
  const rootRef = useRef(null)
  const audioReadyRef = useRef(false)
  const stringVoicesRef = useRef([])
  const loomBusRef = useRef(null)
  const rowCharPosRef = useRef(Array.from({ length: LOOM_STRINGS }, () => 0))
  const rowLastTriggerMsRef = useRef(Array.from({ length: LOOM_STRINGS }, () => 0))
  const rafAudioRef = useRef(null)
  const autoSweepRef = useRef({ y: null, targetY: null, speed: 0, dwellMs: 0, lastTs: 0 })
  const sweepLastRowRef = useRef(-1)
  const rowStyleRef = useRef([])

  const shuffledColorPalette = useMemo(() => shuffleArray(MUTED_PALETTE), [colorSeed])

  useEffect(() => {
    const timer = setTimeout(() => {
      const sansOnly = ALL_FONT_STYLES.filter((s) => s.category === 'Sans')
      const pool = [...ALL_FONT_STYLES, ...sansOnly, ...ALL_FONT_STYLES]
      const shuffled = pool.sort(() => Math.random() - 0.5)
      setShuffledFonts(shuffled)
      const n = shuffled.length
      const idx1 = Math.floor(Math.random() * n)
      let idx2 = Math.floor(Math.random() * n)
      while (idx2 === idx1 && n > 1) idx2 = Math.floor(Math.random() * n)
      setLogoRowIndices(new Set([idx1, idx2]))
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    rowStyleRef.current = shuffledFonts.slice(0, LOOM_STRINGS)
  }, [shuffledFonts])

  const triggerString = useCallback(
    (rowIdx, accent = 1, harmonicNode = false, charType = 'neutral', source = 'auto') => {
    const voice = stringVoicesRef.current[rowIdx]
    if (!voice) return
    const nowMs = performance.now()
    const minGapMs = source === 'mouse' ? 90 : 125
    if (!harmonicNode && nowMs - rowLastTriggerMsRef.current[rowIdx] < minGapMs) return
    rowLastTriggerMsRef.current[rowIdx] = nowMs
    const style = rowStyleRef.current[rowIdx]
    const weight = style?.variants?.[0]?.weight ?? 400
    const isHeavy = weight >= 700
    const partials = getPartialsByRow(rowIdx)
    const isBottomHalf = rowIdx >= LOOM_STRINGS / 2
    const complexity =
      scrollSpeedMultiplier >= 1.6 ? 'high' : scrollSpeedMultiplier >= 0.9 ? 'mid' : 'low'
    const lpfCutoff = isBottomHalf
      ? 1200 - ((rowIdx - LOOM_STRINGS / 2) / Math.max(1, LOOM_STRINGS / 2 - 1)) * 400
      : 12000
    voice.pluck.attackNoise = isHeavy ? 1.2 : 0.7
    voice.pluck.dampening = isHeavy ? 2200 : 5400
    voice.pluck.resonance = isHeavy ? 0.97 : 0.8
    voice.rowLpf.frequency.rampTo(Math.max(800, lpfCutoff), 0.02)
    voice.harmonic.set({
      oscillator: {
        type: 'sine',
        partials,
      },
    })
    voice.gain.gain.rampTo((isHeavy ? 0.48 : 0.34) * accent, 0.01)
    voice.pan.pan.rampTo(((rowIdx / Math.max(1, LOOM_STRINGS - 1)) - 0.5) * 0.7, 0.01)
    try {
      const note = rowToNote(rowIdx)
      const now = Tone.now()
      const f0 = Tone.Frequency(note).toFrequency()
      const isUpper = charType === 'upper'
      const isLower = charType === 'lower'
      const isPunct = charType === 'punct'
      voice.reverbSend.gain.rampTo(isUpper ? 0.24 : 0.04, 0.01)
      // 1) 物理拨弦本体（Karplus-Strong）
      voice.pluck.triggerAttack(note, now)
      // 2) 基频三角波（提供形体感）
      const baseDur = isUpper ? 0.95 : isLower ? 0.72 : 0.62
      voice.base.triggerAttackRelease(f0, baseDur, now, 0.72 * accent)
      // 3) 泛音列叠加（2f0 + 3f0/4f0）
      const harmonicDur = isUpper ? 0.92 : isLower ? 0.62 : 0.54
      voice.harmonic.triggerAttackRelease(
        [f0 * 2, f0 * (isHeavy ? 4 : 3)],
        harmonicDur,
        now,
        (complexity === 'low' ? 0.48 : complexity === 'high' ? 0.24 : 0.34) * accent,
      )
      if (isPunct) {
        voice.base.triggerAttackRelease(Math.max(55, f0 * 0.5), 0.09, now + 0.004, 0.55 * accent)
      }
      // 波节位置触发时，额外给一层“玻璃感”人工泛音
      if (harmonicNode) {
        voice.harmonic.triggerAttackRelease([f0 * 3, f0 * 4], 0.1, now + 0.003, 0.28 * accent)
      }
    } catch {
      /* */
    }
    },
    [scrollSpeedMultiplier],
  )

  const initLoomAudio = useCallback(async () => {
    if (audioReadyRef.current) return true
    try {
      await Tone.start()
      const ctx = Tone.getContext()
      if (ctx.state !== 'running') await ctx.resume()

      const master = new Tone.Gain(0.82).toDestination()
      const limiter = new Tone.Limiter(-8)
      const hpf = new Tone.Filter(400, 'highpass')
      const reverb = new Tone.Reverb({ decay: 4.8, wet: 0.34 })
      const preDelay = new Tone.FeedbackDelay({ delayTime: 0.028, feedback: 0.08, wet: 1 })
      const stereoWidener = new Tone.StereoWidener(0.22)
      limiter.connect(hpf)
      hpf.connect(master)
      reverb.connect(limiter)
      loomBusRef.current = { master, limiter, hpf, reverb, preDelay, stereoWidener }

      const voices = Array.from({ length: LOOM_STRINGS }, (_, i) => {
        const rowLpf = new Tone.Filter(12000, 'lowpass')
        const pan = new Tone.Panner(0)
        const gain = new Tone.Gain(0.36)
        const reverbSend = new Tone.Gain(0.06)
        const pluck = new Tone.PluckSynth({
          attackNoise: 1,
          dampening: 4000,
          resonance: 0.9 + i * 0.004,
        })
        const base = new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.002, decay: 0.72, sustain: 0, release: 1.8 },
          volume: -16,
        })
        const harmonic = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine', partials: [1, 0.6, 0.4, 0.2] },
          envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 2.8 },
          volume: -18,
        })
        pluck.chain(rowLpf, pan, gain, limiter)
        base.chain(rowLpf, pan, gain, limiter)
        harmonic.chain(rowLpf, pan, gain, limiter)
        gain.connect(reverbSend)
        reverbSend.connect(preDelay)
        preDelay.connect(stereoWidener)
        stereoWidener.connect(reverb)
        return { pluck, base, harmonic, rowLpf, pan, gain, reverbSend }
      })
      stringVoicesRef.current = voices
      audioReadyRef.current = true
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    const onFirstGesture = () => {
      if (!audioEnabled || audioReadyRef.current) return
      void initLoomAudio()
    }
    window.addEventListener('pointerdown', onFirstGesture, { passive: true })
    window.addEventListener('keydown', onFirstGesture)
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('keydown', onFirstGesture)
    }
  }, [audioEnabled, initLoomAudio])

  useEffect(() => {
    if (loomTriggerMode !== 'auto') return undefined
    if (!audioEnabled || pursuitMode) return undefined
    let cancelled = false
    const ensure = async () => {
      const ok = await initLoomAudio()
      if (!ok || cancelled) return
      const pickTarget = (h) => Math.max(1, Math.random() * Math.max(2, h - 2))
      const pickSpeed = () => {
        const base = 160 + Math.random() * 940
        return base * (0.75 + scrollSpeedMultiplier * 0.35)
      }
      const root = rootRef.current
      const h0 = Math.max(1, root?.clientHeight || window.innerHeight || 1)
      autoSweepRef.current = {
        y: pickTarget(h0),
        targetY: pickTarget(h0),
        speed: pickSpeed(),
        dwellMs: 0,
        lastTs: performance.now(),
      }
      // 自动扫弦开启后立即发一个起音
      const firstRow = Math.max(0, Math.min(LOOM_STRINGS - 1, Math.floor((autoSweepRef.current.y / h0) * LOOM_STRINGS)))
      if (!logoRowIndices.has(firstRow)) triggerString(firstRow, 0.92, false, 'upper', 'auto')

      const tick = (now) => {
        const state = autoSweepRef.current
        const dtMs = Math.min(80, now - state.lastTs)
        const dt = dtMs / 1000
        state.lastTs = now
        const styles = rowStyleRef.current
        const viewH = Math.max(1, rootRef.current?.clientHeight || window.innerHeight || 1)
        const complexity =
          scrollSpeedMultiplier >= 1.6 ? 'high' : scrollSpeedMultiplier >= 0.9 ? 'mid' : 'low'
        if (loomBusRef.current?.hpf) {
          const targetHpf = complexity === 'high' ? 900 : complexity === 'mid' ? 360 : 180
          loomBusRef.current.hpf.frequency.rampTo(targetHpf, 0.03)
        }
        if (state.dwellMs > 0) {
          state.dwellMs -= dtMs
          if (state.dwellMs <= 0) {
            state.targetY = pickTarget(viewH)
            state.speed = pickSpeed()
          }
          rafAudioRef.current = requestAnimationFrame(tick)
          return
        }

        const prevY = state.y
        const dir = state.targetY > prevY ? 1 : -1
        const nextYRaw = prevY + dir * state.speed * dt
        const reached = (dir > 0 && nextYRaw >= state.targetY) || (dir < 0 && nextYRaw <= state.targetY)
        const nextY = reached ? state.targetY : nextYRaw
        state.y = nextY

        const prevRow = Math.max(0, Math.min(LOOM_STRINGS - 1, Math.floor((prevY / viewH) * LOOM_STRINGS)))
        const curRow = Math.max(0, Math.min(LOOM_STRINGS - 1, Math.floor((nextY / viewH) * LOOM_STRINGS)))
        if (prevRow !== curRow) {
          const step = curRow > prevRow ? 1 : -1
          for (let r = prevRow + step; step > 0 ? r <= curRow : r >= curRow; r += step) {
            if (logoRowIndices.has(r)) continue
            const style = styles[r]
            if (!style) continue
            const prob =
              complexity === 'low'
                ? Math.max(0.55, harmonyDensity)
                : complexity === 'mid'
                  ? Math.max(0.35, harmonyDensity * 0.85)
                  : Math.max(0.22, harmonyDensity * 0.62)
            if (Math.random() > prob) continue
            const txt = style?.variants?.[0]?.text ?? ''
            const idx = rowCharPosRef.current[r] % Math.max(1, txt.length)
            const ch = txt.length > 0 ? txt[idx] : ' '
            rowCharPosRef.current[r] = (idx + 1) % Math.max(1, txt.length)
            const charType = isUpperChar(ch) ? 'upper' : isLowerChar(ch) ? 'lower' : 'punct'
            triggerString(r, 1, false, charType, 'auto')
          }
        }
        if (reached) {
          state.dwellMs = 60 + Math.random() * 340
        }
        rafAudioRef.current = requestAnimationFrame(tick)
      }
      rafAudioRef.current = requestAnimationFrame(tick)
    }
    void ensure()
    return () => {
      cancelled = true
      if (rafAudioRef.current) cancelAnimationFrame(rafAudioRef.current)
      rafAudioRef.current = null
    }
  }, [
    audioEnabled,
    pursuitMode,
    scrollSpeedMultiplier,
    harmonyDensity,
    initLoomAudio,
    triggerString,
    loomTriggerMode,
    logoRowIndices,
  ])

  useEffect(() => {
    if (loomTriggerMode !== 'mouse') return undefined
    const root = rootRef.current
    if (!root) return undefined
    const toRow = (clientY) => {
      const rect = root.getBoundingClientRect()
      const t = Math.max(0, Math.min(0.999, (clientY - rect.top) / rect.height))
      return Math.floor(t * LOOM_STRINGS)
    }
    const onMove = (e) => {
      if (!audioEnabled || pursuitMode) return
      if (!audioReadyRef.current) {
        void initLoomAudio()
        return
      }
      const cur = toRow(e.clientY)
      const prev = sweepLastRowRef.current
      if (prev < 0) {
        sweepLastRowRef.current = cur
        if (!logoRowIndices.has(cur)) triggerString(cur, 1.12, false, 'upper', 'mouse')
        return
      }
      if (cur === prev) return
      const step = cur > prev ? 1 : -1
      for (let r = prev + step; step > 0 ? r <= cur : r >= cur; r += step) {
        if (logoRowIndices.has(r)) continue
        triggerString(r, 1.18, false, 'lower', 'mouse')
      }
      sweepLastRowRef.current = cur
    }
    const resetSweep = () => {
      sweepLastRowRef.current = -1
    }

    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', resetSweep)
    window.addEventListener('blur', resetSweep)
    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', resetSweep)
      window.removeEventListener('blur', resetSweep)
    }
  }, [audioEnabled, pursuitMode, initLoomAudio, triggerString, logoRowIndices, loomTriggerMode])

  useEffect(() => {
    return () => {
      if (rafAudioRef.current) cancelAnimationFrame(rafAudioRef.current)
      const voices = stringVoicesRef.current
      stringVoicesRef.current = []
      audioReadyRef.current = false
      for (const v of voices) {
        try {
          v.pluck.dispose()
          v.base.dispose()
          v.harmonic.dispose()
          v.rowLpf.dispose()
          v.pan.dispose()
          v.gain.dispose()
          v.reverbSend.dispose()
        } catch {
          /* */
        }
      }
      try {
        loomBusRef.current?.stereoWidener?.dispose()
        loomBusRef.current?.preDelay?.dispose()
        loomBusRef.current?.reverb?.dispose()
        loomBusRef.current?.hpf?.dispose()
        loomBusRef.current?.limiter?.dispose()
        loomBusRef.current?.master?.dispose()
      } catch {
        /* */
      }
      loomBusRef.current = null
    }
  }, [])

  // Pursuit Mode 内：[ ] 速度；+ - 缩放；← → 虚拟阴影长度 (量化拖影)
  useEffect(() => {
    if (!pursuitMode) return
    const onKey = (e) => {
      if (e.key === '[') {
        setPursuitSpeedIndex((i) => (i - 1 + PURSUIT_SPEEDS.length) % PURSUIT_SPEEDS.length)
        e.preventDefault()
      }
      if (e.key === ']') {
        setPursuitSpeedIndex((i) => (i + 1) % PURSUIT_SPEEDS.length)
        e.preventDefault()
      }
      if (e.key === '+' || e.key === '=') {
        setPursuitScale((s) => Math.min(3, s + 0.25))
        e.preventDefault()
      }
      if (e.key === '-') {
        setPursuitScale((s) => Math.max(0.25, s - 0.25))
        e.preventDefault()
      }
      if (e.key === 'ArrowLeft') {
        setPursuitShadowPx((px) => Math.max(0, px - 5))
        e.preventDefault()
      }
      if (e.key === 'ArrowRight') {
        setPursuitShadowPx((px) => Math.min(600, px + 5))
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pursuitMode])

  // 右上角面板显示/隐藏：鼠标在角区或面板内时保持显示
  useEffect(() => {
    const threshold = 60
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

  // 双镜像垂直滚动：一个完整周期秒数（速度由面板控制，仅初始化/用户改速时更新，滚动过程无 JS）
  const scrollDurationSec = 60 / scrollSpeedMultiplier

  /** 单份内容（与另一份完全一致，用于 Twin-Ticker 容器 A / B）；tick 用于 key 区分避免复用错位 */
  const renderOneContent = (tick) => (
    <div className="flex flex-col flex-shrink-0" style={{ margin: 0, padding: 0 }}>
      {shuffledFonts.map((style, index) => {
        const prevBgColor = index > 0
          ? (colorMode === 'color' ? shuffledColorPalette[((index - 1) * 2 + 1) % shuffledColorPalette.length] : '#000000')
          : '#000000'
        if (logoRowIndices.has(index)) {
          return (
            <LogoRowItem
              key={`${tick}-logo-${index}`}
              index={index}
              speedMultiplier={scrollSpeedMultiplier}
              colorMode={colorMode}
              colorPalette={shuffledColorPalette}
              wavyEdge={wavyEdge}
              prevRowColor={prevBgColor}
            />
          )
        }
        return (
          <FontStyleItem
            key={`${tick}-${style.name}-${index}`}
            style={style}
            index={index}
            speedMultiplier={scrollSpeedMultiplier}
            colorMode={colorMode}
            colorPalette={shuffledColorPalette}
            wavyEdge={wavyEdge}
            prevRowColor={prevBgColor}
          />
        )
      })}
      <footer className="min-h-[5vh] flex items-center justify-center px-4 py-3 flex-shrink-0">
        <p className="font-ui text-center" style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.02em' }}>
          scroll typography test • {shuffledFonts.length} fonts • rendering: coretext / directwrite
        </p>
      </footer>
    </div>
  )

  const pursuitSpeedPps = PURSUIT_SPEEDS[pursuitSpeedIndex]

  return (
    <div
      ref={rootRef}
      className="w-full overflow-hidden"
      style={{
        height: '100vh',
        backgroundColor: colorMode === 'color' ? shuffledColorPalette[0] : '#000000',
        margin: 0,
        padding: 0,
      }}
    >
      {/* Pursuit Mode：纯黑、单行 Logo 匀速、1px 刻度与参考线（面板按钮进入） */}
      {pursuitMode && (
        <PursuitModeView speedPps={pursuitSpeedPps} scale={pursuitScale} shadowPx={pursuitShadowPx} />
      )}

      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <clipPath id="scroll-wavy-even" clipPathUnits="objectBoundingBox">
            <path d={WAVY_CLIP_PATHS.even} />
          </clipPath>
          <clipPath id="scroll-wavy-odd" clipPathUnits="objectBoundingBox">
            <path d={WAVY_CLIP_PATHS.odd} />
          </clipPath>
        </defs>
      </svg>
      {!pursuitMode && (
        <>
          <div
            className="fixed inset-0 pointer-events-none z-0"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundSize: '100% 100px',
            }}
          />

          {/* Twin-Ticker：双份相同内容 + 纯 CSS translateY，无缝循环 */}
          <div
            className="relative z-10 flex flex-col"
            style={{
              willChange: 'transform',
              animation: `scroll-vertical ${scrollDurationSec}s linear infinite`,
            }}
          >
            {renderOneContent('a')}
            <div style={{ transform: 'translateY(-1px)' }}>{renderOneContent('b')}</div>
          </div>
        </>
      )}

      {/* 右上角控制面板：滚动速度 */}
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
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            scroll speed: {scrollSpeedMultiplier.toFixed(1)}×
          </label>
          <input
            type="range"
            min="0.25"
            max="2.5"
            step="0.05"
            value={scrollSpeedMultiplier}
            onChange={(e) => setScrollSpeedMultiplier(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColorPanel }}>
            harmony density: {Math.round(harmonyDensity * 100)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.05"
            value={harmonyDensity}
            onChange={(e) => setHarmonyDensity(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setColorMode('bw')}
            className="flex-1 py-1.5 px-2 text-[10px] font-ui rounded border transition-colors"
            style={{
              borderColor: colorMode === 'bw' ? 'rgba(255,255,255,0.8)' : panelBorder,
              color: colorMode === 'bw' ? 'rgba(255,255,255,0.95)' : textColorPanel,
              background: colorMode === 'bw' ? 'rgba(255,255,255,0.12)' : 'transparent',
            }}
          >
            b&w
          </button>
          <button
            type="button"
            onClick={() => {
              if (colorMode === 'color') setColorSeed((s) => s + 1)
              else setColorMode('color')
            }}
            className="flex-1 py-1.5 px-2 text-[10px] font-ui rounded border transition-colors"
            style={{
              borderColor: colorMode === 'color' ? 'rgba(255,255,255,0.8)' : panelBorder,
              color: colorMode === 'color' ? 'rgba(255,255,255,0.95)' : textColorPanel,
              background: colorMode === 'color' ? 'rgba(255,255,255,0.12)' : 'transparent',
            }}
          >
            color
          </button>
        </div>
        
        {/* 波浪纹边缘 */}
        <button
          type="button"
          onClick={() => setWavyEdge((w) => !w)}
          className="text-[10px] font-ui py-1.5 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: wavyEdge ? 'rgba(255,255,255,0.8)' : panelBorder,
            color: wavyEdge ? 'rgba(255,255,255,0.95)' : textColorPanel,
            background: wavyEdge ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
        >
          wavy edge: {wavyEdge ? 'on' : 'off'}
        </button>
        {/* Pursuit Mode：追逐模式入口 */}
        <button
          type="button"
          onClick={() => setPursuitMode((m) => !m)}
          className="text-[10px] font-ui py-1.5 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: pursuitMode ? 'rgba(255,255,255,0.8)' : panelBorder,
            color: pursuitMode ? 'rgba(255,255,255,0.95)' : textColorPanel,
            background: pursuitMode ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
        >
          pursuit mode: {pursuitMode ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setLoomTriggerMode((m) => (m === 'auto' ? 'mouse' : 'auto'))}
          className="text-[10px] font-ui py-1.5 px-2 border rounded-md w-full text-left"
          style={{
            borderColor: 'rgba(255,255,255,0.8)',
            color: 'rgba(255,255,255,0.95)',
            background: 'rgba(255,255,255,0.12)',
          }}
        >
          auto sweep: {loomTriggerMode === 'auto' ? 'on' : 'off'}
        </button>

        <GlobalShortcutsHint color="rgba(255,255,255,0.45)" />
      </div>

      <style>{`
        /* GPU 加速：translateY 而非 top/margin */
        @keyframes scroll-vertical {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  )
}
