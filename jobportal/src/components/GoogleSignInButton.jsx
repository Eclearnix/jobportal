import { useEffect, useRef, useState } from 'react'

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)

  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${GOOGLE_SCRIPT}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = GOOGLE_SCRIPT
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', () => resolve(window.google), { once: true })
    script.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded. Check your connection and try again.')), { once: true })
  })
}

export default function GoogleSignInButton({ role, onCredential, disabled = false }) {
  const buttonRef = useRef(null)
  const shellRef = useRef(null)
  const callbackRef = useRef(onCredential)
  const generationRef = useRef(0)
  const [error, setError] = useState('')
  const [hovered, setHovered] = useState(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  function updateSpecularLight(event) {
    const shell = shellRef.current
    if (!shell) return
    const bounds = shell.getBoundingClientRect()
    shell.style.setProperty('--google-light-x', `${event.clientX - bounds.left}px`)
    shell.style.setProperty('--google-light-y', `${event.clientY - bounds.top}px`)
  }

  useEffect(() => {
    callbackRef.current = onCredential
  }, [onCredential])

  useEffect(() => {
    const container = buttonRef.current
    if (!clientId || !container) return undefined
    const generation = ++generationRef.current

    loadGoogleIdentity()
      .then((google) => {
        if (generation !== generationRef.current || !container.isConnected) return
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) callbackRef.current(response.credential)
            else setError('Google did not return a sign-in credential. Please try again.')
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        })
        container.replaceChildren()
        google.accounts.id.renderButton(container, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          width: 360,
          locale: 'en',
        })
      })
      .catch((loadError) => {
        if (generation === generationRef.current) setError(loadError.message)
      })

    return () => {
      generationRef.current += 1
      container.replaceChildren()
    }
  }, [clientId])

  if (!clientId) {
    return <p className="integration-notice">Google sign-in is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> to enable it.</p>
  }

  return (
    <div
      ref={shellRef}
      onPointerMove={updateSpecularLight}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={`google-signin ${hovered ? 'google-signin-hover' : ''} ${disabled ? 'google-signin-disabled' : ''}`}
    >
      <div ref={buttonRef} aria-label={`Continue with Google as ${role}`} />
      {disabled && <span className="google-signin-cover" aria-hidden="true" />}
      {error && <p className="integration-error" role="alert">{error}</p>}
    </div>
  )
}
