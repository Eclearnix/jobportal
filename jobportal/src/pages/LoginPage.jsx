import { useCallback, useState } from 'react'
import { ArrowRight, BriefcaseBusiness, Building2, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import GoogleSignInButton from '../components/GoogleSignInButton'
import Aurora from '../components/Aurora'
import { useAuth } from '../context/AuthContext'

const publicRoles = [
  { id: 'candidate', name: 'Job Seeker', detail: 'Find jobs and manage your applications', Icon: BriefcaseBusiness },
  { id: 'recruiter', name: 'Organization / HR', detail: 'Post jobs and manage your hiring team', Icon: Building2 },
]

function Brand() {
  return (
    <Link to="/login" className="brand login-brand" aria-label="Eclearnix Jobs home">
      <span className="brand-symbol">e</span>
      <span className="brand-wordmark">eclearnix<span>jobs</span></span>
    </Link>
  )
}

export default function LoginPage({ superAdmin = false }) {
  const [role, setRole] = useState(superAdmin ? 'super_admin' : 'candidate')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  const handleCredential = useCallback(async (credential) => {
    setBusy(true)
    setError('')
    try {
      const { user, onboardingRequired } = await signInWithGoogle(role, credential)
      const path = user.role === 'candidate' ? '/candidate' : user.role === 'recruiter' ? '/organization' : '/super-admin'
      navigate(onboardingRequired && user.role !== 'super_admin' ? `/onboarding/${user.role}` : path, { replace: true })
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setBusy(false)
    }
  }, [navigate, role, signInWithGoogle])

  return (
    <main className="login-page">
      <Aurora
        colorStops={['#94a3b8', '#94a3b8', '#ffffff']}
        amplitude={1}
        blend={0.5}
        height={0.45}
        speed={1}
        glow={0.6}
        mouseInteraction={false}
      />
      <aside className="welcome-panel">
        <Brand />
        <div className="welcome-content">
          <div className="welcome-kicker"><span className="welcome-dot" /> Your hiring platform, all in one place</div>
          <h1>Better work starts with the right people.</h1>
          <p>One workspace for your career, your team, or the people keeping the whole marketplace moving.</p>
          <div className="welcome-note">
            <div className="welcome-note-icon"><ShieldCheck size={19} /></div>
            <div><strong>People-first. Secure by design.</strong><small>One thoughtful step at a time.</small></div>
          </div>
        </div>
        <div className="welcome-footer"><span>© 2026 Eclearnix Jobs</span><span>Made for better work.</span></div>
      </aside>

      <section className="login-panel">
        <div className="login-panel-top">
          {superAdmin ? <Link to="/login">← Back to Eclearnix Jobs</Link> : <span>Already part of the community?</span>}
        </div>
        <div className="login-box">
          <div className="mobile-brand"><Brand /></div>
          <div className="login-heading">
            <span className="login-eyebrow">{superAdmin ? 'RESTRICTED PLATFORM ACCESS' : 'ECLEARNIX JOBS WORKSPACE'}</span>
            <h2>{superAdmin ? 'Super Admin sign in.' : 'How will you use Eclearnix?'}</h2>
            <p>{superAdmin ? 'Sign in with an authorized platform administrator account.' : 'Choose your account type, then continue with Google.'}</p>
          </div>

          {superAdmin ? (
            <div className="admin-note"><ShieldCheck size={16} /> Super Admin access is provisioned by an existing administrator. There is no public admin registration.</div>
          ) : (
            <>
              <div className="role-picker" aria-label="Choose your account type">
                {publicRoles.map(({ id, name, detail, Icon }) => (
                  <button
                    type="button"
                    key={id}
                    className={`role-option cursor-target ${role === id ? 'role-option-active' : ''}`}
                    data-cursor-label={name}
                    aria-pressed={role === id}
                    onClick={() => { setRole(id); setError('') }}
                  >
                    <span className="role-option-icon"><Icon size={17} /></span>
                    <span className="role-option-copy"><strong>{name}</strong><small>{detail}</small></span>
                    <span className="role-radio" />
                  </button>
                ))}
              </div>
              <p className="super-admin-link">Platform administrator? <Link to="/super-admin/login">Go to Super Admin sign in <ArrowRight size={12} /></Link></p>
            </>
          )}

          <div className="google-login-area">
            <GoogleSignInButton role={role} onCredential={handleCredential} disabled={busy} />
            {busy && <p className="loading-message" role="status">Verifying your Google account…</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
          </div>

          <p className="auth-privacy-note">Your sign-in is verified securely. Your account role is assigned and checked by Eclearnix Jobs.</p>
          <p className="terms-copy">By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
        </div>
      </section>
    </main>
  )
}
