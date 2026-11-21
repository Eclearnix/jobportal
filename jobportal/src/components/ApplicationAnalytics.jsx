import { useEffect, useMemo, useRef, useState } from 'react'
import { api, queryString } from '../services/api'

const statusLabels = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview_scheduled: 'Interview',
  selected: 'Selected',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const dateKey = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

const dateFromKey = (key) => {
  if (!key) return null
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const formatDateKey = (key, options = { month: 'short', day: 'numeric' }) => {
  const date = dateFromKey(key)
  return date ? date.toLocaleDateString(undefined, options) : '—'
}

const formatDateRange = (start, end, includeYear = false) => {
  if (!start || !end) return 'No activity yet'
  const options = includeYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' }
  return `${formatDateKey(start, options)} — ${formatDateKey(end, options)}`
}

async function loadApplications(route, archived, signal) {
  const loadPage = (page) => api(`${route}${queryString({ archived, page, limit: 100 })}`, { signal })
  const firstPage = await loadPage(1)
  const applications = [...firstPage.items]

  for (let page = 2; page <= firstPage.pages; page += 1) {
    const result = await loadPage(page)
    applications.push(...result.items)
  }

  return applications
}

const activityColors = ['#e5edf6', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a']
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const easeOutCubic = (value) => 1 - (1 - clamp(value, 0, 1)) ** 3
const shadeColor = (color, amount) => {
  const channels = color.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16))
  return `#${channels.map((channel) => Math.round(channel * amount).toString(16).padStart(2, '0')).join('')}`
}

function ActivityStat({ label, value, unit, detail, size = 'standard' }) {
  return (
    <article className={`candidate-activity-stat candidate-activity-stat-${size}`}>
      <span className="candidate-activity-stat-label">{label}</span>
      <div><strong>{value.toLocaleString()}</strong><span>{unit}</span></div>
      <small>{detail}</small>
    </article>
  )
}

export function ApplicationActivityChart({ weeks, yearTotal, yearStart, yearEnd, busiestDay, longestStreak, currentStreak, activityLabel = 'applications' }) {
  const [view, setView] = useState('3d')
  const [progress, setProgress] = useState(1)
  const [orbit, setOrbit] = useState({ yaw: 0, elevation: 0 })
  const [activeDate, setActiveDate] = useState(null)
  const drag = useRef(null)
  const progressRef = useRef(1)
  const animationFrame = useRef(0)
  const cells = weeks.flatMap((days, weekIndex) => days.map((day, dayIndex) => ({ ...day, weekIndex, dayIndex })))
    .filter((day) => day.inRange)
  const monthMarks = weeks.reduce((marks, days, weekIndex) => {
    const firstInRange = days.find((day) => day.inRange)
    if (!firstInRange) return marks
    const monthKey = firstInRange.key.slice(0, 7)
    if (marks[marks.length - 1]?.monthKey !== monthKey) {
      marks.push({
        weekIndex,
        monthKey,
        label: dateFromKey(firstInRange.key).toLocaleDateString(undefined, { month: 'short' }),
      })
    }
    return marks
  }, [])
  const maxCount = Math.max(1, ...cells.map((day) => day.count))
  const cameraProgress = easeOutCubic(progress)
  const baseYaw = (32 * Math.PI) / 180
  const baseElevation = (34 * Math.PI) / 180
  const yaw = (baseYaw + orbit.yaw) * cameraProgress
  const elevation = Math.PI / 2 + (baseElevation + orbit.elevation - Math.PI / 2) * cameraProgress
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const sinElevation = Math.sin(elevation)
  const cosElevation = Math.cos(elevation)
  const project = (x, y, z) => [
    x * cosYaw - y * sinYaw,
    (x * sinYaw + y * cosYaw) * sinElevation - z * cosElevation,
  ]
  const blocks = cells.map((day) => {
    const x = day.weekIndex + 0.1
    const y = day.dayIndex + 0.1
    const size = 0.8
    const waveOffset = (day.weekIndex / Math.max(1, weeks.length - 1)) * 0.36 + (day.dayIndex / 6) * 0.06
    const riseProgress = clamp((progress - waveOffset) / 0.58, 0, 1)
    const height = (day.count ? 0.18 + Math.sqrt(day.count / maxCount) * 2.4 : 0.06) * easeOutCubic(riseProgress)
    const top = [[x, y, height], [x + size, y, height], [x + size, y + size, height], [x, y + size, height]]
    const faces = progress > 0.01
      ? [
          { points: [[x, y + size, 0], [x + size, y + size, 0], top[2], top[3]], shade: 0.72 },
          { points: [[x + size, y, 0], [x + size, y + size, 0], top[2], top[1]], shade: 0.56 },
          { points: top, shade: 1 },
        ]
      : [{ points: top, shade: 1 }]
    return {
      key: day.key,
      count: day.count,
      depth: (day.weekIndex + 0.5) * sinYaw + (day.dayIndex + 0.5) * cosYaw,
      faces,
      color: activityColors[day.count === 0 ? 0 : day.count === 1 ? 1 : day.count <= 3 ? 2 : day.count <= 5 ? 3 : 4],
    }
  }).sort((left, right) => left.depth - right.depth)
  const projectedPoints = blocks.flatMap((block) => block.faces.flatMap((face) => face.points.map((point) => project(...point))))
  const monthPoints = monthMarks.map((month) => ({
    ...month,
    point: project(month.weekIndex + 0.5, 7.35, 0),
  }))
  const xValues = projectedPoints.map(([x]) => x)
  const yValues = projectedPoints.map(([, y]) => y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const labelMinY = monthPoints.length ? Math.min(...monthPoints.map(({ point }) => point[1])) : minY
  const labelMaxY = monthPoints.length ? Math.max(...monthPoints.map(({ point }) => point[1])) : maxY
  const layoutMinY = Math.min(minY, labelMinY)
  const layoutHeight = Math.max(1, Math.max(maxY, labelMaxY) - layoutMinY)
  const sceneWidth = Math.max(1, maxX - minX)
  const scale = Math.min(910 / sceneWidth, 430 / layoutHeight)
  const offsetX = (1000 - sceneWidth * scale) / 2 - minX * scale
  const offsetY = (500 - layoutHeight * scale) / 2 - layoutMinY * scale
  const screenPoint = (point) => {
    const [x, y] = project(...point)
    return `${(offsetX + x * scale).toFixed(2)},${(offsetY + y * scale).toFixed(2)}`
  }
  const screenMonthPoint = (point) => [offsetX + point[0] * scale, offsetY + point[1] * scale]

  useEffect(() => {
    const target = view === '3d' ? 1 : 0
    const from = progressRef.current
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 850
    const start = performance.now()

    const animate = (now) => {
      const amount = duration ? clamp((now - start) / duration, 0, 1) : 1
      const next = from + (target - from) * easeOutCubic(amount)
      progressRef.current = next
      setProgress(next)
      if (amount < 1) animationFrame.current = window.requestAnimationFrame(animate)
    }

    animationFrame.current = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(animationFrame.current)
  }, [view])

  const onPointerDown = (event) => {
    if (view !== '3d' || event.button !== 0) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...orbit }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    if (!drag.current || drag.current.id !== event.pointerId) return
    setOrbit({
      yaw: clamp(drag.current.yaw + (event.clientX - drag.current.x) * 0.004, (8 * Math.PI) / 180 - baseYaw, (82 * Math.PI) / 180 - baseYaw),
      elevation: clamp(drag.current.elevation + (event.clientY - drag.current.y) * 0.003, (18 * Math.PI) / 180 - baseElevation, (62 * Math.PI) / 180 - baseElevation),
    })
  }

  const onPointerUp = (event) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onChartKeyDown = (event) => {
    const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    if (!(event.key in offsets)) return
    event.preventDefault()
    const currentIndex = cells.findIndex((day) => day.key === activeDate)
    const nextIndex = clamp(currentIndex < 0 ? 0 : currentIndex + offsets[event.key], 0, cells.length - 1)
    setActiveDate(cells[nextIndex]?.key || null)
  }

  const activityStats = [
    { label: '1 year total', value: yearTotal, unit: 'applications', detail: formatDateRange(yearStart, yearEnd, true) },
    { label: 'Busiest day', value: busiestDay.count, unit: 'applications', detail: formatDateKey(busiestDay.key) },
    { label: 'Longest streak', value: longestStreak.days, unit: 'days', detail: formatDateRange(longestStreak.start, longestStreak.end) },
    { label: 'Current streak', value: currentStreak.days, unit: 'days', detail: formatDateRange(currentStreak.start, currentStreak.end) },
  ]

  return (
    <section className="candidate-analytics-panel candidate-activity-panel">
      <div className="candidate-activity-heading">
        <h3>{yearTotal.toLocaleString()} {activityLabel} in the last year</h3>
        <div className="candidate-chart-toggle" role="group" aria-label="Activity chart view">
          {['2d', '3d'].map((mode) => (
            <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="candidate-activity-frame">
        {view === '2d' ? (
          <>
            <svg className="candidate-activity-svg candidate-activity-svg-2d" viewBox="0 0 1000 190" role="img" tabIndex="0" aria-label={`Daily ${activityLabel} over the past year. ${yearTotal} applications. Use arrow keys to explore days.`} onKeyDown={onChartKeyDown}>
              {monthMarks.map((month) => <text key={month.monthKey} className="candidate-activity-month" x={70 + month.weekIndex * 17} y="24">{month.label}</text>)}
              {[1, 3, 5].map((dayIndex) => (
                <text className="candidate-activity-weekday" key={dayIndex} x="58" y={42 + dayIndex * 18 + 9} textAnchor="end">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIndex]}
                </text>
              ))}
              {cells.map((day) => (
                <rect
                  key={day.key}
                  x={70 + day.weekIndex * 17}
                  y={42 + day.dayIndex * 18}
                  width="12"
                  height="12"
                  rx="3"
                  fill={activityColors[day.count === 0 ? 0 : day.count === 1 ? 1 : day.count <= 3 ? 2 : day.count <= 5 ? 3 : 4]}
                  stroke={activeDate === day.key ? 'var(--ink)' : 'none'}
                  strokeWidth={activeDate === day.key ? '2' : '0'}
                  onMouseEnter={() => setActiveDate(day.key)}
                  onMouseLeave={() => setActiveDate(null)}
                >
                  <title>{`${day.count} application${day.count === 1 ? '' : 's'} on ${day.key}`}</title>
                </rect>
              ))}
            </svg>
            <div className="candidate-activity-stats-2d">
              {activityStats.map((stat) => <ActivityStat key={stat.label} {...stat} />)}
            </div>
          </>
        ) : (
          <div className="candidate-activity-stage candidate-activity-stage-3d">
            <svg
              className="candidate-activity-svg candidate-activity-svg-3d"
              viewBox="0 0 1000 500"
              role="img"
              tabIndex="0"
              aria-label={`Daily ${activityLabel} over the past year. ${yearTotal} applications, ${longestStreak.days} day longest streak, shown as a 3D skyline.`}
              onKeyDown={onChartKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => setOrbit({ yaw: 0, elevation: 0 })}
            >
              {blocks.map((block) => (
                <g key={block.key} onPointerEnter={() => setActiveDate(block.key)} onPointerLeave={() => setActiveDate(null)}>
                  <title>{`${block.count} application${block.count === 1 ? '' : 's'} on ${block.key}`}</title>
                  {block.faces.map((face, faceIndex) => (
                    <polygon
                      key={faceIndex}
                      points={face.points.map(screenPoint).join(' ')}
                      fill={shadeColor(block.color, face.shade)}
                      stroke={activeDate === block.key && faceIndex === 2 ? 'var(--ink)' : 'none'}
                      strokeWidth={activeDate === block.key && faceIndex === 2 ? '1.5' : '0'}
                    />
                  ))}
                </g>
              ))}
              {monthPoints.map(({ monthKey, label, point }) => {
                const [x, y] = screenMonthPoint(point)
                return <text key={monthKey} className="candidate-activity-month" x={x} y={y + 14}>{label}</text>
              })}
            </svg>
            <div className="candidate-activity-stats-3d">
              <div className="candidate-activity-stats-top">
                {activityStats.slice(0, 2).map((stat) => <ActivityStat key={stat.label} {...stat} size="large" />)}
              </div>
              <div className="candidate-activity-stats-bottom">
                {activityStats.slice(2).map((stat) => <ActivityStat key={stat.label} {...stat} size="large" />)}
              </div>
            </div>
          </div>
        )}
        <div className="candidate-chart-footer">
          <span className="candidate-chart-hint">{view === '3d' ? 'Drag to orbit · Double-click to reset' : 'Hover a day for details · Arrow keys to explore'}</span>
          <div className="candidate-heatmap-legend" aria-hidden="true"><span>Less</span>{activityColors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}<span>More</span></div>
        </div>
      </div>
      <p className="candidate-chart-sr-only" aria-live="polite">
        {activeDate ? `${weeks.flat().find((day) => day.key === activeDate)?.count || 0} applications on ${formatDateKey(activeDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
      </p>
    </section>
  )
}

function ApplicationAnalytics({ role = 'candidate', upcomingInterviews = 0 }) {
  const [applications, setApplications] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('')
  const [scheduledInterviews, setScheduledInterviews] = useState(Number(upcomingInterviews) || 0)
  const requestSequence = useRef(0)
  const activeRequest = useRef(false)
  const [today] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  })

  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = true

    const load = async () => {
      const requestId = ++requestSequence.current
      setRefreshing(true)
      setError('')
      try {
        const [current, archived, recruiterDashboard] = await Promise.all([
          loadApplications(`/${role}/applications`, false, controller.signal),
          loadApplications(`/${role}/applications`, true, controller.signal),
          role === 'recruiter' ? api('/dashboard/recruiter', { signal: controller.signal }) : Promise.resolve(null),
        ])
        if (activeRequest.current && requestId === requestSequence.current) {
          setApplications([...current, ...archived])
          if (recruiterDashboard) setScheduledInterviews(Number(recruiterDashboard.summary.interviews) || 0)
          setLastUpdated(new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
        }
      } catch (loadError) {
        if (activeRequest.current && requestId === requestSequence.current && loadError.name !== 'AbortError') setError(loadError.message)
      } finally {
        if (activeRequest.current && requestId === requestSequence.current) setRefreshing(false)
      }
    }

    void load()
    const refreshOnFocus = () => {
      if (role === 'recruiter') void load()
    }
    const intervalId = role === 'recruiter'
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void load()
        }, 60_000)
      : null
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      activeRequest.current = false
      if (intervalId) window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshOnFocus)
      controller.abort()
    }
  }, [retry, role])

  const analytics = useMemo(() => {
    if (!applications) return null

    const cutoff = new Date(today)
    cutoff.setDate(cutoff.getDate() - 364)
    const countsByDate = new Map()

    applications.forEach((application) => {
      const appliedAt = new Date(application.createdAt)
      if (Number.isNaN(appliedAt.getTime())) return
      const key = dateKey(appliedAt)
      countsByDate.set(key, (countsByDate.get(key) || 0) + 1)
    })

    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - 6 + index)
      const key = dateKey(date)
      return {
        key,
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        count: countsByDate.get(key) || 0,
      }
    })

    const gridStart = new Date(cutoff)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())
    const gridEnd = new Date(today)
    gridEnd.setDate(gridEnd.getDate() + 6 - gridEnd.getDay())
    const weeks = []
    for (let weekStart = new Date(gridStart); weekStart <= gridEnd; weekStart.setDate(weekStart.getDate() + 7)) {
      weeks.push(Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(weekStart)
        date.setDate(weekStart.getDate() + dayIndex)
        const key = dateKey(date)
        return {
          key,
          count: countsByDate.get(key) || 0,
          inRange: date >= cutoff && date <= today,
        }
      }))
    }

    const yearDays = weeks.flat().filter((day) => day.inRange)
    const yearTotal = yearDays.reduce((total, day) => total + day.count, 0)
    const activeDays = yearDays.filter((day) => day.count > 0).length
    const busiestDay = yearDays.reduce((busiest, day) => (
      day.count > busiest.count ? { key: day.key, count: day.count } : busiest
    ), { key: null, count: 0 })
    let longestStreak = { days: 0, start: null, end: null }
    let streakStart = null
    let streakDays = 0
    yearDays.forEach((day) => {
      if (day.count > 0) {
        if (!streakDays) streakStart = day.key
        streakDays += 1
        if (streakDays > longestStreak.days) longestStreak = { days: streakDays, start: streakStart, end: day.key }
      } else {
        streakStart = null
        streakDays = 0
      }
    })
    let currentIndex = yearDays.length - 1
    if (yearDays[currentIndex]?.count === 0) currentIndex -= 1
    const currentEnd = yearDays[currentIndex]?.key || null
    let currentDays = 0
    while (currentIndex >= 0 && yearDays[currentIndex].count > 0) {
      currentDays += 1
      currentIndex -= 1
    }
    const currentStreak = {
      days: currentDays,
      start: currentDays ? yearDays[currentIndex + 1].key : null,
      end: currentDays ? currentEnd : null,
    }
    const applicationsWithRecruiterAction = applications.filter((application) => !['submitted', 'withdrawn'].includes(application.status)).length
    const responseEligible = applications.filter((application) => application.status !== 'withdrawn').length
    const statuses = Object.keys(statusLabels).map((status) => ({
      status,
      label: statusLabels[status],
      count: applications.filter((application) => application.status === status).length,
    }))

    return {
      total: applications.length,
      yearTotal,
      yearStart: dateKey(cutoff),
      yearEnd: dateKey(today),
      weekDays,
      weeks,
      activeDays,
      busiestDay,
      longestStreak,
      currentStreak,
      applicationsWithRecruiterAction,
      responseRate: responseEligible ? Math.round(applicationsWithRecruiterAction / responseEligible * 100) : 0,
      statuses,
    }
  }, [applications, today])

  if (error && !applications) {
    return (
      <section className="candidate-analytics data-card" aria-label="Application analytics">
        <div className="candidate-analytics-heading">
          <div><h2>Application analytics</h2><p>{role === 'recruiter' ? 'Review applications received and recruiter workflow outcomes.' : 'Review your application activity and recruiter updates.'}</p></div>
        </div>
        <div className="candidate-analytics-error" role="alert">
          <p>{error}</p>
          <button type="button" className="subtle-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div>
      </section>
    )
  }

  if (!analytics) {
    return (
      <section className="candidate-analytics data-card" aria-label="Application analytics" aria-busy="true">
        <div className="candidate-analytics-heading">
          <div><h2>Application analytics</h2><p>{role === 'recruiter' ? 'Review applications received and recruiter workflow outcomes.' : 'Review your application activity and recruiter updates.'}</p></div>
        </div>
        <p className="candidate-analytics-loading" role="status">Loading your application history…</p>
      </section>
    )
  }

  const maxDayCount = Math.max(1, ...analytics.weekDays.map((day) => day.count))
  const maxStatusCount = Math.max(1, ...analytics.statuses.map((status) => status.count))

  return (
    <section className="candidate-analytics data-card" aria-label="Application analytics">
      <div className="candidate-analytics-heading">
        <div><h2>Application analytics</h2><p>{role === 'recruiter' ? 'Application activity and hiring outcomes for your organization.' : 'Application activity and recruiter updates across your full application history.'}</p></div>
        {role === 'recruiter' && <div className="recruiter-analytics-refresh">
          <button type="button" className="subtle-button" disabled={refreshing} onClick={() => setRetry((value) => value + 1)}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          {lastUpdated && <small>Live · Updated {lastUpdated}</small>}
        </div>}
      </div>
      {error && <p className="candidate-analytics-refresh-error" role="alert">{error}</p>}
      {role === 'recruiter'
        ? <div className="candidate-analytics-summary recruiter-analytics-summary">
          <article><span>Applications received</span><strong>{analytics.total.toLocaleString()}</strong><small>Including archived and withdrawn</small></article>
          <article><span>Active hiring days</span><strong>{analytics.activeDays.toLocaleString()}</strong><small>Days receiving applications in the past year</small></article>
          <article><span>Interviews scheduled</span><strong>{scheduledInterviews.toLocaleString()}</strong><small>Upcoming interviews</small></article>
          <article><span>Shortlisted</span><strong>{analytics.statuses.find((item) => item.status === 'shortlisted')?.count || 0}</strong><small>Current application stage</small></article>
          <article><span>Rejected</span><strong>{analytics.statuses.find((item) => item.status === 'rejected')?.count || 0}</strong><small>Current application stage</small></article>
          <article><span>Response rate</span><strong>{analytics.responseRate}%</strong><small>Applications with recruiter action</small></article>
        </div>
        : <div className="candidate-analytics-summary">
          <article><span>Total applications</span><strong>{analytics.total.toLocaleString()}</strong><small>Including archived and withdrawn</small></article>
          <article><span>Active days</span><strong>{analytics.activeDays.toLocaleString()}</strong><small>Days with applications in the past year</small></article>
          <article><span>Applications with recruiter action</span><strong>{analytics.applicationsWithRecruiterAction.toLocaleString()}</strong><small>{analytics.responseRate}% of non-withdrawn applications</small></article>
        </div>}

      <div className="candidate-analytics-grid">
        <section className="candidate-analytics-panel">
          <div className="candidate-analytics-panel-heading"><h3>{role === 'recruiter' ? 'Applications received this week' : 'Applications this week'}</h3><span>Past 7 days</span></div>
          <div className="candidate-week-chart" role="img" aria-label={`Applications per day for the past 7 days: ${analytics.weekDays.map((day) => `${day.label} ${day.count}`).join(', ')}`}>
            {analytics.weekDays.map((day) => (
              <div className="candidate-week-column" key={day.key} title={`${day.count} application${day.count === 1 ? '' : 's'} on ${day.key}`}>
                <strong>{day.count}</strong>
                <span className="candidate-week-track"><span style={{ height: `${day.count ? Math.max(8, day.count / maxDayCount * 100) : 0}%` }} /></span>
                <small>{day.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="candidate-analytics-panel">
          <div className="candidate-analytics-panel-heading"><h3>{role === 'recruiter' ? 'Applicant status' : 'Application status'}</h3><span>Latest stage per application</span></div>
          <div className="candidate-status-list">
            {analytics.statuses.map(({ status, label, count }) => (
              <div className="candidate-status-row" key={status}>
                <span>{label}</span>
                <span className="candidate-status-track"><span style={{ width: `${count / maxStatusCount * 100}%` }} /></span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ApplicationActivityChart
        weeks={analytics.weeks}
        yearTotal={analytics.yearTotal}
        yearStart={analytics.yearStart}
        yearEnd={analytics.yearEnd}
        busiestDay={analytics.busiestDay}
        longestStreak={analytics.longestStreak}
        currentStreak={analytics.currentStreak}
        activityLabel={role === 'recruiter' ? 'applications received' : 'applications'}
      />
    </section>
  )
}

export default ApplicationAnalytics
