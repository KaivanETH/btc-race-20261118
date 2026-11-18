// bars-replay bot for make.fun (agent-fun/bars-replay/v1)
// stdin: newline-delimited JSON protocol, stdout: replies only.
// Node 22 type stripping: erasable syntax only, node builtins, stdlib only.

import readline from "node:readline";

// ---- strategy constants (exact names) ----
const FAST = 5;
const PEAK_SPAN = 120;
const DD_ENTRY_BPS = 40;
const TURN_BPS = 40;
const TARGET_BPS = 250;
const TRAIL_ARM_BPS = 50;
const TRAIL_BPS = 50;
const STOP_BPS = 80;
const MAX_HOLD = 480;
const COOLDOWN = 5;
const BASE_WEIGHT = 8500n;
const MIN_WEIGHT = 5000n;
const MAX_WEIGHT = 10000n;
const DD_GUARD_BPS = 200n;
const LOSS_FLOOR_BPS = 300n;
const MAX_SLIP = 100;
const MAX_ORDERS = 16;
const MIN_VOL_BPS = 1.5;
const MAX_VOL_BPS = 40;
const SPIKE_BPS = 200;

// ---- hello-state ----
let symbol: string | null = null;
let startEquity = 0n;
let minNotional = 0n;
let phaseSeed: unknown = null;

// ---- indicator state ----
let emaF: number | null = null;
let prevClose: number | null = null;
let vol: number | null = null;
let lastJump: number | null = null;
let closes: number[] = []; // keeps at most PEAK_SPAN+1 most recent closes
let peakEquity = 0n;

// ---- trade state ----
let inEntryZone = false;
let zoneLow = 0;
let entryPx = 0;
let peakPx = 0;
let heldBars = 0;
let cooldown = 0;
let entryId = 0;
let exitId = 0;

function reply(seq: unknown, orders: unknown[]): void {
  process.stdout.write(JSON.stringify({ type: "reply", seq, orders }) + "\n");
}

function handleHello(msg: any): void {
  const syms = msg.symbols ?? [];
  if (syms.length > 0 && symbol === null) {
    symbol = String(syms[0].symbol);
  }
  if (msg.capital && msg.capital.quote_units !== undefined) {
    startEquity = BigInt(String(msg.capital.quote_units));
    if (peakEquity === 0n) peakEquity = startEquity;
  }
  if (msg.fees && msg.fees.min_notional_quote_units !== undefined) {
    minNotional = BigInt(String(msg.fees.min_notional_quote_units));
  }
  phaseSeed = msg.phase_seed;
}

function handleBatch(msg: any): void {
  const seq = msg.seq;
  if (symbol === null) {
    reply(seq, []);
    return;
  }

  const bars = msg.bars ?? [];
  let bar: any = null;
  for (const b of bars) {
    if (String(b.symbol) === symbol) {
      bar = b;
      break;
    }
  }
  if (!bar) {
    // no bar for our symbol: do nothing else for this symbol
    reply(seq, []);
    return;
  }

  const account = msg.account ?? {};
  const c = Number(bar.c);
  const cash = BigInt(String(account.cash_quote_units ?? "0"));
  const equity = BigInt(String(account.equity_quote_units ?? "0"));

  // --- 1. update indicators with this bar's close ---
  // closes buffer: keep at most PEAK_SPAN+1
  closes.push(c);
  if (closes.length > PEAK_SPAN + 1) closes.shift();

  if (emaF === null) {
    if (closes.length >= FAST) {
      let sum = 0;
      for (let i = 0; i < FAST; i++) sum += closes[i];
      emaF = sum / FAST;
    }
  } else {
    emaF = emaF + (2 / (FAST + 1)) * (c - emaF);
  }

  if (prevClose !== null) {
    const jump = ((c - prevClose) / prevClose) * 10000;
    lastJump = jump;
    const absJump = Math.abs(jump);
    if (vol === null) {
      vol = absJump;
    } else {
      vol = vol + (2 / 20) * (absJump - vol);
    }
  }
  prevClose = c;

  // refresh peak equity
  if (equity > peakEquity) peakEquity = equity;

  // --- 2. decrement cooldown ---
  if (cooldown > 0) cooldown -= 1;

  // current position
  let posQty = 0n;
  const positions = account.positions ?? [];
  for (const p of positions) {
    if (String(p.symbol) === symbol && p.qty !== undefined && p.qty !== null) {
      const q = BigInt(String(p.qty));
      if (q > 0n) posQty = q;
      break;
    }
  }

  const orders: unknown[] = [];

  // --- 3. holding branch ---
  if (posQty > 0n) {
    if (entryPx === 0) {
      // recovery: position exists but entry state missing
      entryPx = c;
      peakPx = c;
      heldBars = 0;
    }
    heldBars += 1;
    if (c > peakPx) peakPx = c;

    const gain = ((c - entryPx) / entryPx) * 10000;
    const peakGain = ((peakPx - entryPx) / entryPx) * 10000;
    const fromPeak = ((peakPx - c) / peakPx) * 10000;

    const mustExit =
      gain <= -STOP_BPS ||
      gain >= TARGET_BPS ||
      (peakGain >= TRAIL_ARM_BPS && fromPeak >= TRAIL_BPS) ||
      heldBars >= MAX_HOLD;

    if (mustExit && orders.length < MAX_ORDERS) {
      orders.push({
        side: "sell",
        client_id: "s" + exitId,
        symbol,
        qty: posQty.toString(),
        max_slippage_bps: MAX_SLIP,
      });
      exitId += 1;
      // clear entry state; cooldown only gates new entries (applied on entry side,
      // set here anyway so this bar can never re-enter)
      entryPx = 0;
      peakPx = 0;
      heldBars = 0;
      cooldown = COOLDOWN;
      inEntryZone = false;
      zoneLow = 0;
    } else {
      // still holding: no orders
      reply(seq, orders);
      return;
    }
  }

  // --- 4. flat branch: skip-entry checks ---
  // (after a sell above, cooldown was just set to COOLDOWN, so no same-bar entry)
  if (entryPx !== 0) {
    // flat but entry state believed active (desync) -> reset conservatively
    entryPx = 0;
    peakPx = 0;
    heldBars = 0;
    cooldown = COOLDOWN;
    inEntryZone = false;
    zoneLow = 0;
  }

  const skip =
    cooldown > 0 ||
    emaF === null ||
    vol === null ||
    vol < MIN_VOL_BPS ||
    vol > MAX_VOL_BPS ||
    equity < (startEquity * (10000n - LOSS_FLOOR_BPS)) / 10000n ||
    (lastJump !== null && Math.abs(lastJump) > SPIKE_BPS);

  if (skip) {
    reply(seq, orders);
    return;
  }

  // --- 5. entry logic ---
  if (closes.length < PEAK_SPAN + 1) {
    reply(seq, orders);
    return;
  }

  // dh = max over last PEAK_SPAN closes excluding the current close
  let dh = closes[0];
  for (let i = 0; i < PEAK_SPAN; i++) {
    if (closes[i] > dh) dh = closes[i];
  }
  const dd = ((dh - c) / dh) * 10000;

  if (!inEntryZone && dd >= DD_ENTRY_BPS) {
    inEntryZone = true;
    zoneLow = c;
  }
  if (inEntryZone && dd < 5) {
    inEntryZone = false;
    zoneLow = 0;
  }
  if (inEntryZone && c < zoneLow) {
    zoneLow = c;
  }

  if (inEntryZone) {
    const rise = ((c - zoneLow) / zoneLow) * 10000;
    if (rise >= TURN_BPS && orders.length < MAX_ORDERS) {
      // weight selection
      let weight: bigint;
      if (vol !== null && vol > 0) {
        weight = BigInt(Math.floor((Number(BASE_WEIGHT) * 4) / vol));
      } else {
        weight = BASE_WEIGHT;
      }
      if (weight < MIN_WEIGHT) weight = MIN_WEIGHT;
      if (weight > MAX_WEIGHT) weight = MAX_WEIGHT;
      if (equity * 10000n < peakEquity * (10000n - DD_GUARD_BPS)) {
        weight = weight / 2n;
      }

      let notional = (equity * weight) / 10000n;
      if (notional > cash) notional = cash;

      if (notional >= minNotional && notional > 0n) {
        orders.push({
          side: "buy",
          client_id: "b" + entryId,
          symbol,
          notional_quote_units: notional.toString(),
          max_slippage_bps: MAX_SLIP,
        });
        entryId += 1;
        entryPx = c;
        peakPx = c;
        heldBars = 0;
        inEntryZone = false;
        zoneLow = 0;
      }
    }
  }

  reply(seq, orders);
}

// ---- main loop: stdin line by line ----
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const trimmed = line.trim();
  if (trimmed === "") continue;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    continue;
  }
  const type = msg.type;
  if (type === "hello") {
    handleHello(msg);
  } else if (type === "batch") {
    handleBatch(msg);
  } else if (type === "done") {
    rl.close();
    process.exit(0);
  }
}