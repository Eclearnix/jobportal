import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { gsap } from 'gsap'
import './StaggeredMenu.css'

export default function StaggeredMenu({
  trigger,
  items = [],
  colors = ['var(--blue-100)', 'var(--blue-700)'],
  position = 'right',
  displayItemNumbering = true,
  className = '',
  accentColor = 'var(--blue-700)',
  closeOnClickAway = true,
  onMenuOpen,
  onMenuClose,
}) {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const initializedRef = useRef(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const layerRefs = useRef([])
  const animationRef = useRef(null)
  const panelId = useId()

  const closeMenu = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    onMenuClose?.()
  }, [onMenuClose])

  const toggleMenu = () => {
    const nextOpen = !openRef.current
    openRef.current = nextOpen
    setOpen(nextOpen)
    if (nextOpen) onMenuOpen?.()
    else onMenuClose?.()
  }

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (closeOnClickAway && !panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        closeMenu()
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenu()
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenu, closeOnClickAway, open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const layers = layerRefs.current.filter(Boolean)
    if (!panel) return undefined

    animationRef.current?.kill()
    const offscreen = position === 'left' ? -100 : 100

    if (!initializedRef.current) {
      gsap.set([panel, ...layers], { xPercent: offscreen, autoAlpha: 0 })
      initializedRef.current = true
    }

    if (open) {
      const labels = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'))
      gsap.set([panel, ...layers], { xPercent: offscreen, autoAlpha: 1 })
      gsap.set(labels, { yPercent: 140, rotate: 9 })

      const timeline = gsap.timeline()
      layers.forEach((layer, index) => {
        timeline.to(layer, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, index * 0.07)
      })
      const panelStart = layers.length ? (layers.length - 1) * 0.07 + 0.08 : 0
      timeline.to(panel, { xPercent: 0, duration: 0.65, ease: 'power4.out' }, panelStart)
      timeline.to(labels, { yPercent: 0, rotate: 0, duration: 0.8, ease: 'power4.out', stagger: 0.1 }, panelStart + 0.15)
      animationRef.current = timeline
    } else if (initializedRef.current && openRef.current === false && gsap.getProperty(panel, 'autoAlpha') === 1) {
      const timeline = gsap.timeline({
        onComplete: () => gsap.set([panel, ...layers], { autoAlpha: 0 }),
      })
      timeline.to([...layers, panel], { xPercent: offscreen, duration: 0.32, ease: 'power3.in', stagger: 0.04 })
      animationRef.current = timeline
    }

    return () => animationRef.current?.kill()
  }, [open, position])

  const panel = typeof document !== 'undefined' && createPortal(
    <>
      <button className={`sm-backdrop ${open ? 'sm-backdrop-open' : ''}`} type="button" aria-label="Close profile menu" onClick={closeMenu} tabIndex={open ? 0 : -1} aria-hidden={!open} />
      <div className="sm-prelayers" data-position={position} aria-hidden="true">
        {colors.slice(0, 3).map((color, index) => (
          <div className="sm-prelayer" key={`${color}-${index}`} ref={(element) => { layerRefs.current[index] = element }} style={{ backgroundColor: color }} />
        ))}
      </div>
      <aside
        id={panelId}
        ref={panelRef}
        className="sm-profile-panel"
        data-position={position}
        aria-hidden={!open}
        inert={!open}
        aria-label="Profile options"
        style={{ '--sm-accent': accentColor }}
      >
        <div className="sm-profile-panel-header">
          <span>Account</span>
          <button type="button" className="sm-close-button" aria-label="Close profile menu" onClick={closeMenu}>
            <X size={19} />
          </button>
        </div>
        <nav aria-label="Profile actions">
          <ol className={`sm-panel-list ${displayItemNumbering ? 'sm-numbered' : ''}`}>
            {items.map((item, index) => (
              <li className="sm-panel-itemWrap" key={`${item.label}-${index}`}>
                <button
                  type="button"
                  className="sm-panel-item"
                  aria-label={item.ariaLabel || item.label}
                  onClick={() => {
                    closeMenu()
                    item.onClick?.()
                  }}
                >
                  {item.icon && <span className="sm-panel-itemIcon" aria-hidden="true">{item.icon}</span>}
                  <span className="sm-panel-itemLabel">{item.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
    </>,
    document.body,
  )

  return (
    <>
      <div className={`sm-profile-trigger-wrap ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          className="sm-profile-trigger"
          aria-label={open ? 'Close profile menu' : 'Open profile menu'}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggleMenu}
        >
          {trigger}
          <ChevronDown className="sm-profile-chevron" size={14} aria-hidden="true" />
        </button>
      </div>
      {panel}
    </>
  )
}