/** Base frequency (Hz) for the lowest pad row — scale-invariant grid audio */
export const AUDIO_GRID_F0 = 110

/** Ghosting: CSS brightness peak 2×, decay duration (ms) */
export const AUDIO_GRID_GHOST_MS = 500

/**
 * Normalized column position in [0, 1] (scale-invariant).
 * @param {number} col - 0 … totalCols-1
 */
export function computeColNorm(col, totalCols) {
  if (totalCols <= 1) return 0.5
  return col / (totalCols - 1)
}

/**
 * Normalized row position among pad rows in [0, 1].
 * @param {number} padRow - 0 … padRows-1
 */
export function computeRowNorm(padRow, padRows) {
  if (padRows <= 1) return 0
  return padRow / (padRows - 1)
}

/**
 * Pitch (Hz) for a pad row. Y-axis = frequency.
 * - If totalGridRows > 8: chromatic ladder f_n = f0 · 2^(n/12), n = padRow.
 * - Else: same total span compressed — semitone index scales with rowNorm so top row matches the large-grid top.
 *
 * @param {number} padRow - 0 … padRows-1
 * @param {number} padRows - number of pad rows (grid rows − 1)
 * @param {number} totalGridRows - full grid N (includes display row)
 * @param {number} [f0=AUDIO_GRID_F0]
 */
export function computePitchHz(padRow, padRows, totalGridRows, f0 = AUDIO_GRID_F0) {
  if (padRows <= 0) return f0
  if (totalGridRows > 8) {
    return f0 * 2 ** (padRow / 12)
  }
  const spanSemitones = Math.max(0, padRows - 1)
  const n = computeRowNorm(padRow, padRows) * spanSemitones
  return f0 * 2 ** (n / 12)
}

/**
 * Column → stereo pan value in [-1, 1] for Tone.Panner
 */
export function computePanFromColNorm(colNorm) {
  return colNorm * 2 - 1
}

/**
 * Column → detune cents (spread) for synth voices
 */
export function computeDetuneCentsFromColNorm(colNorm) {
  return (colNorm - 0.5) * 48
}

/**
 * 忽略第 0 行（屏幕行）：用 pad 行索引在剩余行中均分为四段，对应 Kick / Snare / Hat / Synth。
 * Y 越高 playbackRate 越高（音高越高）。
 *
 * @param {number} padRow - 0 … padRows-1（仅打击垫行，不含屏幕行）
 * @param {number} col - 列 0 … totalCols-1
 * @param {number} totalRows - 整网总行数（含第 1 行屏幕）
 * @param {number} totalCols
 */
export function getSoundByGrid(padRow, col, totalRows, totalCols) {
  const padRows = Math.max(1, totalRows - 1)
  const span = padRows / 4
  const voice = Math.min(3, Math.floor(padRow / span))
  const rowNorm = padRows <= 1 ? 0.5 : padRow / (padRows - 1)
  const playbackRate = 0.7 + rowNorm * 0.58
  const colNorm = computeColNorm(col, totalCols)
  const velocity = 0.48 + colNorm * 0.5
  const hitNotes = ['C2', 'D2', 'F2', 'A2']
  return {
    voice,
    playbackRate,
    velocity,
    colNorm,
    rowNorm,
    hitNote: hitNotes[voice],
  }
}
