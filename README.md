# GRE Sentence Equivalence Scaffolder

An interactive web activity that walks GRE students through Kaplan's four-step Sentence Equivalence method (Clues → Predict → Match → Confirm), with optional AI coaching at three points in each question and a personalized session recap. Built as a single static HTML page plus one server-side Netlify Function and an optional Supabase backend for telemetry and feedback.

---

## What's in this repo

```
.
├── .gitignore
├── README.md                    ← This file
├── netlify.toml                 ← Netlify config (publish dir, functions dir, root redirect)
├── sentequiv.html               ← The full app — HTML, CSS, JS, all in one file
├── supabase-schema.sql          ← Run once in Supabase SQL Editor (telemetry + feedback tables)
├── instructor-report.sql        ← Optional: 11-metric instructor dashboard view
└── netlify/
    └── functions/
        └── grade.mjs            ← Server-side Gemini proxy (keeps API key off the client)
```

---

## Features

### Student-facing

- **Five-question Sentence Equivalence practice set**, each with a guided four-step scaffold (Clues → Predict → Match → Confirm).
- **Tutorial mode on Q1** — all hints expanded; collapse from Q2 onward.
- **A–F lettered answer choices** to support systematic elimination.
- **Step 4 word toggle** — pill UI to read the sentence with each selection in place, instead of comparing two side-by-side renderings.
- **Per-step "Your prediction / Expert prediction" recall** at Step 3 so students don't lose their original prediction while matching.
- **Session resume** — refreshing mid-set returns to the question they were on (localStorage).
- **Completion screen** with first-try score, clue-type breakdown, vocabulary-to-review, and personalized takeaway.
- **In-app feedback form** — single 1–5 star rating with descriptors (Frustrated → Loved it) plus an optional comment.
- **Accessibility**: focus-visible rings, ARIA live regions for step transitions, `prefers-reduced-motion` handling, sr-only skip link, screen-reader announcements.

### Your Kaplan Coach (AI coaching)

When AI is enabled in settings, four coach moments fire across a session:

| When | What it does |
|---|---|
| **Step 1** (after submitting clue analysis) | Checks whether student found the pivot word and key clue. One-line nudge plus ✓/✗ pills. |
| **Step 2** (after submitting prediction) | Checks whether prediction matches the required meaning. One-line nudge. |
| **Step 4** (after Check My Answer) | Holistic 2-sentence journey recap referencing student's actual clue analysis, prediction, and selections. Plus chips for words they picked wrong (red) and correct words they missed (green). |
| **Completion screen** | Session-level recap drawing on all 5 questions. Generic positive opener, method-focused, only comments on performance for nailed moments or Q1→Q5 improvement. |

All coach moments call the same `/.netlify/functions/grade` proxy. The Gemini API key lives in Netlify env vars and never reaches the browser.

### Telemetry & feedback

Captured to Supabase as anonymous events (no PII):

- **`session_start`** — new session begins or resumes
- **`question_start`** — each question loaded
- **`step_complete`** — per-step completion with duration_ms and student input
- **`ai_grade_step1` / `ai_grade_step2` / `ai_grade_step4` / `ai_grade_session`** — AI coach verdicts
- **`answer_checked`** — Check My Answer clicked, with selections + correctness
- **`try_again`** — retry on Step 4
- **`session_complete`** — full per-question summary
- **`feedback_submitted`** — rating and comment metadata

Plus a separate `feedback` table for the post-session form (rating, comment, session summary snapshot).

---

## Architecture

```
Browser ──► Netlify static site (sentequiv.html)
   │
   ├──► /.netlify/functions/grade  ──► Gemini API
   │    (server-side; holds GEMINI_API_KEY)
   │
   └──► Supabase REST (rest/v1/events, rest/v1/feedback)
        (anon key, RLS allows insert only)
```

Three external dependencies, each replaceable:
- **Netlify** for static hosting + the function runtime
- **Google Gemini 2.5 Flash** for AI coaching
- **Supabase** for telemetry/feedback storage

Strip out AI by toggling it off in settings. Strip out telemetry by leaving Supabase fields blank — events buffer to localStorage and the rest of the app keeps working.

---

## Deployment

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

### 2. Connect to Netlify

Netlify dashboard → *Add new site → Import an existing project → GitHub → pick the repo*. No build command needed; `netlify.toml` handles publish dir and functions dir.

### 3. Set the Gemini API key

Netlify dashboard → *Site configuration → Environment variables → Add a variable*:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

Scope to *All scopes* and *All deploy contexts*. **Trigger a redeploy** after adding (env vars only apply to deploys made after they're set).

### 4. Set up Supabase (optional but recommended)

1. Create a Supabase project ([supabase.com](https://supabase.com)).
2. *SQL Editor → New query* — paste `supabase-schema.sql`, run. Creates `events` and `feedback` tables with RLS allowing anonymous inserts only.
3. *(Optional)* Run `instructor-report.sql` to get the 11-metric dashboard view.
4. *Project Settings → API* — copy the **Project URL** and the **anon public** key.
5. Open the deployed site, click ⚙ (top right), paste both into the Supabase section, hit Save.

**Verify RLS:** from a terminal,
```bash
curl "https://YOUR-PROJECT.supabase.co/rest/v1/events?select=*&limit=1" \
  -H "apikey: YOUR_ANON_KEY" -H "Authorization: Bearer YOUR_ANON_KEY"
```
Should return `[]`. If it returns rows, RLS isn't applying — re-run the schema.

### 5. Enable AI coaching

⚙ icon → flip **Your Kaplan Coach** toggle on → Save. Toggle state is per-browser localStorage, so each user's setting is independent.

For production with real students, you'll want to either default it on (change `aiEnabled: false` to `true` in `defaultSettings`) and hide the cog, or gate the cog behind a `?admin=1` URL parameter so only instructors see it.

---

## Local development

```bash
npm install -g netlify-cli
echo "GEMINI_API_KEY=AIza..." > .env
netlify dev
```

Runs at `http://localhost:8888` with the function endpoint working locally. The `.env` is in `.gitignore` so it stays out of the repo.

Opening `sentequiv.html` directly via `file://` works for everything except AI grading, which needs the function endpoint to exist.

---

## Reading the data

After Supabase is connected, three views ship with `instructor-report.sql`:

```sql
-- One-row dashboard: avg rating, completion funnel, time per step
select * from v_instructor_report;

-- All free-text feedback comments, newest first
select * from v_feedback_comments;

-- Step pacing across all questions, with p50/p90
select * from v_step_pacing;
```

Export from any SQL Editor query result via the *Download CSV* button. For ad-hoc table dumps: *Table Editor → events* → top-right *…* menu → *Export as CSV*.

---

## Cost expectations (demo scale)

| Item | Per-session usage | Cost |
|---|---|---|
| Netlify (paid) | ~15 function invocations | Within paid allotment |
| Gemini 2.5 Flash | ~3 calls per question + 1 session recap = 16 calls | Free tier: 15 RPM, 1500 RPD; ~93 sessions/day |
| Supabase free | ~60 events + 1 feedback | 500MB DB, 2GB bandwidth |

Beyond ~90 sessions/day you'll want to upgrade Gemini to the paid tier (~$0.30 per 1M output tokens, well under a penny per session even then).

---

## Security

- **Gemini API key** lives in Netlify env vars, never in the repo or the browser. The proxy validates input shape, allowlists models, caps output tokens, and times out at 12s.
- **Supabase anon key** is safe to embed in the browser as long as RLS policies allow inserts only (which `supabase-schema.sql` configures). Verify with the curl test above before going to real users.
- **No PII collected** — sessions are anonymous UUIDs; the `user_agent` field can be dropped if your context requires stricter privacy.
- **Unauthenticated proxy endpoint** — `/.netlify/functions/grade` accepts requests from anyone. For demo scale this is fine; for broader exposure, add rate limiting (Netlify Edge Functions or Cloudflare in front) or a lightweight bearer token.

---

## Production hardening checklist

Before handing this to real students:

- [ ] `GEMINI_API_KEY` set in Netlify, not in any committed file
- [ ] Supabase RLS verified (anon SELECT returns empty)
- [ ] `.env` is in `.gitignore`
- [ ] Settings cog removed or gated for non-instructor users
- [ ] AI toggle defaulted on (or hidden) for student-facing builds
- [ ] Consent disclosure added if your context requires data collection notice
- [ ] Rate limiting on `/.netlify/functions/grade` if URL is shared broadly

---

## Changelog of features built

In rough order of implementation:

1. Base 5-question scaffolder with four-step guided flow
2. Side-by-side "Your analysis / Expert analysis" comparison on Steps 1 & 2 *(later removed in favor of the AI coach)*
3. Step 4 word-toggle pills replacing Version A/B boxes
4. Step 3 prediction recall pair (Your / Expert)
5. Method-verb progress stepper (Clues / Predict / Match / Confirm)
6. A–F option letters
7. Q1 tutorial mode (hints expanded)
8. localStorage session resume
9. Completion screen with score, clue-type breakdown, takeaway
10. In-app feedback form (replaces external Google Form)
11. Telemetry capture system (localStorage buffer, Supabase sync)
12. Settings modal (⚙ cog) for AI + Supabase configuration
13. **Your Kaplan Coach** at Steps 1, 2, 4, and the completion screen
14. Server-side Gemini proxy via Netlify Function (key hardening)
15. JSON parsing hardening (markdown fences, preamble stripping)
16. Vocabulary-to-review chips (wrong picks + missed correct words)
17. Limited HTML emphasis support in coach text (`<strong>`, `<em>`)
18. Star rating with descriptor labels (Frustrated → Loved it)
