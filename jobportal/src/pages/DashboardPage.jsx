import { Component, cloneElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownToLine, ArrowRight, Bell, BriefcaseBusiness, Building2, ClipboardList, FileText,
  LayoutDashboard, LogOut, Search, Settings, Shield, Users, UserRound, X,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, queryString } from '../services/api'
import StaggeredMenu from '../components/StaggeredMenu'

function UserAvatar({ name, picture }) {
  const [imageFailed, setImageFailed] = useState(false)
  const pictureUrl = typeof picture === 'string' ? picture.trim() : ''
  const initial = name?.trim().charAt(0).toUpperCase() || '?'

  return (
    <span className="user-avatar" role="img" aria-label={`${name || 'User'} profile picture`}>
      {pictureUrl && !imageFailed
        ? <img src={pictureUrl} alt="" onError={() => setImageFailed(true)} />
        : initial}
    </span>
  )
}

const navigation = {
  candidate: [
    ['Overview', LayoutDashboard], ['Find Jobs', Search], ['My Applications', ClipboardList],
    ['Saved Jobs', BriefcaseBusiness], ['My Profile', UserRound], ['Resume', FileText],
    ['Interviews', BriefcaseBusiness], ['Notifications', Bell],
  ],
  recruiter: [
    ['Overview', LayoutDashboard], ['Post a Job', BriefcaseBusiness], ['Manage Jobs', ClipboardList],
    ['Applications', Users], ['Candidates', UserRound], ['Discover Candidates', Search], ['Company Profile', Building2],
    ['Interviews', BriefcaseBusiness], ['Team Management', Users], ['Notifications', Bell], ['Settings', Settings],
  ],
  super_admin: [
    ['Overview', LayoutDashboard], ['User Management', Users], ['Organization Management', Building2],
    ['Job Management', BriefcaseBusiness], ['Application Monitoring', ClipboardList],
    ['Verification Requests', Shield], ['Reports & Complaints', FileText], ['Platform Analytics', LayoutDashboard],
    ['Admin Management', Users], ['Audit Logs', ClipboardList], ['Notifications', Bell], ['Settings', Settings],
  ],
}

const paths = {
  candidate: '/candidate',
  recruiter: '/organization',
  super_admin: '/super-admin',
}

const slug = (value) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '')
const humanize = (value = '') => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const dateLabel = (value, timeZone) => value ? new Date(value).toLocaleDateString(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  ...(timeZone ? { timeZone } : {}),
}) : '—'

function Loading({ message = 'Loading your workspace…' }) {
  return <div className="workspace-loading" role="status"><span className="loading-spinner" />{message}</div>
}

function ErrorNotice({ message, onRetry }) {
  return <div className="workspace-error" role="alert"><p>{message}</p>{onRetry && <button type="button" className="subtle-button" onClick={onRetry}>Try again</button>}</div>
}

function MetricCards({ items }) {
  return <div className="metric-grid">{items.map(({ label, value, note, Icon = LayoutDashboard }) => (
    <article className="metric-card" key={label}>
      <div className="metric-topline"><span>{label}</span><span className="metric-icon"><Icon size={15} /></span></div>
      <strong className="metric-value">{value ?? '—'}</strong>
      {note && <span className="metric-change">{note}</span>}
    </article>
  ))}</div>
}

function DataTable({ columns, rows, actions, search = '', empty = 'Nothing here yet.', className = '' }) {
  const filteredRows = rows.filter((row) => row.cells.some((cell) => {
    const text = typeof cell === 'string' || typeof cell === 'number' ? String(cell) : String(cell?.props?.children || '')
    return text.toLowerCase().includes(search.toLowerCase())
  }))
  return (
    <div className={`data-card ${className}`.trim()}>
      <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}{actions && <th>Actions</th>}</tr></thead>
        <tbody>
          {filteredRows.length ? filteredRows.map((row) => (
            <tr key={row.id || row._id}>
              {row.cells.map((cell, index) => <td key={`${row.id || row._id}-${index}`}>{cell}</td>)}
              {actions && <td className="table-actions">{actions(row)}</td>}
            </tr>
          )) : <tr><td className="empty-row" colSpan={columns.length + (actions ? 1 : 0)}>{search ? 'No results match your search.' : empty}</td></tr>}
        </tbody>
      </table></div>
      <div className="table-footer"><span>{filteredRows.length} of {rows.length} item{rows.length === 1 ? '' : 's'}</span></div>
    </div>
  )
}

function ScheduleInterviewForm({ applicationId, onSaved, onScheduled }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [minimumDateTime] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const result = await api(`/recruiter/applications/${applicationId}/interviews`, {
        method: 'POST',
        body: {
          scheduledAt: new Date(String(form.get('scheduledAt'))).toISOString(),
          durationMinutes: Number(form.get('durationMinutes')),
          meetingUrl: form.get('meetingUrl'),
          notes: form.get('notes'),
        },
      })
      setOpen(false)
      onScheduled(result.emailSent
        ? 'Interview scheduled and email sent to the candidate.'
        : `Interview scheduled and in-app notification created, but email was not sent. ${result.emailError}`)
      await onSaved()
    } catch (scheduleError) {
      setError(scheduleError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="org-action-button" onClick={() => { setOpen(!open); setError('') }}>
        {open ? 'Cancel' : 'Schedule interview'}
      </button>
      {open && createPortal(
        <div className="interview-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false)
        }}>
          <section className="interview-modal" role="dialog" aria-modal="true" aria-labelledby={`interview-title-${applicationId}`}>
            <h2 id={`interview-title-${applicationId}`}>Schedule interview</h2>
            <p>Choose a time and share the meeting details with the candidate.</p>
            <form className="interview-scheduler-form" onSubmit={submit}>
              <label>Date and time<input name="scheduledAt" type="datetime-local" required min={minimumDateTime} /></label>
              <label>Duration<select name="durationMinutes" defaultValue="30"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option></select></label>
              <label>Meeting link<input name="meetingUrl" type="url" maxLength={500} placeholder="https://…" /></label>
              <label>Notes<textarea name="notes" rows="3" maxLength="2000" /></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <div className="interview-modal-actions">
                <button type="button" className="subtle-button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
                <button type="submit" className="green-button" disabled={busy}>{busy ? 'Scheduling…' : 'Confirm interview'}</button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}

function CandidateInvitePanel({ candidateId }) {
  const [jobs, setJobs] = useState([])
  const [jobId, setJobId] = useState('')
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    api('/recruiter/jobs?limit=100')
      .then(({ items }) => {
        if (!active) return
        const publishedJobs = items.filter((job) => job.status === 'published')
        setJobs(publishedJobs)
        setJobId(publishedJobs[0]?._id || '')
      })
      .catch((loadError) => { if (active) setLoadError(loadError.message) })
      .finally(() => { if (active) setLoadingJobs(false) })
    return () => { active = false }
  }, [])

  async function sendInvitation(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await api(`/recruiter/candidates/${candidateId}/invitations`, { method: 'POST', body: { jobId } })
      setMessage('Invite sent. The candidate can view it in website notifications.')
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="candidate-invite-panel" aria-label="Invite candidate to apply">
      <h3>Invite to apply</h3>
      {loadingJobs && <p role="status">Loading published jobs…</p>}
      {!loadingJobs && loadError && <p className="auth-error" role="alert">{loadError}</p>}
      {!loadingJobs && !loadError && !jobs.length && <p>No published jobs are available to invite this candidate to.</p>}
      {!loadingJobs && !loadError && jobs.length > 0 && (
        <form className="candidate-invite-form" onSubmit={sendInvitation}>
          <label htmlFor={`candidate-invite-job-${candidateId}`}>Published job</label>
          <select id={`candidate-invite-job-${candidateId}`} value={jobId} onChange={(event) => { setJobId(event.target.value); setError(''); setMessage('') }} required>
            {jobs.map((job) => <option key={job._id} value={job._id}>{job.title}</option>)}
          </select>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="integration-notice" role="status">{message}</p>}
          <button type="submit" className="green-button" disabled={busy || !jobId || Boolean(message)}>{busy ? 'Sending invite…' : message ? 'Invite sent' : 'Send invite'}</button>
        </form>
      )}
    </section>
  )
}

function CandidatePreview({ candidate, onClose, canInvite = false }) {
  const [showInvite, setShowInvite] = useState(false)

  return (
    <div className="candidate-preview-backdrop" role="presentation" onClick={onClose}>
      <section className="candidate-preview" role="dialog" aria-modal="true" aria-labelledby="candidate-preview-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="candidate-preview-close" aria-label="Close candidate profile" onClick={onClose}>×</button>
        <h2 id="candidate-preview-title">{candidate.name}</h2>
        <p>{candidate.title || 'Candidate'} · {candidate.location || 'Location not provided'}</p>
        <a href={`mailto:${candidate.email}`}>{candidate.email}</a>
        <h3>Skills</h3>
        <p>{candidate.skills?.length ? candidate.skills.join(', ') : 'No skills listed yet.'}</p>
        {candidate.experience?.length > 0 && <>
          <h3>Experience</h3>
          {candidate.experience.map((item, index) => <p key={`${item.company}-${index}`}><strong>{item.title}</strong> · {item.company}{item.summary ? ` — ${item.summary}` : ''}</p>)}
        </>}
        {candidate.education?.length > 0 && <>
          <h3>Education</h3>
          {candidate.education.map((item, index) => <p key={`${item.school}-${index}`}>{item.degree} · {item.school}</p>)}
        </>}
        {canInvite && (
          <>
            <div className="candidate-preview-actions">
              <button type="button" className="green-button" aria-expanded={showInvite} onClick={() => setShowInvite((current) => !current)}>{showInvite ? 'Close invite form' : 'Invite'}</button>
            </div>
            {showInvite && <CandidateInvitePanel candidateId={candidate._id} />}
          </>
        )}
      </section>
    </div>
  )
}

function Pill({ children }) {
  return <span className={`status-pill status-${slug(String(children).toLowerCase())}`}>{humanize(String(children))}</span>
}

function JobSearch({ onOpen, onSaved }) {
  const [filters, setFilters] = useState({ q: '', location: '', workMode: '', employmentType: '', industry: '', experienceLevel: '', salaryMin: '' })
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const search = useCallback(async (event) => {
    event?.preventDefault()
    if (filters.salaryMin !== '' && (!Number.isFinite(Number(filters.salaryMin)) || Number(filters.salaryMin) < 0)) {
      setError('Minimum salary must be a non-negative number.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { items: jobs } = await api(`/jobs${queryString(filters)}`)
      setItems(jobs)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setBusy(false)
    }
  }, [filters])

  useEffect(() => {
    const controller = new AbortController()
    api('/jobs', { signal: controller.signal })
      .then(({ items: jobs }) => setItems(jobs))
      .catch((loadError) => { if (loadError.name !== 'AbortError') setError(loadError.message) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [])

  return (
    <section className="module-section">
      <div className="module-heading"><div><p>Search verified openings from organizations on Eclearnix Jobs.</p></div></div>
      <form className="job-filter-form" onSubmit={search}>
        <input aria-label="Job title, skill, or company" placeholder="Job title, skill, or company" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <input aria-label="Location" placeholder="Location" value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} />
        <select aria-label="Work mode" value={filters.workMode} onChange={(event) => setFilters({ ...filters, workMode: event.target.value })}><option value="">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option></select>
        <select aria-label="Employment type" value={filters.employmentType} onChange={(event) => setFilters({ ...filters, employmentType: event.target.value })}><option value="">Any employment type</option><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option></select>
        <input aria-label="Industry" placeholder="Industry" value={filters.industry} onChange={(event) => setFilters({ ...filters, industry: event.target.value })} />
        <input aria-label="Experience level" placeholder="Experience level" value={filters.experienceLevel} onChange={(event) => setFilters({ ...filters, experienceLevel: event.target.value })} />
        <input aria-label="Minimum salary" type="number" min="0" placeholder="Minimum salary" value={filters.salaryMin} onChange={(event) => setFilters({ ...filters, salaryMin: event.target.value })} />
        <button className="green-button" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search jobs'} <Search size={14} /></button>
      </form>
      {error && <ErrorNotice message={error} onRetry={search} />}
      <div className="job-results">{items.map((job) => (
        <article className="job-result-card" key={job._id}>
          <div className="company-avatar">{job.company?.name?.slice(0, 1) || 'J'}</div>
          <div className="job-result-main"><button type="button" className="job-title-link" onClick={() => onOpen(job._id)}>{job.title}</button><strong>{job.company?.name}</strong><span>{job.location} · {humanize(job.workMode)} · {humanize(job.employmentType)}</span></div>
          <div className="job-result-actions">
            <button type="button" className="subtle-button" onClick={() => onOpen(job._id)}>View job</button>
            <button type="button" className="subtle-button" onClick={() => onSaved(job._id)}>Save job</button>
          </div>
        </article>
      ))}{!busy && !error && !items.length && <div className="empty-state">No jobs match these filters yet. Try broadening your search.</div>}</div>
    </section>
  )
}

function JobPostForm({ onCreated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    setBusy(true)
    setError('')
    const form = new FormData(formElement)
    try {
      const result = await api('/recruiter/jobs', {
        method: 'POST',
        body: {
          title: form.get('title'),
          description: form.get('description'),
          location: form.get('location'),
          workMode: form.get('workMode'),
          employmentType: form.get('employmentType'),
          experienceLevel: form.get('experienceLevel'),
          industry: form.get('industry'),
          skills: String(form.get('skills') || '').split(',').map((skill) => skill.trim()).filter(Boolean),
          status: event.nativeEvent.submitter?.value === 'review' ? 'pending_review' : 'draft',
        },
      })
      formElement.reset()
      onCreated(result.job)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="module-section">
      <div className="module-heading"><div><h2>Create a job listing</h2><p>Write a clear, thoughtful description to help candidates decide if this role is right for them.</p></div></div>
      <form className="module-form" onSubmit={submit}>
        <label>Job title<input name="title" required minLength={2} maxLength={180} placeholder="e.g. Product Designer" /></label>
        <div className="form-two-col">
          <label>Location<input name="location" required placeholder="City, country or Remote" /></label>
          <label>Industry<input name="industry" placeholder="Technology" /></label>
        </div>
        <div className="form-two-col">
          <label>Work mode<select name="workMode" required><option value="">Choose one</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option></select></label>
          <label>Employment type<select name="employmentType" required><option value="">Choose one</option><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label>
        </div>
        <label>Experience level<input name="experienceLevel" placeholder="Mid-level" /></label>
        <label>Skills <small>Separate skills with commas</small><input name="skills" placeholder="React, Accessibility, Design systems" /></label>
        <label>Role description<textarea name="description" rows="7" required minLength={30} maxLength={15000} placeholder="Describe the role, the team, and what success looks like…" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="form-submit-row"><button type="submit" name="submitMode" value="draft" className="subtle-button" disabled={busy}>Save draft</button><button type="submit" name="submitMode" value="review" className="green-button" disabled={busy}>{busy ? 'Saving…' : 'Submit for review'} <ArrowRight size={14} /></button></div>
      </form>
    </section>
  )
}

function CandidateProfile({ profile, onSaved, onProfileSaveStart, onProfileSaved, showHeading = true, largeText = false }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumeError, setResumeError] = useState('')

  async function saveProfile(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    onProfileSaveStart()
    const form = new FormData(event.currentTarget)
    try {
      await api('/candidate/profile', { method: 'PATCH', body: {
        name: form.get('name'),
        title: form.get('title'),
        phone: form.get('phone'),
        location: form.get('location'),
        skills: String(form.get('skills') || '').split(',').map((item) => item.trim()).filter(Boolean),
        preferredLocations: String(form.get('preferredLocations') || '').split(',').map((item) => item.trim()).filter(Boolean),
        openToOpportunities: form.get('openToOpportunities') === 'on',
      } })
      await onProfileSaved()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  async function uploadResume(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setResumeBusy(true)
    setResumeError('')
    try {
      const body = new FormData()
      body.set('resume', file)
      await api('/candidate/resume', { method: 'POST', body })
      await onSaved()
    } catch (uploadError) {
      setResumeError(uploadError.message)
    } finally {
      setResumeBusy(false)
      event.target.value = ''
    }
  }

  async function openResume() {
    setResumeError('')
    try {
      const { url } = await api('/candidate/resume')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (resumeLoadError) {
      setResumeError(resumeLoadError.message)
    }
  }

  return (
    <section className={`module-section candidate-profile ${largeText ? 'candidate-profile-large-text' : ''}`}>
      <div className="module-heading"><div>{showHeading && <h2>Your profile</h2>}<p>Keep your experience current so opportunities can find you.</p></div></div>
      <form className="module-form" onSubmit={saveProfile}>
        <label>Full name<input name="name" defaultValue={profile?.name} required maxLength={120} /></label>
        <label>Professional headline<input name="title" defaultValue={profile?.title} maxLength={120} /></label>
        <div className="form-two-col"><label>Phone<input name="phone" defaultValue={profile?.phone} maxLength={40} /></label><label>Location<input name="location" defaultValue={profile?.location} maxLength={120} /></label></div>
        <label>Skills<input name="skills" defaultValue={profile?.skills?.join(', ')} placeholder="Figma, Research, Prototyping" /></label>
        <label>Preferred locations<input name="preferredLocations" defaultValue={profile?.preferredLocations?.join(', ')} /></label>
        <label className="checkbox-field">
          <input type="checkbox" name="openToOpportunities" defaultChecked={profile?.openToOpportunities} />
          <span><strong>Open to opportunities</strong><small>Allow verified organizations to discover your profile and contact you about relevant roles.</small></span>
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="green-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <ArrowRight size={14} /></button>
      </form>
      <div className="resume-manager"><div><h3>Resume</h3><p>Private PDF or DOCX · Maximum 5 MB</p></div>{profile?.resumeKey && <button type="button" className="subtle-button" onClick={openResume}><ArrowDownToLine size={14} /> Open resume</button>}<label className="subtle-button file-upload-button">{resumeBusy ? 'Uploading…' : 'Upload new resume'}<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadResume} disabled={resumeBusy} /></label></div>
      {resumeError && <p className="auth-error" role="alert">{resumeError}</p>}
    </section>
  )
}

const defaultCandidateNotificationPreferences = {
  jobMatches: { inApp: true, email: false },
  applicationUpdates: { inApp: true, email: false },
  interviewReminders: { inApp: true, email: true },
}

function CandidateSettings({ notificationPreferences, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preferences, setPreferences] = useState(defaultCandidateNotificationPreferences)

  useEffect(() => {
    setPreferences((current) => ({
      ...defaultCandidateNotificationPreferences,
      ...current,
      ...(notificationPreferences || {}),
    }))
  }, [notificationPreferences])

  async function savePreferences(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api('/candidate/settings/notifications', { method: 'PATCH', body: { notificationPreferences: preferences } })
      const nextPreferences = result.notificationPreferences || preferences
      setPreferences(nextPreferences)
      await onSaved()
      window.alert('Settings updated')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  function toggleChannel(key, channel, checked) {
    setPreferences((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [channel]: checked,
      },
    }))
  }

  return (
    <section className="module-section job-seeker-settings">
      <div className="module-heading"><div><p>Control how employers find you and how you receive updates.</p></div></div>
      <form className="module-form" onSubmit={savePreferences}>
        <div className="settings-notification-grid">
          <div className="settings-notification-heading"><span>Update</span><span>In-app</span><span>Email</span></div>
          {Object.entries({
            jobMatches: 'Job matches',
            applicationUpdates: 'Application updates',
            interviewReminders: 'Interview reminders',
          }).map(([key, label]) => (
            <div className="settings-notification-row" key={key}>
              <div><strong>{label}</strong></div>
              <div className="checkbox-field"><input type="checkbox" checked={Boolean(preferences[key]?.inApp)} onChange={(event) => toggleChannel(key, 'inApp', event.target.checked)} /></div>
              <div className="checkbox-field"><input type="checkbox" checked={Boolean(preferences[key]?.email)} onChange={(event) => toggleChannel(key, 'email', event.target.checked)} /></div>
            </div>
          ))}
        </div>

        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="green-button" disabled={busy}>{busy ? 'Saving…' : 'Save settings'} <ArrowRight size={14} /></button>
      </form>
    </section>
  )
}

function CandidateResume({ profile, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function uploadResume(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.set('resume', file)
      await api('/candidate/resume', { method: 'POST', body })
      await onSaved()
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function openResume() {
    setError('')
    try {
      const { url } = await api('/candidate/resume')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (resumeError) {
      setError(resumeError.message)
    }
  }

  return (
    <section className="module-section">
      <div className="module-heading"><div><h2>Your resume</h2><p>Keep one current resume ready for every application.</p></div></div>
      <div className="resume-manager resume-page-card">
        <div>
          <h3>{profile?.resumeKey ? 'Resume uploaded' : 'No resume uploaded yet'}</h3>
          <p>Private PDF or DOCX · Maximum 5 MB</p>
        </div>
        {profile?.resumeKey && <button type="button" className="subtle-button" onClick={openResume}><ArrowDownToLine size={14} /> Open resume</button>}
        <label className="green-button file-upload-button">{busy ? 'Uploading…' : profile?.resumeKey ? 'Replace resume' : 'Upload resume'}<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadResume} disabled={busy} /></label>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </section>
  )
}

function SuperAdminSettings({ settings, reload }) {
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState({})
  const groups = settings.length ? settings : [
    { key: 'job_categories', values: [] },
    { key: 'employment_types', values: [] },
    { key: 'industries', values: [] },
    { key: 'experience_levels', values: [] },
  ]

  async function save(key, values) {
    setError('')
    try {
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { values } })
      await reload()
      setDrafts((current) => ({ ...current, [key]: '' }))
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  return (
    <section className="module-section">
      <div className="module-heading"><div><h2>Master settings</h2><p>Control the platform-wide categories available to candidates and organizations.</p></div></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-settings-grid">{groups.map((group) => (
        <article className="setting-card" key={group.key}>
          <h3>{humanize(group.key)}</h3>
          <div className="setting-tags">{group.values.map((value) => <span className="master-option" key={value}>{value}<button type="button" aria-label={`Remove ${value}`} onClick={() => save(group.key, group.values.filter((item) => item !== value))}><X size={12} /></button></span>)}</div>
          <form onSubmit={(event) => { event.preventDefault(); const value = (drafts[group.key] || '').trim(); if (value && !group.values.some((item) => item.toLowerCase() === value.toLowerCase())) save(group.key, [...group.values, value]) }}>
            <input aria-label={`Add ${humanize(group.key)}`} placeholder="Add an option" value={drafts[group.key] || ''} onChange={(event) => setDrafts({ ...drafts, [group.key]: event.target.value })} />
            <button type="submit" className="green-button" disabled={!drafts[group.key]?.trim()}>Add</button>
          </form>
        </article>
      ))}</div>
    </section>
  )
}

function AdminInvites({ data, reload }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const primaryAdminEmail = data?.primaryAdminEmail || ''
  const primaryAdminExists = data?.admins?.some((admin) => admin.email.toLowerCase() === primaryAdminEmail)

  async function invite(event) {
    event.preventDefault()
    setError('')
    try {
      await api('/admin/admin-invitations', { method: 'POST', body: { email } })
      setEmail('')
      await reload()
    } catch (inviteError) {
      setError(inviteError.message)
    }
  }

  return (
    <section className="module-section">
      <div className="module-heading"><div><h2>Authorized administrators</h2><p>Only invited, Google-verified accounts can receive Super Admin access.</p></div></div>
      <form className="admin-invite-form" onSubmit={invite}><input aria-label="Administrator email" type="email" placeholder="admin@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="green-button">Invite administrator <ArrowRight size={14} /></button></form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <h3 className="list-subheading">Current administrators</h3>
      {!primaryAdminEmail
        ? <p className="auth-error" role="alert">Primary administrator is not configured. Set PRIMARY_ADMIN_EMAIL in the backend environment and restart the API.</p>
        : !primaryAdminExists
          ? <p className="auth-error" role="alert">The configured primary administrator ({primaryAdminEmail}) does not have a Super Admin account yet. Provision this email before signing in.</p>
          : null}
      <DataTable columns={['Name', 'Email', 'Access', 'Status', 'Added']} rows={(data?.admins || []).map((admin) => ({
        id: admin._id,
        cells: [
          admin.name,
          admin.email,
          <Pill key="access">{admin.email.toLowerCase() === primaryAdminEmail ? 'Primary administrator' : 'Administrator'}</Pill>,
          <Pill key="status">{admin.status}</Pill>,
          dateLabel(admin.createdAt),
        ],
      }))} />
      <h3 className="list-subheading">Pending invitations</h3>
      <DataTable columns={['Email', 'Expires']} rows={(data?.invites || []).map((inviteItem) => ({
        id: inviteItem._id,
        cells: [inviteItem.email, dateLabel(inviteItem.expiresAt)],
      }))} actions={(item) => <button type="button" className="org-action-button org-remove-button" onClick={async () => { await api(`/admin/admin-invitations/${item.id}`, { method: 'DELETE' }); await reload() }}>Revoke</button>} />
    </section>
  )
}

function TeamManagement({ data, reload, timeZone }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function invite(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api('/recruiter/team-invitations', { method: 'POST', body: { email } })
      setEmail('')
      await reload()
      setMessage('Invitation email accepted for delivery. Ask your teammate to check their inbox and spam folder.')
    } catch (inviteError) {
      setError(inviteError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="module-section">
      <div className="module-heading"><div><h2>Your hiring team</h2><p>Invite colleagues to share your organization’s hiring workspace.</p></div></div>
      <form className="admin-invite-form" onSubmit={invite}><input aria-label="Team member email" type="email" placeholder="colleague@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="green-button" disabled={busy}>{busy ? 'Sending…' : 'Invite teammate'} <ArrowRight size={14} /></button></form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="integration-notice" role="status">{message}</p>}
      <DataTable columns={['Name', 'Email', 'Role', 'Status']} rows={(data?.members || []).map((member) => ({
        id: member._id, cells: [member.name, member.email, humanize(member.role), <Pill key="status">{member.status}</Pill>],
      }))} empty="Your organization team will appear here." />
      <h3 className="list-subheading">Pending invitations</h3>
      <DataTable columns={['Email', 'Expires']} rows={(data?.invites || []).map((inviteItem) => ({
        id: inviteItem._id, cells: [inviteItem.email, dateLabel(inviteItem.expiresAt, timeZone)],
      }))} actions={(item) => <button type="button" className="org-action-button org-remove-button" onClick={async () => { await api(`/recruiter/team-invitations/${item.id}`, { method: 'DELETE' }); await reload() }}>Revoke</button>} />
    </section>
  )
}

const defaultRecruiterNotificationPreferences = {
  applicationReceived: { inApp: true, email: false },
  interviewUpdates: { inApp: true, email: false },
  teamUpdates: { inApp: true, email: false },
}

const recruiterNotificationTypes = [
  { key: 'applicationReceived', label: 'New applications', detail: 'When a candidate applies to one of your jobs.' },
  { key: 'interviewUpdates', label: 'Interview updates', detail: 'When another teammate schedules an interview.' },
  { key: 'teamUpdates', label: 'Team updates', detail: 'When an invited teammate joins your organization.' },
]

function OrganizationSettings({ settings, reload }) {
  const [timezone, setTimezone] = useState(settings?.timezone || 'UTC')
  const [notificationPreferences, setNotificationPreferences] = useState(() => Object.fromEntries(
    Object.entries(defaultRecruiterNotificationPreferences).map(([key, defaults]) => [
      key,
      { ...defaults, ...settings?.notificationPreferences?.[key] },
    ]),
  ))
  const [timezoneError, setTimezoneError] = useState('')
  const [timezoneMessage, setTimezoneMessage] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [savingTimezone, setSavingTimezone] = useState(false)
  const [savingNotifications, setSavingNotifications] = useState(false)

  async function saveTimezone(event) {
    event.preventDefault()
    setTimezoneError('')
    setTimezoneMessage('')
    setSavingTimezone(true)
    try {
      await api('/recruiter/settings/timezone', { method: 'PATCH', body: { timezone } })
      await reload({ quiet: true })
      setTimezoneMessage('Organization timezone saved.')
    } catch (saveError) {
      setTimezoneError(saveError.message)
    } finally {
      setSavingTimezone(false)
    }
  }

  async function saveNotifications(event) {
    event.preventDefault()
    setNotificationError('')
    setNotificationMessage('')
    setSavingNotifications(true)
    try {
      const { notificationPreferences: savedPreferences } = await api('/recruiter/settings/notifications', {
        method: 'PATCH',
        body: { notificationPreferences },
      })
      setNotificationPreferences(savedPreferences)
      await reload({ quiet: true })
      setNotificationMessage('Notification preferences saved.')
    } catch (saveError) {
      setNotificationError(saveError.message)
    } finally {
      setSavingNotifications(false)
    }
  }

  function updateNotificationPreference(eventKey, channel, checked) {
    setNotificationPreferences((current) => ({
      ...current,
      [eventKey]: { ...current[eventKey], [channel]: checked },
    }))
  }

  return (
    <section className="module-section">
      <div className="module-heading">
        <div><h2>Organization settings</h2><p>Choose your timezone and how you receive hiring updates.</p></div>
      </div>
      <form className="module-form" onSubmit={saveTimezone}>
        <h3>Organization timezone</h3>
        <label>
          IANA timezone
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Kolkata" required />
          <small>Examples: Asia/Kolkata, America/New_York, Europe/London. Interview times and organization dates use this timezone.</small>
        </label>
        {timezoneError && <p className="auth-error" role="alert">{timezoneError}</p>}
        {timezoneMessage && <p className="integration-notice" role="status">{timezoneMessage}</p>}
        <button type="submit" className="green-button" disabled={savingTimezone}>{savingTimezone ? 'Saving…' : 'Save timezone'} <ArrowRight size={14} /></button>
      </form>

      <form className="module-form" onSubmit={saveNotifications}>
        <h3>Notification preferences</h3>
        <p>These preferences apply to your HR account, not emails sent to applicants. Email alerts require Gmail SMTP to be configured on the server.</p>
        <div className="settings-notification-grid">
          <div className="settings-notification-heading"><span>Update</span><span>In-app</span><span>Email</span></div>
          {recruiterNotificationTypes.map(({ key, label, detail }) => (
            <div className="settings-notification-row" key={key}>
              <div><strong>{label}</strong><small>{detail}</small></div>
              {['inApp', 'email'].map((channel) => (
                <label className="checkbox-field" key={channel}>
                  <input
                    type="checkbox"
                    checked={notificationPreferences[key][channel]}
                    onChange={(event) => updateNotificationPreference(key, channel, event.target.checked)}
                    aria-label={`${label} ${channel === 'inApp' ? 'in-app' : 'email'} notification`}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
        {notificationError && <p className="auth-error" role="alert">{notificationError}</p>}
        {notificationMessage && <p className="integration-notice" role="status">{notificationMessage}</p>}
        <button type="submit" className="green-button" disabled={savingNotifications}>{savingNotifications ? 'Saving…' : 'Save notification preferences'} <ArrowRight size={14} /></button>
      </form>
    </section>
  )
}

function DashboardWorkspace({ role }) {
  const { user, signOut } = useAuth()
  const { section } = useParams()
  const navigate = useNavigate()
  const [payload, setPayload] = useState(null)
  const [viewData, setViewData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [profileSaveMessage, setProfileSaveMessage] = useState('')
  const [jobPostMessage, setJobPostMessage] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [canInviteSelectedCandidate, setCanInviteSelectedCandidate] = useState(false)
  const [showArchivedApplications, setShowArchivedApplications] = useState(false)
  const [showRemovedApplications, setShowRemovedApplications] = useState(false)
  const [showArchivedNotifications, setShowArchivedNotifications] = useState(false)
  const [notificationActionsBusy, setNotificationActionsBusy] = useState(false)
  const loadSequence = useRef(0)
  const [today] = useState(() => new Date())
  const navItems = navigation[role]
  const activePage = navItems.find(([label]) => slug(label) === section)?.[0] || 'Overview'
  const title = activePage === 'Overview'
    ? role === 'candidate' ? `Welcome back, ${user.name.split(' ')[0]}.` : role === 'recruiter' ? `Welcome back, ${user.name.split(' ')[0]}.` : 'Your platform, at a glance.'
    : activePage

  const reload = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadSequence.current
    if (quiet) {
      setLoading(false)
    } else {
      setLoading(true)
      setViewData(null)
    }
    setError('')
    try {
      const overviewPath = role === 'candidate' ? '/dashboard/candidate' : role === 'recruiter' ? '/dashboard/recruiter' : '/dashboard/admin'
      const overview = await api(overviewPath)
      if (requestId !== loadSequence.current) return
      setPayload(overview)
      let nextView = overview
      if (role === 'super_admin' && activePage === 'Overview') {
        nextView = await api('/admin/organizations?status=pending&limit=5')
        if (requestId !== loadSequence.current) return
      }
      if (activePage !== 'Overview') {
        if (role === 'candidate') {
          const endpoint = {
            'Find Jobs': '/jobs',
            'My Applications': `/candidate/applications${showRemovedApplications ? '?archived=true' : ''}`,
            'Saved Jobs': '/candidate/saved-jobs',
            'My Profile': '/dashboard/candidate',
            Resume: '/dashboard/candidate',
            Interviews: '/candidate/interviews',
            Notifications: `/candidate/notifications?archived=${showArchivedNotifications}`,
            Settings: '/candidate/settings',
          }[activePage]
          nextView = await api(endpoint)
          if (requestId !== loadSequence.current) return
        } else if (role === 'recruiter') {
          const endpoint = {
            'Manage Jobs': '/recruiter/jobs',
            Applications: `/recruiter/applications${showArchivedApplications ? '?archived=true' : ''}`,
            Candidates: '/recruiter/candidates',
            'Discover Candidates': '/recruiter/discoverable-candidates',
            Interviews: '/recruiter/interviews',
            'Company Profile': '/dashboard/recruiter',
            'Team Management': '/recruiter/team',
            Notifications: '/recruiter/notifications',
            Settings: '/recruiter/settings',
          }[activePage]
          if (activePage !== 'Post a Job') {
            nextView = await api(endpoint)
            if (requestId !== loadSequence.current) return
          }
        } else {
          const endpoint = {
            'User Management': '/admin/users',
            'Organization Management': '/admin/organizations',
            'Job Management': '/admin/jobs',
            'Application Monitoring': '/admin/applications',
            'Verification Requests': '/admin/organizations?status=pending',
            'Reports & Complaints': '/admin/reports',
            'Platform Analytics': '/dashboard/admin',
            'Admin Management': '/admin/admins',
            'Audit Logs': '/admin/audit-logs',
            Notifications: '/admin/notifications',
            Settings: '/admin/settings',
          }[activePage]
          nextView = await api(endpoint)
          if (requestId !== loadSequence.current) return
        }
      }
      setViewData(nextView)
    } catch (loadError) {
      if (requestId !== loadSequence.current) return
      setError(loadError.message)
      if (role === 'recruiter' && /organization registration/i.test(loadError.message)) navigate('/onboarding/recruiter', { replace: true })
    } finally {
      if (requestId === loadSequence.current && !quiet) setLoading(false)
    }
  }, [activePage, navigate, role, showArchivedApplications, showArchivedNotifications, showRemovedApplications])

  const refreshAfterProfileSave = useCallback(async () => {
    await reload({ quiet: true })
    setProfileSaveMessage('Your profile has been updated successfully.')
  }, [reload])

  useEffect(() => {
    void reload()
    return () => { loadSequence.current += 1 }
  }, [reload])

  useEffect(() => {
    if (role !== 'candidate') return undefined

    let active = true
    const refreshUnreadNotifications = async () => {
      try {
        const { summary } = await api('/dashboard/candidate')
        if (active) {
          setPayload((current) => current
            ? { ...current, summary: { ...current.summary, unreadNotifications: summary.unreadNotifications } }
            : current)
        }
      } catch (pollError) {
        if (active) setActionError(pollError.message)
      }
    }

    const intervalId = window.setInterval(refreshUnreadNotifications, 60000)
    window.addEventListener('focus', refreshUnreadNotifications)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshUnreadNotifications)
    }
  }, [role])

  const goTo = (label) => {
    navigate(label === 'Overview' ? paths[role] : `${paths[role]}/${slug(label)}`)
    setSearch('')
    setActionError('')
    setActionMessage('')
    setProfileSaveMessage('')
    setJobPostMessage('')
  }

  const mutate = async (operation) => {
    setActionError('')
    try {
      await operation()
      await reload()
    } catch (operationError) {
      setActionError(operationError.message)
    }
  }

  const runNotificationMutation = async (operation) => {
    setNotificationActionsBusy(true)
    try {
      await mutate(operation)
    } finally {
      setNotificationActionsBusy(false)
    }
  }

  const inspectCandidate = async (candidateId, canInvite = false) => {
    setActionError('')
    try {
      const { candidate } = await api(`/recruiter/candidates/${candidateId}`)
      setSelectedCandidate(candidate)
      setCanInviteSelectedCandidate(canInvite)
    } catch (requestError) {
      setActionError(requestError.message)
    }
  }

  const openApplicationResume = async (applicationId) => {
    setActionError('')
    try {
      const { url } = await api(`/recruiter/applications/${applicationId}/resume`)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (requestError) {
      setActionError(requestError.message)
    }
  }

  const metrics = useMemo(() => {
    if (!payload) return []
    if (role === 'candidate') {
      const stats = payload.summary
      return [
        { label: 'Applications sent', value: stats.applicationsSent, Icon: ClipboardList },
        { label: 'Profile views', value: stats.profileViews, Icon: UserRound },
        { label: 'Upcoming interviews', value: stats.interviews, Icon: BriefcaseBusiness },
      ]
    }
    if (role === 'recruiter') {
      return [
        { label: 'Total jobs posted', value: payload.summary.totalJobs, Icon: BriefcaseBusiness },
        { label: 'Active jobs', value: payload.summary.activeJobs, Icon: ClipboardList },
        { label: 'Total applicants', value: payload.summary.totalApplicants, Icon: Users },
        { label: 'Shortlisted', value: payload.summary.shortlisted, Icon: UserRound },
        { label: 'Interviews scheduled', value: payload.summary.interviews, Icon: Bell },
      ]
    }
    return [
      { label: 'Total candidates', value: payload.summary.totalCandidates, Icon: UserRound },
      { label: 'Total recruiters', value: payload.summary.totalRecruiters, Icon: Users },
      { label: 'Organizations', value: payload.summary.totalOrganizations, Icon: Building2 },
      { label: 'Verified organizations', value: payload.summary.verifiedOrganizations, Icon: Shield },
      { label: 'Pending verifications', value: payload.summary.pendingVerifications, Icon: ClipboardList },
      { label: 'Active jobs', value: payload.summary.activeJobs, Icon: BriefcaseBusiness },
      { label: 'Applications', value: payload.summary.totalApplications, Icon: FileText },
    ]
  }, [payload, role])

  if (loading && !payload) return <Loading />
  const isCandidate = role === 'candidate'
  const isRecruiter = role === 'recruiter'
  const isAdmin = role === 'super_admin'
  const organizationTimeZone = isRecruiter ? payload?.company?.timezone || 'UTC' : undefined

  async function saveJob(jobId) {
    await api(`/candidate/saved-jobs/${jobId}`, { method: 'POST', body: {} })
  }

  async function adminStatus(kind, id, status) {
    const endpoint = kind === 'company'
      ? `/admin/organizations/${id}/status`
      : kind === 'user'
        ? `/admin/users/${id}/status`
        : `/admin/jobs/${id}/status`
    await api(endpoint, { method: 'PATCH', body: { status } })
  }

  let table = null
  if (isCandidate && activePage === 'My Applications') {
    table = <DataTable columns={['Position', 'Organization', 'Status', 'Applied']} rows={(viewData?.items || []).map((item) => ({
      id: item._id, cells: [item.job?.title, item.company?.name, <Pill key="status">{item.status}</Pill>, dateLabel(item.createdAt)], resource: item,
    }))} actions={(row) => <div className="application-actions">
      {row.resource.job?._id && <button type="button" className="org-action-button" onClick={() => navigate(`/jobs/${row.resource.job._id}`)}>View job</button>}
      {showRemovedApplications
        ? <button type="button" className="org-action-button" onClick={() => mutate(() => api(`/candidate/applications/${row.id}/archive`, { method: 'PATCH', body: { archived: false } }))}>Restore</button>
        : <>
          {['submitted', 'under_review', 'shortlisted'].includes(row.resource.status) && <button type="button" className="org-action-button org-remove-button" onClick={() => mutate(() => api(`/candidate/applications/${row.id}/withdraw`, { method: 'PATCH' }))}>Withdraw</button>}
          <button type="button" className="org-action-button org-remove-button" onClick={async () => {
            if (!window.confirm('Remove this application from your list? It will remain visible to the organization.')) return
            await mutate(() => api(`/candidate/applications/${row.id}/archive`, { method: 'PATCH', body: { archived: true } }))
          }}>Delete</button>
        </>}
    </div>} empty={showRemovedApplications ? 'No removed applications.' : 'You have not applied to any jobs yet.'} />
  } else if (isCandidate && activePage === 'Saved Jobs') {
    table = <DataTable columns={['Position', 'Organization', 'Location', '']} rows={(viewData?.items || []).map((item) => ({
      id: item._id, cells: [item.job?.title, item.job?.company?.name, item.job?.location, <button type="button" className="text-button" key="open" onClick={() => navigate(`/jobs/${item.job?._id}`)}>View job</button>], resource: item,
    }))} actions={(row) => <button type="button" className="org-action-button" onClick={() => mutate(() => api(`/candidate/saved-jobs/${row.resource.job?._id}`, { method: 'DELETE' }))}>Remove</button>} empty="Saved jobs will show up here." />
  } else if (isCandidate && activePage === 'Interviews') {
    table = <DataTable columns={['Interview', 'Organization', 'Date', 'Duration', 'Meeting']} rows={(viewData?.items || []).map((item) => ({
      id: item._id,
      cells: [item.application?.job?.title, item.company?.name, new Date(item.scheduledAt).toLocaleString(), `${item.durationMinutes} minutes`, item.meetingUrl ? <a key="meeting" className="meeting-link" href={item.meetingUrl} target="_blank" rel="noreferrer">Join meeting</a> : 'Details in your invitation'],
      resource: item,
    }))} empty="Upcoming interviews will appear here." />
  } else if (activePage === 'Notifications' && (isCandidate || isRecruiter || isAdmin)) {
    const notificationBase = isCandidate ? '/candidate' : isRecruiter ? '/recruiter' : '/admin'
    table = <DataTable columns={['Notification', 'Message', 'Date']} rows={(viewData?.items || []).map((item) => ({
      id: item._id, cells: [item.title, item.message, dateLabel(item.createdAt, organizationTimeZone)], resource: item,
    }))} actions={(row) => {
      const isJobInvitation = isCandidate && row.resource.type === 'job_invitation' && row.resource.relatedId
      return <div className="application-actions">
        {isJobInvitation && <button type="button" className="org-action-button" onClick={() => navigate(`/jobs/${row.resource.relatedId}`)}>View job</button>}
        {!row.resource.readAt && <button type="button" className="org-action-button" disabled={notificationActionsBusy} onClick={() => isCandidate
          ? runNotificationMutation(() => api(`${notificationBase}/notifications/${row.id}/read`, { method: 'PATCH' }))
          : mutate(() => api(`${notificationBase}/notifications/${row.id}/read`, { method: 'PATCH' }))}>Mark read</button>}
        {!isCandidate && row.resource.readAt && !isJobInvitation && 'Read'}
        {isCandidate && <button type="button" className="org-action-button" disabled={notificationActionsBusy} onClick={() => runNotificationMutation(() => api(`/candidate/notifications/${row.id}/archive`, { method: 'PATCH', body: { archived: !showArchivedNotifications } }))}>{showArchivedNotifications ? 'Restore' : 'Archive'}</button>}
        {isCandidate && <button type="button" className="org-action-button org-remove-button" disabled={notificationActionsBusy} onClick={async () => {
          if (!window.confirm('Permanently delete this notification?')) return
          await runNotificationMutation(() => api(`/candidate/notifications/${row.id}`, { method: 'DELETE' }))
        }}>Delete</button>}
      </div>
    }} empty={isCandidate && showArchivedNotifications ? 'No archived notifications.' : 'You’re all caught up.'} className={isCandidate ? 'candidate-notification-table' : ''} />
  } else if (isRecruiter && ['Manage Jobs', 'Applications', 'Candidates'].includes(activePage)) {
    const rows = activePage === 'Manage Jobs'
      ? (viewData?.items || []).map((job) => ({
        id: job._id,
        cells: [job.title, humanize(job.status), job.location, dateLabel(job.createdAt, organizationTimeZone)],
        resource: job,
      }))
      : activePage === 'Applications'
        ? (viewData?.items || []).map((item) => ({
          id: item._id,
          cells: [item.candidate?.name, item.job?.title, <Pill key="status">{item.status}</Pill>, dateLabel(item.createdAt, organizationTimeZone)],
          resource: item,
        }))
        : (viewData?.items || []).map((item) => ({
          id: item.candidate._id,
          cells: [item.candidate.name, item.candidate.email, item.candidate.title || '—', item.applications.length],
          resource: item,
        }))
    table = <DataTable
      columns={activePage === 'Manage Jobs'
        ? ['Job', 'Status', 'Location', 'Created']
        : activePage === 'Applications'
          ? ['Candidate', 'Job', 'Stage', 'Received']
          : ['Candidate', 'Email', 'Title', 'Applications']}
      rows={rows}
      actions={(row) => activePage === 'Manage Jobs'
        ? <div className="application-actions">
          <button className="org-action-button" type="button" onClick={() => mutate(() => api(`/recruiter/jobs/${row.id}/status`, { method: 'PATCH', body: { status: row.resource.status === 'published' ? 'paused' : 'published' } }))}>{row.resource.status === 'published' ? 'Pause' : 'Publish'}</button>
          <button className="org-action-button org-remove-button" type="button" onClick={() => {
            if (window.confirm(`Permanently delete "${row.resource.title}"? Applications, saved-job entries, and interviews will remain, but the job details will no longer be available.`)) {
              mutate(() => api(`/recruiter/jobs/${row.id}`, { method: 'DELETE' }))
            }
          }}>Delete</button>
        </div>
        : activePage === 'Candidates'
          ? <div className="application-actions"><button type="button" className="org-action-button" onClick={() => inspectCandidate(row.resource.candidate._id)}>View profile</button>{row.resource.applications[0] && <button type="button" className="org-action-button" onClick={() => openApplicationResume(row.resource.applications[0].id)}>Resume</button>}</div>
          : <div className="application-actions">
            {!showArchivedApplications && <select className="application-status-select" aria-label={`Update status for ${row.resource.candidate?.name}`} defaultValue={row.resource.status} onChange={(event) => mutate(() => api(`/recruiter/applications/${row.id}/status`, { method: 'PATCH', body: { status: event.target.value } }))}><option value="submitted" disabled>Submitted</option><option value="under_review">Under review</option><option value="shortlisted">Shortlisted</option><option value="interview_scheduled">Interview scheduled</option><option value="selected">Selected</option><option value="rejected">Rejected</option></select>}
            <button type="button" className="org-action-button" onClick={() => inspectCandidate(row.resource.candidate?._id)}>View profile</button>
            <button type="button" className="org-action-button" onClick={() => openApplicationResume(row.id)}>Resume</button>
            {!showArchivedApplications && <ScheduleInterviewForm applicationId={row.id} onSaved={reload} onScheduled={setActionMessage} />}
            <button type="button" className="org-action-button" aria-label={`${showArchivedApplications ? 'Restore' : 'Archive'} application for ${row.resource.candidate?.name || 'candidate'}`} onClick={() => mutate(() => api(`/recruiter/applications/${row.id}/archive`, { method: 'PATCH', body: { archived: !showArchivedApplications } }))}>{showArchivedApplications ? 'Restore' : 'Archive'}</button>
          </div>}
      empty={showArchivedApplications ? 'No archived applications.' : 'No records to show yet.'}
    />
  } else if (isRecruiter && activePage === 'Discover Candidates') {
    table = <DataTable columns={['Candidate', 'Headline', 'Location', 'Skills']} rows={(viewData?.items || []).map((candidate) => ({
      id: candidate._id,
      cells: [candidate.name, candidate.title || '—', candidate.location || '—', candidate.skills?.join(', ') || '—'],
      resource: candidate,
    }))} actions={(row) => <button type="button" className="org-action-button" onClick={() => inspectCandidate(row.id, true)}>View profile</button>} empty="No candidates are currently open to opportunities." />
  } else if (isRecruiter && activePage === 'Interviews') {
    table = <DataTable columns={['Candidate', 'Job', 'Date', 'Duration', 'Meeting']} rows={(viewData?.items || []).map((item) => ({
      id: item._id,
      cells: [item.candidate?.name, item.application?.job?.title, new Date(item.scheduledAt).toLocaleString(undefined, { timeZone: organizationTimeZone || 'UTC', timeZoneName: 'short' }), `${item.durationMinutes} minutes`, item.meetingUrl ? <a key="meeting" className="meeting-link" href={item.meetingUrl} target="_blank" rel="noreferrer">Join meeting</a> : '—'],
      resource: item,
    }))} empty="Scheduled interviews will appear here." />
  } else if (isAdmin && activePage === 'Organization Management' || isAdmin && activePage === 'Verification Requests') {
    const organizations = viewData?.items || []
    table = <DataTable columns={['Organization', 'Contact', 'Status', 'Joined']} rows={organizations.map((company) => ({
      id: company._id,
      cells: [company.name, company.contactEmail || company.owner?.email, <Pill key="status">{company.status}</Pill>, dateLabel(company.createdAt)],
      resource: company,
    }))} actions={(row) => <div className="organization-actions">
      {row.resource.status !== 'verified' && <button className="org-action-button" type="button" onClick={() => mutate(() => adminStatus('company', row.id, 'verified'))}>Verify</button>}
      {row.resource.status !== 'suspended' && <button className="org-action-button" type="button" onClick={() => mutate(() => adminStatus('company', row.id, 'suspended'))}>Suspend</button>}
      <button className="org-action-button org-remove-button" type="button" onClick={() => {
        if (window.confirm(`Remove ${row.resource.name} from the marketplace? Their jobs will be closed and their team access suspended.`)) {
          mutate(() => api(`/admin/organizations/${row.id}`, { method: 'DELETE' }))
        }
      }}>Remove</button>
    </div>} empty="No organizations match this view." />
  } else if (isAdmin && activePage === 'User Management') {
    table = <DataTable columns={['Name', 'Email', 'Role', 'Status', 'Joined']} rows={(viewData?.items || []).map((account) => ({
      id: account._id, cells: [account.name, account.email, humanize(account.role), <Pill key="status">{account.status}</Pill>, dateLabel(account.createdAt)], resource: account,
    }))} actions={(row) => row.resource.role !== 'super_admin' && <button className="org-action-button" type="button" onClick={() => mutate(() => adminStatus('user', row.id, row.resource.status === 'active' ? 'suspended' : 'active'))}>{row.resource.status === 'active' ? 'Suspend' : 'Reactivate'}</button>} />
  } else if (isAdmin && activePage === 'Job Management') {
    table = <DataTable columns={['Job', 'Organization', 'Status', 'Created']} rows={(viewData?.items || []).map((job) => ({
      id: job._id, cells: [job.title, job.company?.name, <Pill key="status">{job.status}</Pill>, dateLabel(job.createdAt)], resource: job,
    }))} actions={(row) => <select aria-label={`Moderate ${row.resource.title}`} value={row.resource.status} onChange={(event) => mutate(() => adminStatus('job', row.id, event.target.value))}><option value="pending_review" disabled>Pending review</option><option value="published">Approve / publish</option><option value="paused">Pause</option><option value="rejected">Reject</option><option value="closed">Remove / close</option></select>} />
  } else if (isAdmin && activePage === 'Application Monitoring') {
    table = <DataTable columns={['Candidate', 'Job', 'Organization', 'Status', 'Applied']} rows={(viewData?.items || []).map((application) => ({
      id: application._id, cells: [application.candidate?.name, application.job?.title, application.company?.name, <Pill key="status">{application.status}</Pill>, dateLabel(application.createdAt)],
    }))} />
  } else if (isAdmin && activePage === 'Reports & Complaints') {
    table = <DataTable columns={['Reason', 'Target', 'Status', 'Reported']} rows={(viewData?.items || []).map((report) => ({
      id: report._id, cells: [report.reason, humanize(report.targetType), <Pill key="status">{report.status}</Pill>, dateLabel(report.createdAt)], resource: report,
    }))} actions={(row) => <select aria-label={`Update report ${row.id}`} value={row.resource.status} onChange={(event) => mutate(() => api(`/admin/reports/${row.id}/status`, { method: 'PATCH', body: { status: event.target.value } }))}><option value="open" disabled>Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolve</option><option value="dismissed">Dismiss</option></select>} />
  } else if (isAdmin && activePage === 'Audit Logs') {
    table = <DataTable columns={['Action', 'Actor', 'Target', 'Date']} rows={(viewData?.items || []).map((log) => ({
      id: log._id, cells: [humanize(log.action), log.actor?.email, `${humanize(log.targetType)}${log.target ? ` · ${log.target}` : ''}`, dateLabel(log.createdAt)],
    }))} empty="Admin actions will appear here as they are performed." />
  }

  const canSearch = ['Organization Management', 'Verification Requests', 'User Management', 'Job Management', 'Application Monitoring', 'Reports & Complaints'].includes(activePage)
  const filteredTable = table ? cloneElement(table, { search: canSearch ? search : '' }) : null

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar dashboard-sidebar-intro">
        <a href="/" className="brand"><span className="brand-symbol">e</span><span className="brand-wordmark">eclearnix<span>jobs</span></span></a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <div className="workspace-switcher"><span className={`workspace-avatar avatar-${role}`}>{(role === 'recruiter' ? payload?.company?.name : user.name)?.charAt(0) || 'E'}</span><span><strong>{role === 'recruiter' ? payload?.company?.name || 'Organization' : role === 'super_admin' ? 'Super Admin' : user.name}</strong><small>{role === 'super_admin' ? 'Platform control' : role === 'recruiter' ? payload?.company?.status === 'verified' ? 'Verified organization' : 'Pending organization' : 'Candidate workspace'}</small></span></div>
        <nav className="dashboard-nav" aria-label={`${role} navigation`}>
          <span className="nav-section-label">WORKSPACE</span>
          {navItems.map(([label, Icon], index) => {
            const unreadNotifications = isCandidate && label === 'Notifications' ? payload?.summary?.unreadNotifications || 0 : 0
            return <button key={label} type="button" className={`dashboard-nav-item ${activePage === label ? 'dashboard-nav-active' : ''}`} style={{ '--sidebar-item-index': index }} onClick={() => goTo(label)} aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : label}>
              <span className="nav-icon"><Icon size={16} />{unreadNotifications > 0 && <span className="notification-unread-dot" aria-hidden="true" />}</span>
              {label}
              {isAdmin && label === 'Verification Requests' && payload?.summary?.pendingVerifications > 0 && <span className="nav-count">{payload.summary.pendingVerifications}</span>}
            </button>
          })}
        </nav>
        {!isCandidate && <button type="button" className="logout-button" onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}><LogOut size={15} /> Sign out</button>}
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{activePage}</strong></div><div className="topbar-actions">{isAdmin && <label className="search-box"><Search size={15} /><input aria-label="Search this dashboard" placeholder="Search..." value={search} onChange={(event) => setSearch(event.target.value)} /></label>}{isCandidate && <button type="button" className="topbar-notification-button" aria-label="Open notifications" onClick={() => goTo('Notifications')}>{payload?.summary?.unreadNotifications > 0 && <span className="notification-unread-dot topbar-unread-dot" aria-hidden="true" />}<Bell className="topbar-notification-bell" size={20} /></button>}{isCandidate ? <StaggeredMenu
          className="profile-staggered-menu"
          displayItemNumbering={false}
          trigger={<><UserAvatar key={user.picture} name={user.name} picture={user.picture} /><strong className="profile-name">{user.name}</strong></>}
          items={[
            { label: 'Recruiter actions', icon: <Users size={16} />, onClick: () => goTo('Notifications') },
            { label: 'View & update profile', icon: <UserRound size={16} />, onClick: () => goTo('My Profile') },
            { label: 'Settings', icon: <Settings size={16} />, onClick: () => goTo('Settings') },
            { label: 'Logout', icon: <LogOut size={16} />, onClick: async () => { await signOut(); navigate('/login', { replace: true }) } },
          ]}
        /> : <><UserAvatar key={user.picture} name={user.name} picture={user.picture} /><strong className="profile-name">{user.name}</strong></>}</div></header>
        <div className="dashboard-content">
          <div className="dashboard-welcome"><div><div className="date-line">{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div><h1>{title}</h1><p>{isAdmin ? 'Manage people, organizations, and the standards that make this marketplace trusted.' : isRecruiter ? `Your organization is ${payload?.company?.status || 'loading'} · see what needs your attention today.` : 'A thoughtful next step can bring the right opportunity closer.'}</p></div>
            {isCandidate && <button className="green-button" type="button" onClick={() => goTo('My Profile')}>Complete profile <ArrowRight size={14} /></button>}
            {isRecruiter && <button className="green-button" type="button" onClick={() => goTo('Post a Job')}>Post a job <ArrowRight size={14} /></button>}
          </div>

          {isRecruiter && payload?.company?.status !== 'verified' && <div className="demo-banner"><span className="demo-banner-icon">i</span><span><strong>Organization verification</strong> &nbsp;Your profile is under review. You can prepare job drafts, but only verified organizations can publish.</span></div>}
          {actionError && <ErrorNotice message={actionError} />}
          {actionMessage && <p className="integration-notice" role="status">{actionMessage}</p>}
          {error && <ErrorNotice message={error} onRetry={reload} />}
          {profileSaveMessage && <p className="profile-save-success" role="status">{profileSaveMessage}</p>}
          {jobPostMessage && <p className="integration-notice" role="status">{jobPostMessage}</p>}
              {selectedCandidate && <CandidatePreview candidate={selectedCandidate} canInvite={canInviteSelectedCandidate} onClose={() => { setSelectedCandidate(null); setCanInviteSelectedCandidate(false) }} />}

          {loading && payload && <Loading />}
          {!loading && !error && activePage === 'Overview' && (
            <>
              <MetricCards items={metrics} />
              {isCandidate && <div className="dashboard-lower">
                <section className="data-card"><div className="card-heading"><div><h2>Recent applications</h2><p>Keep track of the roles you’ve applied for.</p></div><button className="subtle-button" type="button" onClick={() => goTo('My Applications')}>View all <ArrowRight size={13} /></button></div><DataTable columns={['Position', 'Organization', 'Status', 'Applied']} rows={(payload.recentApplications || []).map((item) => ({ id: item._id, cells: [item.job?.title, item.company?.name, <Pill key="status">{item.status}</Pill>, dateLabel(item.createdAt)] }))} empty="Your applications will appear here." /></section>
                <aside className="side-stack"><article className="progress-card"><div className="progress-heading"><div><span>Profile strength</span><strong>{payload.summary.profileStrength}%</strong></div></div><div className="progress-track"><span style={{ width: `${payload.summary.profileStrength}%` }} /></div><p>A complete profile helps organizations understand what you bring.</p><button type="button" onClick={() => goTo('My Profile')}>Update profile <ArrowRight size={13} /></button></article><article className="spotlight-card"><h3>Recommended jobs</h3>{payload.recommendedJobs?.length ? payload.recommendedJobs.slice(0, 3).map((job) => <button type="button" className="recommended-job" key={job._id} onClick={() => navigate(`/jobs/${job._id}`)}><strong>{job.title}</strong><span>{job.company?.name} · {job.location}</span></button>) : <p>Add skills to your profile to get more relevant recommendations.</p>}</article></aside>
              </div>}
              {isRecruiter && <div className="dashboard-lower"><section className="data-card"><div className="card-heading"><div><h2>Latest applicants</h2><p>Applications received for your organization’s jobs.</p></div><button className="subtle-button" type="button" onClick={() => goTo('Applications')}>View all <ArrowRight size={13} /></button></div><DataTable columns={['Candidate', 'Position', 'Stage', 'Received']} rows={(payload.recentApplications || []).map((item) => ({ id: item._id, cells: [item.candidate?.name, item.job?.title, <Pill key="status">{item.status}</Pill>, dateLabel(item.createdAt, organizationTimeZone)] }))} empty="New applications will appear here." /></section><article className="spotlight-card"><h3>Organization status</h3><Pill>{payload.company?.status}</Pill><p>{payload.company?.status === 'verified' ? 'Your organization can publish jobs.' : 'You can manage drafts while your verification is reviewed.'}</p><button type="button" onClick={() => goTo('Company Profile')}>View company profile <ArrowRight size={13} /></button></article></div>}
              {isAdmin && <div className="dashboard-lower"><section className="data-card"><div className="card-heading"><div><h2>Organizations needing review</h2><p>Help keep the marketplace trustworthy.</p></div><button className="subtle-button" type="button" onClick={() => goTo('Verification Requests')}>Review queue <ArrowRight size={13} /></button></div><AdminOrganizationTable rows={viewData?.items || []} onAction={mutate} /></section><article className="spotlight-card"><h3>Platform controls</h3><p>Manage organizations, job listings, people, and shared marketplace settings.</p><button type="button" onClick={() => goTo('Organization Management')}>Manage platform <ArrowRight size={13} /></button></article></div>}
            </>
          )}

          {!loading && !error && isCandidate && activePage === 'Find Jobs' && <JobSearch onOpen={(id) => navigate(`/jobs/${id}`)} onSaved={(id) => mutate(() => saveJob(id))} />}
          {!loading && !error && isRecruiter && activePage === 'Post a Job' && <JobPostForm onCreated={(job) => {
            goTo('Manage Jobs')
            setJobPostMessage(job.status === 'pending_review'
              ? 'Job submitted for review. Candidates will see it after it is approved and published.'
              : 'Draft saved. Publish it when ready; candidates only see published jobs.')
          }} />}
          {!loading && !error && isCandidate && activePage === 'My Profile' && <CandidateProfile profile={viewData?.profile} onSaved={reload} onProfileSaveStart={() => setProfileSaveMessage('')} onProfileSaved={refreshAfterProfileSave} showHeading={false} largeText />}
          {!loading && !error && isCandidate && activePage === 'Resume' && <CandidateResume profile={viewData?.profile} onSaved={reload} />}
          {!loading && !error && isAdmin && activePage === 'Settings' && <SuperAdminSettings settings={viewData?.items || []} reload={reload} />}
          {!loading && !error && isRecruiter && activePage === 'Settings' && <OrganizationSettings settings={viewData} reload={reload} />}
          {!loading && !error && isAdmin && activePage === 'Admin Management' && <AdminInvites data={viewData} reload={reload} />}
          {!loading && !error && isRecruiter && activePage === 'Company Profile' && <CompanyProfile company={viewData?.company} onSaved={reload} />}
          {!loading && !error && isCandidate && activePage === 'Settings' && <CandidateSettings notificationPreferences={viewData?.notificationPreferences || payload?.notificationPreferences} onSaved={reload} />}
          {!loading && !error && isRecruiter && activePage === 'Team Management' && <TeamManagement data={viewData} reload={reload} timeZone={organizationTimeZone} />}
          {!loading && !error && table && <section className="module-section">
            {isCandidate && activePage === 'My Applications' && <div className="candidate-applications-toolbar">
              <button type="button" className="subtle-button" onClick={() => setShowRemovedApplications((current) => !current)}>{showRemovedApplications ? 'View active applications' : 'View deleted applications'}</button>
            </div>}
            {isCandidate && activePage === 'Notifications' && <div className="candidate-notifications-toolbar">
              <button type="button" className="subtle-button" disabled={notificationActionsBusy} onClick={() => setShowArchivedNotifications((current) => !current)}>{showArchivedNotifications ? 'View active notifications' : 'View archived notifications'}</button>
              <button type="button" className="org-action-button org-remove-button" disabled={notificationActionsBusy} onClick={async () => {
                if (!window.confirm('Permanently delete all of your notifications, including archived ones? This cannot be undone.')) return
                await runNotificationMutation(() => api('/candidate/notifications', { method: 'DELETE' }))
              }}>Clear notifications</button>
            </div>}
            {(canSearch || isRecruiter && activePage === 'Applications') && <div className="module-heading">
              <div>
                {(activePage !== 'Applications' || showArchivedApplications) && <h2>{activePage === 'Applications' ? 'Archived applications' : activePage}</h2>}
                <p>{activePage === 'Applications'
                  ? showArchivedApplications
                    ? 'Archived applications are hidden from the active list and can be restored.'
                    : 'Review and manage applications for your organization’s jobs.'
                  : 'Search and manage workspace records.'}</p>
              </div>
              {isRecruiter && activePage === 'Applications'
                ? <button className="subtle-button" type="button" onClick={() => setShowArchivedApplications((current) => !current)}>{showArchivedApplications ? 'View active applications' : 'View archived applications'}</button>
                : canSearch && <input className="module-search" aria-label={`Filter ${activePage}`} placeholder="Filter results…" value={search} onChange={(event) => setSearch(event.target.value)} />}
            </div>}
            {filteredTable}
          </section>}

          <footer className="dashboard-footer"><span>Made for better work, together.</span><span>Signed in as {user.email}</span></footer>
        </div>
      </main>
    </div>
  )
}

function AdminOrganizationTable({ rows, onAction }) {
  return <DataTable columns={['Organization', 'Status', 'Submitted']} rows={rows.filter((item) => item.status === 'pending').slice(0, 5).map((company) => ({
    id: company._id, cells: [company.name, <Pill key="status">{company.status}</Pill>, dateLabel(company.createdAt)], resource: company,
  }))} actions={(row) => <div className="organization-actions"><button type="button" className="org-action-button" onClick={() => onAction(() => api(`/admin/organizations/${row.id}/status`, { method: 'PATCH', body: { status: 'verified' } }))}>Verify</button><button type="button" className="org-action-button org-remove-button" onClick={() => onAction(() => api(`/admin/organizations/${row.id}/status`, { method: 'PATCH', body: { status: 'rejected' } }))}>Reject</button></div>} empty="No organizations are waiting for review." />
}

function CompanyProfile({ company, onSaved }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      await api('/recruiter/company', { method: 'PATCH', body: {
        name: form.get('name'),
        website: form.get('website'),
        industry: form.get('industry'),
        size: form.get('size'),
        location: form.get('location'),
        description: form.get('description'),
        contactEmail: form.get('contactEmail'),
      } })
      await onSaved()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }
  return <section className="module-section"><div className="module-heading"><div><h2>Organization profile</h2><p>Keep your organization information up to date. Verification status is managed by the platform team.</p></div></div>{company && <form className="module-form" onSubmit={save}>
    <label>Organization name<input name="name" defaultValue={company.name || ''} required /></label>
    <div className="form-two-col"><label>Contact email<input name="contactEmail" type="email" defaultValue={company.contactEmail || ''} required /></label><label>Website<input name="website" type="url" defaultValue={company.website || ''} /></label></div>
    <div className="form-two-col"><label>Industry<input name="industry" defaultValue={company.industry || ''} /></label><label>Company size<input name="size" defaultValue={company.size || ''} /></label></div>
    <label>Location<input name="location" defaultValue={company.location || ''} /></label>
    <label>About your organization<textarea name="description" rows="4" defaultValue={company.description || ''} /></label>
    <p className="integration-notice">Verification status: {humanize(company.status)}. Only verified organizations can publish jobs.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="green-button" disabled={busy}>{busy ? 'Saving…' : 'Save organization profile'} <ArrowRight size={14} /></button>
  </form>}</section>
}

function JobReportForm({ jobId }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      await api('/reports', {
        method: 'POST',
        body: { targetType: 'job', target: jobId, reason: form.get('reason'), details: form.get('details') },
      })
      setOpen(false)
      setMessage('Thanks for letting us know. The platform team will review this listing.')
    } catch (reportError) {
      setMessage(reportError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="job-report">
      {message && <p className="integration-notice" role="status">{message}</p>}
      {!open
        ? <button type="button" className="text-button" onClick={() => { setOpen(true); setMessage('') }}>Report this listing</button>
        : <form className="module-form" onSubmit={submit}>
          <label>What should we know?
            <select name="reason" required defaultValue="">
              <option value="" disabled>Choose a reason</option>
              <option>Misleading or inaccurate</option>
              <option>Suspicious or fraudulent</option>
              <option>Discriminatory content</option>
              <option>Other concern</option>
            </select>
          </label>
          <label>Additional details <small>Optional</small><textarea name="details" rows="3" maxLength="3000" /></label>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <div className="form-submit-row"><button type="button" className="subtle-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="green-button" disabled={busy}>{busy ? 'Sending…' : 'Submit report'}</button></div>
        </form>}
    </div>
  )
}

class DashboardErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Dashboard page failed to render:', error, info)
  }

  handleRetry = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <main className="dashboard-render-error">
          <section className="dashboard-render-error-card" role="alert">
            <h1>This workspace page could not be displayed.</h1>
            <p>{this.state.error.message || 'An unexpected rendering error occurred.'}</p>
            <button type="button" className="green-button" onClick={this.handleRetry}>Try again</button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

export default function DashboardPage({ role }) {
  const { user } = useAuth()
  if (role !== user?.role) return <Loading />
  return <DashboardErrorBoundary><DashboardWorkspace role={role} /></DashboardErrorBoundary>
}

export function JobDetailsPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showApplyForm, setShowApplyForm] = useState(false)
  const [resume, setResume] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api(`/jobs/${jobId}`).then((result) => setJob(result.job)).catch((loadError) => setError(loadError.message))
  }, [jobId])

  async function apply() {
    setBusy(true)
    setError('')
    try {
      const form = document.getElementById('job-application-form')
      const body = new FormData()
      if (form) body.set('coverLetter', new FormData(form).get('coverLetter') || '')
      if (resume) body.set('resume', resume)
      await api(`/jobs/${jobId}/applications`, { method: 'POST', body })
      navigate('/candidate/my-applications')
    } catch (applyError) {
      setError(applyError.message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setError('')
    try {
      await api(`/candidate/saved-jobs/${jobId}`, { method: 'POST', body: {} })
      setSaved(true)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  if (error) return <div className="job-details-page"><button className="text-button" type="button" onClick={() => navigate(-1)}>← Back</button><ErrorNotice message={error} /></div>
  if (!job) return <Loading message="Loading job details…" />
  return <main className="job-details-page"><button className="text-button" type="button" onClick={() => navigate(-1)}>← Back to jobs</button><article className="job-details-card"><div className="job-details-head"><div className="company-avatar">{job.company?.name?.slice(0, 1)}</div><div><h1>{job.title}</h1><p>{job.company?.name} · {job.location}</p></div><Pill>{job.workMode}</Pill></div><div className="job-details-meta"><span>{humanize(job.employmentType)}</span><span>{job.experienceLevel || 'Experience flexible'}</span>{job.salaryMin && <span>{job.currency} {job.salaryMin.toLocaleString()}–{job.salaryMax?.toLocaleString()}</span>}</div><section><h2>About the role</h2><p>{job.description}</p></section>{job.responsibilities?.length > 0 && <section><h2>What you’ll do</h2><ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section>}{job.qualifications?.length > 0 && <section><h2>What we’re looking for</h2><ul>{job.qualifications.map((item) => <li key={item}>{item}</li>)}</ul></section>}<section><h2>Skills</h2><div className="setting-tags">{job.skills?.map((skill) => <span className="master-option" key={skill}>{skill}</span>)}</div></section>{error && <ErrorNotice message={error} />}{showApplyForm && <form id="job-application-form" className="application-form" onSubmit={(event) => { event.preventDefault(); apply() }}><label>Cover letter <small>Optional</small><textarea name="coverLetter" rows="5" maxLength="5000" placeholder="Tell the hiring team why this role interests you…" /></label><label>Use an alternate resume <small>Optional · PDF or DOCX, up to 5 MB. Your saved resume will be used if you leave this blank.</small><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setResume(event.target.files?.[0] || null)} /></label><button className="green-button" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'} <ArrowRight size={14} /></button></form>}<div className="job-detail-actions">{user?.role === 'candidate' && <button type="button" className="subtle-button" onClick={save}>{saved ? 'Saved' : 'Save job'}</button>}{user?.role === 'candidate' && !showApplyForm && <button type="button" className="green-button" onClick={() => setShowApplyForm(true)}>Apply now <ArrowRight size={14} /></button>}</div>{user?.role === 'candidate' && <JobReportForm jobId={job._id} />}</article></main>
}
