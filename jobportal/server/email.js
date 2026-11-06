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

export async function sendInterviewEmail({ to, candidateName, companyName, jobTitle, scheduledAt, durationMinutes, meetingUrl, notes }) {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = process.env
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return {
      sent: false,
      error: 'Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL in the server .env.',
    }
  }

  const date = new Date(scheduledAt)
  const formattedDate = `${date.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' })} UTC`
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

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const body = await response.text()
    let detail = ''
    try {
      detail = JSON.parse(body).message || ''
    } catch {
      detail = body.slice(0, 300)
    }
    return {
      sent: false,
      error: detail
        ? `Resend could not send the email: ${detail}`
        : `Resend could not send the email (HTTP ${response.status}).`,
    }
  }

  return { sent: true }
}
