# Eclearnix Jobs

Eclearnix Jobs is a role-based job marketplace built with React, Vite, Express, MongoDB, and Google Identity Services. Private resumes are stored in MongoDB GridFS.

## Workspaces

- **Job Seeker** — candidate profile and resume, job search, saved jobs, applications, and notifications.
- **Organization / HR** — organization onboarding and verification, job drafts and publishing, applications, interviews, and team invitations.
- **Super Admin** — restricted access, organization and user management, job moderation, reports, analytics, master settings, administrator invitations, and audit history.

Super Admin sign-in is separate at `/super-admin/login`. Public sign-in endpoints cannot assign the Super Admin role. A first administrator must be provisioned by an operator with database access.

## Local setup

1. Install Node.js 20.19+ and MongoDB Atlas (or a local MongoDB replica set).
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, `GOOGLE_CLIENT_ID`, and `VITE_GOOGLE_CLIENT_ID`. `CLIENT_ORIGIN` accepts a comma-separated allowlist; the Google client ID must match the OAuth web client configured for the local origin.
3. Resume uploads are stored in the MongoDB database configured by `MONGODB_URI`; no separate file-storage account is required. GridFS stores resume files in the `resumes.files` and `resumes.chunks` collections.
4. To email candidates about scheduled interviews, configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in the server `.env`. The sender address must be allowed by your Resend account (verify your sending domain for general delivery). Without these settings, interview scheduling and in-app notifications still work, and the recruiter sees an explicit email delivery warning.
5. Install packages with `npm install`.
6. Start the API with `npm run server`.
7. In another terminal, start Vite with `npm run dev`.

Vite proxies `/api` requests to `http://localhost:4000`. The API refuses to start without its MongoDB URI and signing secret. Google sign-in reports explicit configuration errors until its provider settings are supplied. This app verifies Google Identity Services ID tokens, so it needs the OAuth client ID in both Google ID variables but does not use a Google client secret.

### Provisioning the first Super Admin

After setting up the database, provision a dedicated administrator account from a trusted operator terminal:

```powershell
npm run admin:provision -- admin@example.com
```

The administrator must then sign in at `/super-admin/login` using the Google account with that verified email. Only an authenticated Super Admin can invite additional Super Admins, and invitees must verify the invited email through Google.

## Architecture

- `src/context` — browser session context.
- `src/services` — credentialed API client and query helpers.
- `src/components` — shared sign-in UI.
- `src/pages` — login, onboarding, candidate/recruiter/admin workspaces, and job details.
- `server/models` — timestamped Mongoose schemas and indexes.
- `server/middleware` — cookie-session, role, and organization membership checks.
- `server/routes.js` — validated REST endpoints for account, jobs, applications, organization, recruiter, and platform administration workflows.
- `server/storage.js` — private resume uploads and authenticated downloads through MongoDB GridFS.

The API uses backend-verified Google ID tokens, role-specific sign-in endpoints, HTTP-only session cookies, organization membership checks, paginated list endpoints, unique email/application indexes, and transactional Super Admin changes with audit records. Candidate applications and recruiter records are scoped to their authenticated owner or organization. Resume download endpoints verify the signed-in candidate or the recruiter's organization membership before streaming private files.

## Validation

```powershell
npm run lint
npm run build
Get-ChildItem server -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

End-to-end OAuth and database workflows require real Google, MongoDB, and R2 configuration. Keep those credentials only in environment variables; never put server secrets in Vite variables or frontend code.
