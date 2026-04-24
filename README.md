# GRE Sentence Equivalence Scaffolder — Deployment Guide

## Project structure

```
your-project/
├── netlify.toml              ← Netlify config (publish dir, functions dir, root redirect)
├── sentequiv.html            ← The app
├── supabase-schema.sql       ← Run once in Supabase SQL Editor
└── netlify/
    └── functions/
        └── grade.js          ← Server-side Gemini proxy
```

## 1. Deploy to Netlify

**Option A — Git-based (recommended):**

1. Push this folder to a GitHub repo.
2. In Netlify: *Add new site → Import an existing project → GitHub → pick the repo*.
3. Build settings: leave everything empty (no build step needed; `netlify.toml` handles publish dir and functions dir).
4. Deploy.

**Option B — Drag and drop:**

1. Drag the folder into the Netlify dashboard's *Sites* screen.
2. The functions directory is auto-detected from `netlify.toml`.

## 2. Set the environment variable

In the Netlify dashboard: *Site settings → Environment variables → Add a variable*:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

Scope: **All scopes** (builds + functions). Set deploy contexts to *All deploy contexts* unless you want separate keys for preview vs production.

After adding, trigger a redeploy (*Deploys → Trigger deploy → Deploy site*) so the function picks up the env var.

## 3. Set up Supabase

1. Create a new Supabase project (or use an existing one).
2. *SQL Editor → New query*, paste `supabase-schema.sql`, run. This creates the `events` and `feedback` tables with RLS policies allowing anonymous inserts only.
3. *Project Settings → API* — copy:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (starts with `eyJ…`)
4. Open the deployed site, click the ⚙ icon, paste both into the Supabase section, hit Save.

**Verify RLS is working:** from a terminal, try a SELECT with the anon key:
```bash
curl "https://YOUR-PROJECT.supabase.co/rest/v1/events?select=*&limit=1" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```
Expect `[]` (empty array) — the policies block SELECT for anon. If you see rows, RLS isn't applied correctly; re-run the schema.

## 4. Enable AI grading

Open the deployed site, click ⚙, flip the AI grading toggle on, hit Save. The toggle state is stored per-browser in localStorage.

Students hitting the site will see the ⚙ icon too — hide it for production by deleting the `<button id="settings-cog">…</button>` element and the `<div id="settings-modal">…</div>` block from `sentequiv.html`, then redeploying. Or gate it behind a `?admin=1` URL parameter if you want instructor access without a rebuild.

## Local development

```bash
npm install -g netlify-cli
netlify dev
```

This runs a local server at `http://localhost:8888` that:
- Serves `sentequiv.html` at `/`
- Proxies `/.netlify/functions/grade` to a local Node runtime
- Reads `GEMINI_API_KEY` from `.env` (create one in the project root with `GEMINI_API_KEY=AIza…`)

**Don't** commit `.env` — add it to `.gitignore`.

Opening the HTML file directly via `file://` will not work for AI grading — the `/.netlify/functions/grade` endpoint only exists under `netlify dev` or on a deployed Netlify site. The rest of the app (questions, timing, completion screen, feedback form) works fine via `file://`; only the AI coach cards will stay hidden.

## Analytics queries

Three ready-made views ship with the schema. Run them from the Supabase SQL Editor logged in as the project owner (not anon):

```sql
-- All session summaries (started, completed, retry count)
select * from v_session_summary order by started_at desc limit 20;

-- Step pacing: where do students get stuck?
select * from v_step_pacing;

-- AI grading accuracy by question
select * from v_ai_grading_accuracy;
```

For deeper analysis, query the raw `events` table and expand the `payload` jsonb column.

## Cost expectations (demo scale)

| Item | Usage | Cost |
|---|---|---|
| Netlify (paid tier) | 1 function invocation per Step 1/2 check | Within included allotment |
| Gemini 2.5 Flash | ~400 input + ~100 output tokens per call | Free tier: 15 RPM, 1M TPM, 1500 RPD |
| Supabase free tier | ~60 events + 1 feedback per session | Free up to 500MB + 2GB bandwidth |

At ~2 AI calls per question × 5 questions = 10 calls per student per session. The Gemini free-tier daily cap (1500 requests) covers ~150 student sessions/day. Upgrade Gemini or swap to a paid key if you exceed that.

## Security checklist before handing to real students

- [ ] `GEMINI_API_KEY` is set in Netlify env vars, **not** in any committed file
- [ ] Supabase RLS verified (anon SELECT returns empty)
- [ ] `.env` is in `.gitignore`
- [ ] Settings cog removed or gated if students shouldn't have access
- [ ] Consent disclosure added if collecting student data in a context that requires it
- [ ] Consider rate-limiting the Netlify function (e.g., via Netlify Edge Functions or an upstream CDN) to prevent abuse of the unauthenticated `/grade` endpoint
