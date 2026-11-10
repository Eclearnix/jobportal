# Eclearnix Jobs

Eclearnix Jobs is a role-based job marketplace built with React, Vite, Express, MongoDB, and Google Identity Services. Private resumes are stored in MongoDB GridFS.

## Workspaces

- **Job Seeker** — candidate profile and resume, job search, saved jobs, applications, and notifications.
- **Organization / HR** — organization onboarding and verification, job drafts and publishing, applications, interviews, and team invitations.
- **Super Admin** — restricted access, organization and user management, job moderation, reports, analytics, master settings, administrator invitations, and audit history.

Super Admin sign-in is provided by the separate `jobportal-superAdmin` frontend. During local development, if `VITE_SUPER_ADMIN_URL` is unset, an existing Super Admin session uses the built-in admin workspace. Public sign-in endpoints cannot assign the Super Admin role. A first administrator must be provisioned by an operator with database access.

## Local setup

1. Install Node.js 20.19+ and MongoDB Atlas (or a local MongoDB replica set).
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, `GOOGLE_CLIENT_ID`, and `VITE_GOOGLE_CLIENT_ID`. `CLIENT_ORIGIN` accepts a comma-separated allowlist for the job portal; set `ADMIN_CLIENT_ORIGIN` to the exact origin of the separate Super Admin frontend. Set `PRIMARY_ADMIN_EMAIL` to the designated primary administrator's email. Configure both frontend origins in the Google OAuth web client.
3. Resume uploads are stored in the MongoDB database configured by `MONGODB_URI`; no separate file-storage account is required. GridFS stores resume files in the `resumes.files` and `resumes.chunks` collections.
4. To email candidates about scheduled interviews, configure Gmail SMTP in the server `.env` with `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. `SMTP_PASSWORD` must be a Google App Password for the Gmail account, not the normal account password. Without these settings, interview scheduling and in-app notifications still work, and the recruiter sees an explicit email delivery warning.
5. Install packages with `npm install`.
6. Start the API with `npm run server`.
7. In another terminal, start Vite with `npm run dev`.

Vite proxies `/api` requests to `http://localhost:4000`. The API refuses to start without its MongoDB URI and signing secret. Google sign-in reports explicit configuration errors until its provider settings are supplied. This app verifies Google Identity Services ID tokens, so it needs the OAuth client ID in both Google ID variables but does not use a Google client secret.

### Vercel deployment

Set the Vercel project root to `jobportal` (the folder containing `package.json`). The included `vercel.json` builds the Vite frontend, and `api/[...path].js` exposes the Express API under `/api`.

Add these environment variables in Vercel for Production, Preview, and Development as appropriate:

```text
VITE_GOOGLE_CLIENT_ID
VITE_SUPER_ADMIN_URL
MONGODB_URI
JWT_SECRET
GOOGLE_CLIENT_ID
CLIENT_ORIGIN
ADMIN_CLIENT_ORIGIN
TRUST_PROXY=true
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

Set `CLIENT_ORIGIN` to the exact deployed job portal frontend origin, such as `https://your-project.vercel.app`, and set `ADMIN_CLIENT_ORIGIN` to the exact deployed Super Admin frontend origin. Add each approved preview domain that needs API access to the matching allowlist. Do not expose server variables with a `VITE_` prefix.

### Provisioning the first Super Admin

Set `PRIMARY_ADMIN_EMAIL=eclearnix.jobs@gmail.com` in the backend `.env` or deployment environment, then restart/redeploy the backend. The account must have the `super_admin` role. If it has not yet been provisioned, run this from a trusted operator terminal:

```powershell
npm run admin:provision -- eclearnix.jobs@gmail.com
```

The administrator must then sign in through the separate Super Admin frontend using the Google account with that verified email. Only the configured primary administrator can invite or revoke additional Super Admins. Invitees must verify the invited email through Google. Changing `PRIMARY_ADMIN_EMAIL` and restarting the backend transfers the primary designation; the new address must already have the `super_admin` role. The old primary remains a Super Admin but loses the ability to manage invitations.

## Architecture

- `src/context` — browser session context.
- `src/services` — credentialed API client and query helpers.
- `src/components` — shared sign-in UI.
- `src/pages` — job portal login, onboarding, candidate/recruiter workspaces, and job details.
- `server/models` — timestamped Mongoose schemas and indexes.
- `server/middleware` — cookie-session, role, and organization membership checks.
- `server/routes.js` — validated REST endpoints for account, jobs, applications, organization, recruiter, and platform administration workflows.
- `server/storage.js` — private resume uploads and authenticated downloads through MongoDB GridFS.

The API uses backend-verified Google ID tokens, role-specific sign-in endpoints, HTTP-only session cookies, organization membership checks, paginated list endpoints, unique email/application indexes, and transactional Super Admin changes with audit records. Every `/admin/*` endpoint and `/dashboard/admin` requires a valid session and the `super_admin` role on the backend. Candidate applications and recruiter records are scoped to their authenticated owner or organization. Resume download endpoints verify the signed-in candidate or the recruiter's organization membership before streaming private files.

## Validation

```powershell
npm run lint
npm run build
Get-ChildItem server -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

End-to-end OAuth and database workflows require real Google, MongoDB, and R2 configuration. Keep those credentials only in environment variables; never put server secrets in Vite variables or frontend code.
