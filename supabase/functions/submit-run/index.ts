/* ============================================================
   Tafeltennisrun — Edge Function `submit-run`
   Ontvangt de invoerlijst van een dagrun, rekent die opnieuw na
   met dezelfde spelcode, claimt of controleert de naam, weigert
   een kopie van een eerder ingestuurde run, past de tempolimiet
   toe en bewaart de run met de service-rol.
   Alle controles op het verzoek zelf zitten in core.js (getest
   in Node); dit bestand doet enkel HTTP, CORS, hashen en database.
   ============================================================ */

// De gedeelde scripts hangen zich aan globalThis. Volgorde telt.
import '../_shared/config.js';
import '../_shared/rng.js';
import '../_shared/world.js';
import '../_shared/game.js';
import '../_shared/replay.js';
import './core.js';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------- minimale types voor wat core.js teruggeeft ----------

type ReplayResult = {
  score: number; dist: number; balls: number;
  jumps: number; slides: number; lanes: number; shields: number; magnets: number;
  timeouts: number; bakken: number; blocks: number;
  crash: string; frame: number;
};

type CheckedRun = {
  seed: string; name: string; secretHex: string; version: number;
  frames: number; inputs: [number, string][]; claimed: unknown; kit: string;
  result: ReplayResult;
};

type CheckResult =
  | { ok: true; run: CheckedRun }
  | { ok: false; status: number; code: string; message: string };

type SubmitCore = {
  checkRequest(body: unknown, now: Date): CheckResult;
  tooFast(lastCreatedAt: Date | null, now: Date, frames: number): boolean;
  MESSAGES: Record<string, string>;
};

const core = (globalThis as unknown as { TTR: { submitCore: SubmitCore } }).TTR.submitCore;
const MESSAGES = core.MESSAGES;

const MAX_BODY = 262144;  // 256 KB

// Eén client voor alle verzoeken; de service-rol omzeilt RLS.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

// ---------- CORS ----------

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',').map((s) => s.trim()).filter((s) => s.length > 0);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function originAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

// De oorsprong wordt enkel teruggegeven als ze toegelaten is.
function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Vary': 'Origin' };
  if (origin && originAllowed(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function reply(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function failure(status: number, code: string, cors: Record<string, string>): Response {
  return reply(status, { ok: false, code, message: MESSAGES[code] }, cors);
}

// ---------- hulpjes ----------

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// vergelijkt de volledige strings, zonder vroeg te stoppen (beide zijn 64 hex-tekens)
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Zoekt eerst op name_key (lower() in Postgres). Valt dat mis, dan op de naam
// zoals hij binnenkwam: bij letters als İ of een slot-sigma geeft toLowerCase()
// in JS soms iets anders dan lower() in Postgres, en dan zou de eigenaar zijn
// eigen naam nooit meer terugvinden.
async function findPlayer(name: string): Promise<{ id: string } | null> {
  const byKey = await db.from('players').select('id').eq('name_key', name.toLowerCase()).maybeSingle();
  if (byKey.error) throw byKey.error;
  if (byKey.data) return byKey.data;
  const byName = await db.from('players').select('id').eq('name', name).maybeSingle();
  if (byName.error) throw byName.error;
  return byName.data;
}

// Geeft de speler terug, of null als de naam van een ander toestel is.
async function claimName(name: string, hash: string): Promise<{ id: string; isNew: boolean } | null> {
  let player = await findPlayer(name);

  if (!player) {
    const ins = await db.from('players').insert({ name }).select('id').single();
    if (ins.error) {
      if (ins.error.code !== '23505') throw ins.error;
      // Iemand anders claimde de naam net voor ons: de unieke index beslist.
      player = await findPlayer(name);
      if (!player) return null;  // de naam bestaat in een andere schrijfwijze die we niet terugvinden
    } else {
      const sec = await db.from('player_secrets').insert({ player_id: ins.data.id, secret_hash: hash });
      if (sec.error) {
        // geen naam zonder geheim laten staan: die zou de naam voor iedereen blokkeren
        await db.from('players').delete().eq('id', ins.data.id);
        throw sec.error;
      }
      return { id: ins.data.id, isNew: true };
    }
  }

  const { data, error } = await db.from('player_secrets')
    .select('secret_hash').eq('player_id', player.id).maybeSingle();
  if (error) throw error;
  if (!data || !sameHash(String(data.secret_hash), hash)) return null;
  return { id: player.id, isNew: false };
}

// de hoogste score van een speler, eventueel enkel op één seed; null als er geen runs zijn
async function bestScore(playerId: string, seed?: string): Promise<number | null> {
  let q = db.from('runs').select('score').eq('player_id', playerId);
  if (seed) q = q.eq('seed', seed);
  const { data, error } = await q.order('score', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? Number(data.score) : null;
}

async function lastRunAt(playerId: string): Promise<Date | null> {
  const { data, error } = await db.from('runs').select('created_at').eq('player_id', playerId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? new Date(data.created_at) : null;
}

// ---------- het eigenlijke werk ----------

async function handle(req: Request, cors: Record<string, string>): Promise<Response> {
  // 1. Body: eerst de grootte, dan pas JSON.parse (cleanName in core is O(n))
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY) return failure(400, 'format', cors);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return failure(400, 'format', cors);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return failure(400, 'format', cors);
  }

  // 2. Vorm, versie, datum en herberekening (core.js)
  const now = new Date();
  const check = core.checkRequest(body, now);
  if (!check.ok) return reply(check.status, { ok: false, code: check.code, message: check.message }, cors);
  const run = check.run;
  const result = run.result;
  const score = result.score;

  // `claimed` dient enkel om afwijkingen te zien; het wordt nooit bewaard
  if (Number(run.claimed) !== score) {
    console.warn(JSON.stringify({ seed: run.seed, version: run.version, claimed: Number(run.claimed), score }));
  }

  // 3. Naam: claimen of het toestelgeheim controleren
  const hash = await sha256Hex(run.secretHex);
  const player = await claimName(run.name, hash);
  if (!player) return failure(409, 'name', cors);

  // 3b. Kopie: precies deze invoer op deze seed is al eens ingestuurd
  // (door wie dan ook). Genormaliseerd: enkel [frame, actie], net als in best_inputs.
  const inputs = run.inputs.map((e) => [e[0], e[1]]);
  const inputsHash = await sha256Hex(JSON.stringify([run.frames, inputs]));
  const seen = await db.from('runs').select('id')
    .eq('seed', run.seed).eq('inputs_hash', inputsHash).limit(1).maybeSingle();
  if (seen.error) throw seen.error;
  if (seen.data) return failure(409, 'copy', cors);

  // 4. Tempo: niet te snel na de vorige run van deze speler
  if (!player.isNew && core.tooFast(await lastRunAt(player.id), now, run.frames)) {
    return failure(429, 'rate', cors);
  }

  // beste ooit vóór deze run, voor `newBest`
  const before = player.isNew ? null : await bestScore(player.id);

  // 5. Bewaren
  const ins = await db.from('runs').insert({
    player_id: player.id,
    seed: run.seed,
    game_version: run.version,
    score,
    dist: result.dist,
    balls: result.balls,
    jumps: result.jumps,
    slides: result.slides,
    lanes: result.lanes,
    shields: result.shields,
    magnets: result.magnets,
    timeouts: result.timeouts,
    bakken: result.bakken,
    blocks: result.blocks,
    crash: result.crash,
    frames: run.frames,
    kit: run.kit,
    inputs_hash: inputsHash
  });
  if (ins.error) {
    // twee keer dezelfde run tegelijk: de unieke index (seed, inputs_hash) beslist
    if (ins.error.code === '23505') return failure(409, 'copy', cors);
    throw ins.error;
  }

  // de invoerlijst enkel bewaren als het de beste van deze speler op deze seed is
  const stored = await db.from('best_inputs').select('score')
    .eq('player_id', player.id).eq('seed', run.seed).maybeSingle();
  if (stored.error) throw stored.error;
  if (!stored.data || score > Number(stored.data.score)) {
    const up = await db.from('best_inputs').upsert({
      player_id: player.id,
      seed: run.seed,
      score,
      game_version: run.version,
      frames: run.frames,
      inputs,  // genormaliseerde kopie (zie 3b): nooit extra velden bewaren
      updated_at: new Date().toISOString()
    }, { onConflict: 'player_id,seed' });
    if (up.error) throw up.error;
  }

  // 6. Antwoord
  const personalBest = (await bestScore(player.id)) ?? score;
  const todayBest = (await bestScore(player.id, run.seed)) ?? score;
  return reply(200, {
    ok: true,
    score,
    personalBest,
    todayBest,
    newBest: before === null || score > before
  }, cors);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  try {
    // Een browser van een vreemde site krijgt niets; zonder Origin (curl) mag het wel.
    // CORS is geen beveiliging, de herberekening wel.
    if (origin && !originAllowed(origin)) return failure(403, 'origin', cors);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { ok: false, code: 'method', message: MESSAGES.error }, cors);
    return await handle(req, cors);
  } catch (err) {
    // geen geheimen in de logs: enkel de foutmelding
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    console.error(JSON.stringify({ error: message }));
    return failure(500, 'error', cors);
  }
});
