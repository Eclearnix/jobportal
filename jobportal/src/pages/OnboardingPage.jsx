import { useState } from 'react'
import { Building2, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'

export default function OnboardingPage({ role }) {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resume, setResume] = useState(null)
  const isCandidate = role === 'candidate'

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      if (isCandidate) {
        await api('/candidate/profile', {
          method: 'PATCH',
          body: {
            name: form.get('name'),
            phone: form.get('phone'),
            location: form.get('location'),
            title: form.get('title'),
            skills: String(form.get('skills') || '').split(',').map((skill) => skill.trim()).filter(Boolean),
            preferredLocations: String(form.get('preferredLocations') || '').split(',').map((location) => location.trim()).filter(Boolean),
          },
        })
        if (resume) {
          const resumeForm = new FormData()
          resumeForm.set('resume', resume)
          await api('/candidate/resume', { method: 'POST', body: resumeForm })
        }
      } else {
        await api('/organizations', {
          method: 'POST',
          body: {
            name: form.get('name'),
            website: form.get('website'),
            industry: form.get('industry'),
            size: form.get('size'),
            location: form.get('location'),
            description: form.get('description'),
            contactEmail: form.get('contactEmail'),
          },
        })
      }
      const updatedUser = await refreshUser()
      navigate(updatedUser.role === 'candidate' ? '/candidate' : '/organization', { replace: true })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  if (!user || (user.role !== 'candidate' && user.role !== 'recruiter')) return null

  return (
    <main className="onboarding-page">
      <section className="onboarding-card">
        <span className="onboarding-icon">{isCandidate ? <UserRound size={20} /> : <Building2 size={20} />}</span>
        <span className="login-eyebrow">LET’S SET UP YOUR WORKSPACE</span>
        <h1>{isCandidate ? 'A little about you.' : 'Tell us about your organization.'}</h1>
        <p>{isCandidate ? 'Help us find opportunities that feel right for you.' : 'Your organization profile will be reviewed before jobs can go live.'}</p>

        <form className="onboarding-form" onSubmit={submit}>
          {isCandidate ? (
            <>
              <label>Full name<input name="name" defaultValue={user.name} required maxLength={120} /></label>
              <label>Email address<input value={user.email} disabled /></label>
              <div className="form-two-col">
                <label>Phone<input name="phone" type="tel" placeholder="+1 555 000 0000" required maxLength={40} /></label>
                <label>Current location<input name="location" placeholder="City, country" required maxLength={120} /></label>
              </div>
              <label>Professional headline<input name="title" placeholder="e.g. Product designer" maxLength={120} /></label>
              <label>Skills <small>Separate skills with commas</small><input name="skills" placeholder="Figma, Research, Prototyping" /></label>
              <label>Preferred locations <small>Separate locations with commas</small><input name="preferredLocations" placeholder="Remote, Toronto" /></label>
              <label>Resume <small>PDF or DOCX, up to 5 MB</small><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setResume(event.target.files?.[0] || null)} /></label>
            </>
          ) : (
            <>
              <label>Organization name<input name="name" placeholder="Northstar Studio" required minLength={2} maxLength={160} /></label>
              <div className="form-two-col">
                <label>Work email<input name="contactEmail" type="email" defaultValue={user.email} required maxLength={240} /></label>
                <label>Website<input name="website" type="url" placeholder="https://example.com" maxLength={240} /></label>
              </div>
              <div className="form-two-col">
                <label>Industry<input name="industry" placeholder="Technology" maxLength={120} /></label>
                <label>Company size<select name="size" defaultValue=""><option value="" disabled>Select company size</option><option>1–10</option><option>11–50</option><option>51–200</option><option>201–1,000</option><option>1,000+</option></select></label>
              </div>
              <label>Organization location<input name="location" placeholder="City, country" maxLength={160} /></label>
              <label>About your organization<textarea name="description" rows="4" placeholder="What should candidates know about your team?" maxLength={3000} /></label>
              <div className="onboarding-review-note"><Building2 size={16} /> Your organization will start as pending review. Jobs can be drafted now; publishing is enabled after verification.</div>
            </>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="login-submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'} <span>→</span></button>
        </form>
      </section>
    </main>
  )
}
