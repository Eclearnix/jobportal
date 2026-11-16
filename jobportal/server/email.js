import nodemailer from 'nodemailer'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function getHttpUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function createSmtpTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  })
}

export async function sendRecruiterNotificationEmail({ to, companyName, subject, message, loginUrl }) {
  const transporter = createSmtpTransporter()
  if (!transporter) {
    return {
      sent: false,
      error: 'Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in the server environment.',
    }
  }

  const safeLoginUrl = getHttpUrl(loginUrl)
  const text = `${message}${safeLoginUrl ? `\n\nOpen Eclearnix Jobs: ${safeLoginUrl}` : ''}`
  const html = `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>${safeLoginUrl ? `<p><a href="${escapeHtml(safeLoginUrl)}">Open Eclearnix Jobs</a></p>` : ''}`
  const info = await transporter.sendMail({
    from: {
      name: `${companyName} via Eclearnix Jobs`,
      address: process.env.SMTP_FROM || process.env.SMTP_USER,
    },
    to,
    subject,
    text,
    html,
  })

  const accepted = (info.accepted || []).some((address) => String(address).toLowerCase() === to.toLowerCase())
  if (!accepted) return { sent: false, error: 'The email server did not accept the recipient address.' }
  return { sent: true }
}

export async function sendCompanyInvitationEmail({ to, companyName, invitedByName, loginUrl }) {
  const transporter = createSmtpTransporter()
  if (!transporter) {
    return {
      sent: false,
      error: 'Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in the server environment.',
    }
  }

  const safeLoginUrl = getHttpUrl(loginUrl)
  if (!safeLoginUrl) return { sent: false, error: 'The organization login URL is not configured.' }

  const subject = `You are invited to join ${companyName} on Eclearnix Jobs`
  const text = [
    'Hello,',
    '',
    `${invitedByName} has invited you to join ${companyName}'s hiring team on Eclearnix Jobs.`,
    'To accept, sign in with Google using the email address that received this invitation and choose Organization / HR.',
    '',
    `Sign in: ${safeLoginUrl}`,
    '',
    'This invitation expires in 7 days.',
  ].join('\n')
  const html = `<p>Hello,</p>
    <p>${escapeHtml(invitedByName)} has invited you to join <strong>${escapeHtml(companyName)}</strong>'s hiring team on Eclearnix Jobs.</p>
    <p>To accept, sign in with Google using the email address that received this invitation and choose Organization / HR.</p>
    <p><a href="${escapeHtml(safeLoginUrl)}">Sign in to Eclearnix Jobs</a></p>
    <p>This invitation expires in 7 days.</p>`

  const info = await transporter.sendMail({
    from: {
      name: `${companyName} HR via Eclearnix Jobs`,
      address: process.env.SMTP_FROM || process.env.SMTP_USER,
    },
    to,
    subject,
    text,
    html,
  })

  const accepted = (info.accepted || []).some((address) => String(address).toLowerCase() === to.toLowerCase())
  if (!accepted) return { sent: false, error: 'The email server did not accept the recipient address.' }
  return { sent: true }
}

export async function sendInterviewEmail({ to, replyTo, candidateName, companyName, jobTitle, scheduledAt, durationMinutes, meetingUrl, notes, timeZone = 'UTC' }) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    return {
      sent: false,
      error: 'Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in the server .env.',
    }
  }

  const date = new Date(scheduledAt)
  const formattedDate = date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  })
  const safeMeetingUrl = getHttpUrl(meetingUrl)
  const subject = `Interview scheduled: ${jobTitle}`
  const text = [
    `Hello ${candidateName},`,
    '',
    `${companyName} has scheduled an interview with you for ${jobTitle}.`,
    `When: ${formattedDate}`,
    `Duration: ${durationMinutes} minutes`,
    safeMeetingUrl ? `Meeting link: ${safeMeetingUrl}` : '',
    notes ? `Notes: ${notes}` : '',
  ].filter(Boolean).join('\n')
  const html = `<p>Hello ${escapeHtml(candidateName)},</p>
    <p>${escapeHtml(companyName)} has scheduled an interview with you for <strong>${escapeHtml(jobTitle)}</strong>.</p>
    <p><strong>When:</strong> ${escapeHtml(formattedDate)}<br>
    <strong>Duration:</strong> ${durationMinutes} minutes</p>
    ${safeMeetingUrl ? `<p><strong>Meeting link:</strong> <a href="${escapeHtml(safeMeetingUrl)}">${escapeHtml(safeMeetingUrl)}</a></p>` : ''}
    ${notes ? `<p><strong>Notes:</strong><br>${escapeHtml(notes).replace(/\n/g, '<br>')}</p>` : ''}`

  const transporter = createSmtpTransporter()

  await transporter.sendMail({
    from: `"${companyName} HR via Eclearnix Jobs" <${SMTP_FROM || SMTP_USER}>`,
    to,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
  })

  return { sent: true }
}
