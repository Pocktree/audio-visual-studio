import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/** 相对满刻度 0 dBFS 的告警阈值（振幅超过此值视为接近削波） */
export const CLIP_THRESHOLD_DB = -0.5

/** CLIP_THRESHOLD_DB 对应的线性峰值 |sample| */
export const CLIP_THRESHOLD_LINEAR = 10 ** (CLIP_THRESHOLD_DB / 20)

const DEFAULT_FFT_SIZE = 2048
const NOISE_LOOP_SEC = 2

/**
 * Paul Kellet 近似粉红噪声（写入 buffer 首声道）
 * @see http://www.firstpr.com.au/dsp/pink-noise/
 */
function fillPinkNoiseChannel(data) {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  const n = data.length
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
    b6 = white * 0.115926
    data[i] = out * 0.11
  }
}

function createWhiteNoiseBuffer(audioContext) {
  const rate = audioContext.sampleRate
  const length = Math.floor(rate * NOISE_LOOP_SEC)
  const buffer = audioContext.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

function createPinkNoiseBuffer(audioContext) {
  const rate = audioContext.sampleRate
  const length = Math.floor(rate * NOISE_LOOP_SEC)
  const buffer = audioContext.createBuffer(1, length, rate)
  fillPinkNoiseChannel(buffer.getChannelData(0))
  return buffer
}

/** 棕噪声（brown / red）：泄漏积分白噪，~1/f²，再峰值归一化 */
function createBrownNoiseBuffer(audioContext) {
  const rate = audioContext.sampleRate
  const length = Math.floor(rate * NOISE_LOOP_SEC)
  const buffer = audioContext.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  let brown = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    brown = brown * 0.985 + white * 0.06
    data[i] = brown
  }
  let peak = 0
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(data[i]))
  }
  if (peak > 1e-8) {
    const scale = 0.5 / peak
    for (let i = 0; i < length; i++) {
      data[i] *= scale
    }
  }
  return buffer
}

/**
 * Web Audio API 音频测试引擎：白/粉/棕噪声、Analyser（FFT + 音量）、削波检测、麦克风分析。
 */
export function useAudioEngine() {
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const masterGainRef = useRef(null)
  const noiseGainRef = useRef(null)
  const micGainRef = useRef(null)
  const whiteBufferRef = useRef(null)
  const pinkBufferRef = useRef(null)
  const brownBufferRef = useRef(null)
  const whiteSourceRef = useRef(null)
  const pinkSourceRef = useRef(null)
  const brownSourceRef = useRef(null)
  const micSourceRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const synthGainRef = useRef(null)
  /** @type {{ current: OscillatorNode[] }} */
  const synthOscillatorsRef = useRef([])

  const floatTimeDataRef = useRef(null)
  const floatFreqDataRef = useRef(null)
  /** master → filter → analyser；水下模式时切低通 */
  const masterFilterRef = useRef(null)

  const ensureContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) {
      throw new Error('Web Audio API is not supported in this environment')
    }
    const ctx = new Ctx()
    audioContextRef.current = ctx

    const master = ctx.createGain()
    master.gain.value = 0.85
    masterGainRef.current = master

    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.2
    noiseGainRef.current = noiseGain

    const micGain = ctx.createGain()
    micGain.gain.value = 1
    micGainRef.current = micGain

    const analyser = ctx.createAnalyser()
    analyser.fftSize = DEFAULT_FFT_SIZE
    analyser.smoothingTimeConstant = 0.65
    analyser.minDecibels = -100
    analyser.maxDecibels = -5
    analyserRef.current = analyser

    noiseGain.connect(master)
    micGain.connect(master)

    const synthGain = ctx.createGain()
    synthGain.gain.value = 0.055
    synthGainRef.current = synthGain
    synthGain.connect(master)

    const masterFilter = ctx.createBiquadFilter()
    masterFilter.type = 'lowpass'
    masterFilter.frequency.value = 20000
    masterFilter.Q.value = 0.707
    masterFilterRef.current = masterFilter

    master.connect(masterFilter)
    masterFilter.connect(analyser)
    analyser.connect(ctx.destination)

    whiteBufferRef.current = createWhiteNoiseBuffer(ctx)
    pinkBufferRef.current = createPinkNoiseBuffer(ctx)
    brownBufferRef.current = createBrownNoiseBuffer(ctx)

    floatTimeDataRef.current = new Float32Array(analyser.fftSize)
    floatFreqDataRef.current = new Float32Array(analyser.frequencyBinCount)

    return ctx
  }, [])

  const stopNoiseSources = useCallback(() => {
    if (whiteSourceRef.current) {
      try {
        whiteSourceRef.current.stop()
        whiteSourceRef.current.disconnect()
      } catch {
        /* already stopped */
      }
      whiteSourceRef.current = null
    }
    if (pinkSourceRef.current) {
      try {
        pinkSourceRef.current.stop()
        pinkSourceRef.current.disconnect()
      } catch {
        /* already stopped */
      }
      pinkSourceRef.current = null
    }
    if (brownSourceRef.current) {
      try {
        brownSourceRef.current.stop()
        brownSourceRef.current.disconnect()
      } catch {
        /* already stopped */
      }
      brownSourceRef.current = null
    }
  }, [])

  const startWhiteNoise = useCallback(
    async (gain = 0.2, playbackRate = 1) => {
      const ctx = ensureContext()
      if (ctx.state === 'suspended') await ctx.resume()
      stopNoiseSources()
      const src = ctx.createBufferSource()
      src.buffer = whiteBufferRef.current
      src.loop = true
      src.playbackRate.value = Math.max(0.0625, Math.min(4, playbackRate))
      noiseGainRef.current.gain.value = gain
      src.connect(noiseGainRef.current)
      src.start(0)
      whiteSourceRef.current = src
    },
    [ensureContext, stopNoiseSources],
  )

  const startPinkNoise = useCallback(
    async (gain = 0.2, playbackRate = 1) => {
      const ctx = ensureContext()
      if (ctx.state === 'suspended') await ctx.resume()
      stopNoiseSources()
      const src = ctx.createBufferSource()
      src.buffer = pinkBufferRef.current
      src.loop = true
      src.playbackRate.value = Math.max(0.0625, Math.min(4, playbackRate))
      noiseGainRef.current.gain.value = gain
      src.connect(noiseGainRef.current)
      src.start(0)
      pinkSourceRef.current = src
    },
    [ensureContext, stopNoiseSources],
  )

  const startBrownNoise = useCallback(
    async (gain = 0.2, playbackRate = 1) => {
      const ctx = ensureContext()
      if (ctx.state === 'suspended') await ctx.resume()
      stopNoiseSources()
      const src = ctx.createBufferSource()
      src.buffer = brownBufferRef.current
      src.loop = true
      src.playbackRate.value = Math.max(0.0625, Math.min(4, playbackRate))
      noiseGainRef.current.gain.value = gain
      src.connect(noiseGainRef.current)
      src.start(0)
      brownSourceRef.current = src
    },
    [ensureContext, stopNoiseSources],
  )

  const setNoisePlaybackRate = useCallback((rate) => {
    const r = Math.max(0.0625, Math.min(4, rate))
    if (whiteSourceRef.current) {
      whiteSourceRef.current.playbackRate.value = r
    }
    if (pinkSourceRef.current) {
      pinkSourceRef.current.playbackRate.value = r
    }
    if (brownSourceRef.current) {
      brownSourceRef.current.playbackRate.value = r
    }
  }, [])

  const stopNoise = useCallback(() => {
    stopNoiseSources()
  }, [stopNoiseSources])

  const disconnectMicrophone = useCallback(() => {
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect()
      } catch {
        /* */
      }
      micSourceRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const connectMicrophone = useCallback(
    async (constraints) => {
      const ctx = ensureContext()
      if (ctx.state === 'suspended') await ctx.resume()
      disconnectMicrophone()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints === undefined ? true : constraints,
      })
      mediaStreamRef.current = stream
      const src = ctx.createMediaStreamSource(stream)
      micSourceRef.current = src
      src.connect(micGainRef.current)
    },
    [ensureContext, disconnectMicrophone],
  )

  const getAnalyser = useCallback(() => analyserRef.current, [])

  /**
   * 写入 FFT 幅值数据（Float32，单位 dB，通常为负值）
   * @param {Float32Array} [out] 可选复用缓冲区；默认使用内部缓冲区并返回
   */
  const getFloatFrequencyData = useCallback((out) => {
    const analyser = analyserRef.current
    if (!analyser) return null
    const buf =
      out && out.length >= analyser.frequencyBinCount
        ? out
        : floatFreqDataRef.current &&
            floatFreqDataRef.current.length === analyser.frequencyBinCount
          ? floatFreqDataRef.current
          : new Float32Array(analyser.frequencyBinCount)
    if (!out) floatFreqDataRef.current = buf
    analyser.getFloatFrequencyData(buf)
    return buf
  }, [])

  /**
   * 时域波形（Float32，约 -1～1）
   */
  const getFloatTimeDomainData = useCallback((out) => {
    const analyser = analyserRef.current
    if (!analyser) return null
    const buf =
      out && out.length >= analyser.fftSize
        ? out
        : floatTimeDataRef.current && floatTimeDataRef.current.length === analyser.fftSize
          ? floatTimeDataRef.current
          : new Float32Array(analyser.fftSize)
    if (!out) floatTimeDataRef.current = buf
    analyser.getFloatTimeDomainData(buf)
    return buf
  }, [])

  /**
   * 当前 RMS 音量（线性 0～1，近似）
   */
  const getVolume = useCallback(() => {
    const buf = getFloatTimeDomainData()
    if (!buf || !buf.length) return 0
    let sum = 0
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i]
      sum += s * s
    }
    return Math.sqrt(sum / buf.length)
  }, [getFloatTimeDomainData])

  /**
   * 当任一样本峰值超过 -0.5 dBFS（线性约 0.944）时返回 true，表示接近削波。
   */
  const checkClipping = useCallback(() => {
    const buf = getFloatTimeDomainData()
    if (!buf || !buf.length) return false
    const th = CLIP_THRESHOLD_LINEAR
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i])
      if (a >= th) return true
    }
    return false
  }, [getFloatTimeDomainData])

  const setMasterGain = useCallback((value) => {
    if (masterGainRef.current) masterGainRef.current.gain.value = value
  }, [])

  const setNoiseGain = useCallback((value) => {
    if (noiseGainRef.current) noiseGainRef.current.gain.value = value
  }, [])

  const setSynthGain = useCallback((value) => {
    if (synthGainRef.current) synthGainRef.current.gain.value = value
  }, [])

  const setMicGain = useCallback((value) => {
    if (micGainRef.current) micGainRef.current.gain.value = value
  }, [])

  /**
   * 水蓝视觉联动：true 时主总线低通（「水下」），false 时恢复宽频。
   * @param {boolean} underwater
   */
  const setUnderwaterMuffling = useCallback((underwater) => {
    const ctx = audioContextRef.current
    const f = masterFilterRef.current
    if (!ctx || !f) return
    const t = ctx.currentTime
    if (underwater) {
      f.type = 'lowpass'
      f.frequency.cancelScheduledValues(t)
      f.frequency.setTargetAtTime(920, t, 0.06)
      f.Q.setTargetAtTime(0.88, t, 0.06)
    } else {
      f.frequency.setTargetAtTime(20000, t, 0.08)
      f.Q.setTargetAtTime(0.707, t, 0.08)
    }
  }, [])

  /**
   * 直接设置主低通滤波器截止频率（Hz）。
   * STUDIO 模块用它跟随流体 Shader 活跃度动态调制滤波。
   */
  const setMasterFilterFrequency = useCallback((freqHz) => {
    const ctx = audioContextRef.current
    const f = masterFilterRef.current
    if (!ctx || !f) return
    const clamped = Math.max(20, Math.min(20000, freqHz))
    const t = ctx.currentTime
    f.frequency.cancelScheduledValues(t)
    f.frequency.setTargetAtTime(clamped, t, 0.05)
  }, [])

  const stopSynthOscillators = useCallback(() => {
    const list = synthOscillatorsRef.current
    for (let i = 0; i < list.length; i++) {
      try {
        list[i].stop()
        list[i].disconnect()
      } catch {
        /* */
      }
    }
    synthOscillatorsRef.current = []
  }, [])

  /**
   * 压力测试联动：振荡器数量 ↑ → 音色更「满」、谐波更密（1～maxOsc）。
   * @param {number} count 振荡器个数
   * @param {number} [maxOsc=24] 上限
   */
  const setSynthOscillatorCount = useCallback(
    (count, maxOsc = 24) => {
      const ctx = audioContextRef.current
      if (!ctx || !synthGainRef.current) return
      stopSynthOscillators()
      const n = Math.max(0, Math.min(maxOsc, Math.floor(count)))
      if (n === 0) return
      const types = ['sine', 'triangle', 'sawtooth']
      const baseHz = 55
      for (let i = 0; i < n; i++) {
        const osc = ctx.createOscillator()
        osc.type = types[i % types.length]
        const detune = (i * 7.3 + (i % 5) * 2.1) % 31
        osc.frequency.value = baseHz * (1 + i * 0.62) + detune * 0.15
        osc.connect(synthGainRef.current)
        try {
          osc.start(0)
        } catch {
          /* */
        }
        synthOscillatorsRef.current.push(osc)
      }
    },
    [stopSynthOscillators],
  )

  const close = useCallback(async () => {
    stopNoiseSources()
    stopSynthOscillators()
    disconnectMicrophone()
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch {
        /* */
      }
      audioContextRef.current = null
    }
    analyserRef.current = null
    masterGainRef.current = null
    noiseGainRef.current = null
    micGainRef.current = null
    synthGainRef.current = null
    masterFilterRef.current = null
    whiteBufferRef.current = null
    pinkBufferRef.current = null
    brownBufferRef.current = null
    floatTimeDataRef.current = null
    floatFreqDataRef.current = null
  }, [stopNoiseSources, stopSynthOscillators, disconnectMicrophone])

  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    return () => {
      void closeRef.current()
    }
  }, [])

  return {
    ensureContext,
    getAudioContext: () => audioContextRef.current,
    getAnalyser,
    startWhiteNoise,
    startPinkNoise,
    startBrownNoise,
    stopNoise,
    setNoisePlaybackRate,
    connectMicrophone,
    disconnectMicrophone,
    getFloatFrequencyData,
    getFloatTimeDomainData,
    getVolume,
    checkClipping,
    setMasterGain,
    setNoiseGain,
    setSynthGain,
    setMicGain,
    setUnderwaterMuffling,
    setMasterFilterFrequency,
    setSynthOscillatorCount,
    stopSynthOscillators,
    close,
    /** 与 checkClipping 使用相同阈值，便于单测或外部使用 */
    clipThresholdLinear: CLIP_THRESHOLD_LINEAR,
  }
}
