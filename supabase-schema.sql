-- =============================================================
-- GRE Sentence Equivalence Scaffolder — Supabase schema
-- =============================================================
-- Run this once in your Supabase project's SQL Editor.
-- It creates two tables and RLS policies that allow anonymous
-- inserts from the browser (using your anon key) while keeping
-- reads locked down to authenticated/service-role queries.
-- =============================================================

-- ───────────────────────────────────────────
-- events: one row per student action / step
-- ───────────────────────────────────────────
create table if not exists public.events (
    id               bigint generated always as identity primary key,
    session_id       uuid not null,
    event_type       text not null,
    question_index   integer,
    step_number      integer,
    duration_ms      integer,
    payload          jsonb not null default '{}'::jsonb,
    user_agent       text,
    client_timestamp timestamptz,
    created_at       timestamptz not null default now()
);

create index if not exists events_session_id_idx   on public.events (session_id);
create index if not exists events_event_type_idx   on public.events (event_type);
create index if not exists events_created_at_idx   on public.events (created_at desc);

-- ───────────────────────────────────────────
-- feedback: one row per feedback submission
-- ───────────────────────────────────────────
create table if not exists public.feedback (
    id               bigint generated always as identity primary key,
    session_id       uuid not null,
    rating           smallint check (rating between 1 and 5),
    reactions        text[] not null default array[]::text[],
    comment          text,
    session_summary  jsonb not null default '{}'::jsonb,
    user_agent       text,
    client_timestamp timestamptz,
    created_at       timestamptz not null default now()
);

create index if not exists feedback_session_id_idx on public.feedback (session_id);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

-- ───────────────────────────────────────────
-- Row Level Security
-- ───────────────────────────────────────────
-- Anonymous clients (browser with anon key) can INSERT only.
-- No SELECT / UPDATE / DELETE for anon. Use service role or
-- an authenticated role for analytics queries.
-- ───────────────────────────────────────────

alter table public.events   enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "anon can insert events"   on public.events;
drop policy if exists "anon can insert feedback" on public.feedback;

create policy "anon can insert events"
    on public.events
    for insert
    to anon
    with check (true);

create policy "anon can insert feedback"
    on public.feedback
    for insert
    to anon
    with check (true);

-- ───────────────────────────────────────────
-- Handy analytics views (run as service role / authenticated)
-- ───────────────────────────────────────────

create or replace view public.v_session_summary as
select
    session_id,
    min(created_at)                                            as started_at,
    max(created_at)                                            as last_activity_at,
    count(*) filter (where event_type = 'question_start')      as questions_started,
    count(*) filter (where event_type = 'answer_checked')      as answers_checked,
    count(*) filter (where event_type = 'session_complete')    as sessions_completed,
    count(*) filter (where event_type = 'try_again')           as retries
from public.events
group by session_id;

create or replace view public.v_step_pacing as
select
    question_index,
    step_number,
    count(*)                            as n,
    avg(duration_ms) / 1000.0           as avg_seconds,
    percentile_cont(0.5) within group (order by duration_ms) / 1000.0 as p50_seconds,
    percentile_cont(0.9) within group (order by duration_ms) / 1000.0 as p90_seconds
from public.events
where event_type = 'step_complete' and duration_ms is not null
group by question_index, step_number
order by question_index, step_number;

create or replace view public.v_ai_grading_accuracy as
select
    question_index,
    event_type,
    count(*)                                                            as n,
    avg(case when (payload->>'pivotFound')::boolean   then 1.0 else 0.0 end)   as pct_pivot_found,
    avg(case when (payload->>'clueFound')::boolean    then 1.0 else 0.0 end)   as pct_clue_found,
    avg(case when (payload->>'meaningMatch')::boolean then 1.0 else 0.0 end)   as pct_meaning_match
from public.events
where event_type in ('ai_grade_step1', 'ai_grade_step2')
group by question_index, event_type
order by question_index, event_type;
