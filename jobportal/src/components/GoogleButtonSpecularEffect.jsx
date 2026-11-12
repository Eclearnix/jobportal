import { useEffect, useRef } from 'react'
import './GoogleButtonSpecularEffect.css'

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}

float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`

const UNIFORMS = [
  'uCenter',
  'uHalf',
  'uRadius',
  'uPx',
  'uSpot',
  'uEntry',
  'uLineColor',
  'uBaseColor',
  'uIntensity',
  'uWindow',
  'uThickness',
  'uGlow'
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const wrap = (value) => value - Math.floor(value)

function loopPosition(x, y, halfX, halfY, radius) {
  const innerX = halfX - radius
  const innerY = halfY - radius
  const arc = (Math.PI / 2) * radius
  const quarter = innerX + innerY + arc
  const absX = Math.abs(x)
  const absY = Math.abs(y)
  const qx = absX - innerX
  const qy = absY - innerY
  let distance
  if (qx > 0 && qy > 0) distance = innerY + Math.atan2(qy, qx) * radius
  else if (qx > qy) distance = Math.min(absY, innerY)
  else distance = innerY + arc + innerX - Math.min(absX, innerX)
  if (x < 0) distance = y >= 0 ? 2 * quarter - distance : 2 * quarter + distance
  else if (y < 0) distance = 4 * quarter - distance
  return wrap(distance / Math.max(4 * quarter, 0.0001))
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    if (program) gl.deleteProgram(program)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.bindAttribLocation(program, 0, 'aPosition')
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return null
}

function parseColor(gl, value) {
  const canvas = gl.canvas.ownerDocument.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return [1, 1, 1]
  context.fillStyle = value
  const resolved = context.fillStyle
  if (!resolved.startsWith('#')) return [1, 1, 1]
  const color = Number.parseInt(resolved.slice(1), 16)
  return [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]
}

export default function GoogleButtonSpecularEffect({ targetContainerRef, disabled }) {
  const canvasRef = useRef(null)
  const disabledRef = useRef(disabled)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    const container = targetContainerRef.current
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    })
    if (!container || !canvas || !gl) return undefined

    const program = createProgram(gl)
    if (!program) return undefined

    const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
    const buffer = gl.createBuffer()
    const vao = gl.createVertexArray()
    if (!buffer || !vao) {
      if (buffer) gl.deleteBuffer(buffer)
      if (vao) gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      return undefined
    }

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    const effectStyle = window.getComputedStyle(canvas)
    const getSetting = (name, fallback) => {
      const value = Number.parseFloat(effectStyle.getPropertyValue(name))
      return Number.isFinite(value) ? value : fallback
    }
    const settings = {
      intensity: getSetting('--google-shine-intensity', 0.9),
      idleIntensity: getSetting('--google-shine-idle-intensity', 0.2),
      pressIntensity: getSetting('--google-shine-press-intensity', 0.7),
      size: getSetting('--google-shine-size', 10),
      fade: getSetting('--google-shine-fade', 34),
      thickness: getSetting('--google-shine-thickness', 1.2),
      glow: getSetting('--google-shine-glow', 0.8),
      colors: {
        line: parseColor(gl, effectStyle.getPropertyValue('--google-shine-color').trim() || '#6ee7b7'),
        base: parseColor(gl, effectStyle.getPropertyValue('--google-shine-base-color').trim() || '#34d399')
      }
    }
    const view = { width: 1, height: 1, ratio: 1, left: 0, top: 0 }
    const pointer = { x: 0, y: 0, known: false, overTarget: false }
    const state = { spot: 0, level: 0, press: 0, ready: false }
    const targetRef = { current: null }
    const raf = { current: 0 }
    const last = { current: 0 }
    const visible = { current: true }

    const cornerRadius = () => Math.min(7, view.width / 2, view.height / 2)

    const restSpot = () => {
      const radius = cornerRadius()
      const inset = radius * (1 - Math.SQRT1_2)
      return loopPosition(inset - view.width / 2, view.height / 2 - inset, view.width / 2, view.height / 2, radius)
    }

    const aim = () => {
      if (!pointer.known || disabledRef.current) return null
      const rect = targetRef.current.getBoundingClientRect()
      const scale = rect.width / view.width || 1
      const halfX = view.width / 2
      const halfY = view.height / 2
      const x = (pointer.x - rect.left - rect.width / 2) / scale
      const y = (rect.top + rect.height / 2 - pointer.y) / scale
      const distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0))
      const near = clamp(1 - distance / 160, 0, 1)
      const nearest = loopPosition(x, y, halfX, halfY, cornerRadius())
      if (distance > 0) return { spot: nearest, near: near * near * (3 - 2 * near) }
      const depth = clamp(Math.min(halfX - Math.abs(x), halfY - Math.abs(y)) / (halfY * 0.8), 0, 1)
      const sway = restSpot() - (x / halfX) * 0.06 - (y / halfY) * 0.02
      const offset = sway - nearest - Math.round(sway - nearest)
      return { spot: wrap(nearest + offset * depth * depth * (3 - 2 * depth)), near: 1 }
    }

    const draw = () => {
      if (!targetRef.current || !state.ready) return
      const { width, height, ratio } = view
      const scaleX = canvas.width / width
      const scaleY = canvas.height / height
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform2f(uniforms.uCenter, width / 2 * scaleX, height / 2 * scaleY)
      gl.uniform2f(uniforms.uHalf, width / 2 * scaleX, height / 2 * scaleY)
      gl.uniform1f(uniforms.uRadius, cornerRadius() * scaleX)
      gl.uniform1f(uniforms.uPx, ratio)
      gl.uniform1f(uniforms.uSpot, state.spot)
      gl.uniform2f(uniforms.uEntry, 0, 0)
      gl.uniform3fv(uniforms.uLineColor, settings.colors.line)
      gl.uniform3fv(uniforms.uBaseColor, settings.colors.base)
      gl.uniform1f(uniforms.uIntensity, disabledRef.current ? 0 : settings.intensity * state.level + state.press * settings.pressIntensity)
      gl.uniform2f(uniforms.uWindow, settings.size / 360 + state.press * 0.06, settings.fade / 360 + 0.0001)
      gl.uniform1f(uniforms.uThickness, settings.thickness)
      gl.uniform1f(uniforms.uGlow, settings.glow)
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
    }

    const frame = (now) => {
      raf.current = 0
      if (!visible.current || !targetRef.current) return
      const dt = last.current ? Math.min(0.05, (now - last.current) / 1000) : 1 / 60
      last.current = now
      const targetSpot = pointer.overTarget && !disabledRef.current
        ? { spot: wrap(now * 0.00012), near: 1 }
        : aim()
      const desiredLevel = disabledRef.current ? 0 : settings.idleIntensity + (1 - settings.idleIntensity) * (targetSpot?.near ?? 0)
      if (!state.ready) {
        state.spot = restSpot()
        state.level = settings.idleIntensity
        state.ready = true
      }
      let difference = 0
      difference = (targetSpot?.spot ?? restSpot()) - state.spot
      difference -= Math.round(difference)
      state.spot = wrap(state.spot + difference * (1 - Math.exp(-dt * 8)))
      state.level += (desiredLevel - state.level) * (1 - Math.exp(-dt * 7))
      state.press *= Math.exp(-dt * 5)
      draw()
      const settling = Math.abs(difference) > 0.0002 || Math.abs(desiredLevel - state.level) > 0.001 || state.press > 0.002
      if (settling) raf.current = requestAnimationFrame(frame)
      else last.current = 0
    }

    const wake = () => {
      if (!raf.current && visible.current) raf.current = requestAnimationFrame(frame)
    }

    const measure = () => {
      if (!targetRef.current) return
      const targetRect = targetRef.current.getBoundingClientRect()
      const overlayRoot = canvas.offsetParent || container
      const containerRect = overlayRoot.getBoundingClientRect()
      const cssScale = targetRect.width / targetRef.current.offsetWidth || 1
      view.width = Math.max(1, targetRect.width / cssScale)
      view.height = Math.max(1, targetRect.height / cssScale)
      view.left = (targetRect.left - containerRect.left) / cssScale
      view.top = (targetRect.top - containerRect.top) / cssScale
      view.ratio = Math.min(window.devicePixelRatio || 1, 3)
      canvas.style.width = `${view.width}px`
      canvas.style.height = `${view.height}px`
      canvas.style.left = `${view.left}px`
      canvas.style.top = `${view.top}px`
      canvas.width = Math.max(1, Math.round(view.width * view.ratio))
      canvas.height = Math.max(1, Math.round(view.height * view.ratio))
      if (state.ready) draw()
      wake()
    }

    const onPointerMove = (event) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.known = true
      wake()
    }
    const onPointerLeave = () => {
      pointer.known = false
      pointer.overTarget = false
      wake()
    }
    const onTargetEnter = () => {
      pointer.overTarget = true
      pointer.known = true
      wake()
    }
    const onPointerDown = () => {
      if (!disabledRef.current) state.press = 1
      wake()
    }
    const onPointerEnd = (event) => {
      if (event.pointerType !== 'mouse') onPointerLeave()
    }

    const resizeObserver = new ResizeObserver(measure)
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible.current = entries.some((entry) => entry.isIntersecting)
      if (visible.current) {
        last.current = 0
        wake()
      } else {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      }
    })
    const observedTarget = { current: null }
    const syncTarget = () => {
      const button = container.querySelector('[role="button"]')
      const frame = Array.from(container.querySelectorAll('iframe')).find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      const nextTarget = button || frame
      if (nextTarget === observedTarget.current) return
      if (observedTarget.current) {
        resizeObserver.unobserve(observedTarget.current)
        intersectionObserver.unobserve(observedTarget.current)
        observedTarget.current.removeEventListener('pointerdown', onPointerDown)
        observedTarget.current.removeEventListener('pointerenter', onTargetEnter)
        observedTarget.current.removeEventListener('pointerleave', onPointerLeave)
      }
      pointer.overTarget = false
      observedTarget.current = nextTarget
      targetRef.current = nextTarget
      if (!targetRef.current) return
      resizeObserver.observe(targetRef.current)
      intersectionObserver.observe(targetRef.current)
      targetRef.current.addEventListener('pointerdown', onPointerDown)
      targetRef.current.addEventListener('pointerenter', onTargetEnter)
      targetRef.current.addEventListener('pointerleave', onPointerLeave)
      measure()
    }
    const mutationObserver = new MutationObserver(syncTarget)
    mutationObserver.observe(container, { childList: true, subtree: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerEnd, { passive: true })
    window.addEventListener('pointercancel', onPointerEnd, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)
    syncTarget()

    return () => {
      cancelAnimationFrame(raf.current)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      if (observedTarget.current) {
        observedTarget.current.removeEventListener('pointerdown', onPointerDown)
        observedTarget.current.removeEventListener('pointerenter', onTargetEnter)
        observedTarget.current.removeEventListener('pointerleave', onPointerLeave)
      }
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
    }
  }, [targetContainerRef])

  return <canvas ref={canvasRef} className="google-specular-effect" aria-hidden="true" />
}
