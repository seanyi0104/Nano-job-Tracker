# Job Tracker

AI-powered job search assistant for CS students. Connects to Gmail, automatically finds job application emails, extracts structured data, and generates interview preparation materials.

## Features

- **Gmail sync** — Fetches and classifies job-related emails (applications, interviews, OAs, rejections, offers)
- **Application dashboard** — Cards grouped by status with color-coded badges
- **Status tracking** — Auto-inferred from emails, manually editable
- **Company snapshot** — AI-generated culture, values, engineering focus, interview themes
- **Interview prep** — Process overview, stage breakdown, preparation checklist
- **Behavioral questions** — Company-specific questions with answer saving

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Prisma + SQLite (swappable to Postgres)
- Auth.js v5 (Google OAuth with `gmail.readonly`)
- Anthropic Claude API (Haiku for classification, Sonnet for extraction/generation)
- Tailwind CSS

## Quick Start (Demo Mode)

No credentials needed — try the app with sample data:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app auto-migrates the database, seeds 6 sample applications (Amazon, Google, Meta, Stripe, Databricks, Anduril), and skips sign-in. The Amazon application includes pre-generated prep content so you can see every feature.

Demo mode activates automatically when `GOOGLE_CLIENT_ID` is not set. Gmail sync is disabled; AI generation buttons work if you set `ANTHROPIC_API_KEY` in `.env.local`, otherwise they show an error. To use your real Gmail, follow the full setup below.

## Full Setup (Real Gmail)

### Prerequisites

- Node.js 20+ (managed via mise in this repo)
- An Anthropic API key

### 1. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen**:
   - User type: External
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Leave publishing status as **Testing**
   - Add your Gmail address under **Test users** (required)
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: Web application
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy the Client ID and Client Secret

### 2. Environment Variables

```bash
cp .env.example .env.local
```

Fill in:
- `AUTH_SECRET` — generate with `npx auth secret`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 1
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com/settings/keys)
- `DATABASE_URL` — keep as `file:./dev.db` for local SQLite

### 3. Install and Run

```bash
npm install
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Click **Connect with Gmail** on the sign-in page
2. Grant read-only access (you'll see a Google consent screen)
3. Click **Sync Gmail** on the dashboard
4. Wait for classification and extraction to complete
5. Click into any application to see details
6. Generate company snapshot, interview prep, and behavioral questions
7. Save your behavioral answers (autosaves on blur)

## Known Limitations

- **7-day token expiry**: Google's Testing-mode OAuth apps expire refresh tokens every 7 days. When this happens, sign out and reconnect. This is a Google limitation that goes away once the app is verified and published.
- **Classification quality**: The Gmail pre-filter query is intentionally broad; Haiku does the precise filtering. Some false positives may slip through — delete mis-identified applications from the detail page.
- **Merge accuracy**: Company/role normalization handles most variants but isn't perfect. If the same application appears twice, delete the duplicate.

## Development

```bash
# Run tests
npx vitest run

# Run dev server
npm run dev

# View database
npx prisma studio

# Reset database
rm prisma/dev.db && npx prisma migrate dev
```

## Manual E2E Checklist

- [ ] Sign in with Google → consent screen shows `gmail.readonly`
- [ ] Dashboard shows after redirect
- [ ] Account row in Prisma Studio has both `access_token` and `refresh_token`
- [ ] Sync → progress bar advances → applications appear
- [ ] Re-sync → no duplicates
- [ ] Click into application → email timeline renders
- [ ] Edit status → survives reload
- [ ] Re-sync → manual status not overwritten
- [ ] Generate company snapshot → content appears
- [ ] Regenerate → content updates
- [ ] Generate interview prep → stages and checklist render
- [ ] Generate behavioral questions → questions appear
- [ ] Type an answer → blur → "Saved ✓"
- [ ] Regenerate questions → answered questions preserved
- [ ] Delete application → redirects to dashboard
- [ ] Sign out → redirects to sign-in page
