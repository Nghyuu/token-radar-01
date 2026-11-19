// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol below the floor: the early rows the radar exists to find. A
// protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol); the snapshot's live-token protocols are kept apart and shown as the market's own values,
// never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and it is calibrated from the
// snapshot itself: the category multiple is the median market-cap-per-TVL of the live-token
// protocols in that same category, shrunk toward the global median so a category with two live
// tokens does not set its own price. No protocol name is ever special-cased: the same function
// scores every row.
//
//   multiple     = shrunk median (mcap_usd / tvl_usd) of live-token protocols in the category,
//                  clamped to [0.05, 1.00]; a category with no live token uses the global median
//   growth       = clamp(change_7d, -60, 150) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity     = 0.5 + 0.5 x age_days / (age_days + 365)   (age unknown: 180 days)
//   breadth      = min(1.12, 1 + 0.04 x ln(chains))
//   implied      = max(1, round(tvl_usd x multiple x growthMult x maturity x breadth))
//
// Maturity saturates: a protocol that has run two pre-token years is near its full multiple, and
// one more year adds little. Breadth rewards protocols live on several chains, capped so a
// twelve-chain listing cannot buy a rank on its own. Growth is the strongest single mover after
// TVL: a protocol growing 50% in a week scores half again as much as a flat one of the same size.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_half_life: number;
  unknown_age_days: number;
  breadth_per_log_chain: number;
  breadth_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.9,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.5,
  maturity_half_life: 365,
  unknown_age_days: 180,
  breadth_per_log_chain: 0.04,
  breadth_cap: 1.12,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  shrink_prior: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries: all of them. */
export const EARLY_ROWS = -1; // -1: no cap; every rankable protocol below the floor is ranked

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, calibrated from this snapshot's own live-token protocols: for each
 * category, the median market-cap-per-TVL of its live-token protocols, shrunk toward the global
 * median with a prior of `shrink_prior` protocols, then clamped. A category with no live token
 * at all takes the global median. Nothing here names a protocol.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r)) continue;
    all.push(r);
    const key = p.category ?? 'Other';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
  }
  const globalRaw = all.length > 0 ? median(all) : 0.2;
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, number>();
  for (const [key, list] of ratios) {
    const shrunk = (list.length * median(list) + model.shrink_prior * globalRaw) / (list.length + model.shrink_prior);
    byCategory.set(key, Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)));
  }
  return { byCategory, global };
}

/** The multipliers and the implied value one protocol gets under `model` at its category multiple. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (1 - model.maturity_floor) * (ageForModel / (ageForModel + model.maturity_half_life));
  const chains = Math.max(1, protocol.chains.length);
  const breadthMult = Math.min(model.breadth_cap, 1 + model.breadth_per_log_chain * Math.log(chains));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const multipleFor = (p: SnapshotProtocol): number => multiples.byCategory.get(p.category ?? 'Other') ?? multiples.global;
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const multiple = multipleFor(p);
    const { growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model, multiple);
    // Round the multipliers FIRST, then compute the implied value from the rounded ones: the
    // dashboard stores exactly these rounded numbers and recomputes the row from them, so the
    // page's number and board.json's number are the same integer, never a rounding apart.
    const m = round4(multiple);
    const g = round4(growthMult);
    const mat = round4(maturityMult);
    const br = round4(breadthMult);
    const implied = Math.max(1, Math.round(p.tvl_usd * m * g * mat * br));
    return { p, multiple: m, implied, growthPct, growthMult: g, maturityMult: mat, breadthMult: br, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The seventh step is the risk check: verify the contract and the claim link before any
 * money moves, because a farm that pays a scammer pays nothing.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const young = age !== null && age < 180;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: young
        ? `This protocol is under six months old, so check its points page weekly: a new program can open with little notice.`
        : `Open the protocol's own points or rewards page each month and note what changed since your last visit.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Check the contract address on ${chain}'s explorer against the one the protocol's own site publishes, and never sign a transaction you cannot read.`,
      cost: 'nothing but the check',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---- radarExtra board analytics ----
// Pure analyses over the scored board rows. They only read the rows the
// program already writes, so they cannot change board.json, data.js or
// the dossier. They give callers category, distribution, momentum and
// risk views of the same board, plus one new composite metric. Every
// function below is self-contained: it takes board rows in and returns
// plain data out, with no I/O and no dependency on the scoring path.

export interface RadarExtraModelBreakdown {
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number;
}

export interface RadarExtraBoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number;
  implied_value_usd: number;
  model: RadarExtraModelBreakdown;
  farm_steps: string[];
}

export interface RadarExtraCategoryTotal {
  category: string;
  rows: number;
  tvl_usd: number;
  implied_value_usd: number;
  median_implied_value_usd: number;
  share_of_board: number;
}

export interface RadarExtraFlaggedRow {
  slug: string;
  name: string;
  rank: number;
  flags: string[];
}

export interface RadarExtraChainTotal {
  chain: string;
  rows: number;
  implied_value_usd: number;
  median_implied_value_usd: number;
}

export function radarExtraMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function radarExtraMean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function radarExtraSum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function radarExtraQuantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, q));
  const sorted = [...values].sort((a, b) => a - b);
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function radarExtraClamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export function radarExtraRound(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

export function radarExtraCategoryTotals(rows: RadarExtraBoardRow[]): RadarExtraCategoryTotal[] {
  const byCategory = new Map<string, RadarExtraBoardRow[]>();
  for (const row of rows) {
    const bucket = byCategory.get(row.category);
    if (bucket === undefined) byCategory.set(row.category, [row]);
    else bucket.push(row);
  }
  const boardTotal = radarExtraSum(rows.map((r) => r.implied_value_usd));
  const totals: RadarExtraCategoryTotal[] = [];
  for (const [category, members] of byCategory) {
    const implied = radarExtraSum(members.map((m) => m.implied_value_usd));
    totals.push({
      category,
      rows: members.length,
      tvl_usd: radarExtraSum(members.map((m) => m.tvl_usd)),
      implied_value_usd: implied,
      median_implied_value_usd: radarExtraMedian(members.map((m) => m.implied_value_usd)),
      share_of_board: boardTotal === 0 ? 0 : implied / boardTotal,
    });
  }
  totals.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  return totals;
}

export function radarExtraCategoryConcentration(rows: RadarExtraBoardRow[]): {
  herfindahl: number;
  top_category_share: number;
  top_three_share: number;
  effective_categories: number;
  categories: number;
} {
  const totals = radarExtraCategoryTotals(rows);
  const boardTotal = radarExtraSum(rows.map((r) => r.implied_value_usd));
  if (totals.length === 0 || boardTotal === 0) {
    return {
      herfindahl: 0,
      top_category_share: 0,
      top_three_share: 0,
      effective_categories: 0,
      categories: 0,
    };
  }
  let herfindahl = 0;
  for (const t of totals) {
    const share = t.implied_value_usd / boardTotal;
    herfindahl += share * share;
  }
  const topThree = radarExtraSum(totals.slice(0, 3).map((t) => t.implied_value_usd));
  return {
    herfindahl: radarExtraRound(herfindahl, 4),
    top_category_share: radarExtraRound(totals[0].share_of_board, 4),
    top_three_share: radarExtraRound(topThree / boardTotal, 4),
    effective_categories: radarExtraRound(1 / herfindahl, 2),
    categories: totals.length,
  };
}

export function radarExtraValueDeciles(rows: RadarExtraBoardRow[]): {
  min: number;
  deciles: number[];
  median: number;
  max: number;
  top_decile_floor: number;
} {
  const values = rows.map((r) => r.implied_value_usd);
  if (values.length === 0) {
    return { min: 0, deciles: [], median: 0, max: 0, top_decile_floor: 0 };
  }
  const deciles: number[] = [];
  for (let k = 1; k <= 9; k++) {
    deciles.push(Math.round(radarExtraQuantile(values, k / 10)));
  }
  return {
    min: Math.min(...values),
    deciles,
    median: Math.round(radarExtraMedian(values)),
    max: Math.max(...values),
    top_decile_floor: Math.round(radarExtraQuantile(values, 0.9)),
  };
}

export function radarExtraGrowthBreakdown(rows: RadarExtraBoardRow[]): {
  up: number;
  flat: number;
  down: number;
  unknown: number;
  median_change_7d: number;
  mean_change_7d: number;
  top_growers: string[];
  top_fallers: string[];
} {
  let up = 0;
  let flat = 0;
  let down = 0;
  let unknown = 0;
  const changes: number[] = [];
  for (const row of rows) {
    if (row.change_7d === null || row.change_7d === undefined) {
      unknown += 1;
      continue;
    }
    changes.push(row.change_7d);
    if (row.change_7d > 0.5) up += 1;
    else if (row.change_7d < -0.5) down += 1;
    else flat += 1;
  }
  const byChange = [...rows]
    .filter((r) => r.change_7d !== null && r.change_7d !== undefined)
    .sort((a, b) => (b.change_7d as number) - (a.change_7d as number));
  const growers = byChange.slice(0, 5).map((r) => r.slug);
  const fallers = byChange.slice(-5).reverse().map((r) => r.slug);
  return {
    up,
    flat,
    down,
    unknown,
    median_change_7d: radarExtraRound(radarExtraMedian(changes), 4),
    mean_change_7d: radarExtraRound(radarExtraMean(changes), 4),
    top_growers: growers,
    top_fallers: fallers,
  };
}

export function radarExtraBreadthBreakdown(rows: RadarExtraBoardRow[]): {
  single_chain: number;
  two_to_three: number;
  four_to_six: number;
  seven_to_ten: number;
  eleven_plus: number;
  median_chains: number;
  max_chains: number;
  top_chains: RadarExtraChainTotal[];
} {
  let single = 0;
  let twoThree = 0;
  let fourSix = 0;
  let sevenTen = 0;
  let elevenPlus = 0;
  const counts: number[] = [];
  const chainRows = new Map<string, RadarExtraBoardRow[]>();
  for (const row of rows) {
    const n = row.chains.length;
    counts.push(n);
    if (n <= 1) single += 1;
    else if (n <= 3) twoThree += 1;
    else if (n <= 6) fourSix += 1;
    else if (n <= 10) sevenTen += 1;
    else elevenPlus += 1;
    for (const chain of row.chains) {
      const bucket = chainRows.get(chain);
      if (bucket === undefined) chainRows.set(chain, [row]);
      else bucket.push(row);
    }
  }
  const totals: RadarExtraChainTotal[] = [];
  for (const [chain, members] of chainRows) {
    totals.push({
      chain,
      rows: members.length,
      implied_value_usd: radarExtraSum(members.map((m) => m.implied_value_usd)),
      median_implied_value_usd: radarExtraMedian(members.map((m) => m.implied_value_usd)),
    });
  }
  totals.sort((a, b) => b.rows - a.rows);
  return {
    single_chain: single,
    two_to_three: twoThree,
    four_to_six: fourSix,
    seven_to_ten: sevenTen,
    eleven_plus: elevenPlus,
    median_chains: radarExtraMedian(counts),
    max_chains: counts.length === 0 ? 0 : Math.max(...counts),
    top_chains: totals.slice(0, 10),
  };
}

export function radarExtraAgeBreakdown(rows: RadarExtraBoardRow[]): {
  under_90d: number;
  days_90_180: number;
  days_181_365: number;
  days_366_730: number;
  over_730d: number;
  median_age_days: number;
  oldest_top_ten: string[];
  youngest_top_ten: string[];
} {
  let under90 = 0;
  let d90 = 0;
  let d181 = 0;
  let d366 = 0;
  let over730 = 0;
  const ages: number[] = [];
  for (const row of rows) {
    ages.push(row.age_days);
    if (row.age_days < 90) under90 += 1;
    else if (row.age_days <= 180) d90 += 1;
    else if (row.age_days <= 365) d181 += 1;
    else if (row.age_days <= 730) d366 += 1;
    else over730 += 1;
  }
  const topTen = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd).slice(0, 10);
  const oldest = [...topTen].sort((a, b) => b.age_days - a.age_days).map((r) => r.slug);
  const youngest = [...topTen].sort((a, b) => a.age_days - b.age_days).map((r) => r.slug);
  return {
    under_90d: under90,
    days_90_180: d90,
    days_181_365: d181,
    days_366_730: d366,
    over_730d: over730,
    median_age_days: radarExtraMedian(ages),
    oldest_top_ten: oldest,
    youngest_top_ten: youngest,
  };
}

export function radarExtraWatchlistComparison(
  rows: RadarExtraBoardRow[],
  watchlistSlugs: string[],
): {
  watchlist_rows: number;
  early_rows: number;
  watchlist_median_implied: number;
  early_median_implied: number;
  watchlist_share_of_top_50: number;
  watchlist_share_of_value: number;
} {
  const watch = new Set(watchlistSlugs);
  const listed = rows.filter((r) => watch.has(r.slug));
  const early = rows.filter((r) => !watch.has(r.slug));
  const top50 = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd).slice(0, 50);
  const listedTop50 = top50.filter((r) => watch.has(r.slug)).length;
  const boardTotal = radarExtraSum(rows.map((r) => r.implied_value_usd));
  const listedTotal = radarExtraSum(listed.map((r) => r.implied_value_usd));
  return {
    watchlist_rows: listed.length,
    early_rows: early.length,
    watchlist_median_implied: Math.round(radarExtraMedian(listed.map((r) => r.implied_value_usd))),
    early_median_implied: Math.round(radarExtraMedian(early.map((r) => r.implied_value_usd))),
    watchlist_share_of_top_50: top50.length === 0 ? 0 : listedTop50 / top50.length,
    watchlist_share_of_value: boardTotal === 0 ? 0 : listedTotal / boardTotal,
  };
}

export function radarExtraTopShare(rows: RadarExtraBoardRow[], n: number): {
  top_n: number;
  share_of_value: number;
  top_slugs: string[];
  cutoff_implied_value_usd: number;
} {
  const ordered = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const top = ordered.slice(0, Math.max(0, n));
  const boardTotal = radarExtraSum(rows.map((r) => r.implied_value_usd));
  const topTotal = radarExtraSum(top.map((r) => r.implied_value_usd));
  return {
    top_n: top.length,
    share_of_value: boardTotal === 0 ? 0 : radarExtraRound(topTotal / boardTotal, 4),
    top_slugs: top.map((r) => r.slug),
    cutoff_implied_value_usd: top.length === 0 ? 0 : top[top.length - 1].implied_value_usd,
  };
}

export function radarExtraConvictionScore(row: RadarExtraBoardRow): number {
  const growthPart = radarExtraClamp((row.model.growth_multiplier - 0.9) / 0.6, 0, 1) * 40;
  const maturityPart = radarExtraClamp((row.model.maturity_multiplier - 0.5) / 0.5, 0, 1) * 30;
  const breadthPart = radarExtraClamp((row.model.breadth_multiplier - 1) / 0.12, 0, 1) * 30;
  return radarExtraRound(growthPart + maturityPart + breadthPart, 1);
}

export function radarExtraRiskFlags(rows: RadarExtraBoardRow[]): RadarExtraFlaggedRow[] {
  if (rows.length === 0) return [];
  const tvls = rows.map((r) => r.tvl_usd).sort((a, b) => a - b);
  const topQuartileTvl = radarExtraQuantile(tvls, 0.75);
  const implied = rows.map((r) => r.implied_value_usd);
  const topDecileImplied = radarExtraQuantile(implied, 0.9);
  const flagged: RadarExtraFlaggedRow[] = [];
  for (const row of rows) {
    const flags: string[] = [];
    const change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    if (change < 0 && row.tvl_usd >= topQuartileTvl) flags.push("cooling-giant");
    if (row.chains.length <= 1 && row.implied_value_usd >= topDecileImplied) {
      flags.push("single-chain-concentration");
    }
    if (row.age_days < 90 && row.implied_value_usd >= topDecileImplied) {
      flags.push("young-heavyweight");
    }
    if (row.model.growth_pct <= -60 || row.model.growth_pct >= 150) {
      flags.push("extreme-weekly-move");
    }
    if (row.model.category_multiple <= 0.05) flags.push("floor-multiple");
    if (flags.length > 0) {
      flagged.push({ slug: row.slug, name: row.name, rank: row.rank, flags });
    }
  }
  flagged.sort((a, b) => a.rank - b.rank);
  return flagged;
}

export function radarExtraChainCoverage(rows: RadarExtraBoardRow[]): RadarExtraChainTotal[] {
  const chainRows = new Map<string, RadarExtraBoardRow[]>();
  for (const row of rows) {
    for (const chain of row.chains) {
      const bucket = chainRows.get(chain);
      if (bucket === undefined) chainRows.set(chain, [row]);
      else bucket.push(row);
    }
  }
  const totals: RadarExtraChainTotal[] = [];
  for (const [chain, members] of chainRows) {
    totals.push({
      chain,
      rows: members.length,
      implied_value_usd: radarExtraSum(members.map((m) => m.implied_value_usd)),
      median_implied_value_usd: Math.round(
        radarExtraMedian(members.map((m) => m.implied_value_usd)),
      ),
    });
  }
  totals.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  return totals;
}

export interface RadarExtraBoardReport {
  rows: number;
  total_implied_value_usd: number;
  total_tvl_usd: number;
  categories: RadarExtraCategoryTotal[];
  concentration: ReturnType<typeof radarExtraCategoryConcentration>;
  deciles: ReturnType<typeof radarExtraValueDeciles>;
  growth: ReturnType<typeof radarExtraGrowthBreakdown>;
  breadth: ReturnType<typeof radarExtraBreadthBreakdown>;
  age: ReturnType<typeof radarExtraAgeBreakdown>;
  top_10_share: number;
  top_50_share: number;
  watchlist: ReturnType<typeof radarExtraWatchlistComparison>;
  flagged: RadarExtraFlaggedRow[];
  chains: RadarExtraChainTotal[];
}

export function radarExtraBoardAnalytics(
  rows: RadarExtraBoardRow[],
  watchlistSlugs: string[],
): RadarExtraBoardReport {
  const ordered = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const top10 = radarExtraTopShare(ordered, 10);
  const top50 = radarExtraTopShare(ordered, 50);
  const watchlist = radarExtraWatchlistComparison(rows, watchlistSlugs);
  return {
    rows: rows.length,
    total_implied_value_usd: radarExtraSum(rows.map((r) => r.implied_value_usd)),
    total_tvl_usd: radarExtraSum(rows.map((r) => r.tvl_usd)),
    categories: radarExtraCategoryTotals(rows),
    concentration: radarExtraCategoryConcentration(rows),
    deciles: radarExtraValueDeciles(rows),
    growth: radarExtraGrowthBreakdown(rows),
    breadth: radarExtraBreadthBreakdown(rows),
    age: radarExtraAgeBreakdown(rows),
    top_10_share: top10.share_of_value,
    top_50_share: top50.share_of_value,
    watchlist,
    flagged: radarExtraRiskFlags(rows),
    chains: radarExtraChainCoverage(rows),
  };
}

export function radarExtraAnalyticsText(report: RadarExtraBoardReport): string {
  const lines: string[] = [];
  lines.push("board rows: " + report.rows);
  lines.push("total implied value: $" + report.total_implied_value_usd.toLocaleString("en-US"));
  lines.push("total tvl: $" + report.total_tvl_usd.toLocaleString("en-US"));
  lines.push("categories: " + report.categories.length);
  if (report.categories.length > 0) {
    const top = report.categories[0];
    lines.push(
      "top category: " + top.category + " (" + top.rows + " rows, " +
        Math.round(top.share_of_board * 1000) / 10 + "% of value)",
    );
  }
  lines.push("category herfindahl: " + report.concentration.herfindahl);
  lines.push("median implied value: $" + report.deciles.median.toLocaleString("en-US"));
  lines.push(
    "growth up/flat/down: " + report.growth.up + "/" + report.growth.flat + "/" + report.growth.down,
  );
  lines.push("median chains per row: " + report.breadth.median_chains);
  lines.push("median age days: " + report.age.median_age_days);
  lines.push("top 10 share: " + Math.round(report.top_10_share * 1000) / 10 + "%");
  lines.push("top 50 share: " + Math.round(report.top_50_share * 1000) / 10 + "%");
  lines.push("watchlist rows: " + report.watchlist.watchlist_rows);
  lines.push(
    "watchlist share of top 50: " +
      Math.round(report.watchlist.watchlist_share_of_top_50 * 1000) / 10 +
      "%",
  );
  lines.push("flagged rows: " + report.flagged.length);
  lines.push("chains covered: " + report.chains.length);
  return lines.join("\n");
}
