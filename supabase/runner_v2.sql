-- ============================================================
-- Tafeltennisrun — eerlijke ranglijst voor heel de club (versie 2)
-- Plak dit hele bestand in Supabase -> SQL Editor -> Run.
-- Je mag het gerust opnieuw draaien, er gaat niets stuk.
--
-- Schrijven kan enkel de Edge Function `submit-run` (service-rol,
-- die RLS omzeilt). Het publiek (anon-sleutel) mag alleen lezen.
-- ============================================================

-- ------------------------------------------------------------
-- Tabellen
-- ------------------------------------------------------------

-- Spelers. `name_key` is de naam in kleine letters: "Jo" en "jo" zijn
-- dezelfde speler. De Edge Function zoekt op `name_key`.
create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 16),
  name_key   text generated always as (lower(name)) stored unique,
  created_at timestamptz not null default now()
);

-- Het toestelgeheim (alleen de SHA-256 hash, hex). Door niemand te lezen
-- behalve de Edge Function.
create table if not exists public.player_secrets (
  player_id   uuid primary key references public.players (id) on delete cascade,
  secret_hash text not null
);

-- Eén rij per geverifieerde run op de dagbaan.
create table if not exists public.runs (
  id           bigint generated always as identity primary key,
  player_id    uuid not null references public.players (id) on delete cascade,
  seed         text not null check (seed ~ '^\d{4}-\d{2}-\d{2}$'),
  game_version int  not null,
  score        int  not null,
  dist         int  not null,
  balls        int  not null,
  jumps        int  not null,
  slides       int  not null,
  lanes        int  not null,
  shields      int  not null,
  magnets      int  not null,
  timeouts     int  not null,
  bakken       int  not null,
  blocks       int  not null,
  crash        text not null,  -- nopper | table | net | machine
  frames       int  not null,  -- lengte van de run in 1/60 s
  kit          text not null,
  created_at   timestamptz not null default now(),

  -- Extra laag: de Edge Function rekent al juist, dit vangt fouten op.
  constraint runs_tellers_niet_negatief check (
    game_version >= 0 and dist >= 0 and balls >= 0 and jumps >= 0
    and slides >= 0 and lanes >= 0 and shields >= 0 and magnets >= 0
    and timeouts >= 0 and bakken >= 0 and blocks >= 0
  ),
  constraint runs_score_bereik check (score between 0 and 1000000),
  constraint runs_frames_bereik check (frames between 1 and 108000),  -- 30 minuten
  -- Meer dan dist + 20 per bal kan niet: 10 per bal, x2 met de ballenbak.
  constraint runs_score_max check (score <= dist + balls * 20),
  -- dist <= frames * 40 / 60 + 1 (40 m/s is een ruime bovengrens).
  -- Hier vermenigvuldigd in plaats van gedeeld, zodat integerdeling
  -- niets afrondt: dist * 60 <= frames * 40 + 60. De bigint-casts
  -- voorkomen dat de vermenigvuldiging overloopt.
  constraint runs_dist_max check (
    dist::bigint * 60 <= frames::bigint * 40 + 60
  )
);

create index if not exists runs_seed_score_idx
  on public.runs (seed, score desc);
create index if not exists runs_player_created_idx
  on public.runs (player_id, created_at desc);  -- tempolimiet
create index if not exists runs_score_idx
  on public.runs (score desc);

-- De beste invoerlijst per speler per dag (voor een spookloper, later).
create table if not exists public.best_inputs (
  player_id    uuid not null references public.players (id) on delete cascade,
  seed         text not null,
  score        int  not null,
  game_version int  not null,
  frames       int  not null,
  inputs       jsonb not null,  -- [[frame, actie], ...]
  updated_at   timestamptz not null default now(),
  primary key (player_id, seed)
);

-- ------------------------------------------------------------
-- Views: de beste run per speler
-- security_invoker: de view draait met de rechten van wie ze opvraagt,
-- dus de RLS-regels van de tabellen blijven gelden.
-- ------------------------------------------------------------

-- Per dag (seed) en per speler de beste run. Gelijke score: de vroegste telt.
create or replace view public.daily_best
  with (security_invoker = true) as
select distinct on (r.seed, r.player_id)
  r.seed,
  p.name,
  r.score,
  r.dist,
  r.balls,
  r.created_at
from public.runs r
join public.players p on p.id = r.player_id
order by r.seed, r.player_id, r.score desc, r.created_at asc;

-- Per speler de beste run ooit. Gelijke score: de vroegste telt.
create or replace view public.alltime_best
  with (security_invoker = true) as
select distinct on (r.player_id)
  p.name,
  r.score,
  r.seed,
  r.created_at
from public.runs r
join public.players p on p.id = r.player_id
order by r.player_id, r.score desc, r.created_at asc;

-- ------------------------------------------------------------
-- Toegang (RLS): lezen mag, schrijven alleen via de service-rol
-- ------------------------------------------------------------

alter table public.players        enable row level security;
alter table public.player_secrets enable row level security;
alter table public.runs           enable row level security;
alter table public.best_inputs    enable row level security;

drop policy if exists "players lezen" on public.players;
create policy "players lezen" on public.players
  for select to anon, authenticated using (true);

drop policy if exists "runs lezen" on public.runs;
create policy "runs lezen" on public.runs
  for select to anon, authenticated using (true);

drop policy if exists "best_inputs lezen" on public.best_inputs;
create policy "best_inputs lezen" on public.best_inputs
  for select to anon, authenticated using (true);

-- Op player_secrets bewust geen enkele policy. En geen insert-, update- of
-- delete-policies op de andere tabellen: de service-rol omzeilt RLS toch.

-- Supabase geeft nieuwe tabellen standaard alle rechten aan anon en
-- authenticated. Eerst alles intrekken, dan enkel `select` teruggeven.
revoke all on public.players, public.runs, public.best_inputs,
  public.daily_best, public.alltime_best
  from anon, authenticated;
revoke all on public.player_secrets from anon, authenticated;

grant select on public.players, public.runs, public.best_inputs,
  public.daily_best, public.alltime_best
  to anon, authenticated;

-- ------------------------------------------------------------
-- De oude tabel: lezen blijft, toevoegen door het publiek stopt.
-- (Alleen als ze bestaat, zodat dit bestand ook op een leeg project draait.)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.runner_scores') is not null then
    revoke insert, update, delete on public.runner_scores from anon, authenticated;
  end if;
end
$$;
