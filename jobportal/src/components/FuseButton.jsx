import { useEffect, useId, useRef, useState } from 'react'
import { Archive, Check, Undo2 } from 'lucide-react'
import './FuseButton.css'

const lineFrames = [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }]
const outlineFrames = [{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }]
const sizes = {
  sm: { height: 36, font: 13, icon: 14, padding: 12 },
  md: { height: 44, font: 14, icon: 15, padding: 20 },
  lg: { height: 52, font: 15, icon: 17, padding: 24 },
}

export default function FuseButton({
  label = 'Archive',
  doneLabel = 'Archived',
  undoLabel = 'Undo',
  color = '#f5f5f5',
  background = '#27272a',
  fuseColor = '#f5a524',
  size = 'md',
  radius = 22,
  undoWindow = 4000,
  fuse = 'outline',
  fuseThickness = 1.5,
  crossfadeMs = 200,
  commitOn = 'press',
  pauseOnHover = true,
  settle = 'reset',
  disabled = false,
  onCommit,
  onUndo,
  onFuseEnd,
  onPhaseChange,
  className = '',
}) {
  const [phase, setPhase] = useState('idle')
  const [instant, setInstant] = useState(false)
  const rootRef = useRef(null)
  const idleRef = useRef(null)
  const undoRef = useRef(null)
  const lineRef = useRef(null)
  const rimRef = useRef(null)
  const animationRef = useRef(null)
  const pauseRef = useRef({ hover: false, hidden: false, canHoverPause: false })
  const lastInputRef = useRef('pointer')
  const windowRef = useRef(undoWindow)
  const latestRef = useRef({})
  const statusId = useId()
  const preset = sizes[size] || sizes.md

  useEffect(() => {
    latestRef.current = { onCommit, onUndo, onFuseEnd, onPhaseChange, commitOn, settle }
  }, [onCommit, onUndo, onFuseEnd, onPhaseChange, commitOn, settle])

  function changePhase(next) {
    setInstant(lastInputRef.current === 'keyboard')
    setPhase(next)
    latestRef.current.onPhaseChange?.(next)
  }

  function syncPlayState() {
    const animation = animationRef.current
    if (!animation) return
    const { hover, hidden } = pauseRef.current
    if (hover || hidden) {
      if (animation.playState === 'running') animation.pause()
    } else if (animation.playState === 'paused') {
      animation.play()
    }
  }

  function light(from = 0) {
    const element = fuse === 'outline' ? rimRef.current : lineRef.current
    if (!element) return
    animationRef.current?.cancel()
    const animation = element.animate(fuse === 'outline' ? outlineFrames : lineFrames, {
      duration: windowRef.current,
      easing: 'linear',
      fill: 'forwards',
    })
    if (from) animation.currentTime = from
    animation.onfinish = () => {
      const callbacks = latestRef.current
      callbacks.onFuseEnd?.()
      if (callbacks.commitOn === 'fuseEnd') callbacks.onCommit?.('fuseEnd')
      lastInputRef.current = 'pointer'
      changePhase(callbacks.settle === 'stay' ? 'settled' : 'idle')
    }
    animationRef.current = animation
    syncPlayState()
  }

  function arm() {
    if (disabled || phase !== 'idle') return
    windowRef.current = undoWindow
    light()
    pauseRef.current.canHoverPause = false
    pauseRef.current.hover = false
    if (commitOn === 'press') onCommit?.('press')
    changePhase('armed')
  }

  function undo() {
    if (phase !== 'armed') return
    if (animationRef.current) {
      animationRef.current.onfinish = null
      animationRef.current.cancel()
    }
    onUndo?.()
    changePhase('idle')
  }

  useEffect(() => {
    const inside = rootRef.current?.contains(document.activeElement)
    if (phase === 'armed') undoRef.current?.focus({ preventScroll: true })
    else if (inside) (phase === 'idle' ? idleRef.current : rootRef.current)?.focus({ preventScroll: true })
  }, [phase])

  useEffect(() => {
    const onVisibilityChange = () => {
      pauseRef.current.hidden = document.hidden
      syncPlayState()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      animationRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (pauseOnHover) return
    pauseRef.current.hover = false
    syncPlayState()
  }, [pauseOnHover])

  function release() {
    if (rootRef.current) delete rootRef.current.dataset.pressed
  }

  function handlePointerEnter(event) {
    if (pauseOnHover && event.pointerType === 'mouse' && pauseRef.current.canHoverPause) {
      pauseRef.current.hover = true
      syncPlayState()
    }
  }

  function handlePointerLeave(event) {
    release()
    if (event.pointerType !== 'mouse') return
    pauseRef.current.canHoverPause = true
    pauseRef.current.hover = false
    syncPlayState()
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') lastInputRef.current = 'keyboard'
    if (event.key === 'Escape' && phase === 'armed') {
      event.preventDefault()
      lastInputRef.current = 'keyboard'
      undo()
    }
  }

  return (
    <span
      ref={rootRef}
      tabIndex={-1}
      className={`fuse-button${className ? ` ${className}` : ''}`}
      data-phase={phase}
      data-fuse={fuse}
      data-instant={instant ? '' : undefined}
      aria-disabled={phase === 'settled' || undefined}
      style={{
        '--fb-ink': color,
        '--fb-bg': background,
        '--fb-fuse': fuseColor,
        '--fb-fuse-h': `${fuseThickness}px`,
        '--fb-radius': `${radius}px`,
        '--fb-fade': `${crossfadeMs}ms`,
        '--fb-h': `${preset.height}px`,
        '--fb-fs': `${preset.font}px`,
        '--fb-icon': `${preset.icon}px`,
        '--fb-px': `${preset.padding}px`,
      }}
      onPointerDown={(event) => {
        lastInputRef.current = 'pointer'
        const pressable = phase === 'armed' || (phase === 'idle' && !disabled)
        if (event.button === 0 && pressable && rootRef.current) rootRef.current.dataset.pressed = ''
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={idleRef}
        type="button"
        className="fuse-button__face fuse-button__idle"
        disabled={disabled}
        inert={phase !== 'idle'}
        onClick={arm}
      >
        <span className="fuse-button__icon" aria-hidden="true"><Archive /></span>
        {label}
      </button>
      <button
        ref={undoRef}
        type="button"
        className="fuse-button__face fuse-button__undo"
        aria-describedby={statusId}
        aria-keyshortcuts="Escape"
        inert={phase !== 'armed'}
        onClick={undo}
      >
        <span className="fuse-button__icon fuse-button__icon--undo" aria-hidden="true"><Undo2 /></span>
        {undoLabel}
        {fuse !== 'outline' && <i ref={lineRef} className="fuse-button__fuse" aria-hidden="true" />}
      </button>
      <span className="fuse-button__face fuse-button__settled" inert={phase !== 'settled'}>
        <span className="fuse-button__icon" aria-hidden="true"><Check /></span>
        {doneLabel}
      </span>
      {fuse === 'outline' && <svg className="fuse-button__rim" aria-hidden="true"><rect ref={rimRef} pathLength="1" /></svg>}
      <span className="fuse-button__status" id={statusId} role="status" aria-live="polite">
        {phase === 'idle' ? '' : doneLabel}
      </span>
    </span>
  )
}
