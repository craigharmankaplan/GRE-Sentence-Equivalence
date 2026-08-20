# GRE Sentence Equivalence Scaffolder

An interactive web activity that walks GRE students through Kaplan's four-step Sentence
Equivalence method (Clues → Predict → Match → Confirm), with AI coaching at three points in
each question plus a personalized session recap.

The whole app is **one static HTML file plus one serverless function**. No build step, no
framework, no bundler. It is hosted on Vercel and **iframed into a Maestro article that surfaces
in the Atom Learning Path** at `kna.learnwithatom.com`.

This is the first of a planned 12–15 GRE interactive workshops. It is the reference
implementation — the pattern here is meant to be copied.

---

## Where things live

| Thing | Where |
|---|---|
| Repo | `craigharmankaplan/GRE-Sentence-Equivalence` (branch `main`) |
| Hosting + serverless function | Vercel project `sentence-equivalence` |
| Public URL | `https://sentenceequiv.vercel.app` |
| Database | Supabase project `fdsasqtqefqmlocvhqvl` |
| AI runtime | Google Gemini 2.5 Flash (via the serverless proxy) |
| Student-facing surface | Maestro article → Atom Learning Path (`kna.learnwithatom.com`) |
| Security reference | Kaplan Security & Privacy Playbook — Interactive Workshops |

---

## What's in this repo

```
.
├── api/
│   └── grade.mjs             ← Serverless Gemini proxy (holds GEMINI_API_KEY)
├── index.html               ← The entire app — HTML, CSS, JS, question content
├── supabase-schema.sql      ← Run once in Supabase SQL Editor (tables, RLS, views)
├── vercel.json              ← Security headers + CSP frame-ancestors for the Atom embed
├── cloudbuild.yaml          ← Google Cloud Build config — see "Open items"
└── README.md                ← This file
```

Five files. That is the whole product.

---

## Architecture

```
Student's browser (inside the Atom iframe)
   │
   ├──► https://sentenceequiv.vercel.app/           Vercel static  →  index.html
   │
   ├──► POST /api/grade                             Vercel Function →  Gemini API
   │       (server-side; reads GEMINI_API_KEY)
   │
   └──► POST <supabase>/rest/v1/events              Supabase REST
        POST <supabase>/rest/v1/feedback            (anon key; RLS = insert only)
```

Three external dependencies, each replaceable:

- **Vercel** — static hosting plus the function runtime
- **Google Gemini 2.5 Flash** — the AI coach
- **Supabase** — telemetry and feedback storage

The Gemini API key never reaches the browser. Every coach call goes through `/api/grade`, which
adds the key server-side.

---

## Features

### Student-facing

- **Five-question practice set**, each with the guided four-step scaffold. Steps can't be skipped.
- **Tutorial mode on Q1** — hints pre-expanded; collapsed from Q2 onward.
- **A–F lettered answer choices** to support systematic elimination.
- **Step 4 "Read with" pill toggle** — swaps each selection into the sentence in place, instead
  of two stacked Version A/B blocks.
- **Step 3 prediction recall** — the student's own prediction sits beside the expert's while they
  match, so their work doesn't vanish.
- **Session resume** — refreshing returns the student to the question they were on (localStorage).
- **Completion screen** — first-try score, clue-type breakdown, vocabulary-to-review chips, and a
  personalized takeaway.
- **In-app feedback form** — 1–5 stars with descriptors (Frustrated → Loved it) plus one specific
  open-text prompt.
- **Accessibility** — focus-visible rings, ARIA live regions on step transitions, `aria-pressed`
  option toggles, `prefers-reduced-motion` handling, sr-only skip link, 320px reflow.

### Your Kaplan Coach (AI)

Four coach moments per session, all through the same proxy:

| When | What it does |
|---|---|
| **Step 1** — after submitting clue analysis | Checks whether the student found the pivot word and the key clue. One-line nudge plus ✓/✗ pills. |
| **Step 2** — after submitting a prediction | Checks whether the prediction matches the required meaning. One-line nudge. |
| **Step 4** — after Check My Answer | Two-sentence journey recap referencing the student's actual clue analysis, prediction, and selections. Plus chips for wrong picks (red) and missed correct words (green). |
| **Completion screen** | Session-level recap across all five questions. Method-focused; only comments on performance for a clear "nailed it" moment or Q1→Q5 improvement. |

The coach is **permanently on** in this build. `defaultSettings.aiEnabled` is `true`,
`loadSettings()` deliberately ignores any older localStorage values, and there is no settings
UI — an earlier build had a ⚙ cog, and it's gone.

### Telemetry

Anonymous events posted to Supabase. There is no PII and no enrollment ID — every student gets a
random session UUID.

`session_start` · `question_start` · `step_complete` · `ai_grade_step1` · `ai_grade_step2` ·
`ai_grade_step4` · `ai_grade_session` · `answer_checked` · `try_again` · `session_complete` ·
`feedback_submitted`

Events buffer in localStorage and flush to Supabase; a failed POST leaves the event queued for
the next attempt, so a dropped network call doesn't lose data.

---

## The `/api/grade` contract

One endpoint, four shapes, keyed on `step`. `model` is optional and validated against an
allowlist (`gemini-2.5-flash`, `gemini-2.5-pro`); anything else falls back to Flash.

**Step 1 — clue analysis**

```jsonc
// request
{ "step": 1, "sentence": "...", "rubric": { "pivot": "Though", "keyClue": "reveal as little as possible" },
  "studentInput": "...", "model": "gemini-2.5-flash" }
// response
{ "pivotFound": true, "clueFound": false, "nudge": "..." }
```

**Step 2 — prediction**

```jsonc
// request
{ "step": 2, "sentence": "...", "rubric": { "targetMeanings": ["unclear", "hidden", "..."] },
  "studentInput": "opaque" }
// response
{ "meaningMatch": true, "nudge": "..." }
```

**Step 4 — journey recap**

```jsonc
// request
{ "step": 4, "sentence": "...", "correctPair": ["opaque","obscure"], "selections": ["opaque","ambiguous"],
  "clueAnalysis": "...", "prediction": "..." }
// response
{ "summary": "..." }
```

**Step 5 — session recap**

```jsonc
// request
{ "step": 5, "questions": [ { "sentence": "...", "correctPair": [], "clueAnalysis": "",
  "prediction": "", "selections": [], "correctFirstTry": false, "aiStep1": {}, "aiStep2": {} } ] }
// response
{ "summary": "..." }
```

Hardening built into the function:

- **POST only** via the named `export async function POST(req)`.
- **Per-step input validation** — wrong shape gets a 400 before any spend against the key.
- **Input caps** — `studentInput` and `clueAnalysis` truncated to 1000 chars, `prediction` to 200.
  Discourages prompt stuffing.
- **Model allowlist** — closes parameter injection into the upstream Google URL.
- **Structured output** — `responseMimeType: application/json` plus a `responseSchema`,
  `temperature: 0.2`, `maxOutputTokens: 1000`.
- **12s upstream timeout** (client aborts at 14s), with distinct 502/504 responses.
- **Defensive JSON parser** — handles markdown fences and preamble even when Gemini ignores the
  schema. A failed parse degrades to a hidden coach card, never a broken UI.

---

## Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "..."
git push origin main
```

Vercel is connected to `main` and auto-deploys on push. No build command; it's a static site with
a function directory.

### 2. Set the Gemini API key in Vercel

*Project → Settings → Environment Variables → Add*

| Key | Value | Scope |
|---|---|---|
| `GEMINI_API_KEY` | Kaplan-sanctioned Gemini key | Production and Preview, marked **Sensitive** |

Redeploy after adding — env vars only apply to deploys made after they're set.

> The key must be on Kaplan's paid/enterprise Gemini plan. Under paid terms, prompt and response
> data is not used to train Google's models. Student text is in these payloads.

### 3. Set up Supabase

1. *SQL Editor → New query* — paste `supabase-schema.sql`, run. Creates `events` and `feedback`
   with RLS allowing anonymous inserts only, plus three analytics views.
2. *Project Settings → API* — the Project URL and anon key are already hardcoded in
   `defaultSettings` in `index.html`. Update them there if the project changes.

**Verify RLS before real students touch it:**

```bash
curl "https://YOUR-PROJECT.supabase.co/rest/v1/events?select=*&limit=1" \
  -H "apikey: YOUR_ANON_KEY" -H "Authorization: Bearer YOUR_ANON_KEY"
```

Should return `[]`. If it returns rows, RLS isn't applying — re-run the schema.

### 4. Embed in the Atom Learning Path

The app reaches students through a Maestro article item, not directly. In the Maestro code view,
the item has `"instruction_type": "html"` and the `content` field holds an escaped iframe:

```html
<iframe class="ql-video" frameborder="0" allowfullscreen="true"
        src="https://sentenceequiv.vercel.app" height="2000" width="100%"></iframe>
```

Other fields on that item that matter: `"kaplan_type": "instruction"`, `"schema": "2.0"`,
`"recommended_time": 900000` (15 minutes), and the `not_scorable` tag — the workshop reports no
score back to Atom.

The height is a fixed `2000`. There is no postMessage resize handshake, so the iframe is sized
tall enough for the longest state and the parent page scrolls. If a workshop grows past that, the
number has to change by hand.

---

## Local development

```bash
npm i -g vercel
vercel dev
```

Runs the static file and `/api/grade` together on `localhost:3000`. Pull the env var down with
`vercel env pull` so the function has a key.

Opening `index.html` over `file://` works for everything except AI coaching, which needs the
function endpoint to exist. The coach fails closed — the card hides and the rest of the app keeps
working.

---

## Reading the data

`supabase-schema.sql` ships three views:

```sql
select * from v_session_summary;      -- per-session funnel: starts, checks, completes, retries
select * from v_step_pacing;          -- avg / p50 / p90 seconds per question per step
select * from v_ai_grading_accuracy;  -- % pivot found, clue found, meaning match by question
```

Export via *Download CSV* on any SQL Editor result, or *Table Editor → events → … → Export as CSV*.

---

## Security posture

The full reasoning lives in the Security & Privacy Playbook. The short version:

- **Gemini key** is server-side only, in a Vercel env var marked Sensitive. Never in the repo,
  never in the browser. If it ever appears in a paste, log, screenshot, or commit, rotate it.
- **Supabase anon key is public by design** and is committed in `index.html`. That is fine — the
  security boundary is Postgres RLS, not key secrecy. RLS allows `insert` to `anon` and nothing
  else; reads require the service role.
- **No PII, no enrollment ID.** Every student is a random session UUID generated client-side.
  Nothing links a session back to a person, which is why the workshop can run before the identity
  question is settled.
- **`X-Frame-Options` is deliberately absent.** The app must be framed by Atom. Framing is
  controlled by CSP `frame-ancestors 'self' https://kna.learnwithatom.com` in `vercel.json`,
  which both permits the embed and blocks clickjacking from anywhere else.
- **`/api/grade` is unauthenticated.** Anyone who finds the URL can spend against the Gemini key.
  Acceptable at pilot scale with monitoring; it must not stay this way at student scale. See
  "Open items."
- **Storage is partitioned.** Inside the Atom iframe the app is cross-site to
  `learnwithatom.com`, so localStorage and sessionStorage are bucketed to the parent site.
  Session resume works within the embed; it does not carry over to the app opened standalone.
  Always test through the real embed, not the standalone URL.

---

## Open items

Carried here so they don't get lost. Ordered by how much they gate the work.

- [ ] **Rate-limit or auth-gate `/api/grade`.** Per-IP limiting is the floor while identity is
      unresolved; per-user limiting needs a verified identity first.
- [ ] **Identity transport from Atom is unresolved.** Whether the iframe can receive a verifiable
      enrollment ID — signed launch, postMessage, or nothing — is still an open question with the
      Atom integration owners. Until it's answered, no durable per-student data.
- [ ] **`cloudbuild.yaml` doesn't belong to this deploy path.** It's Google Cloud Build config in
      a Vercel-deployed repo. Either document what it's for or remove it. Still outstanding — the
      file isn't tracked here, so it has to be deleted in the repo directly.
- [ ] **Dead CSS: `.step-info h3` and its four color variants** (`.purple`, `.teal`, `.green`,
      `.gold`) match nothing. Same mismatch as the `.hint-toggle` selector below, one level up: no
      `<h3>` sits inside a `.step-info`. Every remaining `<h3>` is covered by another rule
      (`.stats-subsection`, `.completion-steps-reminder`, `.feedback-panel`, `.feedback-box`,
      `.feedback-header`), so these five are safe to delete — left in place pending a call on it.
- [ ] **CSP is framing-only.** `vercel.json` sets `frame-ancestors` but no `default-src`,
      `script-src`, or `connect-src`. Stand up the full policy in report-only first, then enforce.
- [ ] Add HSTS at custom-domain cutover, coordinated with IT.
- [ ] Confirm with Legal/Privacy that the audience is consumer (not institutional, not under-13)
      and that the Gemini data flow is covered by Kaplan's privacy policy.

### Fixed

- [x] **Stale `vercel.json` rewrite** (`/` → `/sentequiv.html`). `rewrites` block removed; Vercel
      serves `index.html` at `/` by default.
- [x] **`.hint-toggle h3` → `h2`.** Four selectors — the base rule plus the `.teal`, `.green`, and
      `.gold` color variants. All four step headings are `<h2>`, so the 16px sizing and every
      heading color were inert. Verified against the markup for all four steps.
- [x] **Blank-token mismatch on questions 4 and 5.** `renderPreviewSentence()` now splits on
      `/_{5,}/` rather than exactly nine underscores. Chosen over renormalizing the two sentences
      so that a future question written with a different count can't reintroduce it. Verified
      against all five sentences: two parts each, no stray underscore.
- [x] **`q.options.sort()` mutating the question object** during render. Now `.slice().sort()`.

---

## Building the next workshop

The reusable part is everything except the content. To stand up workshop number two:

1. Copy the repo. Empty the `questions` array in `index.html`.
2. Author questions in the same shape — `sentence` (blank as a run of five or more underscores;
   `renderPreviewSentence()` splits on `/_{5,}/`, so the exact count doesn't matter), `options`,
   `correct`, `clues`, `prediction`, `explanation`, `clueType`, `step1Rubric`, `step2Rubric`.
   The rubrics are what the coach grades against; without them the coach silently no-ops.
3. Relabel the four steps for the method being taught. The scaffold structure is
   question-type-agnostic; only the step names and the rubric fields change.
4. Add prompt branches in `buildPromptAndSchema()` if the new method needs different grading
   shapes.
5. New Vercel project, same env var, same Supabase project (events are already keyed by event
   type and question index).
6. New Maestro item pointing at the new Vercel URL, plus that URL's host in the workshop's own
   `frame-ancestors`.

See the Interactive Workshops build guide for the walkthrough version of this.
