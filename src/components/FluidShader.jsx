import { useRef, useEffect } from 'react'

const VERTEX_SOURCE = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAGMENT_HEAD = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;

  vec3 hash33(vec3 p) {
    float n = sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453;
    return fract(vec3(n, n * 0.5 + 0.5, n * 0.25 + 0.75));
  }
  float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(dot(hash33(mod(i + vec3(0,0,0), 50.0)), f - vec3(0,0,0)),
              dot(hash33(mod(i + vec3(1,0,0), 50.0)), f - vec3(1,0,0)), f.x),
          mix(dot(hash33(mod(i + vec3(0,1,0), 50.0)), f - vec3(0,1,0)),
              dot(hash33(mod(i + vec3(1,1,0), 50.0)), f - vec3(1,1,0)), f.x), f.y),
      mix(mix(dot(hash33(mod(i + vec3(0,0,1), 50.0)), f - vec3(0,0,1)),
              dot(hash33(mod(i + vec3(1,0,1), 50.0)), f - vec3(1,0,1)), f.x),
          mix(dot(hash33(mod(i + vec3(0,1,1), 50.0)), f - vec3(0,1,1)),
              dot(hash33(mod(i + vec3(1,1,1), 50.0)), f - vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    float f = 1.0;
    for (int i = 0; i < 4; i++) {
      v += a * valueNoise3D(p * f);
      a *= 0.5;
      f *= 2.0;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 st = vec2(uv.x * aspect, uv.y);
    float flow = u_time * 0.12;
    vec3 samplePos = vec3(st * 1.85 + 0.5, flow);
    float n = fbm(samplePos);
    n = clamp(n, 0.0, 1.0);
    float t = n * n * (3.0 - 2.0 * n);
    vec3 darkCrimson = vec3(1.0, 0.435, 0.38);
    vec3 grapefruit = vec3(1.0, 0.38, 0.32);
    vec3 peachOrange = vec3(1.0, 0.7, 0.45);
    float t1 = smoothstep(0.0, 0.6, t);
    float t2 = smoothstep(0.25, 0.9, t);
    vec3 fluidColor = mix(
      mix(darkCrimson, grapefruit, t1),
      peachOrange,
      t2
    );

    float lineWidth = 0.008;
    float line = 0.0;
    for (int i = 0; i <= 20; i++) {
      float k = float(i) * 0.05;
      float d = abs(n - k);
      line = max(line, 1.0 - smoothstep(0.0, lineWidth, d));
    }
    float lineWidthMint = 0.003;
    float lineMint = 0.0;
    for (int i = 0; i <= 40; i++) {
      float k = float(i) * 0.025;
      float d = abs(n - k);
      lineMint = max(lineMint, 1.0 - smoothstep(0.0, lineWidthMint, d));
    }
    vec3 lineColor = vec3(1.0, 1.0, 0.98);
    vec3 mintColor = vec3(0.72, 1.0, 0.88);
    float glow = line * 0.5 + line;
    vec3 finalColor = mix(fluidColor, lineColor, min(glow, 1.0));
    finalColor = mix(finalColor, mintColor, lineMint * 0.55);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`

const FRAGMENT_SOURCE_WITH_FWIDTH = `
  #extension GL_OES_standard_derivatives : enable
` + FRAGMENT_HEAD.replace(
  'float lineWidth = 0.008;',
  `float dw = fwidth(n);
    float lineWidth = max(dw * 2.5, 0.004);
    float lineWidthMint = max(dw * 1.2, 0.002);`
).replace(
  'float lineWidthMint = 0.003;',
  ''
)

const FRAGMENT_SOURCE = FRAGMENT_HEAD

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile: ${log}`)
  }
  return shader
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    throw new Error('Program link failed')
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return program
}

export function FluidShaderCanvas({ paused = false }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const startTimeRef = useRef(null)
  const pausedRef = useRef(paused)
  const frozenTimeRef = useRef(0)
  pausedRef.current = paused

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { alpha: false, antialias: true })
    if (!gl) return

    const ext = gl.getExtension('OES_standard_derivatives')
    const fragmentSource = ext ? FRAGMENT_SOURCE_WITH_FWIDTH : FRAGMENT_SOURCE
    let program
    try {
      program = createProgram(gl, VERTEX_SOURCE, fragmentSource)
    } catch (e) {
      program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE)
    }
    const locResolution = gl.getUniformLocation(program, 'u_resolution')
    const locTime = gl.getUniformLocation(program, 'u_time')
    const locPosition = gl.getAttribLocation(program, 'a_position')

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      let w = Math.floor((canvas.clientWidth || window.innerWidth) * dpr)
      let h = Math.floor((canvas.clientHeight || window.innerHeight) * dpr)
      w = Math.max(1, w)
      h = Math.max(1, h)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }
    resize()
    window.addEventListener('resize', resize)
    const resizeCheck = setTimeout(resize, 100)

    const render = (now) => {
      if (pausedRef.current) {
        gl.useProgram(program)
        gl.uniform2f(locResolution, canvas.width, canvas.height)
        gl.uniform1f(locTime, frozenTimeRef.current)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.enableVertexAttribArray(locPosition)
        gl.vertexAttribPointer(locPosition, 2, gl.FLOAT, false, 0, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        rafRef.current = requestAnimationFrame(render)
        return
      }
      if (!startTimeRef.current) startTimeRef.current = now
      const time = (now - startTimeRef.current) / 1000
      frozenTimeRef.current = time
      gl.useProgram(program)
      gl.uniform2f(locResolution, canvas.width, canvas.height)
      gl.uniform1f(locTime, time)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(locPosition)
      gl.vertexAttribPointer(locPosition, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      rafRef.current = requestAnimationFrame(render)
    }
    rafRef.current = requestAnimationFrame(render)

    return () => {
      clearTimeout(resizeCheck)
      window.removeEventListener('resize', resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block"
      style={{ display: 'block' }}
    />
  )
}
