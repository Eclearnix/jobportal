import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import mongoose from 'mongoose'
import { z } from 'zod'
import {
  AdminInvite,
  AdminLog,
  Application,
  CompanyInvite,
  Company,
  Interview,
  Job,
  Notification,
  Report,
  SavedJob,
  Setting,
  User,
} from './models/index.js'
import { requireCompanyMember, requirePrimaryAdmin, requireRoles, requireUser } from './middleware/auth.js'
import { savePrivateFile, streamPrivateFile } from './storage.js'
import { sendCompanyInvitationEmail, sendInterviewEmail } from './email.js'
import {
  normalizeCandidateNotificationPreferences,
  normalizeRecruiterNotificationPreferences,
  notifyRecruiterMembers,
  shouldSendCandidateNotification,
} from './notifications.js'

const router = Router()
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
const primaryAdminEmail = process.env.PRIMARY_ADMIN_EMAIL?.trim().toLowerCase() || null
const notificationChannelInput = z.object({ inApp: z.boolean(), email: z.boolean() }).strict()
const recruiterNotificationPreferencesInput = z.object({
  applicationReceived: notificationChannelInput,
  interviewUpdates: notificationChannelInput,
  teamUpdates: notificationChannelInput,
}).strict()
const candidateNotificationPreferencesInput = z.object({
  jobMatches: notificationChannelInput,
  applicationUpdates: notificationChannelInput,
  interviewReminders: notificationChannelInput,
}).strict()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype)) {
      const error = new Error('Only PDF and DOCX files are allowed.')
      error.status = 400
      return callback(error)
    }
    return callback(null, true)
  },
})
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPG, PNG, or WebP image.')
      error.status = 400
      return callback(error)
    }
    return callback(null, true)
  },
})
const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a PDF, JPG, PNG, or WebP certificate.')
      error.status = 400
      return callback(error)
    }
    return callback(null, true)
  },
})
const publicUrl = z.string().trim().max(500).refine((value) => {
  if (!value) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, 'Enter a valid HTTP or HTTPS URL.')

function emptyLeetCodeStats() {
  return {
    solved: null,
    solvedEasy: 0,
    solvedMedium: 0,
    solvedHard: 0,
    totalQuestions: 0,
    totalEasy: 0,
    totalMedium: 0,
    totalHard: 0,
    submissionsPastYear: 0,
    activeDays: 0,
    maxStreak: 0,
    activity: [],
    badgeCount: 0,
    activeBadge: { name: '', icon: '' },
    badges: [],
    ranking: null,
    contestRating: null,
    globalRanking: null,
    updatedAt: null,
  }
}

function emptyHackerRankStats() {
  return {
    challengesSolved: 0,
    totalPracticePoints: 0,
    totalContestPoints: 0,
    trackCount: 0,
    badgeCount: 0,
    badges: [],
    tracks: [],
    updatedAt: null,
  }
}

function getRecruiterNotificationsUrl(req) {
  const origin = req.get('origin') || process.env.CLIENT_ORIGIN?.split(',')[0]
  try {
    const url = new URL('/organization/notifications', origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

router.get('/recruiter/team', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const [members, invites] = await Promise.all([
    User.find({ _id: { $in: req.company.members }, company: req.company._id }).select('name email role status createdAt').sort({ createdAt: 1 }).lean(),
    CompanyInvite.find({ company: req.company._id, expiresAt: { $gt: new Date() } }).select('email expiresAt createdAt').lean(),
  ])
  res.json({ members, invites })
})

router.post('/recruiter/team-invitations', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const { email } = validate(z.object({ email: z.string().email().max(240) }).strict(), req.body)
  const normalizedEmail = email.toLowerCase()
  const existingUser = await User.findOne({ email: normalizedEmail })
  if (existingUser && (existingUser.role !== 'recruiter' || (existingUser.company && String(existingUser.company) !== String(req.company._id)))) {
    return res.status(409).json({ error: 'This email is already assigned to another account or organization.' })
  }
  const invite = await CompanyInvite.findOneAndUpdate(
    { email: normalizedEmail, company: req.company._id },
    { email: normalizedEmail, company: req.company._id, invitedBy: req.user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    { upsert: true, new: true, runValidators: true },
  )
  const configuredOrigin = req.get('origin') || process.env.CLIENT_ORIGIN?.split(',')[0]
  let loginUrl = ''
  try {
    if (configuredOrigin) loginUrl = new URL('/login', configuredOrigin).href
  } catch {
    loginUrl = ''
  }

  let emailResult
  try {
    emailResult = await sendCompanyInvitationEmail({
      to: normalizedEmail,
      companyName: req.company.name,
      invitedByName: req.user.name,
      loginUrl,
    })
  } catch (error) {
    console.error('Team invitation email delivery failed:', error)
    return res.status(502).json({ error: 'The invitation was saved, but the email could not be sent. Check the API server logs and try again.' })
  }
  if (!emailResult.sent) {
    console.error(`Team invitation email was not sent: ${emailResult.error}`)
    return res.status(503).json({ error: `The invitation was saved, but the email could not be sent. ${emailResult.error}` })
  }

  res.status(201).json({ invite, emailSent: true })
})

router.delete('/recruiter/team-invitations/:inviteId', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.inviteId)
  const result = await CompanyInvite.deleteOne({ _id: id, company: req.company._id })
  if (!result.deletedCount) return res.status(404).json({ error: 'Invitation not found.' })
  res.status(204).end()
})

router.get('/candidate/settings', requireUser, requireRoles('candidate'), async (req, res) => {
  res.json({
    profile: {
      openToOpportunities: req.user.openToOpportunities,
    },
    notificationPreferences: normalizeCandidateNotificationPreferences(req.user.candidateNotificationPreferences),
  })
})

router.patch('/candidate/settings/notifications', requireUser, requireRoles('candidate'), async (req, res) => {
  const { notificationPreferences } = validate(z.object({
    notificationPreferences: candidateNotificationPreferencesInput,
  }).strict(), req.body)
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { candidateNotificationPreferences: notificationPreferences } },
    { new: true, runValidators: true },
  ).select('candidateNotificationPreferences').lean()
  if (!user) return res.status(404).json({ error: 'Candidate account not found.' })
  res.json({ notificationPreferences: normalizeCandidateNotificationPreferences(user.candidateNotificationPreferences) })
})

router.get('/recruiter/settings', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  res.json({
    timezone: req.company.timezone || 'UTC',
    notificationPreferences: normalizeRecruiterNotificationPreferences(req.user.recruiterNotificationPreferences),
  })
})

router.patch('/recruiter/settings/timezone', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const { timezone } = validate(z.object({ timezone: z.string().trim().min(1).max(64) }).strict(), req.body)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return res.status(400).json({ error: 'Enter a valid IANA timezone, such as Asia/Kolkata or America/New_York.' })
  }

  const company = await Company.findOneAndUpdate(
    { _id: req.company._id },
    { $set: { timezone } },
    { new: true, runValidators: true },
  ).select('timezone')
  if (!company) return res.status(404).json({ error: 'Organization not found.' })
  res.json({ timezone: company.timezone })
})

router.patch('/recruiter/settings/notifications', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const { notificationPreferences } = validate(z.object({
    notificationPreferences: recruiterNotificationPreferencesInput,
  }).strict(), req.body)
  const user = await User.findOneAndUpdate(
    { _id: req.user._id, company: req.company._id },
    { $set: { recruiterNotificationPreferences: notificationPreferences } },
    { new: true, runValidators: true },
  ).select('recruiterNotificationPreferences').lean()
  if (!user) return res.status(404).json({ error: 'Organization member not found.' })
  res.json({ notificationPreferences: normalizeRecruiterNotificationPreferences(user.recruiterNotificationPreferences) })
})

router.patch('/recruiter/company', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const input = validate(z.object({
    name: z.string().trim().min(2).max(160).optional(),
    website: z.string().trim().url().max(240).or(z.literal('')).optional(),
    industry: z.string().trim().max(120).optional(),
    size: z.string().trim().max(60).optional(),
    location: z.string().trim().max(160).optional(),
    description: z.string().trim().max(3000).optional(),
    contactEmail: z.string().email().max(240).optional(),
  }).strict(), req.body)
  const updates = { ...input }
  if (updates.name) updates.normalizedName = updates.name.toLowerCase()
  const company = await Company.findByIdAndUpdate(req.company._id, { $set: updates }, { new: true, runValidators: true })
  res.json({ company })
})

router.get('/recruiter/notifications', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ items })
})

router.patch('/recruiter/notifications/:notificationId/read', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.notificationId)
  const notification = await Notification.findOneAndUpdate({ _id: id, user: req.user._id }, { readAt: new Date() }, { new: true })
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json({ notification })
})

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'A valid resource ID is required.')
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

function validate(schema, input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    error.status = 400
    throw error
  }
  return parsed.data
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validateFileSignature(file) {
  if (!file) return
  const isPdf = file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-'
  const isDocx = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b
  if (!isPdf && !isDocx) {
    const error = new Error('The uploaded file content does not match an allowed resume format.')
    error.status = 400
    throw error
  }
}

function validateImageSignature(file) {
  if (!file) return
  const isJpeg = file.mimetype === 'image/jpeg'
    && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff
  const isPng = file.mimetype === 'image/png'
    && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp = file.mimetype === 'image/webp'
    && file.buffer.toString('ascii', 0, 4) === 'RIFF'
    && file.buffer.toString('ascii', 8, 12) === 'WEBP'
  if (!isJpeg && !isPng && !isWebp) {
    const error = new Error('The uploaded file content does not match an allowed image format.')
    error.status = 400
    throw error
  }
}

function validateCertificateSignature(file) {
  if (file.mimetype !== 'application/pdf') return validateImageSignature(file)
  if (file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    const error = new Error('The uploaded file content does not match a PDF certificate.')
    error.status = 400
    throw error
  }
}

async function fetchLeetCodeStats(username) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let payload
  try {
    const response = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'EclearnixJobs/1.0' },
      body: JSON.stringify({
        query: `query profileStats($username: String!) {
          allQuestionsCount { difficulty count }
          matchedUser(username: $username) {
            profile { ranking }
            activeBadge { displayName icon }
            badges { id displayName icon creationDate }
            submitStats {
              acSubmissionNum { difficulty count }
              totalSubmissionNum { difficulty count }
            }
            userCalendar { streak totalActiveDays activeYears submissionCalendar }
          }
          userContestRanking(username: $username) {
            rating
            globalRanking
          }
        }`,
        variables: { username },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = new Error('LeetCode stats are temporarily unavailable.')
      error.status = 502
      throw error
    }
    try {
      payload = await response.json()
    } catch {
      const error = new Error('LeetCode returned an invalid stats response.')
      error.status = 502
      throw error
    }
  } catch (requestError) {
    if (requestError.status) throw requestError
    const error = new Error('LeetCode stats could not be reached. Try again later.')
    error.status = 502
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const matchedUser = payload.data?.matchedUser
  if (!matchedUser) {
    const error = new Error(payload.errors?.length
      ? 'LeetCode could not provide stats for this profile.'
      : 'That LeetCode profile could not be found.')
    error.status = payload.errors?.length ? 502 : 404
    throw error
  }
  const acceptedSubmissions = matchedUser.submitStats?.acSubmissionNum
  const questionTotals = payload.data?.allQuestionsCount
  const toCounts = (rows) => {
    if (!Array.isArray(rows)) return null
    const counts = {}
    for (const item of rows) {
      if (typeof item?.difficulty !== 'string' || !Number.isSafeInteger(item.count) || item.count < 0) return null
      counts[item.difficulty.toLowerCase()] = item.count
    }
    return counts
  }
  const solvedCounts = toCounts(acceptedSubmissions)
  const totalCounts = toCounts(questionTotals)
  if (!solvedCounts || !totalCounts || !['all', 'easy', 'medium', 'hard'].every((key) => (
    Number.isSafeInteger(solvedCounts[key]) && Number.isSafeInteger(totalCounts[key])
  ))) {
    const error = new Error('LeetCode returned incomplete stats. Try again later.')
    error.status = 502
    throw error
  }

  const calendar = matchedUser.userCalendar
  let rawCalendar = calendar?.submissionCalendar
  if (typeof rawCalendar === 'string') {
    try {
      rawCalendar = JSON.parse(rawCalendar)
    } catch {
      const error = new Error('LeetCode returned an invalid activity calendar.')
      error.status = 502
      throw error
    }
  }
  if (!rawCalendar || typeof rawCalendar !== 'object' || Array.isArray(rawCalendar)) rawCalendar = {}
  const activityByDate = new Map()
  for (const [timestamp, value] of Object.entries(rawCalendar)) {
    const date = new Date(Number(timestamp) * 1000)
    const count = Number(value)
    if (!Number.isFinite(date.getTime()) || !Number.isSafeInteger(count) || count < 0) {
      const error = new Error('LeetCode returned invalid activity data.')
      error.status = 502
      throw error
    }
    activityByDate.set(date.toISOString().slice(0, 10), count)
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(today.getTime() - 364 * 24 * 60 * 60 * 1000)
  const recentActivity = [...activityByDate.entries()]
    .filter(([date]) => date >= startDate.toISOString().slice(0, 10) && date <= today.toISOString().slice(0, 10))
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => left.date.localeCompare(right.date))
  const submissionsPastYear = recentActivity.reduce((sum, day) => sum + day.count, 0)
  const activeDays = recentActivity.filter((day) => day.count > 0).length
  let maxStreak = 0
  let currentStreak = 0
  let previousDate = null
  for (const day of recentActivity) {
    const date = new Date(`${day.date}T00:00:00.000Z`)
    const consecutive = previousDate && date.getTime() - previousDate.getTime() === 24 * 60 * 60 * 1000
    currentStreak = day.count > 0 ? consecutive ? currentStreak + 1 : 1 : 0
    maxStreak = Math.max(maxStreak, currentStreak)
    previousDate = day.count > 0 ? date : null
  }
  const safeBadgeIcon = (icon) => {
    if (typeof icon !== 'string' || !icon) return ''
    try {
      const url = new URL(icon, 'https://leetcode.com')
      return url.protocol === 'https:' && (url.hostname === 'leetcode.com' || url.hostname.endsWith('.leetcode.com'))
        ? url.href
        : ''
    } catch {
      return ''
    }
  }
  const badges = Array.isArray(matchedUser.badges)
    ? matchedUser.badges
      .map((badge) => ({
        name: badge.displayName,
        icon: safeBadgeIcon(badge.icon),
        earnedAt: badge.creationDate || '',
      }))
      .filter((badge) => badge.name)
      .sort((left, right) => String(right.earnedAt).localeCompare(String(left.earnedAt)))
      .slice(0, 6)
    : []
  const activeBadge = matchedUser.activeBadge
  const contest = payload.data?.userContestRanking
  return {
    solved: solvedCounts.all,
    solvedEasy: solvedCounts.easy,
    solvedMedium: solvedCounts.medium,
    solvedHard: solvedCounts.hard,
    totalQuestions: totalCounts.all,
    totalEasy: totalCounts.easy,
    totalMedium: totalCounts.medium,
    totalHard: totalCounts.hard,
    submissionsPastYear,
    activeDays,
    maxStreak,
    activity: recentActivity,
    badgeCount: Array.isArray(matchedUser.badges) ? matchedUser.badges.length : 0,
    activeBadge: activeBadge ? { name: activeBadge.displayName, icon: safeBadgeIcon(activeBadge.icon) } : { name: '', icon: '' },
    badges,
    ranking: Number.isFinite(matchedUser.profile?.ranking) ? matchedUser.profile.ranking : null,
    contestRating: Number.isFinite(contest?.rating) ? contest.rating : null,
    globalRanking: Number.isFinite(contest?.globalRanking) ? contest.globalRanking : null,
  }
}

async function fetchHackerRankStats(username) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  const baseUrl = 'https://www.hackerrank.com/rest'
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
  }
  const requestJson = async (path) => {
    const response = await fetch(`${baseUrl}/${path}`, { headers, signal: controller.signal })
    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'HackerRank is rate-limiting profile requests. Try again later.'
        : response.status === 404
          ? 'That HackerRank profile could not be found.'
          : 'HackerRank stats are temporarily unavailable.')
      error.status = response.status === 404 ? 404 : 502
      throw error
    }
    try {
      return await response.json()
    } catch {
      const error = new Error('HackerRank returned an invalid stats response.')
      error.status = 502
      throw error
    }
  }

  let profilePayload
  let badgePayload
  let scoreRows
  const encodedUsername = encodeURIComponent(username)
  try {
    [profilePayload, badgePayload, scoreRows] = await Promise.all([
      requestJson(`contests/master/hackers/${encodedUsername}/profile`),
      requestJson(`hackers/${encodedUsername}/badges`),
      requestJson(`hackers/${encodedUsername}/scores_elo`),
    ])
  } catch (requestError) {
    if (requestError.status) throw requestError
    const error = new Error(controller.signal.aborted
      ? 'HackerRank stats request timed out. Try again later.'
      : 'HackerRank stats could not be reached. Try again later.')
    error.status = 502
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!profilePayload?.model?.username) {
    const error = new Error('That HackerRank profile could not be found.')
    error.status = 404
    throw error
  }
  if (!Array.isArray(badgePayload?.models) || !Array.isArray(scoreRows)) {
    const error = new Error('HackerRank returned incomplete stats. Try again later.')
    error.status = 502
    throw error
  }

  const metric = (value) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : 0
  }
  const rank = (value) => {
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? number : null
  }
  const badgeRows = badgePayload.models.map((badge) => ({
    name: typeof badge?.badge_name === 'string' ? badge.badge_name.trim() : '',
    badgeType: typeof badge?.badge_type === 'string' ? badge.badge_type : '',
    stars: metric(badge?.stars),
    solved: metric(badge?.solved),
    points: metric(badge?.current_points ?? badge?.points),
  })).filter((badge) => badge.name)
  const earnedBadges = badgeRows.filter((badge) => badge.stars > 0)
    .sort((left, right) => right.stars - left.stars || right.points - left.points)
  const tracks = scoreRows.map((row) => {
    const practiceScore = metric(row?.practice?.score)
    const contestScore = metric(row?.contest?.score)
    const medals = row?.contest?.medals || {}
    return {
      name: typeof row?.name === 'string' ? row.name : '',
      slug: typeof row?.slug === 'string' ? row.slug : '',
      practiceScore,
      practiceRank: rank(row?.practice?.rank),
      contestScore,
      contestRank: rank(row?.contest?.rank),
      level: contestScore > 0 ? metric(row?.contest?.level) : null,
      goldMedals: metric(medals.gold),
      silverMedals: metric(medals.silver),
      bronzeMedals: metric(medals.bronze),
    }
  }).filter((track) => track.name && (
    track.practiceScore > 0 || track.contestScore > 0
      || track.goldMedals > 0 || track.silverMedals > 0 || track.bronzeMedals > 0
  )).sort((left, right) => (
    right.practiceScore + right.contestScore - left.practiceScore - left.contestScore
  ))

  return {
    challengesSolved: badgeRows.reduce((total, badge) => total + badge.solved, 0),
    totalPracticePoints: tracks.reduce((total, track) => total + track.practiceScore, 0),
    totalContestPoints: tracks.reduce((total, track) => total + track.contestScore, 0),
    trackCount: tracks.length,
    badgeCount: earnedBadges.length,
    badges: earnedBadges.slice(0, 12),
    tracks: tracks.slice(0, 12),
  }
}

function issueSession(user, res) {
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'eclearnix-jobs' })
  res.cookie('ecl_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  })
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    company: user.company,
    phone: user.phone,
    location: user.location,
  }
}

async function authenticateGoogle(req, res, intendedRole) {
  const { credential } = validate(z.object({ credential: z.string().min(20).max(5000) }), req.body)
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('Google sign-in is not configured on this server.')
    error.status = 503
    throw error
  }
  let ticket
  try {
    ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID })
  } catch {
    const error = new Error('Google could not verify this sign-in. Please try again.')
    error.status = 401
    throw error
  }
  const payload = ticket.getPayload()
  if (!payload?.email || !payload.email_verified || !payload.sub || !payload.name) {
    const error = new Error('Google did not return a verified account.')
    error.status = 401
    throw error
  }

  const email = payload.email.toLowerCase()
  let user = await User.findOne({ $or: [{ email }, { googleId: payload.sub }] })
  const companyInvite = intendedRole === 'recruiter'
    ? await CompanyInvite.findOne({ email, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 })
    : null
  if (intendedRole === 'super_admin') {
    if (!user) {
      const invite = await AdminInvite.findOneAndDelete({ email, expiresAt: { $gt: new Date() } })
      if (invite) {
        user = await User.create({ email, googleId: payload.sub, name: payload.name, picture: payload.picture || '', role: 'super_admin' })
      }
    }
    if (!user || user.role !== 'super_admin') {
      const error = new Error('This Google account is not authorized for Super Admin access.')
      error.status = 403
      throw error
    }
  } else if (user && user.role !== intendedRole) {
    const error = new Error('This account belongs to a different workspace. Sign in using its assigned role.')
    error.status = 403
    throw error
  } else if (!user) {
    user = await User.create({
      email,
      googleId: payload.sub,
      name: payload.name,
      picture: payload.picture || '',
      role: intendedRole,
    })
  } else if (user.googleId && user.googleId !== payload.sub) {
    const error = new Error('This email is already linked to a different Google account.')
    error.status = 409
    throw error
  }

  user.googleId = payload.sub
  user.name = payload.name
  user.picture = payload.picture || user.picture
  user.lastLoginAt = new Date()
  if (user.status === 'suspended') {
    const error = new Error('This account is suspended. Contact platform support.')
    error.status = 403
    throw error
  }
  let acceptedCompany = null
  if (companyInvite) {
    if (user.company && String(user.company) !== String(companyInvite.company)) {
      const error = new Error('This account already belongs to a different organization.')
      error.status = 409
      throw error
    }
    const company = await Company.findOne({ _id: companyInvite.company, status: { $nin: ['removed', 'suspended'] } })
    if (!company) {
      const error = new Error('The organization invitation is no longer valid.')
      error.status = 410
      throw error
    }
    user.company = company._id
    company.members.addToSet(user._id)
    await company.save()
    await CompanyInvite.deleteOne({ _id: companyInvite._id })
    acceptedCompany = company
  }
  await user.save()
  if (companyInvite && acceptedCompany) {
    await notifyRecruiterMembers({
      memberIds: [companyInvite.invitedBy],
      companyId: acceptedCompany._id,
      excludeUserId: user._id,
      preferenceKey: 'teamUpdates',
      type: 'team_member_joined',
      title: 'Teammate joined',
      message: `${user.name} accepted the invitation and joined ${acceptedCompany.name}.`,
      subject: `${user.name} joined ${acceptedCompany.name}`,
      companyName: acceptedCompany.name,
      loginUrl: getRecruiterNotificationsUrl(req),
      relatedId: acceptedCompany._id,
    })
  }
  issueSession(user, res)
  return user
}

async function adminTransaction(req, { action, targetType, target, details }, change) {
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await change(session)
      await AdminLog.create([{
        actor: req.user._id,
        action,
        targetType,
        target,
        details,
        ipAddress: req.ip,
      }], { session })
    })
    return result
  } finally {
    await session.endSession()
  }
}

function toPage(query) {
  const { page, limit } = validate(pagination, query)
  return { page, limit, skip: (page - 1) * limit }
}

router.get('/health', (_req, res) => res.json({ status: 'ok' }))

router.post('/auth/google/candidate', async (req, res) => {
  const user = await authenticateGoogle(req, res, 'candidate')
  res.json({ user: publicUser(user), onboardingRequired: !user.location || !user.phone })
})

router.post('/auth/google/organization', async (req, res) => {
  const user = await authenticateGoogle(req, res, 'recruiter')
  res.json({ user: publicUser(user), onboardingRequired: !user.company })
})

router.post('/auth/google/super-admin', async (req, res) => {
  const user = await authenticateGoogle(req, res, 'super_admin')
  res.json({ user: publicUser(user), onboardingRequired: false })
})

router.get('/auth/me', requireUser, async (req, res) => {
  res.json({ user: publicUser(req.user) })
})

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('ecl_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  })
  res.status(204).end()
})

router.get('/jobs', async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = { status: 'published' }
  const text = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
  if (text) query.$text = { $search: text }
  if (typeof req.query.location === 'string' && req.query.location.trim()) query.location = new RegExp(escapeRegex(req.query.location.trim().slice(0, 80)), 'i')
  if (['remote', 'hybrid', 'on-site'].includes(req.query.workMode)) query.workMode = req.query.workMode
  if (['full-time', 'part-time', 'internship', 'contract'].includes(req.query.employmentType)) query.employmentType = req.query.employmentType
  if (typeof req.query.industry === 'string' && req.query.industry.trim()) query.industry = new RegExp(escapeRegex(req.query.industry.trim().slice(0, 120)), 'i')
  if (req.query.salaryMin && Number.isFinite(Number(req.query.salaryMin)) && Number(req.query.salaryMin) >= 0) query.salaryMax = { $gte: Number(req.query.salaryMin) }
  if (typeof req.query.experienceLevel === 'string' && req.query.experienceLevel.trim()) query.experienceLevel = new RegExp(escapeRegex(req.query.experienceLevel.trim().slice(0, 80)), 'i')
  const sort = req.query.sort === 'relevance' && text ? { score: { $meta: 'textScore' }, publishedAt: -1 } : { publishedAt: -1 }
  const [jobs, total] = await Promise.all([
    Job.find(query).sort(sort).skip(skip).limit(limit).populate('company', 'name logoKey location industry status').lean(),
    Job.countDocuments(query),
  ])
  res.json({ items: jobs, page, limit, total, pages: Math.ceil(total / limit) })
})

router.get('/jobs/:jobId', async (req, res) => {
  const id = validate(objectId, req.params.jobId)
  const job = await Job.findOne({ _id: id, status: 'published' }).populate('company', 'name website industry size location description status')
  if (!job) return res.status(404).json({ error: 'Job not found.' })
  res.json({ job })
})

router.get('/dashboard/candidate', requireUser, requireRoles('candidate'), async (req, res) => {
  const [applicationsSent, interviews, profile, recentApplications, recommendedJobs, unreadNotifications] = await Promise.all([
    Application.countDocuments({ candidate: req.user._id, status: { $ne: 'withdrawn' } }),
    Interview.countDocuments({ candidate: req.user._id, status: 'scheduled', scheduledAt: { $gte: new Date() } }),
    User.findById(req.user._id).select('name picture title about profilePhotoKey profileBannerKey location skills education experience portfolioUrl projects certifications codingProfiles leetcodeStats hackerrankStats resumeKey phone preferredLocations openToOpportunities profileViews candidateNotificationPreferences'),
    Application.find({ candidate: req.user._id }).sort({ createdAt: -1 }).limit(5).populate({ path: 'job', select: 'title location employmentType' }).populate({ path: 'company', select: 'name' }).lean(),
    Job.find({ status: 'published', ...(req.user.skills?.length ? { skills: { $in: req.user.skills } } : {}) }).sort({ publishedAt: -1 }).limit(4).populate('company', 'name location').lean(),
    Notification.countDocuments({ user: req.user._id, readAt: null, archivedAt: null }),
  ])
  const profileFields = [profile?.phone, profile?.location, profile?.skills?.length, profile?.education?.length, profile?.experience?.length, profile?.resumeKey]
  const profileStrength = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100)
  res.json({
    summary: { applicationsSent, profileViews: profile.profileViews, interviews, unreadNotifications, profileStrength },
    recentApplications,
    recommendedJobs,
    profile: profile.toObject(),
  })
})

router.patch('/candidate/profile', requireUser, requireRoles('candidate'), async (req, res) => {
  const projectInput = z.object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional().default(''),
    liveUrl: publicUrl.optional().default(''),
    repositoryUrl: publicUrl.optional().default(''),
  }).strict()
  const certificationInput = z.object({
    id: objectId.optional(),
    kind: z.enum(['certificate', 'achievement']),
    title: z.string().trim().min(1).max(120),
    issuer: z.string().trim().max(160).optional().default(''),
    issueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional().default(''),
    description: z.string().trim().max(1000).optional().default(''),
    credentialUrl: publicUrl.optional().default(''),
  }).strict()
  const codingProfileInput = z.object({
    platform: z.enum(['leetcode', 'codechef', 'hackerrank']),
    username: z.string().trim().min(1).max(50).regex(/^[\w.-]+$/),
  }).strict()
  const input = validate(z.object({
    name: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().max(120).optional(),
    about: z.string().trim().max(3000).optional(),
    phone: z.string().trim().max(40).optional(),
    location: z.string().trim().max(120).optional(),
    portfolioUrl: publicUrl.optional(),
    projects: z.array(projectInput).max(5).optional(),
    certifications: z.array(certificationInput).max(20).optional(),
    codingProfiles: z.array(codingProfileInput).max(3).optional().refine(
      (profiles) => !profiles || new Set(profiles.map((profile) => profile.platform)).size === profiles.length,
      'Each coding platform can only be listed once.',
    ),
    skills: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    preferredLocations: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    openToOpportunities: z.boolean().optional(),
    education: z.array(z.object({ school: z.string().max(160), degree: z.string().max(120), graduationYear: z.number().int().min(1950).max(2100).optional() })).max(20).optional(),
    experience: z.array(z.object({ title: z.string().max(120), company: z.string().max(160), summary: z.string().max(2000).optional() })).max(30).optional(),
  }).strict(), req.body)
  const update = { $set: input }
  if (input.codingProfiles || input.certifications) {
    const currentProfile = await User.findById(req.user._id).select('codingProfiles certifications')
    if (input.codingProfiles) {
      const previousUsername = currentProfile.codingProfiles.find((item) => item.platform === 'leetcode')?.username
      const nextUsername = input.codingProfiles.find((item) => item.platform === 'leetcode')?.username
      if (previousUsername !== nextUsername) {
        update.$set.leetcodeStats = emptyLeetCodeStats()
      }
      const previousHackerRankUsername = currentProfile.codingProfiles.find((item) => item.platform === 'hackerrank')?.username
      const nextHackerRankUsername = input.codingProfiles.find((item) => item.platform === 'hackerrank')?.username
      if (previousHackerRankUsername !== nextHackerRankUsername) {
        update.$set.hackerrankStats = emptyHackerRankStats()
      }
    }
    if (input.certifications) {
      const existingCertifications = new Map((currentProfile.certifications || []).map((certification) => [String(certification._id), certification]))
      const seenIds = new Set()
      update.$set.certifications = input.certifications.map(({ id, ...certification }) => {
        const existing = id ? existingCertifications.get(id) : null
        if (id && (!existing || seenIds.has(id))) {
          const error = new Error('A certification could not be found or was listed more than once.')
          error.status = 400
          throw error
        }
        if (id) seenIds.add(id)
        return {
          ...certification,
          ...(existing ? {
            _id: existing._id,
            fileKey: existing.fileKey,
            fileName: existing.fileName,
            fileContentType: existing.fileContentType,
          } : {}),
        }
      })
    }
  }
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true }).select('-googleId')
  res.json({ user })
})

router.post('/candidate/profile/photo', requireUser, requireRoles('candidate'), imageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP profile photo.' })
  validateImageSignature(req.file)
  const key = await savePrivateFile(req.file, `profile-assets/${req.user._id}/photo`)
  await User.findByIdAndUpdate(req.user._id, { profilePhotoKey: key })
  res.status(201).json({ profilePhotoKey: key })
})

router.post('/candidate/profile/banner', requireUser, requireRoles('candidate'), imageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP banner image.' })
  validateImageSignature(req.file)
  const key = await savePrivateFile(req.file, `profile-assets/${req.user._id}/banner`)
  await User.findByIdAndUpdate(req.user._id, { profileBannerKey: key })
  res.status(201).json({ profileBannerKey: key })
})

router.post('/candidate/profile/certifications/:certificationId/file', requireUser, requireRoles('candidate'), certificateUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF, JPG, PNG, or WebP file.' })
  validateCertificateSignature(req.file)
  const certificationId = validate(objectId, req.params.certificationId)
  const user = await User.findById(req.user._id).select('certifications')
  const certification = user.certifications.id(certificationId)
  if (!certification) return res.status(404).json({ error: 'Certification or achievement not found.' })
  certification.fileKey = await savePrivateFile(req.file, `certifications/${req.user._id}/${certificationId}`)
  certification.fileName = req.file.originalname.slice(0, 200)
  certification.fileContentType = req.file.mimetype
  await user.save()
  res.status(201).json({
    certification: {
      _id: certification._id,
      fileName: certification.fileName,
      fileContentType: certification.fileContentType,
    },
  })
})

router.get('/candidate/profile/certifications/:certificationId/file', requireUser, requireRoles('candidate'), async (req, res) => {
  const certificationId = validate(objectId, req.params.certificationId)
  const user = await User.findById(req.user._id).select('certifications')
  const certification = user.certifications.id(certificationId)
  if (!certification?.fileKey) return res.status(404).json({ error: 'Certificate file not found.' })
  res.setHeader('Cache-Control', 'private, no-store')
  await streamPrivateFile(certification.fileKey, res)
})

router.get('/candidate/profile/assets/:asset', requireUser, requireRoles('candidate'), async (req, res) => {
  const field = { photo: 'profilePhotoKey', banner: 'profileBannerKey' }[req.params.asset]
  if (!field) return res.status(404).json({ error: 'Profile image not found.' })
  const user = await User.findById(req.user._id).select(field)
  if (!user?.[field]) return res.status(404).json({ error: 'Profile image not found.' })
  res.setHeader('Cache-Control', 'private, max-age=300')
  await streamPrivateFile(user[field], res)
})

router.post('/candidate/profile/coding-stats/refresh', requireUser, requireRoles('candidate'), async (req, res) => {
  const { username } = validate(z.object({
    username: z.string().trim().min(1).max(50).regex(/^[\w.-]+$/),
  }).strict(), req.body)
  const user = await User.findById(req.user._id).select('codingProfiles')
  const existingProfile = user.codingProfiles.find((profile) => profile.platform === 'leetcode')
  const codingProfiles = [
    ...user.codingProfiles.filter((profile) => profile.platform !== 'leetcode'),
    { platform: 'leetcode', username },
  ]
  const profileUpdate = { codingProfiles }
  if (existingProfile?.username !== username) {
    profileUpdate.leetcodeStats = emptyLeetCodeStats()
  }
  await User.findByIdAndUpdate(req.user._id, { $set: profileUpdate }, { runValidators: true })
  const stats = await fetchLeetCodeStats(username)
  const updatedUser = await User.findByIdAndUpdate(req.user._id, {
    leetcodeStats: { ...stats, updatedAt: new Date() },
  }, { new: true, runValidators: true }).select('leetcodeStats')
  res.json({ stats: updatedUser.leetcodeStats })
})

router.post('/candidate/profile/hackerrank-stats/refresh', requireUser, requireRoles('candidate'), async (req, res) => {
  const { username } = validate(z.object({
    username: z.string().trim().min(1).max(50).regex(/^[\w.-]+$/),
  }).strict(), req.body)
  const user = await User.findById(req.user._id).select('codingProfiles')
  const existingProfile = user.codingProfiles.find((profile) => profile.platform === 'hackerrank')
  const codingProfiles = [
    ...user.codingProfiles.filter((profile) => profile.platform !== 'hackerrank'),
    { platform: 'hackerrank', username },
  ]
  const profileUpdate = { codingProfiles }
  if (existingProfile?.username !== username) {
    profileUpdate.hackerrankStats = emptyHackerRankStats()
  }
  await User.findByIdAndUpdate(req.user._id, { $set: profileUpdate }, { runValidators: true })
  const stats = await fetchHackerRankStats(username)
  const updatedUser = await User.findByIdAndUpdate(req.user._id, {
    hackerrankStats: { ...stats, updatedAt: new Date() },
  }, { new: true, runValidators: true }).select('hackerrankStats')
  res.json({ stats: updatedUser.hackerrankStats })
})

router.post('/candidate/resume', requireUser, requireRoles('candidate'), upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF or DOCX resume to upload.' })
  validateFileSignature(req.file)
  const key = await savePrivateFile(req.file, `resumes/${req.user._id}`)
  const user = await User.findByIdAndUpdate(req.user._id, { resumeKey: key }, { new: true }).select('resumeKey')
  res.status(201).json({ resume: user.resumeKey })
})

router.get('/candidate/resume', requireUser, requireRoles('candidate'), async (req, res) => {
  const user = await User.findById(req.user._id).select('resumeKey')
  if (!user.resumeKey) return res.status(404).json({ error: 'No resume has been uploaded.' })
  res.json({ url: '/api/candidate/resume/file' })
})

router.get('/candidate/resume/file', requireUser, requireRoles('candidate'), async (req, res) => {
  const user = await User.findById(req.user._id).select('resumeKey')
  if (!user.resumeKey) return res.status(404).json({ error: 'No resume has been uploaded.' })
  await streamPrivateFile(user.resumeKey, res)
})

router.get('/candidate/applications', requireUser, requireRoles('candidate'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = {
    candidate: req.user._id,
    candidateArchivedAt: req.query.archived === 'true' ? { $ne: null } : null,
  }
  const [items, total] = await Promise.all([
    Application.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('job', 'title location employmentType').populate('company', 'name').lean(),
    Application.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.post('/jobs/:jobId/applications', requireUser, requireRoles('candidate'), upload.single('resume'), async (req, res) => {
  const jobId = validate(objectId, req.params.jobId)
  const job = await Job.findOne({ _id: jobId, status: 'published' }).populate('company', 'status name members')
  if (!job || job.company.status !== 'verified') return res.status(404).json({ error: 'This job is no longer available.' })
  const candidate = await User.findById(req.user._id).select('resumeKey name candidateNotificationPreferences')
  validateFileSignature(req.file)
  const resumeKey = req.file ? await savePrivateFile(req.file, `resumes/${candidate.id}`) : candidate.resumeKey
  if (!resumeKey) return res.status(400).json({ error: 'Upload a resume before applying.' })
  const input = validate(z.object({ coverLetter: z.string().trim().max(5000).optional().default('') }), req.body || {})
  try {
    const application = await Application.create({ candidate: candidate._id, job: job._id, company: job.company._id, resumeKey, coverLetter: input.coverLetter })
    if (shouldSendCandidateNotification(candidate.candidateNotificationPreferences, 'applicationUpdates')) {
      await Notification.create({ user: candidate._id, type: 'application_submitted', title: 'Application submitted', message: `Your application for ${job.title} was submitted.`, relatedId: application._id })
    }
    await notifyRecruiterMembers({
      memberIds: job.company.members,
      companyId: job.company._id,
      preferenceKey: 'applicationReceived',
      type: 'application_received',
      title: 'New application received',
      message: `${candidate.name} applied for ${job.title}.`,
      subject: `New application for ${job.title}`,
      companyName: job.company.name,
      loginUrl: getRecruiterNotificationsUrl(req),
      relatedId: application._id,
    })
    res.status(201).json({ application })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You have already applied for this job.' })
    throw error
  }
})

router.patch('/candidate/applications/:applicationId/withdraw', requireUser, requireRoles('candidate'), async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const application = await Application.findOneAndUpdate(
    { _id: id, candidate: req.user._id, status: { $in: ['submitted', 'under_review', 'shortlisted'] } },
    { status: 'withdrawn', withdrawnAt: new Date() },
    { new: true, runValidators: true },
  )
  if (!application) return res.status(404).json({ error: 'Application cannot be found or withdrawn.' })
  res.json({ application })
})

router.patch('/candidate/applications/:applicationId/archive', requireUser, requireRoles('candidate'), async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const { archived } = validate(z.object({ archived: z.boolean() }).strict(), req.body)
  const application = await Application.findOneAndUpdate(
    { _id: id, candidate: req.user._id },
    { $set: { candidateArchivedAt: archived ? new Date() : null } },
    { new: true, runValidators: true },
  )
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  res.json({ application })
})

router.post('/candidate/saved-jobs/:jobId', requireUser, requireRoles('candidate'), async (req, res) => {
  const jobId = validate(objectId, req.params.jobId)
  const job = await Job.findOne({ _id: jobId, status: 'published' }).select('_id')
  if (!job) return res.status(404).json({ error: 'Job not found.' })
  try {
    const saved = await SavedJob.create({ candidate: req.user._id, job: job._id })
    res.status(201).json({ saved })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'Job is already saved.' })
    throw error
  }
})

router.delete('/candidate/saved-jobs/:jobId', requireUser, requireRoles('candidate'), async (req, res) => {
  const jobId = validate(objectId, req.params.jobId)
  const result = await SavedJob.deleteOne({ candidate: req.user._id, job: jobId })
  if (!result.deletedCount) return res.status(404).json({ error: 'Saved job not found.' })
  res.status(204).end()
})

router.get('/candidate/saved-jobs', requireUser, requireRoles('candidate'), async (req, res) => {
  const items = await SavedJob.find({ candidate: req.user._id }).sort({ createdAt: -1 }).populate({ path: 'job', match: { status: 'published' }, populate: { path: 'company', select: 'name location' } }).lean()
  res.json({ items: items.filter((item) => item.job) })
})

router.get('/candidate/notifications', requireUser, requireRoles('candidate'), async (req, res) => {
  const archivedAt = req.query.archived === 'true' ? { $ne: null } : null
  const items = await Notification.find({ user: req.user._id, archivedAt }).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ items })
})

router.patch('/candidate/notifications/:notificationId/read', requireUser, requireRoles('candidate'), async (req, res) => {
  const id = validate(objectId, req.params.notificationId)
  const notification = await Notification.findOneAndUpdate({ _id: id, user: req.user._id }, { readAt: new Date() }, { new: true })
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json({ notification })
})

router.patch('/candidate/notifications/:notificationId/archive', requireUser, requireRoles('candidate'), async (req, res) => {
  const id = validate(objectId, req.params.notificationId)
  const { archived } = validate(z.object({ archived: z.boolean() }).strict(), req.body)
  const notification = await Notification.findOneAndUpdate(
    { _id: id, user: req.user._id },
    { $set: { archivedAt: archived ? new Date() : null } },
    { new: true, runValidators: true },
  )
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json({ notification })
})

router.delete('/candidate/notifications/:notificationId', requireUser, requireRoles('candidate'), async (req, res) => {
  const id = validate(objectId, req.params.notificationId)
  const result = await Notification.deleteOne({ _id: id, user: req.user._id })
  if (!result.deletedCount) return res.status(404).json({ error: 'Notification not found.' })
  res.status(204).end()
})

router.delete('/candidate/notifications', requireUser, requireRoles('candidate'), async (req, res) => {
  await Notification.deleteMany({ user: req.user._id })
  res.status(204).end()
})

router.get('/candidate/interviews', requireUser, requireRoles('candidate'), async (req, res) => {
  const items = await Interview.find({ candidate: req.user._id, status: 'scheduled', scheduledAt: { $gte: new Date() } })
    .sort({ scheduledAt: 1 }).populate({ path: 'application', populate: { path: 'job', select: 'title' } }).populate('company', 'name').lean()
  res.json({ items })
})

router.get('/recruiter/candidates', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const applications = await Application.find({ company: req.company._id, status: { $ne: 'withdrawn' } })
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('candidate', 'name email picture title location skills')
    .populate('job', 'title')
    .lean()

  const candidates = new Map()
  for (const application of applications) {
    if (!application.candidate) continue
    const candidateId = String(application.candidate._id)
    const existing = candidates.get(candidateId)
    const applicationSummary = {
      id: application._id,
      jobTitle: application.job?.title || 'Untitled job',
      status: application.status,
      createdAt: application.createdAt,
    }
    if (existing) {
      existing.applications.push(applicationSummary)
      continue
    }
    candidates.set(candidateId, {
      candidate: application.candidate,
      applications: [applicationSummary],
    })
  }

  res.json({ items: [...candidates.values()] })
})

router.get('/recruiter/discoverable-candidates', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const query = { role: 'candidate', status: 'active', openToOpportunities: true }
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const search = escapeRegex(req.query.q.trim().slice(0, 80))
    query.$or = [
      { name: new RegExp(search, 'i') },
      { title: new RegExp(search, 'i') },
      { location: new RegExp(search, 'i') },
      { skills: new RegExp(search, 'i') },
    ]
  }
  const items = await User.find(query)
    .select('name email picture title location skills preferredLocations openToOpportunities profileViews')
    .sort({ lastLoginAt: -1, updatedAt: -1 })
    .limit(100)
    .lean()
  res.json({ items })
})

router.get('/recruiter/candidates/:candidateId', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const candidateId = validate(objectId, req.params.candidateId)
  const [hasApplication, isDiscoverable] = await Promise.all([
    Application.exists({ candidate: candidateId, company: req.company._id }),
    User.exists({ _id: candidateId, role: 'candidate', status: 'active', openToOpportunities: true }),
  ])
  if (!hasApplication && !isDiscoverable) return res.status(404).json({ error: 'Candidate is not available to your organization.' })
  const candidate = await User.findOneAndUpdate({ _id: candidateId, role: 'candidate', status: 'active' }, { $inc: { profileViews: 1 } }, { new: true })
    .select('name email picture title about location skills education experience portfolioUrl projects certifications codingProfiles leetcodeStats hackerrankStats profilePhotoKey profileBannerKey')
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' })
  res.json({ candidate })
})

router.get('/recruiter/candidates/:candidateId/assets/:asset', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const candidateId = validate(objectId, req.params.candidateId)
  const field = { photo: 'profilePhotoKey', banner: 'profileBannerKey' }[req.params.asset]
  if (!field) return res.status(404).json({ error: 'Profile image not found.' })
  const [hasApplication, isDiscoverable] = await Promise.all([
    Application.exists({ candidate: candidateId, company: req.company._id }),
    User.exists({ _id: candidateId, role: 'candidate', status: 'active', openToOpportunities: true }),
  ])
  if (!hasApplication && !isDiscoverable) return res.status(404).json({ error: 'Candidate is not available to your organization.' })
  const candidate = await User.findOne({ _id: candidateId, role: 'candidate', status: 'active' }).select(field)
  if (!candidate?.[field]) return res.status(404).json({ error: 'Profile image not found.' })
  res.setHeader('Cache-Control', 'private, max-age=300')
  await streamPrivateFile(candidate[field], res)
})

router.get('/recruiter/candidates/:candidateId/certifications/:certificationId/file', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const candidateId = validate(objectId, req.params.candidateId)
  const certificationId = validate(objectId, req.params.certificationId)
  const [hasApplication, isDiscoverable] = await Promise.all([
    Application.exists({ candidate: candidateId, company: req.company._id }),
    User.exists({ _id: candidateId, role: 'candidate', status: 'active', openToOpportunities: true }),
  ])
  if (!hasApplication && !isDiscoverable) return res.status(404).json({ error: 'Candidate is not available to your organization.' })
  const candidate = await User.findOne({ _id: candidateId, role: 'candidate', status: 'active' }).select('certifications')
  const certification = candidate?.certifications.id(certificationId)
  if (!certification?.fileKey) return res.status(404).json({ error: 'Certificate file not found.' })
  res.setHeader('Cache-Control', 'private, no-store')
  await streamPrivateFile(certification.fileKey, res)
})

router.post('/recruiter/candidates/:candidateId/invitations', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const candidateId = validate(objectId, req.params.candidateId)
  const { jobId } = validate(z.object({ jobId: objectId }).strict(), req.body)
  const [candidate, job] = await Promise.all([
    User.findOne({ _id: candidateId, role: 'candidate', status: 'active', openToOpportunities: true }).select('_id candidateNotificationPreferences'),
    Job.findOne({ _id: jobId, company: req.company._id, status: 'published' }).select('_id title'),
  ])
  if (!candidate) return res.status(404).json({ error: 'Candidate is not available to your organization.' })
  if (!job) return res.status(404).json({ error: 'Published job not found for your organization.' })

  const [existingApplication, existingInvitation] = await Promise.all([
    Application.exists({ candidate: candidate._id, job: job._id }),
    Notification.exists({ user: candidate._id, type: 'job_invitation', relatedId: job._id }),
  ])
  if (existingApplication) return res.status(409).json({ error: 'This candidate has already applied to this job.' })
  if (existingInvitation) return res.status(409).json({ error: 'This candidate has already been invited to this job.' })

  if (shouldSendCandidateNotification(candidate.candidateNotificationPreferences, 'jobMatches')) {
    await Notification.create({
      user: candidate._id,
      type: 'job_invitation',
      title: 'You’re invited to apply',
      message: `${req.company.name} invites you to apply for ${job.title}. If you’re interested, submit an application. The organization may contact you to schedule an interview.`,
      relatedId: job._id,
    })
  }
  const notification = await Notification.findOne({ user: candidate._id, type: 'job_invitation', relatedId: job._id }).sort({ createdAt: -1 }).lean()
  res.status(201).json({ notification })
})

router.get('/recruiter/applications/:applicationId/resume', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const application = await Application.findOne({ _id: id, company: req.company._id }).select('resumeKey')
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  res.json({ url: `/api/recruiter/applications/${id}/resume/file` })
})

router.get('/recruiter/applications/:applicationId/resume/file', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const application = await Application.findOne({ _id: id, company: req.company._id }).select('resumeKey')
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  await streamPrivateFile(application.resumeKey, res)
})

router.get('/recruiter/interviews', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const items = await Interview.find({ company: req.company._id })
    .sort({ scheduledAt: 1 }).limit(100).populate('candidate', 'name email').populate({ path: 'application', populate: { path: 'job', select: 'title' } }).lean()
  res.json({ items })
})

router.delete('/recruiter/interviews/:interviewId', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const interviewId = validate(objectId, req.params.interviewId)
  const interview = await Interview.findOne({ _id: interviewId, company: req.company._id }).select('status scheduledAt durationMinutes')
  if (!interview) return res.status(404).json({ error: 'Interview not found.' })
  const completedByTime = interview.status === 'scheduled'
    && interview.scheduledAt.getTime() + interview.durationMinutes * 60_000 <= Date.now()
  if (interview.status !== 'completed' && !completedByTime) {
    return res.status(409).json({ error: 'Only completed interviews can be deleted.' })
  }
  const deletedInterview = await Interview.findOneAndDelete({
    _id: interviewId,
    company: req.company._id,
    status: interview.status,
    scheduledAt: interview.scheduledAt,
    durationMinutes: interview.durationMinutes,
  })
  if (!deletedInterview) return res.status(409).json({ error: 'The interview changed before it could be deleted. Refresh and try again.' })
  res.status(204).end()
})

router.post('/reports', requireUser, async (req, res) => {
  const input = validate(z.object({
    targetType: z.enum(['company', 'job', 'user']),
    target: objectId,
    reason: z.string().trim().min(3).max(120),
    details: z.string().trim().max(3000).optional().default(''),
  }).strict(), req.body)
  const report = await Report.create({ ...input, reporter: req.user._id, target: input.target })
  res.status(201).json({ report })
})

router.post('/organizations', requireUser, requireRoles('recruiter'), async (req, res) => {
  if (req.user.company) return res.status(409).json({ error: 'This account already belongs to an organization.' })
  const input = validate(z.object({
    name: z.string().trim().min(2).max(160),
    website: z.string().trim().url().max(240).or(z.literal('')).optional().default(''),
    industry: z.string().trim().max(120).optional().default(''),
    size: z.string().trim().max(60).nullish().transform((value) => value ?? ''),
    location: z.string().trim().max(160).optional().default(''),
    description: z.string().trim().max(3000).optional().default(''),
    contactEmail: z.string().email().max(240),
  }).strict(), req.body)
  const company = await Company.create({ ...input, normalizedName: input.name.toLowerCase(), owner: req.user._id, members: [req.user._id] })
  await User.findByIdAndUpdate(req.user._id, { company: company._id })
  res.status(201).json({ company })
})

router.get('/dashboard/recruiter', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const company = await Company.findById(req.company._id).lean()
  const [totalJobs, activeJobs, totalApplicants, shortlisted, interviews, recentApplications] = await Promise.all([
    Job.countDocuments({ company: company._id }),
    Job.countDocuments({ company: company._id, status: 'published' }),
    Application.countDocuments({ company: company._id }),
    Application.countDocuments({ company: company._id, status: 'shortlisted' }),
    Interview.countDocuments({ company: company._id, status: 'scheduled', scheduledAt: { $gte: new Date() } }),
    Application.find({ company: company._id }).sort({ createdAt: -1 }).limit(8).populate('candidate', 'name email picture').populate('job', 'title').lean(),
  ])
  res.json({ company, summary: { totalJobs, activeJobs, totalApplicants, shortlisted, interviews }, recentApplications })
})

router.get('/recruiter/jobs', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  if (!req.user.company) return res.status(409).json({ error: 'Complete organization registration first.' })
  const { page, limit, skip } = toPage(req.query)
  const query = { company: req.user.company }
  const [items, total] = await Promise.all([
    Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Job.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

const jobInput = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().min(30).max(15000),
  responsibilities: z.array(z.string().trim().max(500)).max(30).optional().default([]),
  qualifications: z.array(z.string().trim().max(500)).max(30).optional().default([]),
  skills: z.array(z.string().trim().max(80)).max(50).optional().default([]),
  location: z.string().trim().min(2).max(160),
  workMode: z.enum(['remote', 'hybrid', 'on-site']),
  employmentType: z.enum(['full-time', 'part-time', 'internship', 'contract']),
  experienceLevel: z.string().trim().max(80).optional().default(''),
  industry: z.string().trim().max(120).optional().default(''),
  salaryMin: z.number().min(0).optional().nullable(),
  salaryMax: z.number().min(0).optional().nullable(),
  currency: z.string().trim().length(3).optional().default('USD'),
  applicationDeadline: z.string().datetime().optional().nullable(),
  status: z.enum(['draft', 'pending_review']).optional().default('draft'),
}).strict()

router.post('/recruiter/jobs', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const input = validate(jobInput, req.body)
  const status = input.status === 'pending_review' ? 'pending_review' : 'draft'
  const job = await Job.create({ ...input, applicationDeadline: input.applicationDeadline || null, company: req.user.company, createdBy: req.user._id, status })
  res.status(201).json({ job })
})

router.delete('/recruiter/jobs/:jobId', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.jobId)
  const job = await Job.findOneAndDelete({ _id: id, company: req.company._id })
  if (!job) return res.status(404).json({ error: 'Job not found.' })
  res.status(204).end()
})

router.patch('/recruiter/jobs/:jobId', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.jobId)
  const input = validate(jobInput.partial(), req.body)
  const job = await Job.findOneAndUpdate(
    { _id: id, company: req.user.company, status: { $nin: ['closed', 'rejected'] } },
    { $set: input },
    { new: true, runValidators: true },
  )
  if (!job) return res.status(404).json({ error: 'Job not found or cannot be edited.' })
  res.json({ job })
})

router.patch('/recruiter/jobs/:jobId/status', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.jobId)
  const { status } = validate(z.object({ status: z.enum(['published', 'paused', 'closed']) }), req.body)
  let updated
  if (status === 'published') {
    const company = await Company.findOne({ _id: req.company._id, status: 'verified', members: req.user._id })
    if (!company) return res.status(403).json({ error: 'Only verified organizations can publish jobs.' })
    updated = await Job.findOneAndUpdate({ _id: id, company: company._id, status: { $in: ['draft', 'pending_review', 'paused'] } }, { status, publishedAt: new Date() }, { new: true })
  } else {
    updated = await Job.findOneAndUpdate({ _id: id, company: req.user.company, status: { $ne: 'closed' } }, { status }, { new: true })
  }
  if (!updated) return res.status(404).json({ error: 'Job not found or status transition is not allowed.' })
  res.json({ job: updated })
})

router.get('/recruiter/applications', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = {
    company: req.company._id,
    archivedAt: req.query.archived === 'true' ? { $ne: null } : null,
  }
  const [items, total] = await Promise.all([
    Application.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('candidate', 'name email picture title location skills').populate('job', 'title').lean(),
    Application.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/recruiter/applications/:applicationId/archive', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const { archived } = validate(z.object({ archived: z.boolean() }), req.body)
  const application = await Application.findOneAndUpdate(
    { _id: id, company: req.company._id },
    { $set: { archivedAt: archived ? new Date() : null } },
    { new: true, runValidators: true },
  )
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  res.status(204).end()
})

router.patch('/recruiter/applications/:applicationId/status', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const { status } = validate(z.object({ status: z.enum(['under_review', 'shortlisted', 'interview_scheduled', 'selected', 'rejected']) }), req.body)
  const application = await Application.findOneAndUpdate({ _id: id, company: req.user.company, status: { $ne: 'withdrawn' } }, { status }, { new: true })
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  const candidate = await User.findById(application.candidate).select('candidateNotificationPreferences')
  if (shouldSendCandidateNotification(candidate?.candidateNotificationPreferences, 'applicationUpdates')) {
    await Notification.create({ user: application.candidate, type: 'application_status', title: 'Application update', message: `Your application status changed to ${status.replaceAll('_', ' ')}.`, relatedId: application._id })
  }
  res.json({ application })
})

router.post('/recruiter/applications/:applicationId/interviews', requireUser, requireRoles('recruiter'), requireCompanyMember, async (req, res) => {
  const id = validate(objectId, req.params.applicationId)
  const input = validate(z.object({
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(480).optional().default(30),
    meetingUrl: z.string().url().max(500).optional().or(z.literal('')).default(''),
    notes: z.string().max(2000).optional().default(''),
  }), req.body)
  const application = await Application.findOne({ _id: id, company: req.user.company, status: { $nin: ['withdrawn', 'rejected'] } })
    .populate('candidate', 'name email')
    .populate('job', 'title')
  if (!application) return res.status(404).json({ error: 'Application not found.' })
  const interview = await Interview.create({ ...input, scheduledAt: new Date(input.scheduledAt), candidate: application.candidate._id, company: application.company, application: application._id })
  application.status = 'interview_scheduled'
  await application.save()
  const interviewTime = interview.scheduledAt.toLocaleString('en-US', {
    timeZone: req.company.timezone || 'UTC',
    timeZoneName: 'short',
  })
  const candidateRecord = await User.findById(application.candidate._id).select('candidateNotificationPreferences')
  if (shouldSendCandidateNotification(candidateRecord?.candidateNotificationPreferences, 'interviewReminders')) {
    await Notification.create({ user: application.candidate._id, type: 'interview_scheduled', title: 'Interview scheduled', message: `An interview has been scheduled for ${interviewTime}.`, relatedId: interview._id })
  }
  let emailResult
  try {
    emailResult = await sendInterviewEmail({
      to: application.candidate.email,
      candidateName: application.candidate.name,
      companyName: req.company.name,
      jobTitle: application.job.title,
      scheduledAt: interview.scheduledAt,
      durationMinutes: interview.durationMinutes,
      meetingUrl: interview.meetingUrl,
      notes: interview.notes,
      timeZone: req.company.timezone || 'UTC',
    })
  } catch (error) {
    console.error('Interview email delivery failed:', error)
    emailResult = { sent: false, error: 'The interview is scheduled and the in-app notification was created, but email delivery failed. Check the API server logs.' }
  }
  if (!emailResult.sent) console.error(`Interview email was not sent: ${emailResult.error}`)
  await notifyRecruiterMembers({
    memberIds: req.company.members,
    companyId: req.company._id,
    excludeUserId: req.user._id,
    preferenceKey: 'interviewUpdates',
    type: 'interview_scheduled',
    title: 'Interview scheduled',
    message: `An interview was scheduled with ${application.candidate.name} for ${application.job.title} at ${interviewTime}.`,
    subject: `Interview scheduled for ${application.candidate.name}`,
    companyName: req.company.name,
    loginUrl: getRecruiterNotificationsUrl(req),
    relatedId: interview._id,
  })
  res.status(201).json({ interview, emailSent: emailResult.sent, emailError: emailResult.error || '' })
})

router.get('/dashboard/admin', requireUser, requireRoles('super_admin'), async (_req, res) => {
  const [totalCandidates, totalRecruiters, totalOrganizations, verifiedOrganizations, pendingVerifications, totalJobs, activeJobs, totalApplications] = await Promise.all([
    User.countDocuments({ role: 'candidate' }),
    User.countDocuments({ role: 'recruiter' }),
    Company.countDocuments({ status: { $ne: 'removed' } }),
    Company.countDocuments({ status: 'verified' }),
    Company.countDocuments({ status: 'pending' }),
    Job.countDocuments(),
    Job.countDocuments({ status: 'published' }),
    Application.countDocuments(),
  ])
  res.json({ summary: { totalCandidates, totalRecruiters, totalOrganizations, verifiedOrganizations, pendingVerifications, totalJobs, activeJobs, totalApplications } })
})

router.get('/admin/organizations', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = { status: { $ne: 'removed' } }
  if (['pending', 'verified', 'rejected', 'suspended'].includes(req.query.status)) query.status = req.query.status
  if (typeof req.query.q === 'string' && req.query.q.trim()) query.$or = [
    { name: new RegExp(escapeRegex(req.query.q.trim().slice(0, 80)), 'i') },
    { contactEmail: new RegExp(escapeRegex(req.query.q.trim().slice(0, 80)), 'i') },
  ]
  const [items, total] = await Promise.all([
    Company.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('owner', 'name email').lean(),
    Company.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/admin/organizations/:companyId/status', requireUser, requireRoles('super_admin'), async (req, res) => {
  const id = validate(objectId, req.params.companyId)
  const { status } = validate(z.object({ status: z.enum(['verified', 'rejected', 'suspended', 'pending']) }), req.body)
  const company = await adminTransaction(req, { action: `organization.${status}`, targetType: 'company', target: id, details: { status } }, async (session) => {
    const updated = await Company.findOneAndUpdate({ _id: id, status: { $ne: 'removed' } }, { status }, { new: true, session })
    if (!updated) {
      const error = new Error('Organization not found.')
      error.status = 404
      throw error
    }
    if (status === 'suspended' || status === 'rejected') await Job.updateMany({ company: id, status: 'published' }, { status: 'paused' }, { session })
    return updated
  })
  res.json({ company })
})

router.delete('/admin/organizations/:companyId', requireUser, requireRoles('super_admin'), async (req, res) => {
  const id = validate(objectId, req.params.companyId)
  const company = await adminTransaction(req, { action: 'organization.removed', targetType: 'company', target: id }, async (session) => {
    const removed = await Company.findOneAndUpdate({ _id: id, status: { $ne: 'removed' } }, { status: 'removed' }, { new: true, session })
    if (!removed) {
      const error = new Error('Organization not found or already removed.')
      error.status = 404
      throw error
    }
    await Job.updateMany({ company: id, status: { $nin: ['closed', 'rejected'] } }, { status: 'closed' }, { session })
    await User.updateMany({ company: id, role: 'recruiter' }, { status: 'suspended' }, { session })
    return removed
  })
  res.json({ company })
})

router.get('/admin/users', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = {}
  if (['candidate', 'recruiter', 'super_admin'].includes(req.query.role)) query.role = req.query.role
  if (['active', 'pending', 'suspended'].includes(req.query.status)) query.status = req.query.status
  const [items, total] = await Promise.all([
    User.find(query).select('name email role status company createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/admin/users/:userId/status', requireUser, requireRoles('super_admin'), async (req, res) => {
  const id = validate(objectId, req.params.userId)
  const { status } = validate(z.object({ status: z.enum(['active', 'suspended']) }), req.body)
  const user = await adminTransaction(req, { action: `user.${status}`, targetType: 'user', target: id, details: { status } }, async (session) => {
    if (String(id) === String(req.user._id) && status === 'suspended') {
      const error = new Error('You cannot suspend your own Super Admin account.')
      error.status = 400
      throw error
    }
    const updated = await User.findOneAndUpdate({ _id: id, role: { $ne: 'super_admin' } }, { status }, { new: true, session }).select('name email role status')
    if (!updated) {
      const error = new Error('User not found or administrator accounts cannot be changed here.')
      error.status = 404
      throw error
    }
    return updated
  })
  res.json({ user })
})

router.get('/admin/jobs', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const query = {}
  if (['draft', 'pending_review', 'published', 'paused', 'closed', 'rejected'].includes(req.query.status)) query.status = req.query.status
  const [items, total] = await Promise.all([
    Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('company', 'name status').lean(),
    Job.countDocuments(query),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/admin/jobs/:jobId/status', requireUser, requireRoles('super_admin'), async (req, res) => {
  const id = validate(objectId, req.params.jobId)
  const { status } = validate(z.object({ status: z.enum(['published', 'paused', 'closed', 'rejected']) }), req.body)
  const job = await adminTransaction(req, { action: `job.${status}`, targetType: 'job', target: id, details: { status } }, async (session) => {
    const currentJob = await Job.findById(id).populate('company', 'status').session(session)
    if (!currentJob) {
      const error = new Error('Job not found.')
      error.status = 404
      throw error
    }
    if (status === 'published' && currentJob.company?.status !== 'verified') {
      const error = new Error('Verify the organization before publishing its jobs.')
      error.status = 409
      throw error
    }
    const updated = await Job.findByIdAndUpdate(id, { status, ...(status === 'published' ? { publishedAt: new Date() } : {}) }, { new: true, session })
    return updated
  })
  res.json({ job })
})

router.get('/admin/reports', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const [items, total] = await Promise.all([
    Report.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('reporter', 'name email').lean(),
    Report.countDocuments(),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.patch('/admin/reports/:reportId/status', requireUser, requireRoles('super_admin'), async (req, res) => {
  const id = validate(objectId, req.params.reportId)
  const { status } = validate(z.object({ status: z.enum(['reviewing', 'resolved', 'dismissed']) }), req.body)
  const report = await adminTransaction(req, { action: `report.${status}`, targetType: 'report', target: id, details: { status } }, async (session) => {
    const updated = await Report.findByIdAndUpdate(id, { status, assignedTo: req.user._id }, { new: true, session })
    if (!updated) {
      const error = new Error('Report not found.')
      error.status = 404
      throw error
    }
    return updated
  })
  res.json({ report })
})

router.get('/admin/audit-logs', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const [items, total] = await Promise.all([
    AdminLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'name email').lean(),
    AdminLog.countDocuments(),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.get('/admin/settings', requireUser, requireRoles('super_admin'), async (_req, res) => {
  const items = await Setting.find().sort({ key: 1 }).lean()
  res.json({ items })
})

router.put('/admin/settings/:key', requireUser, requireRoles('super_admin'), async (req, res) => {
  const key = validate(z.string().trim().regex(/^[a-z][a-z0-9_-]{1,79}$/), req.params.key)
  const { values } = validate(z.object({ values: z.array(z.string().trim().min(1).max(120)).max(100) }).strict(), req.body)
  const uniqueValues = [...new Set(values)]
  const setting = await adminTransaction(req, { action: 'settings.updated', targetType: 'setting', details: { key, values: uniqueValues } }, async (session) => Setting.findOneAndUpdate(
    { key },
    { key, values: uniqueValues, updatedBy: req.user._id },
    { upsert: true, new: true, runValidators: true, session },
  ))
  res.json({ setting })
})

router.get('/admin/notifications', requireUser, requireRoles('super_admin'), async (_req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ items })
})

router.get('/admin/applications', requireUser, requireRoles('super_admin'), async (req, res) => {
  const { page, limit, skip } = toPage(req.query)
  const [items, total] = await Promise.all([
    Application.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('candidate', 'name email').populate('company', 'name').populate('job', 'title').lean(),
    Application.countDocuments(),
  ])
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
})

router.get('/admin/admins', requireUser, requireRoles('super_admin'), async (req, res) => {
  const [admins, invites] = await Promise.all([
    User.find({ role: 'super_admin' }).select('name email status createdAt').sort({ createdAt: 1 }).lean(),
    AdminInvite.find({ expiresAt: { $gt: new Date() } }).select('email expiresAt createdAt').lean(),
  ])
  res.json({
    admins: admins.map((admin) => ({ ...admin, isPrimaryAdmin: admin.email.toLowerCase() === primaryAdminEmail })),
    invites,
    primaryAdminEmail,
    currentUserIsPrimaryAdmin: Boolean(primaryAdminEmail) && req.user.email.toLowerCase() === primaryAdminEmail,
    primaryAdminConfigured: Boolean(primaryAdminEmail),
  })
})

router.delete('/admin/admins/:adminId', requireUser, requireRoles('super_admin'), requirePrimaryAdmin, async (req, res) => {
  const id = validate(objectId, req.params.adminId)
  const primaryAdminEmail = process.env.PRIMARY_ADMIN_EMAIL.trim().toLowerCase()
  if (String(id) === String(req.user._id)) {
    const error = new Error('You cannot remove your own administrator account.')
    error.status = 400
    throw error
  }
  const admin = await User.findOne({ _id: id, role: 'super_admin' }).select('email').lean()
  if (!admin) {
    const error = new Error('Secondary administrator not found.')
    error.status = 404
    throw error
  }
  if (admin.email.toLowerCase() === primaryAdminEmail) {
    const error = new Error('The primary administrator account cannot be removed.')
    error.status = 400
    throw error
  }
  await adminTransaction(req, { action: 'admin.removed', targetType: 'user', target: id, details: { email: admin.email } }, async (session) => {
    const removed = await User.findOneAndDelete({ _id: id, role: 'super_admin', email: admin.email }, { session }).select('email')
    if (!removed) {
      const error = new Error('Secondary administrator not found.')
      error.status = 404
      throw error
    }
    return removed
  })
  res.status(204).end()
})

router.post('/admin/admin-invitations', requireUser, requireRoles('super_admin'), requirePrimaryAdmin, async (req, res) => {
  const { email } = validate(z.object({ email: z.string().email().max(240) }).strict(), req.body)
  const normalizedEmail = email.toLowerCase()
  const existingUser = await User.findOne({ email: normalizedEmail })
  if (existingUser && existingUser.role !== 'super_admin') return res.status(409).json({ error: 'This email is already assigned to a non-admin account.' })
  const invite = await adminTransaction(req, { action: 'admin.invite_created', targetType: 'admin_invite', details: { email: normalizedEmail } }, async (session) => AdminInvite.findOneAndUpdate(
    { email: normalizedEmail },
    { email: normalizedEmail, createdBy: req.user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    { upsert: true, new: true, runValidators: true, session },
  ))
  res.status(201).json({ invite })
})

router.delete('/admin/admin-invitations/:inviteId', requireUser, requireRoles('super_admin'), requirePrimaryAdmin, async (req, res) => {
  const id = validate(objectId, req.params.inviteId)
  await adminTransaction(req, { action: 'admin.invite_revoked', targetType: 'admin_invite', target: id }, async (session) => {
    const result = await AdminInvite.deleteOne({ _id: id }, { session })
    if (!result.deletedCount) {
      const error = new Error('Invitation not found.')
      error.status = 404
      throw error
    }
    return result
  })
  res.status(204).end()
})

export default router
