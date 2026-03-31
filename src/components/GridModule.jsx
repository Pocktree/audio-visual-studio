import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import { motion } from 'framer-motion'
import { RippleButton } from './RippleButton'
import { GlobalShortcutsHint } from './GlobalShortcutsHint'
import { STUDIO_LOGO_VIEWBOX, STUDIO_LOGO_PATHS } from './StudioLogoPaths'
import { TypoSynthMode } from './TypoSynthMode'
import { AUDIO_GRID_F0 } from './audioGridMap'

/** Scale-invariant Typo-Synth 音高/列映射（实现见 audioGridMap.js） */
export {
  AUDIO_GRID_F0,
  AUDIO_GRID_GHOST_MS,
  computePitchHz,
  computeColNorm,
  computeRowNorm,
  computePanFromColNorm,
  computeDetuneCentsFromColNorm,
} from './audioGridMap'

// Display-P3 广色域
const DISPLAY_P3 = {
  red: 'color(display-p3 1 0 0)',
  green: 'color(display-p3 0 1 0)',
  blue: 'color(display-p3 0 0 1)',
  yellow: 'color(display-p3 1 1 0)',
  cyan: 'color(display-p3 0 1 1)',
  magenta: 'color(display-p3 1 0 1)',
  white: 'color(display-p3 1 1 1)',
  orange: 'color(display-p3 1 0.5 0)',
}

// 随机字符集
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*!'

// AVS-big SVG 路径（增加出现概率）
const AVS_PATH = "M233.22,61.48c-3.18,8.51-8.48,22.8-12.85,22.8s-9.63-14.27-12.82-22.8c-5.79-15.6-12.38-33.29-27.9-33.29s-21.36,12.93-26.08,22.37c-4.54,9.17-7.2,13.46-11.66,13.46s-7.62-4.42-12.78-13.78c-2.9-5.23-6.21-11.07-10.82-15.46c-7.12-7.76-17.73-12.29-30.54-12.29c-24.19,0-40.49,15.6-40.49,38.78s16.34,39.07,40.49,39.07c19.34,0,33.66-10.29,38.48-26.56,4.02,3.71,9.02,6.29,15.71,6.29,14.93,0,21.36-12.93,26.08-22.37,4.54-9.17,7.2-13.46,11.66-13.46s9.63,14.27,12.82,22.8c5.79,15.6,12.38,33.29,27.9,33.29s22.11-17.68,27.94-33.29c3.18-8.51,8.48-22.8,12.85-22.8v-16.11c-15.54,0-22.11,17.68-27.93,33.29h-.02v.03l-.03.02ZM87.72,84.78c-12.86,0-21.76-9.46-21.76-23.18s8.88-23.18,21.76-23.18,21.47,9.46,21.47,23.18-8.88,23.18-21.47,23.18Z"

// 随机选择字符，AVS 有更高概率
function pickRandomChar() {
  const avsChance = 0.25 // 25% 概率出现 AVS
  if (Math.random() < avsChance) {
    return 'AVS_SVG'
  }
  return CHARS[Math.floor(Math.random() * CHARS.length)]
}

// sRGB 标准色域
const SRGB = {
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  white: '#FFFFFF',
  orange: '#FF8000',
}

const PALETTE_P3 = Object.values(DISPLAY_P3)
const PALETTE_SRGB = Object.values(SRGB)

const BFI_DURATION_MIN = 50
const BFI_DURATION_MAX = 1000
const BFI_INTERVAL_MS = 5000 // 闪黑测试间隔

// 纯色自检：1=白 2=黑 3=红 4=绿 5=5%灰 6=蓝 7=18%中性灰 (全量色彩矩阵)
const UNIFORMITY_COLORS = [
  'rgb(255,255,255)', // 1: 纯白 - 最大亮度与均匀性
  'rgb(0,0,0)',       // 2: 纯黑 - 漏光
  'rgb(255,0,0)',    // 3: 红 - 子像素坏点
  'rgb(0,255,0)',    // 4: 绿 - 子像素坏点
  'rgb(13,13,13)',   // 5: 5% 灰 - 近黑均匀性 (OLED/DSE)
  'rgb(0,0,255)',    // 6: 蓝 - 子像素坏点
  'rgb(119,119,119)', // 7: 18% 中性灰 - Gamma 与中间调
]
const UNIFORMITY_LABELS = ['纯白', '纯黑', '红', '绿', '5%灰', '蓝', '18%灰']

function pickRandomColor(palette) {
  return palette[Math.floor(Math.random() * palette.length)]
}

// 随机网格划分
function generateGrid(rows, cols, palette) {
  const cells = []
  const total = rows * cols
  
  for (let i = 0; i < total; i++) {
    // 随机决定格子内容类型：0=纯色, 1=旋转文字
    const type = Math.random() > 0.5 ? 'typo' : 'solid'
    const colorIndex = Math.floor(Math.random() * 8)
    
    cells.push({
      row: Math.floor(i / cols),
      col: i % cols,
      type,
      color: palette[colorIndex],
      char: pickRandomChar(),
      rotation: Math.random() * 360,
      // 文字水平位移参数
      textOffset: Math.random() * 100,
      textDirection: Math.random() > 0.5 ? 1 : -1,
      textSpeed: 0.5 + Math.random() * 1, // 速度
    })
  }
  
  return cells
}

/** 色深断层测试：Canvas 逐列绘制 120→135 灰阶（不用 CSS gradient 避免压缩），Dither 控制 imageSmoothingEnabled */
function BitDepthCanvas({ dither, className }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.floor((canvas.clientWidth || window.innerWidth) * dpr)
      const h = Math.floor((canvas.clientHeight || window.innerHeight) * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.imageSmoothingEnabled = dither
      ctx.imageSmoothingQuality = 'high'
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1) || 0
        const v = Math.round(120 + t * 15)
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(x, 0, 1, h)
      }
    }
    draw()
    const resize = () => draw()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [dither])
  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%' }} />
}

/** 动力学排版文字 - 水平位移+边缘变色 */
function KineticCell({ cell, fontFamily, onClick, palette }) {
  const [offset, setOffset] = useState(0)
  const [textColor, setTextColor] = useState(palette[6]) // white
  const [isHovered, setIsHovered] = useState(false)
  const [displayColor, setDisplayColor] = useState(() => cell.color)
  const requestRef = useRef()
  const directionRef = useRef(cell.textDirection)
  const posRef = useRef(0)

  useEffect(() => {
    const animate = () => {
      posRef.current += directionRef.current * cell.textSpeed
      
      // 边界检测 - 碰到边缘变色并反弹
      if (posRef.current > 30) {
        posRef.current = 30
        directionRef.current = -1
        setTextColor(palette[3]) // yellow
      } else if (posRef.current < -30) {
        posRef.current = -30
        directionRef.current = 1
        setTextColor(palette[4]) // cyan
      } else {
        // 恢复白色
        setTextColor(prev => prev === palette[6] ? prev : palette[6]) // white
      }
      
      setOffset(posRef.current)
      requestRef.current = requestAnimationFrame(animate)
    }
    
    requestRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(requestRef.current)
  }, [cell.textSpeed, cell.textDirection])

  return (
    <motion.div
      className="relative overflow-hidden flex items-center justify-center outline-none focus:outline-none"
      style={{ backgroundColor: displayColor, outline: 'none' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => {
        setIsHovered(true)
        setDisplayColor(pickRandomColor(palette))
      }}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {cell.type === 'typo' && cell.char === 'AVS_SVG' && (
        <svg
          viewBox="0 0 310.61 122.86"
          style={{ 
            width: 'clamp(20px, 8vw, 60px)',
            height: 'auto',
            color: isHovered ? '#000000' : textColor,
            transform: `translateX(${offset / 3}%) rotate(${cell.rotation}deg)`,
            transition: 'color 0.1s',
          }}
        >
          <path fill="currentColor" d={AVS_PATH} />
        </svg>
      )}
      {cell.type === 'typo' && cell.char !== 'AVS_SVG' && (
        <span
          className="select-none"
          style={{
            fontFamily: '"Montserrat", sans-serif',
            fontWeight: 500,
            fontSize: 'clamp(2rem, 8vw, 5rem)',
            color: isHovered ? '#000000' : textColor,
            transform: `translateX(${offset}%) rotate(${cell.rotation}deg)`,
            transition: 'color 0.1s',
          }}
        >
          {cell.char}
        </span>
      )}
    </motion.div>
  )
}

/** 纯色块 */
function SolidCell({ cell, onClick, palette }) {
  const [displayColor, setDisplayColor] = useState(() => cell.color)
  return (
    <motion.div
      className="flex items-center justify-center cursor-pointer outline-none focus:outline-none relative overflow-hidden"
      style={{ backgroundColor: displayColor, outline: 'none' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setDisplayColor(pickRandomColor(palette))}
      onClick={onClick}
    >
    </motion.div>
  )
}

/** 字体加载检测 */
function useFontLoaded(fontFamily) {
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    setIsLoaded(false)
    if (!fontFamily || fontFamily === 'var(--font-stack-sans)') {
      setIsLoaded(true)
      return
    }
    if (document.fonts) {
      document.fonts.ready.then(() => setIsLoaded(true))
    } else {
      const timer = setTimeout(() => setIsLoaded(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [fontFamily])

  return isLoaded
}

const GRID_SIZE_MIN = 1
const GRID_SIZE_MAX = 20
const AUTO_CYCLE_INTERVAL = 5000

function getRandomSizeUpTo(max) {
  const n = GRID_SIZE_MIN + Math.floor(Math.random() * (max - GRID_SIZE_MIN + 1))
  return { rows: n, cols: n }
}

export function GridModule({ fontFamily, onModuleChange, onAutoPlayChange }) {
  const [gridSizeNum, setGridSizeNum] = useState(5) // 1–20，N×N
  const [autoCycle, setAutoCycle] = useState(true)   // true=自由轮播，false=固定
  const [colorSpace, setColorSpace] = useState('p3') // 'p3' | 'srgb'
  const [gridSize, setGridSize] = useState(() => ({ rows: 5, cols: 5 }))
  const [cells, setCells] = useState(() => generateGrid(5, 5, colorSpace === 'p3' ? PALETTE_P3 : PALETTE_SRGB))
  const [showControls, setShowControls] = useState(false)
  const [bfiDurationMs, setBfiDurationMs] = useState(200)
  const [bfiEnabled, setBfiEnabled] = useState(true)
  const [bfiActive, setBfiActive] = useState(false)
  const [colorOffsetMode, setColorOffsetMode] = useState(false)
  const [gridTestMode, setGridTestMode] = useState(null) // null | 'uniformity' | 'bitdepth'
  /** PO-12 风格 Typo-Synth：Tone 鼓组 + Screen 反应堆 + Pad / 音序 */
  const [typoSynthMode, setTypoSynthMode] = useState(false)
  const [uniformityIndex, setUniformityIndex] = useState(0) // 0-6: 白/黑/红/绿/5%灰/蓝/18%灰
  const [bitDepthDither, setBitDepthDither] = useState(true) // true = imageSmoothingEnabled
  const [testModeHintVisible, setTestModeHintVisible] = useState(false)
  const testModeHintTimeoutRef = useRef(null)
  const controlsPanelRef = useRef(null)
  const [isNarrowColorOffset, setIsNarrowColorOffset] = useState(false) // COLOR OFFSET 窄屏堆叠模式：width < 1024 或竖屏
  const REF_GRAY = { low: 32, mid: 128, high: 224 }
  const [calibrationData, setCalibrationData] = useState(() => ({
    low: { r: 0, g: 0, b: 0 },
    mid: { r: 0, g: 0, b: 0 },
    high: { r: 0, g: 0, b: 0 },
  }))
  const [calibrationLevel, setCalibrationLevel] = useState('mid') // 'low' | 'mid' | 'high'
  const [flickerMode, setFlickerMode] = useState(false)
  const [flickerPhase, setFlickerPhase] = useState(0)
  const [activeOffsetAxis, setActiveOffsetAxis] = useState(0) // 0=R, 1=G, 2=B
  const fontLoaded = useFontLoaded(fontFamily)

  const offsetR = calibrationData[calibrationLevel].r
  const offsetG = calibrationData[calibrationLevel].g
  const offsetB = calibrationData[calibrationLevel].b
  const setOffsetR = (vOrUpdater) => {
    setCalibrationData((prev) => {
      const current = prev[calibrationLevel].r
      const v = typeof vOrUpdater === 'function' ? vOrUpdater(current) : vOrUpdater
      return {
        ...prev,
        [calibrationLevel]: { ...prev[calibrationLevel], r: Math.max(-30, Math.min(30, v)) },
      }
    })
  }
  const setOffsetG = (vOrUpdater) => {
    setCalibrationData((prev) => {
      const current = prev[calibrationLevel].g
      const v = typeof vOrUpdater === 'function' ? vOrUpdater(current) : vOrUpdater
      return {
        ...prev,
        [calibrationLevel]: { ...prev[calibrationLevel], g: Math.max(-30, Math.min(30, v)) },
      }
    })
  }
  const setOffsetB = (vOrUpdater) => {
    setCalibrationData((prev) => {
      const current = prev[calibrationLevel].b
      const v = typeof vOrUpdater === 'function' ? vOrUpdater(current) : vOrUpdater
      return {
        ...prev,
        [calibrationLevel]: { ...prev[calibrationLevel], b: Math.max(-30, Math.min(30, v)) },
      }
    })
  }
  
  // 当前调色板（与主网格 / Typo-Synth 共用）
  const palette = colorSpace === 'p3' ? PALETTE_P3 : PALETTE_SRGB

  /** 拖动 size 滑块时推迟应用到合成器，避免 n 连续变化导致子网格反复卸载/重算出现整屏黑闪 */
  const deferredSynthN = useDeferredValue(gridSizeNum)

  const typoSynthAudioGrid = useMemo(
    () => ({
      f0: AUDIO_GRID_F0,
      totalRows: deferredSynthN,
      totalCols: deferredSynthN,
    }),
    [deferredSynthN],
  )

  // 右上角热区或悬停在设置面板上时保持显示（避免拖滑块移出角落后面板消失/无法操作）
  useEffect(() => {
    const threshold = 60
    let hideTimeout = null
    const handleMouseMove = (e) => {
      const isInCorner = e.clientX > window.innerWidth - threshold && e.clientY < threshold
      let isOverPanel = false
      const panel = controlsPanelRef.current
      if (panel) {
        const r = panel.getBoundingClientRect()
        isOverPanel = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      }
      if (isInCorner || isOverPanel) {
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

  // COLOR OFFSET 自适应布局：窄屏 / 竖屏时启用上下堆叠模式
  useEffect(() => {
    const updateNarrow = () => {
      const w = window.innerWidth || 0
      const h = window.innerHeight || 0
      setIsNarrowColorOffset(w < 1024 || (w > 0 && h > w))
    }
    updateNarrow()
    window.addEventListener('resize', updateNarrow)
    return () => window.removeEventListener('resize', updateNarrow)
  }, [])

  // 固定模式：方格数由 gridSizeNum 决定
  useEffect(() => {
    if (autoCycle) return
    const n = Math.max(GRID_SIZE_MIN, Math.min(GRID_SIZE_MAX, gridSizeNum))
    setGridSize({ rows: n, cols: n })
    setCells(generateGrid(n, n, palette))
  }, [autoCycle, gridSizeNum, palette])

  // 自由轮播：定时在 1×1 到 gridSizeNum×gridSizeNum 之间随机切换
  useEffect(() => {
    if (!autoCycle || colorOffsetMode || gridTestMode || typoSynthMode) return
    const interval = setInterval(() => {
      const max = Math.max(GRID_SIZE_MIN, Math.min(GRID_SIZE_MAX, gridSizeNum))
      const next = getRandomSizeUpTo(max)
      setGridSize(next)
      setCells(generateGrid(next.rows, next.cols, palette))
    }, AUTO_CYCLE_INTERVAL)
    return () => clearInterval(interval)
  }, [autoCycle, colorOffsetMode, gridTestMode, typoSynthMode, gridSizeNum, palette])

  // 色彩空间切换时重新生成网格
  useEffect(() => {
    setCells(generateGrid(gridSize.rows, gridSize.cols, palette))
  }, [colorSpace, gridSize, palette])

  // 进入 COLOR OFFSET 或 纯色/色深测试 时：自动关闭 BFI，暂停轮播（与 COLOR OFFSET 一致）
  const inTestOrOffsetMode = colorOffsetMode || !!gridTestMode || typoSynthMode
  useEffect(() => {
    if (inTestOrOffsetMode) {
      setBfiEnabled(false)
      setAutoCycle(false)
      onAutoPlayChange?.(false)
    } else {
      onAutoPlayChange?.(true)
    }
  }, [inTestOrOffsetMode])

  // Flicker Mode：30Hz 切换右侧色块在用户值与 128 灰之间
  useEffect(() => {
    if (!colorOffsetMode || !flickerMode) return
    const t = setInterval(() => setFlickerPhase((p) => 1 - p), 1000 / 30)
    return () => clearInterval(t)
  }, [colorOffsetMode, flickerMode])

  // 切换档位时默认选中 R，上下键只控制当前档位（low/mid/high）的 R/G/B
  useEffect(() => {
    if (!colorOffsetMode) return
    setActiveOffsetAxis(0)
  }, [colorOffsetMode, calibrationLevel])

  // COLOR OFFSET 内： [ ] 切换档位；↑/↓ 对当前档位（calibrationLevel）的 R/G/B ±1，无焦点时默认调 R
  const CAL_LEVELS = ['low', 'mid', 'high']
  useEffect(() => {
    if (!colorOffsetMode) return
    const onKey = (e) => {
      if (e.key === '[') {
        e.preventDefault()
        setCalibrationLevel((l) => CAL_LEVELS[(CAL_LEVELS.indexOf(l) - 1 + 3) % 3])
      }
      if (e.key === ']') {
        e.preventDefault()
        setCalibrationLevel((l) => CAL_LEVELS[(CAL_LEVELS.indexOf(l) + 1) % 3])
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const active = document.activeElement
        const axis = active?.getAttribute('role') === 'slider' ? activeOffsetAxis : 0
        e.preventDefault()
        if (e.key === 'ArrowUp') {
          if (axis === 0) setOffsetR((v) => Math.min(30, v + 1))
          if (axis === 1) setOffsetG((v) => Math.min(30, v + 1))
          if (axis === 2) setOffsetB((v) => Math.min(30, v + 1))
        } else {
          if (axis === 0) setOffsetR((v) => Math.max(-30, v - 1))
          if (axis === 1) setOffsetG((v) => Math.max(-30, v - 1))
          if (axis === 2) setOffsetB((v) => Math.max(-30, v - 1))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [colorOffsetMode, activeOffsetAxis, calibrationLevel])

  // 纯色/色深测试：数字键 1-7 切换纯色，D 切换 Dither；鼠标移动或按键时显示角标+左上 logo，2s 无操作自动隐藏
  useEffect(() => {
    if (!gridTestMode) return
    const showHint = () => {
      setTestModeHintVisible(true)
      if (testModeHintTimeoutRef.current) clearTimeout(testModeHintTimeoutRef.current)
      testModeHintTimeoutRef.current = setTimeout(() => {
        setTestModeHintVisible(false)
        testModeHintTimeoutRef.current = null
      }, 2000)
    }
    const onKey = (e) => {
      if (gridTestMode === 'uniformity') {
        let digit = null
        if (e.key >= '1' && e.key <= '7') digit = Number(e.key)
        else if (e.code && /^Numpad[1-7]$/.test(e.code)) digit = Number(e.code.replace('Numpad', ''))
        if (digit !== null) {
          e.preventDefault()
          e.stopPropagation()
          setUniformityIndex(digit - 1)
          showHint()
        }
      }
      if (gridTestMode === 'bitdepth' && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        setBitDepthDither((d) => !d)
        showHint()
      }
    }
    showHint()
    window.addEventListener('mousemove', showHint)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousemove', showHint)
      window.removeEventListener('keydown', onKey, true)
      if (testModeHintTimeoutRef.current) clearTimeout(testModeHintTimeoutRef.current)
    }
  }, [gridTestMode])

  // 仅 Grid 内：周期性闪黑测试（BFI）；Typo-Synth 全屏时关闭
  useEffect(() => {
    if (!bfiEnabled || typoSynthMode) {
      setBfiActive(false)
      return
    }
    let timeoutId = null
    const runFlash = () => {
      setBfiActive(true)
      timeoutId = setTimeout(() => setBfiActive(false), bfiDurationMs)
    }
    runFlash()
    const intervalId = setInterval(runFlash, BFI_INTERVAL_MS)
    return () => {
      clearInterval(intervalId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [bfiEnabled, bfiDurationMs, typoSynthMode])

  const fontStack = fontFamily ?? 'Inter, sans-serif'

  // 字体未加载时显示纯色块（Typo-Synth 自带排版，不等待字体）
  if (!fontLoaded && !typoSynthMode) {
    return (
      <div
        className="w-full h-full grid"
        style={{
          gridTemplateColumns: `repeat(${gridSize.cols}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize.rows}, 1fr)`,
        }}
      >
        {Array.from({ length: gridSize.rows * gridSize.cols }).map((_, i) => (
          <div
            key={i}
            style={{ backgroundColor: palette[i % 8] }}
          />
        ))}
      </div>
    )
  }

  const panelBg = 'rgba(0,0,0,0.85)'
  const panelBorder = 'rgba(255,255,255,0.25)'
  const textColor = 'rgba(255,255,255,0.7)'
  const btnBorder = 'rgba(255,255,255,0.3)'
  const btnActive = 'rgba(255,255,255,0.9)'

  return (
    <div className="w-full h-full relative">
      {typoSynthMode && (
        <div className="absolute inset-0 z-20 flex h-full min-h-0 w-full flex-col bg-black">
          <TypoSynthMode
            n={deferredSynthN}
            gridSizeMin={GRID_SIZE_MIN}
            gridSizeMax={GRID_SIZE_MAX}
            fontFamily={fontStack}
            palette={palette}
            colorSpace={colorSpace}
            audioGrid={typoSynthAudioGrid}
          />
        </div>
      )}

      {/* 仅 Grid：闪黑测试 overlay（正中间 Logo + 下方 BFI 测试文字 + 十字准星） */}
      {bfiActive && !typoSynthMode && (
        <div
          className="absolute inset-0 z-40 bg-black pointer-events-none flex items-center justify-center"
          aria-hidden
        >
          {/* 十字准星 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute w-full h-px" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <div className="absolute w-px h-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
          </div>
          {/* Logo + 下方测试文字 */}
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-24 h-auto flex-shrink-0 mb-4">
              <svg viewBox={STUDIO_LOGO_VIEWBOX} className="w-full h-auto" aria-hidden>
                {STUDIO_LOGO_PATHS.map((d, i) => (
                  <path key={i} fill="#FFFFFF" d={d} />
                ))}
              </svg>
            </div>
            <span
              className="font-mono tracking-widest select-none"
              style={{
                fontSize: 'clamp(10px, 2vw, 14px)',
                color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.2em',
              }}
            >
              BFI ACTIVE: {bfiDurationMs}ms · {Math.round(1000 / bfiDurationMs)}Hz
            </span>
          </div>
        </div>
      )}

      {/* COLOR OFFSET 三点白平衡量化模式 */}
      {colorOffsetMode && !typoSynthMode && (() => {
        const base = REF_GRAY[calibrationLevel]
        const adjR = Math.min(255, Math.max(0, base + offsetR))
        const adjG = Math.min(255, Math.max(0, base + offsetG))
        const adjB = Math.min(255, Math.max(0, base + offsetB))
        const chartW = 200
        const chartH = 100
        const scaleY = (v) => chartH / 2 - (v / 30) * (chartH / 2 - 8)
        const toPath = (vals) => vals.map((y, i) => `${i === 0 ? 'M' : 'L'} ${(i / 2) * chartW} ${scaleY(y)}`).join(' ')
        const rPath = toPath([calibrationData.low.r, calibrationData.mid.r, calibrationData.high.r])
        const gPath = toPath([calibrationData.low.g, calibrationData.mid.g, calibrationData.high.g])
        const bPath = toPath([calibrationData.low.b, calibrationData.mid.b, calibrationData.high.b])
        const trackColor = '#444'
        return (
          <>
            <div
              className="absolute inset-0 z-30 pointer-events-none opacity-[0.035]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'repeat',
              }}
            />
            <div className="absolute top-4 left-4 z-40 w-24 h-auto pointer-events-none" aria-hidden>
              <svg viewBox={STUDIO_LOGO_VIEWBOX} className="w-full h-auto" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
                {STUDIO_LOGO_PATHS.map((d, i) => (
                  <path key={i} fill="rgba(140,140,140,0.85)" d={d} />
                ))}
              </svg>
            </div>
            <div className="absolute bottom-4 left-4 z-40 pointer-events-none">
              <span className="font-mono text-[9px] text-[#666]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                [ ] 档位 · ↑↓ 步进
              </span>
            </div>
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-0 bg-black"
              style={{ transition: 'all 0.3s ease' }}
            >
              {/* 核心测试场：REF / ADJ 对比区域；窄屏下上下堆叠，宽屏并排 */}
              <div
                className="relative shrink-0 w-full max-w-[1000px]"
                style={{ height: isNarrowColorOffset ? '40vh' : 500, transition: 'all 0.3s ease' }}
              >
                {/* 极简档位器：浮在灰色块上方中央，稍下移避免与灰块边缘重叠 */}
                <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center" style={{ top: 28, zIndex: 50 }}>
                  <div className="flex items-center justify-center gap-12 mb-2">
                    {(['low', 'mid', 'high']).map((lev) => (
                      <button
                        key={lev}
                        type="button"
                        onClick={() => setCalibrationLevel(lev)}
                        className="outline-none focus:ring-0"
                        style={{
                          fontFamily: 'Montserrat, sans-serif',
                          fontSize: '10px',
                          color: calibrationLevel === 'mid' ? '#000' : '#888',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {lev === 'low' ? 'Low' : lev === 'mid' ? 'Mid' : 'High'}
                      </button>
                    ))}
                  </div>
                  <div style={{ height: 1, background: calibrationLevel === 'mid' ? '#000' : '#333', width: 240, position: 'relative', shapeRendering: 'crispEdges' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: calibrationLevel === 'low' ? 0 : calibrationLevel === 'mid' ? 118 : 236,
                        top: 2,
                        width: 4,
                        height: 4,
                        backgroundColor: calibrationLevel === 'mid' ? '#fff' : '#FF6B4A',
                        transition: 'left 0.15s ease',
                        shapeRendering: 'crispEdges',
                      }}
                    />
                  </div>
                </div>
                <div className={`flex w-full h-full ${isNarrowColorOffset ? 'flex-col' : 'flex-row'} items-stretch`}>
                  <div
                    className="flex-1"
                    style={{ backgroundColor: `rgb(${base}, ${base}, ${base})` }}
                    aria-label="REF"
                  />
                  <div
                    className="flex-1"
                    style={{
                      backgroundColor: flickerMode && flickerPhase === 1
                        ? `rgb(${base}, ${base}, ${base})`
                        : `rgb(${Math.round(adjR)}, ${Math.round(adjG)}, ${Math.round(adjB)})`,
                      transition: flickerMode ? 'none' : 'background-color 0.08s ease',
                    }}
                    aria-label="ADJ"
                  />
                </div>
              </div>

              {/* 控制器 + 量化分析图：窄屏下垂直堆叠，滑块宽度 90% 视口；图表在滑块下方 */}
              <div
                className="flex flex-col items-center mt-2"
                style={{ display: 'inline-flex', alignSelf: 'center', zIndex: 50 }}
              >
                <div
                  className={`flex ${isNarrowColorOffset ? 'flex-col items-stretch gap-4' : 'items-end justify-center gap-12'} px-6 py-4`}
                  style={{ fontFamily: 'Montserrat, sans-serif', fontSize: '10px', color: '#e0e0e0' }}
                >
                {[
                  { label: 'R', value: offsetR, setValue: setOffsetR, axis: 0 },
                  { label: 'G', value: offsetG, setValue: setOffsetG, axis: 1 },
                  { label: 'B', value: offsetB, setValue: setOffsetB, axis: 2 },
                ].map(({ label, value, setValue, axis }) => {
                  const axisColor = axis === activeOffsetAxis ? (axis === 0 ? '#e66' : axis === 1 ? '#6e6' : '#66e') : '#e0e0e0'
                  return (
                    <div
                      key={label}
                      role="slider"
                      tabIndex={0}
                      onFocus={() => setActiveOffsetAxis(axis)}
                      onClick={() => setActiveOffsetAxis(axis)}
                      className="flex flex-col items-center gap-1 outline-none"
                    >
                      <span style={{ marginBottom: 4, color: axisColor }}>Δ{label}: {value >= 0 ? '+' : ''}{value}</span>
                      <div
                        className="relative"
                        style={{
                          width: isNarrowColorOffset ? '90vw' : 220,
                          maxWidth: isNarrowColorOffset ? '100%' : 220,
                          height: isNarrowColorOffset ? 16 : 10,
                        }}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const width = Math.max(1, rect.width)
                          const v = Math.round((e.clientX - rect.left) / (width - 1) * 60 - 30)
                          setValue(Math.max(-30, Math.min(30, v)))
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: isNarrowColorOffset ? 7 : 4,
                            width: '100%',
                            height: 1,
                            backgroundColor: trackColor,
                            shapeRendering: 'crispEdges',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            left: `${((value + 30) / 60) * 100}%`,
                            top: 0,
                            width: 1,
                            height: isNarrowColorOffset ? 16 : 10,
                            backgroundColor: trackColor,
                            cursor: 'ew-resize',
                            shapeRendering: 'crispEdges',
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const track = e.currentTarget.parentElement
                            const move = (e2) => {
                              const rect = track.getBoundingClientRect()
                              const width = Math.max(1, rect.width)
                              const v = Math.round((e2.clientX - rect.left) / (width - 1) * 60 - 30)
                              setValue(Math.max(-30, Math.min(30, v)))
                            }
                            window.addEventListener('mousemove', move)
                            window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true })
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
                <div
                  className={`flex gap-2 mt-8 ${isNarrowColorOffset ? 'flex-col mx-auto' : 'flex-row items-center'}`}
                  style={isNarrowColorOffset ? { width: '90vw', maxWidth: '100%' } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => setFlickerMode((f) => !f)}
                    className={`px-2 py-1 rounded border border-[#444] text-[10px] outline-none text-center ${isNarrowColorOffset ? 'w-full' : ''}`}
                    style={{ fontFamily: 'Montserrat, sans-serif', color: flickerMode ? '#FF6B4A' : '#888', background: flickerMode ? 'rgba(255,107,74,0.1)' : 'transparent' }}
                  >
                    Flicker: {flickerMode ? 'on' : 'off'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCalibrationData((prev) => ({
                        ...prev,
                        [calibrationLevel]: { r: 0, g: 0, b: 0 },
                      }))
                    }
                    className={`px-2 py-1 rounded border border-[#444] text-[10px] outline-none text-center ${isNarrowColorOffset ? 'w-full' : ''}`}
                    style={{ fontFamily: 'Montserrat, sans-serif', color: '#888' }}
                  >
                    Reset
                  </button>
                </div>
                </div>
                {/* 量化分析图：窄屏与滑块一致 90vw，宽屏维持 95% */}
                <div className="mt-6 mx-auto" style={{ width: isNarrowColorOffset ? '90vw' : '95%', maxWidth: isNarrowColorOffset ? '100%' : undefined, minHeight: chartH }}>
                  <svg
                    width="100%"
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    preserveAspectRatio="none"
                    style={{ shapeRendering: 'crispEdges', display: 'block' }}
                  >
                    <line x1={0} y1={chartH / 2} x2={chartW} y2={chartH / 2} stroke="#444" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                    <path d={rPath} fill="none" stroke="#e66" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <path d={gPath} fill="none" stroke="#6e6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <path d={bPath} fill="none" stroke="#66e" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              </div>
            </div>
          </>
        )
      })()}

      {/* 纯色自检：全屏点对点填充，无边框无 UI，1-7 或点击切换；死点/坏点/脏屏/Gamma 测试 */}
      {gridTestMode === 'uniformity' && !typoSynthMode && (
        <div
          className="absolute inset-0 z-30 outline-none"
          style={{
            backgroundColor: UNIFORMITY_COLORS[uniformityIndex],
            margin: 0,
            border: 'none',
            outline: 'none',
          }}
          onClick={() => setUniformityIndex((i) => (i + 1) % 7)}
          role="button"
          tabIndex={0}
          aria-label={`纯色自检 ${UNIFORMITY_LABELS[uniformityIndex]}，1-7 或点击切换`}
        />
      )}

      {/* 色深断层测试：Canvas 渐变 120–135，D 切换 Dither */}
      {gridTestMode === 'bitdepth' && !typoSynthMode && (
        <BitDepthCanvas
          dither={bitDepthDither}
          className="absolute inset-0 z-30 w-full h-full block"
        />
      )}

      {/* 纯色/色深：左上角 logo + 左下角 模式+操作指南，仅鼠标移动或按键时显示，10px Montserrat，2s 后消失 */}
      {gridTestMode && !typoSynthMode && testModeHintVisible && (() => {
        const isUniformityWhite = gridTestMode === 'uniformity' && uniformityIndex === 0
        const isUniformityGreen = gridTestMode === 'uniformity' && uniformityIndex === 3
        const isUniformity18Gray = gridTestMode === 'uniformity' && uniformityIndex === 6
        const logoFill = isUniformityWhite ? '#666' : (isUniformityGreen ? '#000' : 'rgba(255,255,255,0.7)')
        const textColor = isUniformityWhite ? '#666' : (isUniformityGreen ? '#000' : (gridTestMode === 'uniformity' ? '#fff' : 'rgba(255,255,255,0.6)'))
        const textShadow = (isUniformityWhite || isUniformityGreen || isUniformity18Gray || gridTestMode === 'bitdepth') ? 'none' : '0 0 1px #000'
        return (
        <>
          <div className="absolute top-4 left-4 z-40 w-24 h-auto pointer-events-none" aria-hidden>
            <svg viewBox={STUDIO_LOGO_VIEWBOX} className="w-full h-auto" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
              {STUDIO_LOGO_PATHS.map((d, i) => (
                <path key={i} fill={logoFill} d={d} />
              ))}
            </svg>
          </div>
          <div
            className="absolute bottom-4 left-4 z-40 pointer-events-none"
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontSize: 10,
              lineHeight: 1.2,
              color: textColor,
              textShadow,
            }}
          >
            {gridTestMode === 'uniformity' && (
              <>
                <div>MODE: UNIFORMITY | {UNIFORMITY_LABELS[uniformityIndex]} (1–7)</div>
                <div style={{ marginTop: 2 }}>1–7 或点击 切换纯色</div>
              </>
            )}
            {gridTestMode === 'bitdepth' && (
              <>
                <div>MODE: BIT-DEPTH | STEP: 120–135</div>
                <div style={{ marginTop: 2 }}>D 切换抖动 {bitDepthDither ? 'ON' : 'OFF'}</div>
              </>
            )}
          </div>
        </>
        )
      })()}

      {!typoSynthMode && (
        <div
          className="w-full h-full grid"
          style={{
            gridTemplateColumns: `repeat(${gridSize.cols}, 1fr)`,
            gridTemplateRows: `repeat(${gridSize.rows}, 1fr)`,
            gap: 0,
          }}
        >
          {cells.map((cell, i) =>
            cell.type === 'typo' ? (
              <KineticCell
                key={`${gridSize.rows}-${gridSize.cols}-${i}`}
                cell={cell}
                fontFamily={fontStack}
                palette={palette}
                onClick={() => onModuleChange?.('color')}
              />
            ) : (
              <SolidCell
                key={`${gridSize.rows}-${gridSize.cols}-${i}`}
                cell={cell}
                palette={palette}
                onClick={() => onModuleChange?.('color')}
              />
            )
          )}
        </div>
      )}

      {/* 右上角控制面板 - 1px 灰框、圆角，滑块与按钮同宽 */}
      <div
        ref={controlsPanelRef}
        className={`absolute top-4 right-4 z-50 flex flex-col gap-2 p-3 w-[140px] rounded-lg transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          color: textColor,
        }}
      >
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColor }}>
            size: {gridSizeNum}×{gridSizeNum}
          </label>
          <input
            type="range"
            min={GRID_SIZE_MIN}
            max={GRID_SIZE_MAX}
            value={gridSizeNum}
            onChange={(e) => setGridSizeNum(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <RippleButton
          type="button"
          onClick={() => setAutoCycle((a) => !a)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: autoCycle ? btnActive : textColor,
            background: autoCycle ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          auto: {autoCycle ? 'on' : 'off'}
        </RippleButton>

        <RippleButton
          type="button"
          onClick={() => {
            setColorOffsetMode(false)
            setGridTestMode(null)
            setTypoSynthMode((t) => !t)
          }}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: typoSynthMode ? btnActive : textColor,
            background: typoSynthMode ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
          title="Typo-Synth · PO-12 风格 · Tone.js 鼓组 · LIVE / SEQ"
        >
          TYPO_SYNTH: {typoSynthMode ? 'on' : 'off'}
        </RippleButton>

        {/* 色彩空间切换 */}
        <div className="text-[10px] font-ui" style={{ color: textColor }}>
          <div className="mb-1">color space</div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setColorSpace('p3')}
              className="flex-1 py-1 px-2 border rounded text-center"
              style={{
                borderColor: btnBorder,
                color: colorSpace === 'p3' ? btnActive : textColor,
                background: colorSpace === 'p3' ? 'rgba(255,255,255,0.1)' : 'transparent',
              }}
            >
              P3
            </button>
            <button
              type="button"
              onClick={() => setColorSpace('srgb')}
              className="flex-1 py-1 px-2 border rounded text-center"
              style={{
                borderColor: btnBorder,
                color: colorSpace === 'srgb' ? btnActive : textColor,
                background: colorSpace === 'srgb' ? 'rgba(255,255,255,0.1)' : 'transparent',
              }}
            >
              sRGB
            </button>
          </div>
        </div>

        {/* 闪黑测试：仅 Grid 内，时长可调 */}
        <div>
          <label className="block text-[10px] font-ui mb-1" style={{ color: textColor }}>
            BFI: {bfiDurationMs}ms
          </label>
          <input
            type="range"
            min={BFI_DURATION_MIN}
            max={BFI_DURATION_MAX}
            step={50}
            value={bfiDurationMs}
            onChange={(e) => setBfiDurationMs(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'white' }}
          />
        </div>
        <RippleButton
          type="button"
          onClick={() => setBfiEnabled((e) => !e)}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: bfiEnabled ? btnActive : textColor,
            background: bfiEnabled ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          BFI test: {bfiEnabled ? 'on' : 'off'}
        </RippleButton>

        <RippleButton
          type="button"
          onClick={() => {
            setTypoSynthMode(false)
            setGridTestMode(null)
            setColorOffsetMode((c) => !c)
          }}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: colorOffsetMode ? btnActive : textColor,
            background: colorOffsetMode ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          COLOR OFFSET: {colorOffsetMode ? 'on' : 'off'}
        </RippleButton>

        <RippleButton
          type="button"
          onClick={() => {
            setTypoSynthMode(false)
            setColorOffsetMode(false)
            setGridTestMode((m) => (m === 'uniformity' ? null : 'uniformity'))
          }}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: gridTestMode === 'uniformity' ? btnActive : textColor,
            background: gridTestMode === 'uniformity' ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          Uniformity: {gridTestMode === 'uniformity' ? 'on' : 'off'}
        </RippleButton>

        <RippleButton
          type="button"
          onClick={() => {
            setTypoSynthMode(false)
            setColorOffsetMode(false)
            setGridTestMode((m) => (m === 'bitdepth' ? null : 'bitdepth'))
          }}
          className="text-[10px] font-ui py-1 px-2 border rounded-md text-left w-full"
          style={{
            borderColor: btnBorder,
            color: gridTestMode === 'bitdepth' ? btnActive : textColor,
            background: gridTestMode === 'bitdepth' ? 'rgba(255,255,255,0.1)' : 'transparent',
          }}
        >
          Bit-Depth: {gridTestMode === 'bitdepth' ? 'on' : 'off'}
        </RippleButton>

        <GlobalShortcutsHint color="rgba(255,255,255,0.45)" />
      </div>
    </div>
  )
}
