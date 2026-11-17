import { Notification, User } from './models/index.js'
import { sendRecruiterNotificationEmail } from './email.js'

export const DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES = {
  applicationReceived: { inApp: true, email: false },
  interviewUpdates: { inApp: true, email: false },
  teamUpdates: { inApp: true, email: false },
}

export const DEFAULT_CANDIDATE_NOTIFICATION_PREFERENCES = {
  jobMatches: { inApp: true, email: false },
  applicationUpdates: { inApp: true, email: false },
  interviewReminders: { inApp: true, email: true },
}

export function normalizeRecruiterNotificationPreferences(preferences = {}) {
  const savedPreferences = preferences || {}
  return Object.fromEntries(Object.entries(DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES).map(([event, defaults]) => [
    event,
    {
      inApp: savedPreferences[event]?.inApp ?? defaults.inApp,
      email: savedPreferences[event]?.email ?? defaults.email,
    },
  ]))
}

export function normalizeCandidateNotificationPreferences(preferences = {}) {
  const savedPreferences = preferences || {}
  return Object.fromEntries(Object.entries(DEFAULT_CANDIDATE_NOTIFICATION_PREFERENCES).map(([event, defaults]) => [
    event,
    {
      inApp: savedPreferences[event]?.inApp ?? defaults.inApp,
      email: savedPreferences[event]?.email ?? defaults.email,
    },
  ]))
}

export function shouldSendCandidateNotification(preferences = {}, key, channel = 'inApp') {
  const normalized = normalizeCandidateNotificationPreferences(preferences)
  return Boolean(normalized[key]?.[channel])
}

export async function notifyRecruiterMembers({
  memberIds,
  companyId,
  excludeUserId,
  preferenceKey,
  type,
  title,
  message,
  subject,
  companyName,
  loginUrl,
  relatedId,
}) {
  if (!memberIds?.length) return

  try {
    const userQuery = { _id: { $in: memberIds }, company: companyId, role: 'recruiter', status: 'active' }
    if (excludeUserId) userQuery._id.$ne = excludeUserId
    const members = await User.find(userQuery).select('email recruiterNotificationPreferences').lean()

    for (const member of members) {
      const preferences = normalizeRecruiterNotificationPreferences(member.recruiterNotificationPreferences)[preferenceKey]
      if (preferences.inApp) {
        try {
          await Notification.create({ user: member._id, type, title, message, relatedId })
        } catch (error) {
          console.error('Recruiter in-app notification failed:', error)
        }
      }

      if (preferences.email) {
        try {
          const result = await sendRecruiterNotificationEmail({
            to: member.email,
            companyName,
            subject,
            message,
            loginUrl,
          })
          if (!result.sent) console.error(`Recruiter email notification was not sent: ${result.error}`)
        } catch (error) {
          console.error('Recruiter email notification failed:', error)
        }
      }
    }
  } catch (error) {
    console.error('Recruiter notification delivery failed:', error)
  }
}
