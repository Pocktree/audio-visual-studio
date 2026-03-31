import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  AUDIO_GRID_F0,
  computeColNorm,
  computeDetuneCentsFromColNorm,
  computePitchHz,
  getSoundByGrid,
} from './audioGridMap'
import { STUDIO_LOGO_PATHS, STUDIO_LOGO_VIEWBOX } from './StudioLogoPaths'

/** 与 GridModule 主网格一致：8 色 P3 / sRGB（palette 未传入时兜底） */
const FALLBACK_PALETTE_P3 = [
  'color(display-p3 1 0 0)',
  'color(display-p3 0 1 0)',
  'color(display-p3 0 0 1)',
  'color(display-p3 1 1 0)',
  'color(display-p3 0 1 1)',
  'color(display-p3 1 0 1)',
  'color(display-p3 1 1 1)',
  'color(display-p3 1 0.5 0)',
]

const FALLBACK_PALETTE_SRGB = [
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#FFFF00',
  '#00FFFF',
  '#FF00FF',
  '#FFFFFF',
  '#FF8000',
]

/** 按住超过该时间后切换为合成器持续音（低/中/高/亮分层） */
const LONG_PRESS_MS = 300
const LONG_PRESS_SEC = LONG_PRESS_MS / 1000
/** 第一行长按：清空录制与循环播放 */
const SCREEN_ROW_CLEAR_MS = 500
/** 与下方 Pad 列对齐：每列水平子像素列数（canvas 宽度为其整数倍） */
const LED_SUBPIXELS_PER_COL = 4
/** 纵向离散档位数 */
const LED_VERT_STEPS = 16
/** 按下 Pad 时该频带目标最小抬升，保证即时反馈 */
const PAD_SPECTRUM_BOOST_MIN = 0.88
/** 幅值伽马：与 FFT 目标一致，拉大强弱对比 */
const SPECTRUM_GAMMA = 1.6
/** 重力下落速度（归一化高度/秒），模拟 GtG 拖影、流沙滑落 */
const SPECTRUM_GRAVITY = 0.95

/** 精密频谱：对数分带范围（Hz） */
const SPEC_F_MIN = 20
const SPEC_F_MAX = 20000
/** Transport 与第一行循环回放色闪节拍一致 */
const SPECTRUM_LOOP_BPM = 120
/**
 * 与首行列数对齐的对数分带数量：N=20 → 20 带，小 N 保底 12、大 N 封顶 48
 * @param {number} n - 网格边长
 */
function spectrumBandCountFromN(n) {
  if (n <= 4) return 12
  return Math.min(48, Math.max(12, n))
}

/** 对数等分频点边界 [f0..fN]，长度 numBands+1 */
function logFrequencyEdges(numBands, fMin = SPEC_F_MIN, fMax = SPEC_F_MAX) {
  const lo = Math.log10(fMin)
  const hi = Math.log10(fMax)
  const edges = new Float64Array(numBands + 1)
  for (let i = 0; i <= numBands; i++) {
    edges[i] = 10 ** (lo + ((hi - lo) * i) / numBands)
  }
  return edges
}

/** dB → [0,1] 伽马高度（感知重力前）：final ∝ ((db+90)/90)^1.6 */
function dbToGammaHeightNorm(db) {
  if (!Number.isFinite(db)) return 0
  const t = Math.max(0, Math.min(1, (db + 90) / 90))
  return Math.pow(t, SPECTRUM_GAMMA)
}

function frequencyToLogBandIndex(freqHz, numBands, fMin, fMax) {
  const edges = logFrequencyEdges(numBands, fMin, fMax)
  if (freqHz <= edges[0]) return 0
  if (freqHz >= edges[numBands]) return numBands - 1
  for (let b = 0; b < numBands; b++) {
    if (freqHz >= edges[b] && freqHz < edges[b + 1]) return b
  }
  return numBands - 1
}

/** 长按清空录制成功：单声清脆短音（独立 Synth，用完即 dispose） */
function playClearConfirmSound() {
  try {
    const synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.09 },
      volume: -8,
    }).toDestination()
    const t = Tone.now()
    synth.triggerAttackRelease('A5', 0.06, t)
    window.setTimeout(() => {
      try {
        synth.dispose()
      } catch {
        /* */
      }
    }, 200)
  } catch {
    /* */
  }
}

/** 按下格子时，Row0 频谱上要点亮的对数频带（与当前 N 的 band 数一致） */
function computePadSpectrumHighlightBands(padRow, pc, totalGridRows, totalGridCols, gridF0, numBands) {
  const padRows = Math.max(0, totalGridRows - 1)
  const g = getSoundByGrid(padRow, pc, totalGridRows, totalGridCols)
  const pitchHz = computePitchHz(padRow, padRows, totalGridRows, gridF0)
  const baseHz = pitchHz * g.playbackRate
  const sampleRate = Tone.context.sampleRate
  const fMax = Math.min(SPEC_F_MAX, sampleRate * 0.49)
  let centerHz
  if (g.voice === 0) {
    centerHz = Math.max(40, Math.min(120, pitchHz * g.playbackRate * 0.2))
  } else if (g.voice === 1) {
    centerHz = 2400
  } else if (g.voice === 2) {
    centerHz = 6200
  } else {
    centerHz = Math.max(120, Math.min(5200, baseHz))
  }
  const idx = frequencyToLogBandIndex(centerHz, numBands, SPEC_F_MIN, fMax)
  const spread = g.voice === 1 || g.voice === 2 ? 1 : 0
  const bands = []
  for (let d = -spread; d <= spread; d++) {
    const b = idx + d
    if (b >= 0 && b < numBands) bands.push(b)
  }
  return { bands }
}

/** Kick：行音高 × 0.2，限制在 sub 区，与长按一致 */
function kickFundamentalHz(pitchHz, playbackRate) {
  return Math.max(40, Math.min(120, pitchHz * playbackRate * 0.2))
}

/**
 * 将录制事件展开为 Part 时间线（与 onPointerDown / 300ms 长按 / onPointerUp 语义对齐）
 * @param {{ type: string, tOffset: number, padRow: number, pc: number, v: number, pointerId: number }[]} events
 */
function buildPlaybackTimeline(events, durationSec, longPressSec) {
  const sorted = [...events].sort((a, b) => a.tOffset - b.tOffset)
  const open = new Map()
  const pairs = []
  for (const ev of sorted) {
    if (ev.type === 'down') {
      open.set(ev.pointerId, ev)
    } else if (ev.type === 'up') {
      const d = open.get(ev.pointerId)
      open.delete(ev.pointerId)
      if (d) pairs.push({ down: d, up: ev })
    }
  }
  for (const d of open.values()) {
    pairs.push({ down: d, up: { ...d, type: 'up', tOffset: durationSec, pointerId: d.pointerId } })
  }
  const timeline = []
  for (const { down, up } of pairs) {
    const td = Math.max(0, down.tOffset)
    const tu = Math.min(Math.max(td, up.tOffset), durationSec)
    timeline.push({ t: td, kind: 'samplerOn', padRow: down.padRow, pc: down.pc })
    if (tu - td > longPressSec) {
      timeline.push({ t: td + longPressSec, kind: 'crossToSustain', padRow: down.padRow, pc: down.pc })
      timeline.push({ t: tu, kind: 'sustainEnd', padRow: down.padRow, pc: down.pc })
    } else {
      timeline.push({ t: tu, kind: 'samplerRelease', padRow: down.padRow, pc: down.pc })
    }
  }
  const kindOrder = { samplerOn: 0, crossToSustain: 1, sustainEnd: 2, samplerRelease: 3 }
  timeline.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t
    return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)
  })
  return timeline
}

function pickRandom(palette) {
  if (!palette || palette.length === 0) return '#808080'
  return palette[Math.floor(Math.random() * palette.length)]
}

/** 第一行屏幕背景不用纯白/近白，避免与白色频谱块糊成一片 */
function isExcludedScreenBackground(color) {
  if (!color) return true
  const s = String(color).trim()
  const t = s.replace(/\s/g, '').toLowerCase()
  if (t === '#ffffff' || t === '#fff') return true
  const p3 = /display-p3\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(s)
  if (p3) {
    const r = parseFloat(p3[1])
    const g = parseFloat(p3[2])
    const b = parseFloat(p3[3])
    if (r >= 0.97 && g >= 0.97 && b >= 0.97) return true
  }
  const hex = /^#?([0-9a-f]{6})$/i.exec(t)
  if (hex) {
    const v = parseInt(hex[1], 16)
    const r = (v >> 16) & 255
    const g = (v >> 8) & 255
    const b = v & 255
    if (r >= 248 && g >= 248 && b >= 248) return true
  }
  return false
}

function pickScreenBaseColor(palette) {
  const pal = palette && palette.length > 0 ? palette : FALLBACK_PALETTE_P3
  const filtered = pal.filter((c) => !isExcludedScreenBackground(c))
  const pool = filtered.length > 0 ? filtered : ['#1a1b22']
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Pad 区：(N-1)×N，与主网格第 2…N 行对应 */
function buildPadGrid(n, palette) {
  const pal = palette && palette.length > 0 ? palette : FALLBACK_PALETTE_P3
  const padRows = Math.max(0, n - 1)
  return Array.from({ length: padRows }, () =>
    Array.from({ length: n }, () => ({ color: pickRandom(pal) })),
  )
}

function hzToNote(hz) {
  const f = Math.max(24, Math.min(12500, hz))
  try {
    const note = Tone.Frequency(f).toNote()
    return note && String(note).length > 0 ? note : 'C4'
  } catch {
    return 'C4'
  }
}

function getDrumSynthByVoice(kit, voice) {
  if (!kit) return null
  return [kit.kickDrum, kit.snareDrum, kit.hihatDrum, kit.beepDrum][voice] ?? null
}

/**
 * 短按：Kick / Snare / Hat / Square 四套合成器鼓点
 * 行：音高；列：音色复杂度（Kick 过冲、Snare/Hat 带宽；Synth 短按为方波 beep）
 */
function triggerShortDrumSynth(kit, padRow, pc, totalGridRows, totalGridCols, gridF0, time) {
  if (!kit) return
  const t = time ?? Tone.now()
  const padRows = Math.max(0, totalGridRows - 1)
  const g = getSoundByGrid(padRow, pc, totalGridRows, totalGridCols)
  const pitchHz = computePitchHz(padRow, padRows, totalGridRows, gridF0)
  const colNorm = computeColNorm(pc, totalGridCols)
  const note = hzToNote(pitchHz * g.playbackRate)
  const detuneCents = computeDetuneCentsFromColNorm(colNorm) + (g.playbackRate - 1) * 400
  try {
    if (g.voice === 0) {
      const kHz = kickFundamentalHz(pitchHz, g.playbackRate)
      const vel = Math.min(1, 0.84 + colNorm * 0.16)
      if (kit.kickShortDistortion) kit.kickShortDistortion.distortion = colNorm * 0.52
      kit.kickDrum.triggerAttackRelease(kHz, 0.2, t, vel)
    } else if (g.voice === 1) {
      if (kit.snareShortFilter) {
        kit.snareShortFilter.Q.value = 14 - colNorm * 13.2
        kit.snareShortFilter.frequency.value = 1200 + colNorm * 3200
      }
      kit.snareDrum.triggerAttackRelease('16n', t, 0.7 + colNorm * 0.28)
    } else if (g.voice === 2) {
      kit.hihatDrum.volume.value = -10 + colNorm * 5
      kit.hihatDrum.modulationIndex = 14 + colNorm * 38
      kit.hihatDrum.resonance = Math.min(7000, 2200 + colNorm * 4800)
      kit.hihatDrum.triggerAttackRelease(note, '32n', t, 0.68 + colNorm * 0.24)
    } else {
      kit.beepDrum.detune.value = detuneCents
      kit.beepDrum.triggerAttackRelease(note, '16n', t, Math.min(1, 0.58 + colNorm * 0.32))
    }
  } catch {
    /* */
  }
}

function releaseShortDrumSynth(kit, voice, time) {
  /** Synth 短按用 triggerAttackRelease 已自带 release；pointerup 再 release 会掐掉音头导致几乎听不见 */
  if (voice === 3) return
  const d = getDrumSynthByVoice(kit, voice)
  if (!d) return
  const t = time ?? Tone.now()
  try {
    d.triggerRelease(t)
  } catch {
    /* */
  }
}

function getSustainSynthByVoice(kit, voice) {
  if (!kit) return null
  return [kit.sustainKick, kit.sustainSnare, kit.sustainHat, kit.sustainLead][voice] ?? null
}

/**
 * 长按 Hybrid Sustain：与四套短按鼓一一对应
 * 0 Kick 正弦+列过冲 | 1 Snare 粉红噪声+带宽 | 2 Hat FM | 3 FM pad + 滤波 LFO
 */
function triggerSustainSynth(kit, padRow, pc, totalGridRows, totalGridCols, gridF0, time) {
  if (!kit) return
  const t = time ?? Tone.now()
  const padRows = Math.max(0, totalGridRows - 1)
  const g = getSoundByGrid(padRow, pc, totalGridRows, totalGridCols)
  const pitchHz = computePitchHz(padRow, padRows, totalGridRows, gridF0)
  const colNorm = computeColNorm(pc, totalGridCols)
  const baseHz = pitchHz * g.playbackRate
  const detuneCents = computeDetuneCentsFromColNorm(colNorm) + (g.playbackRate - 1) * 200
  const vel = Math.min(1, 0.42 + colNorm * 0.55)
  const synth = getSustainSynthByVoice(kit, g.voice)
  if (!synth) return
  try {
    if (g.voice === 0) {
      const subHz = kickFundamentalHz(pitchHz, g.playbackRate)
      if (kit.sustainKickDistortion) kit.sustainKickDistortion.distortion = colNorm * 0.55
      kit.sustainKick.detune.value = detuneCents * 0.2
      kit.sustainKick.triggerAttack(hzToNote(subHz), t, vel)
    } else if (g.voice === 1) {
      if (kit.sustainSnareFilter && kit.sustainSnareLfo) {
        kit.sustainSnareFilter.Q.value = Math.max(0.35, 12 - colNorm * 11.5)
        kit.sustainSnareFilter.frequency.value = 900 + colNorm * 2400
        kit.sustainSnareLfo.min = 400 + colNorm * 200
        kit.sustainSnareLfo.max = 1800 + colNorm * 2800
        kit.sustainSnareLfo.frequency.value = 0.045 + colNorm * 0.09
      }
      kit.sustainSnare.triggerAttack(t, vel * 0.92)
    } else if (g.voice === 2) {
      kit.sustainHat.harmonicity.value = 4 + colNorm * 9
      kit.sustainHat.modulationIndex.value = 8 + colNorm * 40
      const carrierHz = Math.max(900, Math.min(7800, baseHz * 4.8 + colNorm * 1100 + 600))
      kit.sustainHat.detune.value = detuneCents
      kit.sustainHat.triggerAttack(hzToNote(carrierHz), t, vel * 0.88)
    } else {
      kit.sustainLead.detune.value = detuneCents
      kit.sustainLead.modulationIndex.value = 3 + colNorm * 45
      kit.sustainLead.harmonicity.value = 2 + colNorm * 0.9
      kit.sustainLead.triggerAttack(hzToNote(baseHz), t, vel * 0.9)
    }
  } catch {
    /* */
  }
}

function releaseSustainSynth(kit, voice, time) {
  const s = getSustainSynthByVoice(kit, voice)
  if (!s) return
  const tm = time ?? Tone.now()
  try {
    s.triggerRelease(tm)
  } catch {
    /* */
  }
}

function SynthPadButton({
  baseColor,
  palette: pal,
  isPlayhead,
  active,
  playheadActiveShadow,
  playheadIdleShadow,
  onPointerDownAction,
  onPointerUpAction,
  onPointerCancelAction,
  gridRow,
  gridColumn,
  ghostToken,
}) {
  const [displayColor, setDisplayColor] = useState(baseColor)
  const [ghostBrightness, setGhostBrightness] = useState(1)
  useEffect(() => {
    setDisplayColor(baseColor)
  }, [baseColor])

  useEffect(() => {
    if (ghostToken == null || ghostToken === 0) return
    setGhostBrightness(2)
    const id = requestAnimationFrame(() => {
      setGhostBrightness(1)
    })
    return () => cancelAnimationFrame(id)
  }, [ghostToken])

  return (
    <button
      type="button"
      className="relative min-h-0 min-w-0 cursor-pointer border-0 p-0 outline-none"
      style={{
        gridRow,
        gridColumn,
        backgroundColor: displayColor,
        transition: 'filter 500ms linear, background-color 0.06s linear',
        boxShadow: isPlayhead ? (active ? playheadActiveShadow : playheadIdleShadow) : 'none',
        filter: `brightness(${ghostBrightness})`,
      }}
      onMouseEnter={() => setDisplayColor(pickRandom(pal))}
      onPointerDown={(e) => {
        e.preventDefault()
        setDisplayColor(pickRandom(pal))
        onPointerDownAction(e)
      }}
      onPointerUp={(e) => {
        onPointerUpAction?.(e)
        setDisplayColor(baseColor)
      }}
      onPointerCancel={(e) => {
        onPointerCancelAction?.(e)
        setDisplayColor(baseColor)
      }}
    />
  )
}

export function TypoSynthMode({
  n: nProp,
  gridSizeMin = 2,
  gridSizeMax = 20,
  fontFamily,
  palette: paletteProp,
  colorSpace = 'p3',
  /** @type {{ f0?: number, totalRows?: number, totalCols?: number } | undefined} */
  audioGrid: audioGridProp,
}) {
  const palette = useMemo(() => {
    if (paletteProp && paletteProp.length > 0) return paletteProp
    return colorSpace === 'srgb' ? FALLBACK_PALETTE_SRGB : FALLBACK_PALETTE_P3
  }, [paletteProp, colorSpace])

  const n = Math.max(gridSizeMin, Math.min(gridSizeMax, Math.floor(nProp || 4)))
  const gridF0 = audioGridProp?.f0 ?? AUDIO_GRID_F0
  const totalGridRows = audioGridProp?.totalRows ?? n
  const totalGridCols = audioGridProp?.totalCols ?? n
  const fontStack = fontFamily ?? 'Inter, ui-monospace, system-ui, sans-serif'

  const initialScreen = useMemo(() => pickScreenBaseColor(palette), [palette])
  const [screenBase, setScreenBase] = useState(initialScreen)
  const [padGrid, setPadGrid] = useState(() => buildPadGrid(n, palette))
  const [liveMode, setLiveMode] = useState(true)
  const [pattern, setPattern] = useState(() => {
    const rows = Math.max(0, n - 1)
    return Array.from({ length: rows }, () =>
      Array.from({ length: n }, () => Math.random() > 0.78),
    )
  })
  const [stepMs, setStepMs] = useState(115)
  const [seqRunning, setSeqRunning] = useState(true)
  const [playheadCol, setPlayheadCol] = useState(0)
  const [toneReady, setToneReady] = useState(false)
  const [rmsNorm, setRmsNorm] = useState(0)
  const [ghostEpoch, setGhostEpoch] = useState(() => ({}))
  const [isRecording, setIsRecording] = useState(false)
  const [recordLoopActive, setRecordLoopActive] = useState(false)
  const isRecordingRef = useRef(false)
  const recordEventsRef = useRef([])
  const recordStartSecRef = useRef(0)
  const playbackPartRef = useRef(null)
  const recordLoopActiveRef = useRef(false)
  const recordLoopDurationSecRef = useRef(2)
  const spectrumBoostUntilRef = useRef(0)
  const longHoldVisualRef = useRef(false)
  /** pointerId → { bands }，按下格子时点亮 Row0 对数频带 */
  const spectrumPadHighlightRef = useRef(new Map())
  const screenSpectrumCanvasRef = useRef(null)
  const [longHoldScreen, setLongHoldScreen] = useState(false)

  const playheadColRef = useRef(0)
  const accumRef = useRef(0)
  const lastTsRef = useRef(0)
  const patternRef = useRef(pattern)
  patternRef.current = pattern

  const kitRef = useRef(null)
  const pointerPadRef = useRef(new Map())
  /** 第一行：短按录/停录+播，长按清空录制 */
  const screenPointerDownMsRef = useRef(0)
  const screenLongPressTimerRef = useRef(null)
  const screenLongPressDidRef = useRef(false)

  const playheadActiveShadow = 'inset 0 0 0 3px rgba(255,255,255,0.95)'
  const playheadIdleShadow = 'inset 0 0 0 2px rgba(128,128,128,0.75)'

  useEffect(() => {
    const nextScreen = pickScreenBaseColor(palette)
    setScreenBase(nextScreen)
    setPadGrid(buildPadGrid(n, palette))
    const rows = Math.max(0, n - 1)
    setPattern(
      Array.from({ length: rows }, () =>
        Array.from({ length: n }, () => Math.random() > 0.78),
      ),
    )
  }, [n, palette])

  useEffect(() => {
    let cancelled = false
    void Tone.start().then(() => {
      if (cancelled) return
      setToneReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!toneReady) return undefined
    const tr = Tone.getTransport()
    tr.bpm.value = SPECTRUM_LOOP_BPM
    tr.timeSignature = 4
    return undefined
  }, [toneReady])

  useEffect(() => {
    if (!toneReady) return undefined

    const masterGain = new Tone.Gain(0.78)
    const limiter = new Tone.Limiter(-10)
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.84 })
    /**
     * Row 0 频谱：Tone 的 size = frequencyBinCount；内部 fftSize = size*2。
     * 1024 个 bin + 对数分带，低频更易分辨。
     */
    const fftAnalyser = new Tone.Analyser({ type: 'fft', size: 1024 })
    fftAnalyser.smoothing = 0.75
    const fftMute = new Tone.Gain(0)

    masterGain.connect(limiter)
    limiter.toDestination()
    masterGain.connect(meter)
    masterGain.connect(fftAnalyser)
    fftAnalyser.connect(fftMute)
    fftMute.toDestination()

    /** 短按：四套合成器鼓音色 */
    const kickDrum = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.12 },
    })
    const snareDrum = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 },
    })
    snareDrum.volume.value = -2
    const hihatDrum = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.06, release: 0.02 },
      harmonicity: 5.2,
      modulationIndex: 24,
      resonance: 4200,
      octaves: 0.5,
    })
    hihatDrum.volume.value = -8
    const beepDrum = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.08 },
      volume: -4,
    })

    const drumBus = new Tone.Gain(0.88)
    const kickShortDistortion = new Tone.Distortion({ distortion: 0, oversample: '4x' })
    const snareShortFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 2200,
      Q: 8,
      rolloff: -24,
    })
    kickDrum.chain(kickShortDistortion, drumBus)
    snareDrum.chain(snareShortFilter, drumBus)
    hihatDrum.connect(drumBus)
    beepDrum.connect(drumBus)
    drumBus.connect(masterGain)

    const sustainMerger = new Tone.Gain(0.88)

    /** 长按 Layer 1 — Kick：正弦 sub + 列控制失真过冲 */
    const sustainKick = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.12, decay: 0.25, sustain: 1, release: 0.75 },
      volume: -4,
    })
    const sustainKickDistortion = new Tone.Distortion({ distortion: 0, oversample: '4x' })

    /**
     * 长按 Layer 2 — Snare：粉红噪声 + 外接带通（Tone v15 的 NoiseSynth 无内置 filter，须自行串联）
     */
    const sustainSnare = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.35, decay: 0.15, sustain: 1, release: 1.35 },
      volume: -11,
    })
    const sustainSnareFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 1600,
      Q: 2.8,
      rolloff: -24,
    })
    const sustainSnareLfo = new Tone.LFO({
      frequency: 0.055,
      min: 720,
      max: 3200,
    })
    sustainSnareLfo.connect(sustainSnareFilter.frequency)
    sustainSnareLfo.start()
    sustainSnare.chain(sustainSnareFilter, sustainMerger)

    /** 长按 Layer 3 — Hat：FM 金属长音（高频载波 + 调制指数） */
    const sustainHat = new Tone.FMSynth({
      harmonicity: 6,
      modulationIndex: 16,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.04, decay: 0.35, sustain: 0.96, release: 1.15 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.12, decay: 0.4, sustain: 0.92, release: 1.05 },
      volume: -9,
    })

    /** 长按 Layer 4 — Synth pad：FM + 后置低通，列控制调制深度；LFO 扫滤波 */
    const sustainLead = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 12,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.28, decay: 0.18, sustain: 0.96, release: 1.05 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.1, decay: 0.35, sustain: 0.92, release: 1.05 },
      volume: -12,
    })
    const sustainLeadPostFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 900,
      Q: 1.2,
      rolloff: -24,
    })
    const sustainLeadLfo = new Tone.LFO({
      frequency: 0.11,
      min: 320,
      max: 2400,
    })
    sustainLeadLfo.connect(sustainLeadPostFilter.frequency)
    sustainLeadLfo.start()

    sustainKick.chain(sustainKickDistortion, sustainMerger)
    sustainHat.connect(sustainMerger)
    sustainLead.connect(sustainLeadPostFilter)
    sustainLeadPostFilter.connect(sustainMerger)
    sustainMerger.connect(masterGain)

    const disposeAll = () => {
      try {
        fftAnalyser.dispose()
        fftMute.dispose()
        kickShortDistortion.dispose()
        snareShortFilter.dispose()
        kickDrum.dispose()
        snareDrum.dispose()
        hihatDrum.dispose()
        beepDrum.dispose()
        drumBus.dispose()
        sustainSnareLfo.stop()
        sustainSnareLfo.disconnect()
        sustainSnareLfo.dispose()
        sustainLeadLfo.stop()
        sustainLeadLfo.disconnect()
        sustainLeadLfo.dispose()
        sustainKickDistortion.dispose()
        sustainKick.dispose()
        sustainSnare.dispose()
        sustainSnareFilter.dispose()
        sustainHat.dispose()
        sustainLeadPostFilter.dispose()
        sustainLead.dispose()
        sustainMerger.dispose()
        meter.dispose()
        limiter.dispose()
        masterGain.dispose()
      } catch {
        /* */
      }
    }

    kitRef.current = {
      ready: true,
      kickDrum,
      kickShortDistortion,
      snareShortFilter,
      snareDrum,
      hihatDrum,
      beepDrum,
      sustainKick,
      sustainKickDistortion,
      sustainSnare,
      sustainSnareFilter,
      sustainSnareLfo,
      sustainHat,
      sustainLead,
      sustainLeadPostFilter,
      sustainMerger,
      drumBus,
      masterGain,
      limiter,
      meter,
      fftAnalyser,
      fftMute,
    }

    return () => {
      kitRef.current = null
      disposeAll()
    }
  }, [toneReady])

  useEffect(() => {
    if (!toneReady) return undefined
    let raf = 0
    const tick = () => {
      const m = kitRef.current?.meter
      if (m) {
        const mv = m.getValue()
        setRmsNorm(typeof mv === 'number' ? mv : 0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [toneReady])

  const ensureAudio = useCallback(async () => {
    await Tone.start()
    const ctx = Tone.getContext()
    if (ctx.state !== 'running') {
      await ctx.resume()
    }
  }, [])

  const playVoice = useCallback(
    (time, padRow, pc) => {
      const kit = kitRef.current
      if (!kit?.ready) return
      const t = time ?? Tone.now()
      triggerShortDrumSynth(kit, padRow, pc, totalGridRows, totalGridCols, gridF0, t)
    },
    [totalGridRows, totalGridCols, gridF0],
  )

  /** 长按：停短鼓 → 同区合成器持续音（低/中/高/亮分层） */
  const crossToSustainSynthAt = useCallback(
    (kit, padRow, pc, atTime) => {
      if (!kit?.ready) return
      const g = getSoundByGrid(padRow, pc, totalGridRows, totalGridCols)
      const t = atTime ?? Tone.now()
      try {
        releaseShortDrumSynth(kit, g.voice, t)
      } catch {
        /* */
      }
      try {
        triggerSustainSynth(kit, padRow, pc, totalGridRows, totalGridCols, gridF0, t)
      } catch {
        /* */
      }
    },
    [totalGridRows, totalGridCols, gridF0],
  )

  const releaseLongSustainAt = useCallback((kit, voice, atTime) => {
    if (!kit?.ready) return
    const t = atTime ?? Tone.now()
    try {
      releaseSustainSynth(kit, voice, t)
    } catch {
      /* */
    }
  }, [])

  const stopPlaybackPart = useCallback(() => {
    if (playbackPartRef.current) {
      try {
        playbackPartRef.current.stop()
        playbackPartRef.current.dispose()
      } catch {
        /* */
      }
      playbackPartRef.current = null
    }
    setRecordLoopActive(false)
    recordLoopActiveRef.current = false
  }, [])

  /** 长按第一行：清空事件、停 Transport、停循环播放；屏幕恢复随机底色，等待再次短按开录 */
  const clearRecordingAndPlayback = useCallback(async () => {
    await ensureAudio()
    const tr = Tone.getTransport()
    isRecordingRef.current = false
    setIsRecording(false)
    recordEventsRef.current = []
    stopPlaybackPart()
    tr.stop()
    tr.loop = false
    tr.position = 0
    recordLoopDurationSecRef.current = 2
    setScreenBase(pickScreenBaseColor(palette))
    playClearConfirmSound()
  }, [ensureAudio, stopPlaybackPart, palette])

  /**
   * 第一行点击：未录 → 开始录；录中 → 停录并立刻循环播放本次内容；
   * 循环播放中再点 → 停播并开始新一段录制（覆盖上次）。
   */
  const toggleScreenRecord = useCallback(async () => {
    await ensureAudio()
    const tr = Tone.getTransport()
    if (!isRecordingRef.current) {
      stopPlaybackPart()
      tr.stop()
      tr.loop = false
      tr.position = 0
      recordEventsRef.current = []
      tr.start()
      recordStartSecRef.current = tr.seconds
      isRecordingRef.current = true
      setIsRecording(true)
      setScreenBase(pickScreenBaseColor(palette))
      return
    }
    isRecordingRef.current = false
    setIsRecording(false)
    const duration = Math.max(0.25, tr.seconds - recordStartSecRef.current)
    recordLoopDurationSecRef.current = duration
    tr.stop()
    const timeline = buildPlaybackTimeline(recordEventsRef.current, duration, LONG_PRESS_SEC)
    const partEvents = timeline.map((ev) => [ev.t, ev])
    stopPlaybackPart()
    tr.loop = true
    tr.loopStart = 0
    tr.loopEnd = duration
    tr.position = 0
    if (partEvents.length > 0) {
      const part = new Tone.Part((time, ev) => {
        const kit = kitRef.current
        if (!kit?.ready) return
        switch (ev.kind) {
          case 'samplerOn':
            triggerShortDrumSynth(kit, ev.padRow, ev.pc, totalGridRows, totalGridCols, gridF0, time)
            break
          case 'crossToSustain':
            crossToSustainSynthAt(kit, ev.padRow, ev.pc, time)
            break
          case 'sustainEnd': {
            const g = getSoundByGrid(ev.padRow, ev.pc, totalGridRows, totalGridCols)
            releaseLongSustainAt(kit, g.voice, time)
            break
          }
          case 'samplerRelease': {
            const g = getSoundByGrid(ev.padRow, ev.pc, totalGridRows, totalGridCols)
            releaseShortDrumSynth(kit, g.voice, time)
            break
          }
          default:
            break
        }
      }, partEvents)
      part.loop = true
      part.loopEnd = duration
      part.start(0)
      playbackPartRef.current = part
    }
    setRecordLoopActive(true)
    recordLoopActiveRef.current = true
    playheadColRef.current = 0
    setPlayheadCol(0)
    tr.start()
  }, [
    ensureAudio,
    stopPlaybackPart,
    crossToSustainSynthAt,
    releaseLongSustainAt,
    totalGridRows,
    totalGridCols,
    gridF0,
    palette,
  ])

  const handleScreenPointerDown = useCallback(() => {
    screenPointerDownMsRef.current = performance.now()
    screenLongPressDidRef.current = false
    if (screenLongPressTimerRef.current) clearTimeout(screenLongPressTimerRef.current)
    screenLongPressTimerRef.current = window.setTimeout(() => {
      screenLongPressDidRef.current = true
      void clearRecordingAndPlayback()
    }, SCREEN_ROW_CLEAR_MS)
  }, [clearRecordingAndPlayback])

  const handleScreenPointerUpOrCancel = useCallback(() => {
    if (screenLongPressTimerRef.current) {
      clearTimeout(screenLongPressTimerRef.current)
      screenLongPressTimerRef.current = null
    }
    if (screenLongPressDidRef.current) {
      screenLongPressDidRef.current = false
      return
    }
    if (performance.now() - screenPointerDownMsRef.current <= SCREEN_ROW_CLEAR_MS) {
      void toggleScreenRecord()
    }
  }, [toggleScreenRecord])

  useEffect(() => {
    return () => {
      if (screenLongPressTimerRef.current) {
        clearTimeout(screenLongPressTimerRef.current)
      }
    }
  }, [])

  const bumpPadGhost = useCallback((padPr, pc) => {
    setGhostEpoch((prev) => ({
      ...prev,
      [`${padPr}-${pc}`]: (prev[`${padPr}-${pc}`] || 0) + 1,
    }))
  }, [])

  const padPointerDown = useCallback(
    async (e, padPr, pc) => {
      if (!liveMode) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* */
      }
      const g = getSoundByGrid(padPr, pc, totalGridRows, totalGridCols)
      const st = {
        g,
        v: g.voice,
        padRow: padPr,
        pc,
        timer: null,
        sustainOn: false,
        downAt: performance.now(),
      }
      pointerPadRef.current.set(e.pointerId, st)
      await ensureAudio()
      if (!pointerPadRef.current.has(e.pointerId)) return
      const kit = kitRef.current
      if (!kit?.ready) return
      if (isRecordingRef.current) {
        const tr = Tone.getTransport()
        recordEventsRef.current.push({
          type: 'down',
          tOffset: tr.seconds - recordStartSecRef.current,
          padRow: padPr,
          pc,
          v: g.voice,
          pointerId: e.pointerId,
        })
      }
      try {
        triggerShortDrumSynth(kit, padPr, pc, totalGridRows, totalGridCols, gridF0, Tone.now())
      } catch {
        /* */
      }
      spectrumPadHighlightRef.current.set(
        e.pointerId,
        computePadSpectrumHighlightBands(padPr, pc, totalGridRows, totalGridCols, gridF0, spectrumBandCountFromN(n)),
      )
      bumpPadGhost(padPr, pc)
      st.timer = window.setTimeout(() => {
        const cur = pointerPadRef.current.get(e.pointerId)
        if (!cur || cur !== st) return
        const k = kitRef.current
        if (!k?.ready) return
        crossToSustainSynthAt(k, st.padRow, st.pc, Tone.now())
        st.sustainOn = true
        longHoldVisualRef.current = true
        setLongHoldScreen(true)
        spectrumBoostUntilRef.current = Math.max(
          spectrumBoostUntilRef.current,
          performance.now() + 920,
        )
      }, LONG_PRESS_MS)
    },
    [liveMode, ensureAudio, bumpPadGhost, totalGridRows, totalGridCols, gridF0, crossToSustainSynthAt, n],
  )

  const padPointerUp = useCallback(
    (e) => {
      const st = pointerPadRef.current.get(e.pointerId)
      if (!st) return
      if (isRecordingRef.current) {
        const tr = Tone.getTransport()
        recordEventsRef.current.push({
          type: 'up',
          tOffset: tr.seconds - recordStartSecRef.current,
          padRow: st.padRow,
          pc: st.pc,
          v: st.v,
          pointerId: e.pointerId,
        })
      }
      if (st.timer) clearTimeout(st.timer)
      const k = kitRef.current
      if (k?.ready) {
        if (!st.sustainOn) {
          releaseShortDrumSynth(k, st.g.voice, Tone.now())
        } else {
          releaseLongSustainAt(k, st.g.voice, Tone.now())
          longHoldVisualRef.current = false
          setLongHoldScreen(false)
          spectrumBoostUntilRef.current = Math.max(
            spectrumBoostUntilRef.current,
            performance.now() + 1280,
          )
        }
      }
      pointerPadRef.current.delete(e.pointerId)
      spectrumPadHighlightRef.current.delete(e.pointerId)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* */
      }
    },
    [releaseLongSustainAt],
  )

  useEffect(() => {
    return () => {
      pointerPadRef.current.forEach((st) => {
        if (st.timer) clearTimeout(st.timer)
        const k = kitRef.current
        if (!k?.ready) return
        try {
          if (!st.sustainOn) {
            releaseShortDrumSynth(k, st.g.voice, Tone.now())
          } else {
            releaseLongSustainAt(k, st.g.voice, Tone.now())
          }
        } catch {
          /* */
        }
      })
      longHoldVisualRef.current = false
      spectrumPadHighlightRef.current.clear()
      pointerPadRef.current.clear()
    }
  }, [releaseLongSustainAt])

  const padRows = Math.max(0, n - 1)

  useEffect(() => {
    if (liveMode) return undefined
    lastTsRef.current = 0
    let rafId = 0
    let cancelled = false
    const loop = (ts) => {
      if (cancelled) return
      if (recordLoopActiveRef.current) {
        rafId = requestAnimationFrame(loop)
        return
      }
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      if (seqRunning && padRows > 0) {
        accumRef.current += dt
        let guard = 0
        while (accumRef.current >= stepMs && guard++ < 64) {
          accumRef.current -= stepMs
          const col = playheadColRef.current
          const pat = patternRef.current
          for (let padPr = 0; padPr < padRows; padPr++) {
            if (pat[padPr]?.[col]) {
              playVoice(undefined, padPr, col)
              bumpPadGhost(padPr, col)
            }
          }
          const next = (playheadColRef.current + 1) % n
          playheadColRef.current = next
          setPlayheadCol(next)
        }
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [liveMode, seqRunning, stepMs, n, padRows, playVoice, bumpPadGhost])

  const toggleStep = (padRow, pc) => {
    setPattern((prev) => {
      const next = prev.map((row) => [...row])
      next[padRow][pc] = !next[padRow][pc]
      return next
    })
  }

  const fallbackPad = palette[0] ?? '#888888'

  const displayRowBrightness = useMemo(
    () => 1 + Math.min(0.92, rmsNorm * 1.05),
    [rmsNorm],
  )

  /** 限制 filter 亮度；长按持续音时略提亮 */
  const screenFilterBrightness = useMemo(
    () =>
      Math.min(
        displayRowBrightness * (longHoldScreen ? 1.14 : 1),
        longHoldScreen ? 1.32 : 1.22,
      ),
    [displayRowBrightness, longHoldScreen],
  )

  /** 循环回放：playhead 列 + Transport 四分拍随机切换第一行底色（单 rAF） */
  useEffect(() => {
    if (!recordLoopActive || !toneReady) return undefined
    const quarterSec = 60 / SPECTRUM_LOOP_BPM
    let lastBeat = -1
    let raf = 0
    const tick = () => {
      const tr = Tone.getTransport()
      const dur = recordLoopDurationSecRef.current
      const tLoop = dur > 0 ? ((tr.seconds % dur) + dur) % dur : 0
      const col = dur > 0 ? Math.floor((tLoop / dur) * n) % n : 0
      setPlayheadCol(col)
      playheadColRef.current = col

      const cycle = quarterSec * 4
      const tBeat = ((tr.seconds % cycle) + cycle) % cycle
      const beat = Math.min(4, Math.floor(tBeat / quarterSec) + 1)
      if (beat !== lastBeat) {
        lastBeat = beat
        setScreenBase(pickScreenBaseColor(palette))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [recordLoopActive, toneReady, n, palette])

  useEffect(() => {
    return () => {
      if (playbackPartRef.current) {
        try {
          playbackPartRef.current.dispose()
        } catch {
          /* */
        }
        playbackPartRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!toneReady) return undefined
    const canvas = screenSpectrumCanvasRef.current
    if (!canvas) return undefined
    const parent = canvas.parentElement
    if (!parent) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.imageSmoothingEnabled = false

    let ro = null
    let raf = 0

    const resize = () => {
      const r = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const numCols = Math.max(1, n)
      const totalSub = numCols * LED_SUBPIXELS_PER_COL
      const wRaw = Math.max(1, Math.floor(r.width * dpr))
      const hRaw = Math.max(1, Math.floor(r.height * dpr))
      const w = Math.max(totalSub, Math.floor(wRaw / totalSub) * totalSub)
      const h = Math.max(LED_VERT_STEPS, Math.floor(hRaw / LED_VERT_STEPS) * LED_VERT_STEPS)
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }

    ro = new ResizeObserver(resize)
    ro.observe(parent)
    resize()

    const lastHeights = new Float32Array(48)
    let lastFrameMs = performance.now()
    let lastNumBands = -1

    const draw = () => {
      const kit = kitRef.current
      const fft = kit?.fftAnalyser?.getValue?.()
      const cw = canvas.width
      const ch = canvas.height
      const now = performance.now()
      const dtSec = Math.min(0.08, (now - lastFrameMs) / 1000)
      lastFrameMs = now

      if (cw > 0 && ch > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, cw, ch)

        const numBands = spectrumBandCountFromN(n)
        if (numBands !== lastNumBands) {
          lastHeights.fill(0)
          lastNumBands = numBands
        }

        const timeBoost = now < spectrumBoostUntilRef.current ? 1.5 : 1
        const holdBoost = longHoldVisualRef.current ? 1.9 : 1
        const boost = timeBoost * holdBoost

        const targets = new Float32Array(numBands)
        if (fft && fft.length > 0) {
          const sampleRate = Tone.context.sampleRate
          const fftSize = fft.length * 2
          const nyquist = sampleRate / 2
          const fMax = Math.min(SPEC_F_MAX, nyquist * 0.98)
          const edges = logFrequencyEdges(numBands, SPEC_F_MIN, fMax)
          for (let b = 0; b < numBands; b++) {
            const fLo = edges[b]
            const fHi = edges[b + 1]
            let k0 = Math.floor((fLo * fftSize) / sampleRate)
            let k1 = Math.ceil((fHi * fftSize) / sampleRate) - 1
            k0 = Math.max(0, Math.min(fft.length - 1, k0))
            k1 = Math.max(0, Math.min(fft.length - 1, k1))
            if (k1 < k0) k1 = k0
            let maxDb = -Infinity
            for (let k = k0; k <= k1; k++) {
              const v = fft[k]
              if (Number.isFinite(v)) maxDb = Math.max(maxDb, v)
            }
            if (maxDb === -Infinity) maxDb = -100
            targets[b] = Math.min(1, dbToGammaHeightNorm(maxDb) * boost)
          }
        }

        const highlighted = new Set()
        for (const h of spectrumPadHighlightRef.current.values()) {
          for (const b of h.bands) highlighted.add(b)
        }
        for (const b of highlighted) {
          if (b >= 0 && b < numBands) {
            targets[b] = Math.max(targets[b], PAD_SPECTRUM_BOOST_MIN)
          }
        }

        for (let b = 0; b < numBands; b++) {
          const tgt = fft && fft.length ? targets[b] : 0
          const prev = lastHeights[b]
          if (tgt > prev) {
            lastHeights[b] = tgt
          } else {
            lastHeights[b] = Math.max(tgt, prev - SPECTRUM_GRAVITY * dtSec)
          }
        }

        const numCols = Math.max(1, n)
        const totalSub = numCols * LED_SUBPIXELS_PER_COL
        const pixelWidth = cw / totalSub
        const pixelHeight = ch / LED_VERT_STEPS

        ctx.globalAlpha = 1
        ctx.fillStyle = '#FFFFFF'
        ctx.shadowBlur = 0

        for (let ix = 0; ix < totalSub; ix++) {
          // 非镜像：左->右单向映射（低频->高频）
          const t = (ix + 0.5) / totalSub
          const b = Math.min(numBands - 1, Math.floor(t * numBands))
          const effectiveNorm = lastHeights[b]
          const activeRows = Math.round(effectiveNorm * LED_VERT_STEPS)
          const drawRows = Math.min(Math.max(0, activeRows), LED_VERT_STEPS)

          for (let r = 0; r < drawRows; r++) {
            const x = Math.floor(ix * pixelWidth)
            const y = Math.floor(ch - (r + 1) * pixelHeight)
            ctx.fillRect(
              x,
              y,
              Math.ceil(pixelWidth),
              Math.ceil(pixelHeight),
            )
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      if (ro) ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [toneReady, n])

  return (
    <div
      className="relative z-20 flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-black text-white"
      style={{ fontFamily: fontStack }}
    >
      {/* 单一 N×N：第 1 行整行横跨 = 屏幕；第 2…N 行为 Pad */}
      <div
        className="grid min-h-0 flex-1 gap-0"
        style={{
          gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${n}, minmax(0, 1fr))`,
          minHeight: 0,
        }}
      >
        <div
          className="relative min-h-0"
          style={{
            gridColumn: '1 / -1',
            gridRow: 1,
          }}
        >
          <div
            role="presentation"
            className="absolute inset-0 cursor-pointer"
            style={{
              backgroundColor: screenBase,
              filter: `brightness(${screenFilterBrightness})`,
              transition:
                recordLoopActive
                  ? 'background-color 0.06s linear'
                  : 'filter 0.08s linear, background-color 0.06s linear',
            }}
            onMouseEnter={() => {
              if (isRecording || recordLoopActive) return
              setScreenBase(pickScreenBaseColor(palette))
            }}
            onPointerDown={handleScreenPointerDown}
            onPointerUp={handleScreenPointerUpOrCancel}
            onPointerCancel={handleScreenPointerUpOrCancel}
            aria-hidden
          />
          <canvas
            ref={screenSpectrumCanvasRef}
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
            aria-hidden
          />
          {/* 与 Rain 同款位置：左上角小 Logo；黑色，不拦截第一排点击 */}
          <div
            className="pointer-events-none absolute left-4 top-4 z-20 h-auto w-24"
            aria-hidden
          >
            <svg viewBox={STUDIO_LOGO_VIEWBOX} className="h-auto w-full">
              {STUDIO_LOGO_PATHS.map((d, i) => (
                <path key={i} fill="#000000" d={d} />
              ))}
            </svg>
          </div>
          {isRecording && (
            <div
              className="pointer-events-none absolute right-4 top-4 z-30 flex items-center justify-center"
              aria-hidden
              title="正在录制"
            >
              <span className="inline-block h-2.5 w-2.5 shrink-0 bg-red-600 animate-pulse" />
            </div>
          )}
        </div>

        {padRows > 0 &&
          Array.from({ length: padRows * n }, (_, i) => {
            const padPr = Math.floor(i / n)
            const pc = i % n
            const cell = padGrid[padPr]?.[pc]
            const base = cell?.color ?? fallbackPad
            const playheadFromSeq =
              (recordLoopActive && playheadCol === pc) ||
              (!liveMode && !recordLoopActive && playheadCol === pc)
            /** 录音与循环回放节拍改在第一行底色闪动，不再用 Pad 内边框 */
            const isPlayhead =
              playheadFromSeq && !isRecording && !recordLoopActive
            const active = pattern[padPr]?.[pc]
            const gridRow = padPr + 2

            return (
              <SynthPadButton
                key={`pad-${n}-${padPr}-${pc}`}
                baseColor={base}
                palette={palette}
                isPlayhead={isPlayhead}
                active={active}
                playheadActiveShadow={playheadActiveShadow}
                playheadIdleShadow={playheadIdleShadow}
                gridRow={gridRow}
                gridColumn={pc + 1}
                ghostToken={ghostEpoch[`${padPr}-${pc}`] ?? 0}
                onPointerDownAction={(e) => {
                  if (liveMode) void padPointerDown(e, padPr, pc)
                  else toggleStep(padPr, pc)
                }}
                onPointerUpAction={liveMode ? padPointerUp : undefined}
                onPointerCancelAction={liveMode ? padPointerUp : undefined}
              />
            )
          })}
      </div>
    </div>
  )
}
