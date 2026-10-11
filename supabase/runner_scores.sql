-- ============================================================
-- Tafeltennisrun — ranglijst voor heel de club
-- Plak dit hele bestand in Supabase -> SQL Editor -> Run.
-- Je mag het gerust opnieuw draaien, er gaat niets stuk.
-- ============================================================

create table if not exists public.runner_scores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 16),
  score      int  not null check (score between 0 and 1000000),
  seed       text not null check (char_length(seed) between 1 and 32),
  created_at timestamptz not null default now()
);

create index if not exists runner_scores_seed_score_idx
  on public.runner_scores (seed, score desc);
create index if not exists runner_scores_score_idx
  on public.runner_scores (score desc);

-- Iedereen mag lezen en toevoegen; wijzigen of wissen mag niet.
alter table public.runner_scores enable row level security;

drop policy if exists "runner_scores lezen" on public.runner_scores;
create policy "runner_scores lezen" on public.runner_scores
  for select to anon, authenticated using (true);

drop policy if exists "runner_scores toevoegen" on public.runner_scores;
create policy "runner_scores toevoegen" on public.runner_scores
  for insert to anon, authenticated with check (true);

grant select, insert on public.runner_scores to anon, authenticated;
