// game.js — rules engine, fan calculator, AI, state machine, UI
// Rules layer is pure (no DOM). UI code is guarded at the bottom (file:// + Node safe).
'use strict';

// ---- 0. Seeded RNG (all in-game randomness goes through g.rng) ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---- 1. Tile helpers ----
function isHonor(t) { return t >= 11; }
function isYao(t) { return t === 1 || t === 9 || t >= 11; }
function countsOf(arr) { const c = new Array(18).fill(0); for (const t of arr) c[t]++; return c; }
function sortHand(h) { h.sort((a, b) => a - b); }

// ---- 2. Hu detection ----

// Enumerate decompositions of concealed counts into `need` sets + 1 pair.
function decompose(counts, need) {
  const res = []; const c = counts.slice(); const sets = []; let pairK = -1;
  function rec(i) {
    while (i <= 17 && !c[i]) i++;
    if (i > 17) { if (sets.length === need && pairK >= 0) res.push({ sets: sets.slice(), pair: pairK }); return; }
    if (pairK < 0 && c[i] >= 2) { c[i] -= 2; pairK = i; rec(i); pairK = -1; c[i] += 2; }
    if (sets.length < need) {
      if (c[i] >= 3) { c[i] -= 3; sets.push({ k: 'p', n: i }); rec(i); sets.pop(); c[i] += 3; }
      if (i <= 7 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ k: 'c', s: i }); rec(i); sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
  }
  rec(1); return res;
}

function isStdHu(counts, need) { return decompose(counts, need).length > 0; }

function isSevenPairs(counts) {
  let n = 0;
  for (let k = 1; k <= 17; k++) { if (counts[k] % 2) return false; n += counts[k]; }
  return n === 14;
}
function isLianQidui(counts) {
  for (let k = 11; k <= 17; k++) if (counts[k]) return false;
  for (let s = 1; s <= 3; s++) {
    let ok = true;
    for (let k = 1; k <= 9; k++) { const want = (k >= s && k <= s + 6) ? 2 : 0; if (counts[k] !== want) { ok = false; break; } }
    if (ok) return true;
  }
  return false;
}
function isJiulian(counts) {
  for (let k = 11; k <= 17; k++) if (counts[k]) return false;
  if (counts[1] < 3 || counts[9] < 3) return false;
  for (let k = 2; k <= 8; k++) if (counts[k] < 1) return false;
  let n = 0; for (let k = 1; k <= 9; k++) n += counts[k];
  return n === 14;
}
function isQixing(counts, suit, winTile) {
  if (suit !== 'w') return false;                      // requires the wan-suit round per rulebook
  if (!isHonor(winTile)) return false;                 // must win on an honor
  if (counts[1] !== 3 || counts[9] !== 3) return false;
  for (let k = 2; k <= 8; k++) if (counts[k]) return false;
  let pairs = 0;
  for (let k = 11; k <= 17; k++) {
    if (counts[k] === 2) pairs++;
    else if (counts[k] !== 1) return false;
  }
  return pairs === 1;
}
function isQueshen(counts) {
  for (let k = 1; k <= 9; k++) if (counts[k]) return false;
  for (let k = 11; k <= 17; k++) if (counts[k] !== 2) return false;
  return true;
}

// counts = concealed hand + winning tile (14 - 3*melds total)
function canWinCounts(counts, meldCount, suit, winTile) {
  if (isStdHu(counts, 4 - meldCount)) return true;
  if (meldCount > 0) return false;
  return isSevenPairs(counts) || isJiulian(counts) || isQixing(counts, suit, winTile) || isQueshen(counts);
}
function canWinTile(g, seat, tile) {
  const c = countsOf(g.hands[seat]); c[tile]++;
  if (c[tile] > 4) return false;
  return canWinCounts(c, g.melds[seat].length, g.suit, tile);
}
function canWinSelf(g, seat, drawn) { // hand already contains the drawn tile
  const c = countsOf(g.hands[seat]);
  return canWinCounts(c, g.melds[seat].length, g.suit, drawn);
}
function waitsOf(g, seat) { // winning tiles for the current 13-3m concealed hand
  const base = countsOf(g.hands[seat]);
  const out = [];
  for (const k of KINDS) {
    if (base[k] >= 4) continue;
    base[k]++;
    if (canWinCounts(base, g.melds[seat].length, g.suit, k)) out.push(k);
    base[k]--;
  }
  return out;
}

// ---- 3. Fan calculator ----

// Higher patterns suppress the listed lower ones (rulebook "不計" lists;
// same-family tier collapses added by intent: si-* suppresses san-*).
const SUPPRESS = {
  qinglong: ['lianliu', 'laoshaofu'],
  sibugao: ['lianliu', 'laoshaofu', 'pinghu', 'sanbugao'],
  sijiegao: ['santongshun', 'pengpenghu', 'sanjiegao'],
  santongshun: ['sanjiegao', 'yibangao'],
  sitongshun: ['sanjiegao', 'yibangao', 'siguiyi', 'santongshun'],
  shuanglonghui: ['pinghu', 'qingyise', 'laoshaofu', 'yibangao'],
  hunyaojiu: ['pengpenghu', 'yaojiuke', 'hunyise'],
  ziyise: ['pengpenghu', 'hundaiyao', 'yaojiuke'],
  sianke: ['menqing', 'pengpenghu', 'buqiuren', 'sananke'],
  dasanyuan: ['shuangjianke', 'jianke'],
  xiaosanyuan: ['shuangjianke', 'jianke'],
  dasixi: ['sanfengke', 'yaojiuke', 'pengpenghu'],
  xiaosixi: ['sanfengke', 'yaojiuke'],
  quanqiuren: ['dandiao'],
  sigang: ['dandiao', 'sangang'],
  qidui: ['menqing', 'dandiao', 'buqiuren'],
  lianqidui: ['qingyise', 'dandiao', 'menqing', 'buqiuren', 'pinghu', 'qidui'],
  jiulian: ['qingyise', 'yaojiuke', 'menqing', 'buqiuren'],
  qixing: ['yaojiuke'],
  queshen: ['ziyise', 'qidui'],
  qianggang: ['juezhang'],
  gangkai: ['zimo'],
  gangshanggang: ['zimo', 'gangkai'],
  miaoshou: ['zimo'],
};

function calcFan(g, seat, winTile, ctx) {
  const melds = g.melds[seat];
  // tsumo: the winning tile is already in hand; ron/rob: add it
  const cc = countsOf(g.hands[seat]);
  if (!ctx.tsumo) cc[winTile]++;
  const need = 4 - melds.length;
  const concealedHand = melds.every(m => m.sub === 'an');

  const all = cc.slice();
  for (const m of melds) for (const t of m.tiles) all[t]++;
  let hasHonor = false, hasNum = false;
  for (let k = 1; k <= 9; k++) if (all[k]) hasNum = true;
  for (let k = 11; k <= 17; k++) if (all[k]) hasHonor = true;

  const variants = [];

  function addCtx(ids) {
    if (ctx.qianggang) bump(ids, 'qianggang');
    if (ctx.gangkai) bump(ids, ctx.chain ? 'gangshanggang' : 'gangkai');
    if (ctx.haidi) bump(ids, 'haidi');
    if (ctx.miaoshou) bump(ids, 'miaoshou');
    if (ctx.tsumo) bump(ids, 'zimo');
    if (ctx.tianhu) bump(ids, 'tianhu');
    if (ctx.dihu) bump(ids, 'dihu');
    if (ctx.renhu) bump(ids, 'renhu');
    if (ctx.juezhang) bump(ids, 'juezhang');
    const tk = g.ting[seat];
    if (tk) bump(ids, tk.kind === 'tian' ? 'tianting' : tk.kind === 'di' ? 'diting' : 'ting');
    if (concealedHand) bump(ids, ctx.tsumo ? 'buqiuren' : 'menqing');
  }
  function addWholeHand(ids) {
    bump(ids, !hasNum ? 'ziyise' : !hasHonor ? 'qingyise' : 'hunyise');
    let anyYao = false;
    for (const k of KINDS) if (isYao(k) && all[k]) anyYao = true;
    if (!anyYao) bump(ids, 'duanyao');
    if (!hasHonor) {
      let lo = true, hi = true;
      for (let k = 1; k <= 9; k++) { if (all[k] && k > 4) lo = false; if (all[k] && k < 6) hi = false; }
      if (lo) bump(ids, 'xiaoyuwu');
      if (hi) bump(ids, 'dayuwu');
    }
    for (const k of KINDS) {
      if (all[k] === 4 && !melds.some(m => m.t === 'gang' && m.tile === k)) bump(ids, 'siguiyi');
    }
    // round dora — scored off `all` (hand + melds), so it is decomposition-independent and
    // also lands on the special hands (七對 etc.), which have no sets to hang a bonus on
    if (g.dora && all[g.dora]) bump(ids, 'dora', all[g.dora]);
  }
  function bump(ids, id, n) { ids.set(id, (ids.get(id) || 0) + (n || 1)); }

  // --- standard decompositions ---
  const decomps = decompose(cc, need);
  const waitKinds = new Set();
  const stdVariants = [];
  for (const d of decomps) {
    const placements = [];
    d.sets.forEach((s, i) => {
      if (s.k === 'p' && s.n === winTile) placements.push({ in: 'pung', i });
      if (s.k === 'c' && winTile >= s.s && winTile <= s.s + 2) placements.push({ in: 'chow', i });
    });
    if (d.pair === winTile) placements.push({ in: 'pair', i: -1 });
    for (const pl of placements) {
      let wt = 'none';
      if (pl.in === 'pair') wt = 'dandiao';
      else if (pl.in === 'chow') {
        const s = d.sets[pl.i].s;
        if (winTile === s + 1) wt = 'kanzhang';
        else if ((s === 1 && winTile === 3) || (s === 7 && winTile === 7)) wt = 'bianzhang';
      }
      waitKinds.add(wt);
      stdVariants.push({ d, pl, wt });
    }
  }
  // wait fan counts only if every interpretation yields a wait fan (rulebook examples)
  let globalWait = null;
  if (waitKinds.size && !waitKinds.has('none')) {
    globalWait = waitKinds.has('kanzhang') ? 'kanzhang' : waitKinds.has('bianzhang') ? 'bianzhang' : 'dandiao';
  }

  for (const v of stdVariants) {
    const ids = new Map();
    // assemble sets
    const sets = [];
    for (const m of melds) {
      if (m.t === 'chi') sets.push({ k: 'c', s: m.start, open: true });
      else if (m.t === 'pon') sets.push({ k: 'p', n: m.tile, open: true });
      else sets.push({ k: 'p', n: m.tile, kong: true, sub: m.sub, anke: m.sub === 'an' });
    }
    v.d.sets.forEach((s, i) => {
      if (s.k === 'c') sets.push({ k: 'c', s: s.s });
      else sets.push({ k: 'p', n: s.n, anke: !(v.pl.in === 'pung' && v.pl.i === i && !ctx.tsumo) });
    });
    const pair = v.d.pair;
    const chows = sets.filter(s => s.k === 'c');
    const pungs = sets.filter(s => s.k === 'p');

    if (pungs.length === 4) bump(ids, 'pengpenghu');
    if (chows.length === 4 && pair < 10) bump(ids, 'pinghu');
    for (const p of pungs) if (p.n === 1 || p.n === 9 || (p.n >= 11 && p.n <= 14)) bump(ids, 'yaojiuke');

    // arrow / wind groups
    const arrows = pungs.filter(p => p.n >= 15).length;
    const winds = pungs.filter(p => p.n >= 11 && p.n <= 14).length;
    if (arrows === 3) bump(ids, 'dasanyuan');
    else if (arrows === 2 && pair >= 15) bump(ids, 'xiaosanyuan');
    else if (arrows === 2) bump(ids, 'shuangjianke');
    else if (arrows === 1) bump(ids, 'jianke');
    if (winds === 4) bump(ids, 'dasixi');
    else if (winds === 3 && pair >= 11 && pair <= 14) bump(ids, 'xiaosixi');
    else if (winds === 3) bump(ids, 'sanfengke');

    // chow shapes
    const cs = {}; for (const c of chows) cs[c.s] = (cs[c.s] || 0) + 1;
    const starts = Object.keys(cs).map(Number).sort((a, b) => a - b);
    if (cs[1] && cs[7]) bump(ids, 'laoshaofu', Math.min(cs[1], cs[7]));
    for (let s = 1; s <= 4; s++) if (cs[s] && cs[s + 3]) bump(ids, 'lianliu');
    for (const s of starts) if (cs[s] >= 2) bump(ids, 'yibangao', Math.floor(cs[s] / 2));
    if (cs[1] && cs[4] && cs[7]) bump(ids, 'qinglong');
    if (chows.length === 4 && cs[1] >= 2 && cs[7] >= 2 && pair === 5) bump(ids, 'shuanglonghui');
    for (const s of starts) { if (cs[s] === 3) bump(ids, 'santongshun'); if (cs[s] === 4) bump(ids, 'sitongshun'); }
    // stepped chows (diff 1 or 2)
    for (const step of [1, 2]) {
      const flat = []; for (const c of chows) flat.push(c.s); flat.sort((a, b) => a - b);
      let run4 = false, run3 = false;
      for (const s0 of flat) {
        if (flat.includes(s0 + step) && flat.includes(s0 + 2 * step)) {
          if (flat.includes(s0 + 3 * step) && chows.length === 4) run4 = true; else run3 = true;
        }
      }
      if (run4) bump(ids, 'sibugao'); else if (run3) bump(ids, 'sanbugao');
    }
    // stepped pungs (diff 1)
    const ps = pungs.filter(p => p.n < 10).map(p => p.n).sort((a, b) => a - b);
    for (const n0 of ps) {
      if (ps.includes(n0 + 1) && ps.includes(n0 + 2)) {
        if (ps.includes(n0 + 3)) bump(ids, 'sijiegao'); else bump(ids, 'sanjiegao');
      }
    }

    // concealed pungs tier
    const anke = pungs.filter(p => p.anke).length;
    if (anke === 2) bump(ids, 'shuanganke');
    else if (anke === 3) bump(ids, 'sananke');
    else if (anke === 4) bump(ids, 'sianke');

    // kong tiers
    const mg = melds.filter(m => m.t === 'gang' && m.sub !== 'an').length;
    const ag = melds.filter(m => m.t === 'gang' && m.sub === 'an').length;
    const kg = mg + ag;
    if (kg === 4) { bump(ids, 'sigang'); if (ag) bump(ids, 'angang', ag); }
    else if (kg === 3) { bump(ids, 'sangang'); if (ag) bump(ids, 'angang', ag); }
    else {
      if (mg === 2) bump(ids, 'shuangminggang'); else if (mg === 1) bump(ids, 'minggang');
      if (ag === 2) bump(ids, 'shuangangang'); else if (ag === 1) bump(ids, 'angang');
    }

    // all-sets-contain-terminal/honor family
    const setYao = s => s.k === 'c' ? (s.s === 1 || s.s === 7) : isYao(s.n);
    if (sets.every(setYao) && isYao(pair)) {
      if (pungs.length === 4 && pungs.every(p => isYao(p.n)) && isYao(pair) && hasHonor && hasNum
          && pungs.every(p => p.n === 1 || p.n === 9 || p.n >= 11) && (pair === 1 || pair === 9 || pair >= 11)) {
        bump(ids, 'hunyaojiu');
      } else if (hasHonor) bump(ids, 'hundaiyao');
      else bump(ids, 'qingdaiyao');
    }

    // all melds claimed + single wait ron
    if (melds.length === 4 && melds.every(m => m.sub !== 'an') && !ctx.tsumo && v.pl.in === 'pair') {
      bump(ids, 'quanqiuren');
    }

    if (globalWait) bump(ids, globalWait);
    addWholeHand(ids);
    addCtx(ids);
    variants.push(ids);
  }

  // --- special hands (concealed only) ---
  if (melds.length === 0) {
    function special(mainId, extra) {
      const ids = new Map();
      bump(ids, mainId);
      addWholeHand(ids);
      addCtx(ids);
      if (extra) extra(ids);
      variants.push(ids);
    }
    if (isQueshen(cc)) special('queshen');
    else if (isQixing(cc, g.suit, winTile)) special('qixing', ids => {
      bump(ids, 'shuanganke'); // the 1-wan and 9-wan concealed triplets
    });
    else if (isLianQidui(cc)) special('lianqidui');
    else if (isJiulian(cc)) special('jiulian');
    else if (isSevenPairs(cc)) special('qidui');
  }

  // --- score variants, take max ---
  let best = null, bestTotal = -1;
  for (const ids of variants) {
    for (const [id] of Array.from(ids)) {
      const sup = SUPPRESS[id];
      if (sup && ids.has(id)) for (const s of sup) ids.delete(s);
    }
    let total = 0;
    for (const [id, n] of ids) total += FAN[id].fan * n;
    if (total > bestTotal) { bestTotal = total; best = ids; }
  }
  if (!best) return { items: [], total: 0 };
  const items = Array.from(best).map(([id, n]) => ({ id, name: FAN[id].name, fan: FAN[id].fan, n }))
    .sort((a, b) => b.fan - a.fan);
  return { items, total: bestTotal };
}

// ---- 4. Shanten + AI ----

function stdShanten(counts, meldCount) {
  const c = counts.slice();
  let best = 8;
  function evalPartials(sets) {
    const r = c.slice();
    let parts = 0, pair = 0;
    for (let i = 1; i <= 17; i++) {
      if (r[i] >= 2) { if (!pair) { pair = 1; r[i] -= 2; } }
    }
    for (let i = 1; i <= 17; i++) { while (r[i] >= 2) { parts++; r[i] -= 2; } }
    for (let i = 1; i <= 7; i++) {
      while (r[i] && (r[i + 1] || r[i + 2])) { parts++; r[i]--; if (r[i + 1]) r[i + 1]--; else r[i + 2]--; }
    }
    const total = sets + meldCount;
    parts = Math.min(parts, Math.max(0, 4 - total));
    const st = 8 - 2 * total - parts - pair;
    if (st < best) best = st;
  }
  function walk(i, sets) {
    if (sets + meldCount >= 4 || i > 17) { evalPartials(sets); return; }
    while (i <= 17 && !c[i]) i++;
    if (i > 17) { evalPartials(sets); return; }
    if (c[i] >= 3) { c[i] -= 3; walk(i, sets + 1); c[i] += 3; }
    if (i <= 7 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; walk(i, sets + 1); c[i]++; c[i + 1]++; c[i + 2]++;
    }
    walk(i + 1, sets);
  }
  walk(1, 0);
  return best;
}
function qiduiShanten(counts, meldCount) {
  if (meldCount) return 9;
  let pairs = 0, kinds = 0;
  for (let i = 1; i <= 17; i++) { if (counts[i]) kinds++; if (counts[i] >= 2) pairs++; }
  return 6 - pairs + Math.max(0, 7 - kinds);
}
function shantenOf(counts, meldCount) {
  return Math.min(stdShanten(counts, meldCount), qiduiShanten(counts, meldCount));
}

function ukeire(counts, meldCount) {
  const base = shantenOf(counts, meldCount);
  let n = 0;
  for (const k of KINDS) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (shantenOf(counts, meldCount) < base) n += 4 - counts[k] + 1;
    counts[k]--;
  }
  return n;
}

// ---- AI defense ----
// Reads public information only: rivers, exposed melds, and the ting declaration.
// Never the opponent's hand or the wall. Deliberately approximate — a perfect
// blocker would make the table unwinnable and would read to the player as cheating.

// Tiles the declared-ting opponent provably cannot be waiting on: anything either
// seat discarded after the declaration went up (they drew it and did not win).
function safeTiles(g, seat) {
  const from = g.ting[1 - seat] && g.ting[1 - seat].from;
  const s = new Set();
  if (!from) return s;
  for (const q of [0, 1]) for (let i = from[q]; i < g.rivers[q].length; i++) s.add(g.rivers[q][i]);
  return s;
}

// 0 = provably safe, higher = more likely to feed the wait
function dangerOf(g, tile, safe) {
  if (safe.has(tile)) return 0;
  const left = 4 - visibleCopies(g, tile);
  if (left <= 0) return 0;                            // all four accounted for: cannot be waited on
  const width = isHonor(tile) ? 2                     // honors: pair/triplet waits only
    : (tile === 1 || tile === 9) ? 3                  // terminals: one sequence runs through them
    : (tile === 2 || tile === 8) ? 4
    : 5;                                              // 3-7: maximum sequence coverage
  return width * left;
}

// push/fold: 0 = attack (efficiency only), 1 = balance, 2 = fold
function defenseMode(g, seat) {
  if (!g.sk.defend) return 0;
  if (!g.ting[1 - seat]) return 0;                    // nothing declared: nothing to defend against
  if (g.ting[seat]) return 0;                         // both declared: it is a race, push
  return aiBestDiscardShanten(g, seat) <= 1 ? 1 : 2;  // close enough to win = keep pushing
}

// mode 0 keeps the pure-efficiency ordering; 1 breaks efficiency ties by safety;
// 2 leads on safety and accepts a slower hand to stay out of the way
function betterDiscard(g, a, b, mode) {
  const keys = mode === 2 ? ['dg', 'sh', 'uk'] : mode === 1 ? ['sh', 'dg', 'uk'] : ['sh', 'uk'];
  for (const key of keys) {
    const d = key === 'uk' ? b.uk - a.uk : a[key] - b[key];  // uk: higher wins; sh/dg: lower wins
    if (d !== 0) return d < 0;
  }
  return g.rng() < 0.5;
}

// choose best discard from a 14-3m hand; returns {tile, sh, uk, dg}
function aiBestDiscard(g, seat) {
  const mode = defenseMode(g, seat);
  const safe = mode ? safeTiles(g, seat) : null;
  const m = g.melds[seat].length;
  const c = countsOf(g.hands[seat]);
  let best = null;
  for (const k of KINDS) {
    if (!c[k]) continue;
    c[k]--;
    const cand = { tile: k, sh: shantenOf(c, m), uk: ukeire(c, m), dg: mode ? dangerOf(g, k, safe) : 0 };
    c[k]++;
    if (!best || betterDiscard(g, cand, best, mode)) best = cand;
  }
  return best;
}

function aiSelfDecision(g, seat, opts) {
  if (opts.hu) return { t: 'hu' };
  // kong: only when it cannot hurt (not tenpai, or waits unchanged)
  for (const kan of opts.kans) {
    if (kanKeepsGame(g, seat, kan)) return { t: 'gang', kan };
  }
  if (opts.mustDiscardDrawn) return { t: 'discard', tile: g.lastDrawn };
  const best = aiBestDiscard(g, seat);
  let ting = false;
  if (!g.ting[seat]) {
    const c = countsOf(g.hands[seat]); c[best.tile]--;
    let tenpai = false;
    for (const k of KINDS) {
      if (c[k] >= 4) continue;
      c[k]++;
      if (canWinCounts(c, g.melds[seat].length, g.suit, k)) { tenpai = true; c[k]--; break; }
      c[k]--;
    }
    ting = tenpai;
  }
  return { t: 'discard', tile: best.tile, ting };
}
function kanKeepsGame(g, seat, kan) {
  // hand currently holds the drawn tile (14 - 3m tiles)
  const m = g.melds[seat].length;
  const saved = g.hands[seat];
  const removeN = kan.kind === 'an' ? 4 : 1;
  const afterHand = [];
  let removed = 0;
  for (const t of saved) { if (t === kan.tile && removed < removeN) { removed++; continue; } afterHand.push(t); }
  const cAfter = countsOf(afterHand);
  if (!g.ting[seat]) {
    const shBefore = aiBestDiscardShanten(g, seat);
    const shAfter = shantenOf(cAfter, m + 1);
    return shAfter <= shBefore;
  }
  // declared ting: waits must be identical (locked hand = hand minus drawn tile)
  const lockedHand = saved.slice();
  const di = lockedHand.indexOf(g.lastDrawn); lockedHand.splice(di, 1);
  g.hands[seat] = lockedHand;
  const before = waitsOf(g, seat).join(',');
  g.hands[seat] = afterHand;
  g.melds[seat].push({ t: 'gang', sub: kan.kind, tile: kan.tile, start: 0, tiles: [kan.tile, kan.tile, kan.tile, kan.tile] });
  const after = waitsOf(g, seat).join(',');
  g.melds[seat].pop();
  g.hands[seat] = saved;
  return before === after && after.length > 0;
}
function aiBestDiscardShanten(g, seat) {
  const c = countsOf(g.hands[seat]);
  const m = g.melds[seat].length;
  let best = 9;
  for (const k of KINDS) {
    if (!c[k]) continue;
    c[k]--; best = Math.min(best, shantenOf(c, m)); c[k]++;
  }
  return best;
}

function aiClaimDecision(g, seat, tile, opts) {
  if (opts.hu) return { t: 'hu' };
  if (g.ting[seat]) return { t: 'skip' };
  const c = countsOf(g.hands[seat]);
  const m = g.melds[seat].length;
  const cur = shantenOf(c, m);
  if (opts.gang && cur > 0) return { t: 'gang' };
  if (opts.pon) {
    c[tile] -= 2;
    let bestAfter = 9;
    for (const k of KINDS) { if (!c[k]) continue; c[k]--; bestAfter = Math.min(bestAfter, shantenOf(c, m + 1)); c[k]++; }
    c[tile] += 2;
    if (bestAfter < cur) return { t: 'pon' };
  }
  if (opts.chis && opts.chis.length) {
    for (const s of opts.chis) {
      for (let x = s; x < s + 3; x++) if (x !== tile) c[x]--;
      let bestAfter = 9;
      for (const k of KINDS) { if (!c[k]) continue; c[k]--; bestAfter = Math.min(bestAfter, shantenOf(c, m + 1)); c[k]++; }
      for (let x = s; x < s + 3; x++) if (x !== tile) c[x]++;
      if (bestAfter < cur) return { t: 'chi', s };
    }
  }
  return { t: 'skip' };
}

function aiDecision(g) {
  const p = g.pending;
  switch (p.type) {
    case 'draw': return { t: 'draw' };
    case 'self': return aiSelfDecision(g, p.seat, p.opts);
    case 'claim': return aiClaimDecision(g, p.seat, p.tile, p.opts);
    case 'rob': return { t: 'hu' };
    case 'haidi':
    case 'duihua': {
      if (p.done) return { t: 'resolve' };
      let i;
      const taken = p.type === 'haidi' ? p.picks : p.picks.map(x => x.i);
      do { i = Math.floor(g.rng() * 10); } while (taken.includes(i));
      return { t: 'pick', i };
    }
  }
  return null;
}

// ---- 5. Game engine ----

// sk = opponent-character skill flags; defaults preserve the baseline profile
// (pass-doubling on, no reveal, single duihua, no hand limit) so sims stay comparable.
// defend is on by default — reacting to a declared ting is baseline behaviour, not a perk;
// pass defend:false to sim the old pure-efficiency AI as a control group
function newGame(seed, dealer, base, sk) {
  const rng = mulberry32(seed);
  const suit = SUITS[Math.floor(rng() * 3)];
  // Round dora: a number tile (1-9) of the round suit, announced at deal time. Drawn from a
  // SIDE stream, never from rng() — pulling one more value out of rng() would shift the whole
  // wall and invalidate every existing sim baseline plus the controller's presim alignment.
  // A side hash is also needed because nextGameSeed() does not guarantee a uniform low bits.
  const dora = 1 + Math.floor(mulberry32(seed ^ 0x5bf03635)() * 9);
  const tiles = [];
  for (const k of KINDS) for (let i = 0; i < 4; i++) tiles.push(k);
  for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  const g = {
    seed, rng, suit, dealer, dora,
    base: base || CONFIG.BASE,
    sk: Object.assign({ pass: true, reveal: false, duihua2: false, handLimit: 0, revealN: 0, defend: true }, sk || {}),
    wall: tiles,
    hands: [[], []], melds: [[], []], rivers: [[], []],
    passMult: [1, 1],
    passCount: [0, 0],      // effective doublings so far (multiplier = 2^passCount, capped)
    ting: [null, null],
    anyCall: false,
    discNum: [0, 0], drawNum: [0, 0],
    turn: dealer,
    lastDrawn: null, replacement: false, kongDepth: 0,
    lastDiscard: null,
    pending: null,
    over: false, result: null,
    actions: 0,
  };
  for (let i = 0; i < 13; i++) { g.hands[0].push(g.wall.pop()); g.hands[1].push(g.wall.pop()); }
  sortHand(g.hands[0]); sortHand(g.hands[1]);
  // dealer's 14th tile (opening tile) is treated as drawn; kept at the tail (UI shows it apart)
  const t14 = g.wall.pop();
  g.hands[dealer].push(t14);
  g.lastDrawn = t14;
  g.hasDrawn = true;
  g.drawNum[dealer]++;
  setSelfPending(g, dealer);
  return g;
}

function selfOptions(g, seat) {
  const opts = { hu: canWinSelf(g, seat, g.lastDrawn), kans: [], mustDiscardDrawn: false };
  const c = countsOf(g.hands[seat]);
  if (g.wall.length > 0) {
    for (const k of KINDS) if (c[k] === 4) opts.kans.push({ kind: 'an', tile: k });
    for (const m of g.melds[seat]) if (m.t === 'pon' && c[m.tile] >= 1) opts.kans.push({ kind: 'jia', tile: m.tile });
  }
  if (g.ting[seat]) {
    opts.kans = opts.kans.filter(kan => kanKeepsGame(g, seat, kan));
    opts.mustDiscardDrawn = true;
  }
  return opts;
}
function setSelfPending(g, seat) {
  const opts = selfOptions(g, seat);
  g.pending = { type: 'self', seat, opts };
  // locked hand with nothing to decide: auto-discard the drawn tile
  if (opts.mustDiscardDrawn && !opts.hu && !opts.kans.length) {
    doDiscard(g, seat, g.lastDrawn, false);
  }
}

function claimOptions(g, seat, tile) {
  const opts = { hu: canWinTile(g, seat, tile), pon: false, gang: false, chis: [] };
  if (g.wall.length === 0) return opts; // final discard: hu only
  if (g.ting[seat]) return opts;        // locked hand: no calls
  const c = countsOf(g.hands[seat]);
  opts.pon = c[tile] >= 2;
  opts.gang = c[tile] >= 3 && g.wall.length > 0;
  if (tile < 10) {
    for (let s = Math.max(1, tile - 2); s <= Math.min(7, tile); s++) {
      let ok = true;
      for (let x = s; x < s + 3; x++) if (x !== tile && !c[x]) ok = false;
      if (ok) opts.chis.push(s);
    }
  }
  return opts;
}

function removeTiles(hand, tile, n) {
  for (let i = 0; i < n; i++) { const idx = hand.indexOf(tile); hand.splice(idx, 1); }
}

function applyPass(g, seat) {
  if (!g.sk.pass) return; // this table has no pass-doubling: declining a win is free
  if (g.passMult[seat] < CONFIG.PASS_MULT_CAP) { g.passMult[seat] *= 2; g.passCount[seat]++; }
}

function doDiscard(g, seat, tile, ting) {
  removeTiles(g.hands[seat], tile, 1);
  sortHand(g.hands[seat]); // re-sort once the drawn tile is resolved
  g.kongDepth = 0; g.replacement = false; g.hasDrawn = false;
  if (ting && !g.ting[seat]) {
    const first = g.discNum[seat] === 0 && !g.anyCall;
    const kind = first ? (seat === g.dealer ? 'tian' : 'di') : 'normal';
    // river marks at declaration time: everything discarded from here on is a proven safe tile
    g.ting[seat] = { kind, from: [g.rivers[0].length, g.rivers[1].length] };
  }
  g.discNum[seat]++;
  g.lastDiscard = { seat, tile };
  const opp = 1 - seat;
  const opts = claimOptions(g, opp, tile);
  if (opts.hu || opts.pon || opts.gang || opts.chis.length) {
    g.pending = { type: 'claim', seat: opp, tile, opts };
  } else {
    finishDiscard(g);
  }
}
function finishDiscard(g) {
  const { seat, tile } = g.lastDiscard;
  g.rivers[seat].push(tile);
  g.lastDiscard = null;
  if (g.wall.length === 0) { endDraw(g); return; }
  g.turn = 1 - seat;
  g.pending = { type: 'draw' };
}
function finalizeDraw(g) {
  g.over = true;
  const A = g.base * CONFIG.LOSS_CAP_MULT;
  g.result = { winner: -1, net: 0, wager: A, fan: null, mult: 1 };
  g.pending = { type: 'end' };
}
// exhaustive draw: player (and only the player) gets the haidi bonus when tenpai
function endDraw(g) {
  if (!g.haidiUsed && waitsOf(g, 0).length > 0) {
    g.haidiUsed = true;
    g.pending = { type: 'haidi', pool: buildHaidiPool(g), picks: [], done: false };
    return;
  }
  finalizeDraw(g);
}
function buildHaidiPool(g) {
  const waits = waitsOf(g, 0);
  // pool holds 1~3 waited tiles; hit/miss is pure luck in the prototype
  // (future blacklist/RTP-bin control plugs in HERE: pool composition + placement)
  const k = 1 + Math.floor(g.rng() * 3);
  const pool = [];
  for (let i = 0; i < k && pool.length < 10; i++) {
    pool.push({ tile: waits[Math.floor(g.rng() * waits.length)], hit: true });
  }
  const nonWaits = KINDS.filter(t => !waits.includes(t));
  while (pool.length < 10) {
    pool.push({ tile: nonWaits[Math.floor(g.rng() * nonWaits.length)], hit: false });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(g.rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function randomNonMatchTile(g, matchTiles) {
  const s = new Set(matchTiles);
  const cands = KINDS.filter(k => !s.has(k));
  return cands[Math.floor(g.rng() * cands.length)];
}

function visibleCopies(g, tile) {
  let n = 0;
  for (const s of [0, 1]) {
    for (const t of g.rivers[s]) if (t === tile) n++;
    for (const m of g.melds[s]) if (m.sub !== 'an') for (const t of m.tiles) if (t === tile) n++;
  }
  return n;
}

function finalizeWin(g, seat, winTile, ctx) {
  ctx.juezhang = visibleCopies(g, winTile) >= 3;
  ctx.tianhu = !!ctx.tsumo && seat === g.dealer && g.discNum[0] + g.discNum[1] === 0 && !g.anyCall;
  ctx.renhu = !ctx.tsumo && !ctx.qianggang && seat !== g.dealer && g.discNum[g.dealer] === 1 &&
              g.discNum[seat] === 0 && !g.anyCall;
  // first-turn check must ignore kan replacement draws (rulebook allows ankan → dihu + gangkai)
  ctx.dihu = !!ctx.tsumo && seat !== g.dealer && g.discNum[seat] === 0 && !g.anyCall;
  const fan = calcFan(g, seat, winTile, ctx);
  if (seat === 0) {
    // every player win enters the duihua bonus before settlement;
    // duihua2 characters run the lottery twice: 6 picks, hits = sum of two table samples
    const rounds = g.sk.duihua2 ? 2 : 1;
    const need = 3 * rounds;
    let M = 0;
    for (let r0 = 0; r0 < rounds; r0++) {
      const r = g.rng();
      for (let i = 0; i < DUIHUA_PROBS.length; i++) { if (r < DUIHUA_PROBS[i]) { M += i; break; } }
    }
    const slots = [];
    for (let i = 0; i < need; i++) slots.push(i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(g.rng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const matchTiles = g.hands[0].slice();
    if (!ctx.tsumo) matchTiles.push(winTile);
    g.pending = {
      type: 'duihua', winTile, tsumo: !!ctx.tsumo, fan, need,
      hitSlots: slots.slice(0, M), matchTiles, picks: [], reveals: [], done: false,
    };
    return;
  }
  settleResult(g, seat, winTile, !!ctx.tsumo, fan);
}
function settleResult(g, seat, winTile, tsumo, fan) {
  const B = g.base, A = B * CONFIG.LOSS_CAP_MULT;
  const mult = g.passMult[seat];
  const net = seat === 0 ? fan.total * mult * B : -Math.min(fan.total * mult * B, A);
  g.over = true;
  g.result = { winner: seat, winTile, tsumo, fan, mult, net, wager: A };
  g.pending = { type: 'end' };
}

function doKanReplacementDraw(g, seat) {
  const tile = g.wall.pop();
  g.hands[seat].push(tile);
  g.drawNum[seat]++;
  g.lastDrawn = tile; g.replacement = true; g.hasDrawn = true;
  setSelfPending(g, seat);
}

function performKan(g, seat, kan) {
  const chained = g.replacement && kan.tile === g.lastDrawn;
  if (kan.kind === 'an') {
    removeTiles(g.hands[seat], kan.tile, 4);
    g.melds[seat].push({ t: 'gang', sub: 'an', tile: kan.tile, tiles: [kan.tile, kan.tile, kan.tile, kan.tile] });
    g.kongDepth = chained ? g.kongDepth + 1 : 1;
    doKanReplacementDraw(g, seat);
  } else { // jia (extend an exposed pon): opponent may rob
    const opp = 1 - seat;
    if (canWinTile(g, opp, kan.tile)) {
      g.pending = { type: 'rob', seat: opp, kseat: seat, tile: kan.tile, chained };
    } else {
      completeKakan(g, seat, kan.tile, chained);
    }
  }
}
function completeKakan(g, seat, tile, chained) {
  removeTiles(g.hands[seat], tile, 1);
  const m = g.melds[seat].find(x => x.t === 'pon' && x.tile === tile);
  m.t = 'gang'; m.sub = 'jia'; m.tiles = [tile, tile, tile, tile];
  g.anyCall = true;
  g.kongDepth = chained ? g.kongDepth + 1 : 1;
  doKanReplacementDraw(g, seat);
}

function act(g, dec) {
  if (g.over) return;
  g.actions++;
  const p = g.pending;
  switch (p.type) {
    case 'draw': {
      if (g.wall.length === 0) { endDraw(g); return; }
      const seat = g.turn;
      // hand-limit table: once a seat has used all its draws the round ends in a draw
      if (g.sk.handLimit && g.drawNum[seat] >= g.sk.handLimit) { endDraw(g); return; }
      const tile = g.wall.pop();
      g.hands[seat].push(tile); // unsorted tail = the drawn tile (UI shows it apart)
      g.drawNum[seat]++;
      g.lastDrawn = tile; g.replacement = false; g.hasDrawn = true;
      setSelfPending(g, seat);
      return;
    }
    case 'self': {
      const seat = p.seat;
      if (dec.t === 'hu') {
        finalizeWin(g, seat, g.lastDrawn, {
          tsumo: true,
          gangkai: g.replacement, chain: g.replacement && g.kongDepth >= 2,
          miaoshou: g.wall.length === 0,
        });
        return;
      }
      if (p.opts.hu && dec.t !== 'hu') { applyPass(g, seat); p.opts.hu = false; }
      if (dec.t === 'pass') {
        if (p.opts.mustDiscardDrawn && !p.opts.kans.length) doDiscard(g, seat, g.lastDrawn, false);
        return;
      }
      if (dec.t === 'gang') { performKan(g, seat, dec.kan); return; }
      if (dec.t === 'discard') { doDiscard(g, seat, dec.tile, !!dec.ting); return; }
      return;
    }
    case 'claim': {
      const seat = p.seat, tile = p.tile;
      if (dec.t === 'hu') {
        finalizeWin(g, seat, tile, { tsumo: false, haidi: g.wall.length === 0 });
        return;
      }
      if (p.opts.hu) { applyPass(g, seat); p.opts.hu = false; }
      if (dec.t === 'pass') return; // declined hu; keep pon/chi/skip options open
      if (dec.t === 'pon') {
        removeTiles(g.hands[seat], tile, 2);
        g.melds[seat].push({ t: 'pon', tile, start: 0, tiles: [tile, tile, tile] });
        g.anyCall = true; g.lastDiscard = null;
        g.turn = seat; g.kongDepth = 0; g.replacement = false; g.hasDrawn = false;
        g.pending = { type: 'self', seat, opts: { hu: false, kans: [], mustDiscardDrawn: false } };
        return;
      }
      if (dec.t === 'gang') {
        removeTiles(g.hands[seat], tile, 3);
        g.melds[seat].push({ t: 'gang', sub: 'ming', tile, start: 0, tiles: [tile, tile, tile, tile] });
        g.anyCall = true; g.lastDiscard = null;
        g.turn = seat; g.kongDepth = 1;
        doKanReplacementDraw(g, seat);
        return;
      }
      if (dec.t === 'chi') {
        const s = dec.s;
        for (let x = s; x < s + 3; x++) if (x !== tile) removeTiles(g.hands[seat], x, 1);
        g.melds[seat].push({ t: 'chi', start: s, tile, tiles: [s, s + 1, s + 2] });
        g.anyCall = true; g.lastDiscard = null;
        g.turn = seat; g.kongDepth = 0; g.replacement = false; g.hasDrawn = false;
        g.pending = { type: 'self', seat, opts: { hu: false, kans: [], mustDiscardDrawn: false } };
        return;
      }
      // skip
      finishDiscard(g);
      return;
    }
    case 'rob': {
      const seat = p.seat;
      if (dec.t === 'hu') {
        finalizeWin(g, seat, p.tile, { tsumo: false, qianggang: true });
        return;
      }
      applyPass(g, seat); // a rob chance is a hu chance; declining doubles
      completeKakan(g, p.kseat, p.tile, p.chained);
      return;
    }
    case 'haidi': {
      if (dec.t === 'pick' && !p.done && Number.isInteger(dec.i) && dec.i >= 0 && dec.i < 10 && !p.picks.includes(dec.i)) {
        p.picks.push(dec.i);
        if (p.picks.length === 3) p.done = true;
        return;
      }
      if (dec.t === 'resolve' && p.done) {
        const hit = p.picks.map(i => p.pool[i]).find(x => x.hit);
        if (hit) finalizeWin(g, 0, hit.tile, { tsumo: false, haidi: true });
        else finalizeDraw(g);
      }
      return;
    }
    case 'duihua': {
      if (dec.t === 'pick' && !p.done && Number.isInteger(dec.i) && dec.i >= 0 && dec.i < 10 && !p.picks.some(x => x.i === dec.i)) {
        const slot = p.picks.length;
        const hit = p.hitSlots.includes(slot);
        const tile = hit
          ? p.matchTiles[Math.floor(g.rng() * p.matchTiles.length)]
          : randomNonMatchTile(g, p.matchTiles);
        p.picks.push({ i: dec.i, tile, hit });
        if (p.picks.length === (p.need || 3)) {
          p.done = true;
          // cosmetic: reveal the 7 unpicked tiles (does not affect settlement)
          p.rest = [];
          for (let i = 0; i < 10; i++) {
            if (p.picks.some(x => x.i === i)) continue;
            const asMatch = g.rng() < 0.3;
            p.rest.push({
              i,
              tile: asMatch
                ? p.matchTiles[Math.floor(g.rng() * p.matchTiles.length)]
                : randomNonMatchTile(g, p.matchTiles),
            });
          }
        }
        return;
      }
      if (dec.t === 'resolve' && p.done) {
        const hits = p.picks.filter(x => x.hit);
        const nDora = hits.filter(x => x.tile === g.dora).length;   // dora hits pay the higher rate
        const M = hits.length - nDora;
        if (M > 0) {
          p.fan.items.push({ id: 'duihua', name: FAN.duihua.name, fan: FAN.duihua.fan, n: M });
          p.fan.total += FAN.duihua.fan * M;
        }
        if (nDora > 0) {
          p.fan.items.push({ id: 'duihuaDora', name: FAN.duihuaDora.name, fan: FAN.duihuaDora.fan, n: nDora });
          p.fan.total += FAN.duihuaDora.fan * nDora;
        }
        settleResult(g, 0, p.winTile, p.tsumo, p.fan);
      }
      return;
    }
  }
}

function runHeadless(g) {
  while (!g.over && g.actions < CONFIG.ACTION_CAP) act(g, aiDecision(g));
  if (!g.over) finalizeDraw(g);
  return g;
}

// ---- 6. Machine bookkeeping (fair random deal) ----

function createMachine(seed) {
  return { rng: mulberry32(seed), hist: [], games: 0 };
}
function machineRTP(m) {
  let r = 0, w = 0;
  for (const h of m.hist) { r += h.ret; w += h.wager; }
  return w ? r / w : CONFIG.RTP_TARGET;
}
function recordResult(m, g) {
  const wager = g.result.wager;
  m.hist.push({ ret: wager + g.result.net, wager });
  if (m.hist.length > CONFIG.RTP_WINDOW) m.hist.shift();
  m.games++;
}
// public build: every deal is a fresh fair shuffle
function nextGameSeed(m, dealer) {
  return Math.floor(m.rng() * 0x7fffffff);
}

// ---- 7. selfTest: fixed seed, invariants, termination ----

function tileConservation(g) {
  let n = g.wall.length;
  for (const s of [0, 1]) {
    n += g.hands[s].length + g.rivers[s].length;
    for (const m of g.melds[s]) n += m.tiles.length;
  }
  if (g.lastDiscard) n++;
  return n;
}

function selfTest(runs = 100, seed = 42) {
  const rand = mulberry32(seed);
  let fails = 0;
  const stats = { wins: [0, 0], draws: 0, fanTotals: [], mults: [] };
  for (let i = 0; i < runs; i++) {
    const g = newGame(Math.floor(rand() * 0x7fffffff), i % 2);
    let guard = 0;
    while (!g.over && ++guard <= CONFIG.ACTION_CAP) {
      act(g, aiDecision(g));
      if (tileConservation(g) !== 64) { console.error('conservation broken', g.seed, tileConservation(g)); fails++; break; }
      for (const s of [0, 1]) {
        if (g.over) break; // winner legitimately holds the winning tile
        if (g.pending && (g.pending.type === 'haidi' || g.pending.type === 'duihua')) break; // bonus phase: outcome decided
        const expect = 13 - 3 * g.melds[s].length;
        const len = g.hands[s].length;
        const isActing = !g.over && g.pending && (g.pending.type === 'self') && g.pending.seat === s;
        if (len !== expect && !(isActing && len === expect + 1) && !(g.pending && g.pending.type === 'rob' && g.pending.kseat === s && len === expect + 1)) {
          console.error('hand size broken', g.seed, s, len, expect, g.pending && g.pending.type); fails++; g.over = true; break;
        }
      }
    }
    if (!g.over) { console.error('game did not terminate', g.seed); fails++; continue; }
    const r = g.result;
    if (r.winner >= 0) {
      stats.wins[r.winner]++;
      stats.fanTotals.push(r.fan.total);
      stats.mults.push(r.mult);
      if (r.fan.total < 1) { console.error('zero-fan win', g.seed, r); fails++; }
      if (r.winner === 1 && r.net < -r.wager) { console.error('loss cap broken', g.seed, r.net); fails++; }
      if (r.mult > CONFIG.PASS_MULT_CAP) { console.error('mult cap broken', g.seed, r.mult); fails++; }
    } else stats.draws++;
  }
  const avgFan = stats.fanTotals.length ? (stats.fanTotals.reduce((a, b) => a + b, 0) / stats.fanTotals.length).toFixed(1) : '-';
  const msg = fails
    ? `selfTest FAIL ${fails} problems / ${runs} games`
    : `selfTest OK: ${runs} games, seed=${seed} | P/AI/draw = ${stats.wins[0]}/${stats.wins[1]}/${stats.draws} | avg fan ${avgFan}`;
  console.log(msg);
  return fails === 0;
}

// ---- 8. UI (browser only) ----

if (typeof document !== 'undefined') {
  const S = {
    credits: CONFIG.START_CREDITS,
    machine: createMachine(Date.now() & 0x7fffffff),
    round: 0, g: null, auto: false, speed: 500,
    tingMode: false, tingSelect: null, timer: null,
    betIdx: 0, charIdx: 0, diffKey: 'normal', autoNext: false, vsTimer: null, suitTimer: null,
    unlocked: null,         // Set of unlocked CHARS ids; filled from storage on boot
    lastMult: 1,            // last rendered pass multiplier, to fire the bump animation once
  };
  // ---- opponent roster unlocks ----
  // A portrait unlocks by BEATING that opponent, not by meeting them — meeting is free (the
  // opponent is rolled at random), so only a win is worth collecting. Persisted so the
  // collection survives a reload; file:// can deny storage, hence the try/catch fallback to
  // in-memory only (unlocks then last for the session).
  const UNLOCK_KEY = 'qs13.unlocked';
  function loadUnlocks() {
    try { return new Set(JSON.parse(localStorage.getItem(UNLOCK_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveUnlocks() {
    try { localStorage.setItem(UNLOCK_KEY, JSON.stringify([...S.unlocked])); } catch (e) { /* no storage: session only */ }
  }
  function unlockChar(id) {
    if (S.unlocked.has(id)) return false;
    S.unlocked.add(id);
    saveUnlocks();
    return true;
  }

  function curChar() { return CHARS[S.charIdx]; }        // pure skin
  function curDiff() { return DIFFS[S.diffKey]; }        // skill set + min stake
  function curBet() { return BET_LADDER[S.betIdx]; }     // global stake ladder
  function minBetIdx() { return BET_LADDER.findIndex(b => b >= curDiff().minBet); }
  // reveal tiles by ABSOLUTE stake (only applied when difficulty unlocks reveal)
  function revealForBet(bet) {
    if (bet >= 10000) return 9;
    if (bet >= 5000) return 7;
    if (bet >= 2000) return 5;
    if (bet >= 1000) return 3;
    if (bet >= 500) return 1;
    return 0;
  }
  const $ = id => document.getElementById(id);

  function tileLabel(t) {
    if (t >= 11) return HONOR_NAME[t];
    return NUM_NAME[t] + SUIT_NAME[S.g ? S.g.suit : 'w'];
  }
  function tileEl(t, opts = {}) {
    const d = document.createElement('div');
    d.className = 'tile' + (t >= 15 ? ' arrow-' + t : t >= 11 ? ' wind' : ' num') + (opts.cls ? ' ' + opts.cls : '');
    if (opts.back) { d.className = 'tile back'; return d; }
    if (t >= 11) d.textContent = HONOR_NAME[t];
    else d.innerHTML = `<span class="n">${NUM_NAME[t]}</span><span class="s">${SUIT_NAME[S.g.suit]}</span>`;
    return d;
  }

  // Round dora as a tile face (number over suit), matching how tileEl draws a number tile —
  // the splash and the top-bar stamp must read as the same object the player holds in hand.
  function doraFace(g) {
    return `<span class="n">${NUM_NAME[g.dora]}</span><span class="s">${SUIT_NAME[g.suit]}</span>`;
  }

  function newRound() {
    S.round++;
    const dealer = (S.round % 2 === 1) ? 0 : 1;
    const seed = nextGameSeed(S.machine, dealer);
    const diff = curDiff();
    const bet = curBet();
    const sk = Object.assign({}, diff.skill, { revealN: diff.skill.reveal ? revealForBet(bet) : 0 });
    S.g = newGame(seed, dealer, bet, sk);
    S.tingMode = false;
    S.lastMult = 1;          // fresh round starts at x1; don't carry last round's bump state
    showOppChar();
    hideOverlay();
    playSuitThenDrive();
  }

  // Announce the round's suit, then start play. Runs on every round-start path (manual 開局
  // after the VS splash, and auto-next) because the suit is re-rolled every round — unlike the
  // opponent skin, it is not something the player can carry over in their head.
  // Skipped entirely in full auto-play, and tappable to skip for players who already saw it.
  function playSuitThenDrive() {
    const ov = $('suit-anim');
    if (S.auto) { ov.style.display = 'none'; drive(); return; }
    $('suit-big').innerHTML = doraFace(S.g);
    $('suit-note').textContent = TEXT.doraNote;
    ov.style.display = 'flex';
    ov.classList.remove('run'); void ov.offsetWidth; ov.classList.add('run'); // restart CSS anim
    clearTimeout(S.suitTimer);
    const finish = () => {
      clearTimeout(S.suitTimer);
      ov.style.display = 'none';
      ov.onclick = null;
      stampSuit();          // hand the tile off to the top bar so the eye follows it
      drive();
    };
    ov.onclick = finish;
    S.suitTimer = setTimeout(finish, CONFIG.SUIT_SPLASH_MS);
  }
  // replay the small stamp pop on the top-bar readout
  function stampSuit() {
    const st = $('suit-stamp');
    st.classList.remove('stamp'); void st.offsetWidth; st.classList.add('stamp');
  }

  function showOppChar() {
    const ch = CHARS[S.charIdx];
    const box = $('opp-char');
    box.style.display = 'flex';
    const img = $('opp-img');
    if (img.getAttribute('src') !== ch.img) img.src = ch.img;
    $('opp-name').textContent = ch.name;
  }

  function rollOpponent() {
    S.charIdx = Math.floor(Math.random() * CHARS.length); // random skin, independent of game RNG
  }

  // Opponent re-roll + VS splash. Runs on manual 開局 AND on 自動下一局 — auto-next locks the
  // stake and the difficulty, but the opponent is re-drawn every round, so the splash is how the
  // player finds out who they got. Full auto-play re-rolls too but silently (see advanceAfterSettle).
  function playVsThenStart() {
    // Close the settlement overlay FIRST. The splash covers it visually but does not disable it,
    // so leaving it up lets a second 下一局 click re-enter this function and reset the timer —
    // which stalls the hand-off to newRound() indefinitely.
    hideOverlay();
    rollOpponent();
    const ch = curChar();
    const img = $('vs-img');
    if (img.getAttribute('src') !== ch.img) img.src = ch.img;
    $('vs-name').textContent = ch.name;
    const ov = $('vs-anim');
    ov.style.display = 'flex';
    ov.classList.remove('run'); void ov.offsetWidth; ov.classList.add('run'); // restart CSS anim
    clearTimeout(S.vsTimer);
    S.vsTimer = setTimeout(() => { ov.style.display = 'none'; newRound(); }, 1600);
  }

  // pass-doubling readout. Shown on every table that allows 過水 — including at ×1, so the
  // player learns the mechanic exists and can watch it climb; hidden entirely where it can't
  // be used. Also spells out remaining passes, since the multiplier alone doesn't tell the
  // player how many chances are left (the cap is silent otherwise).
  const PASS_MAX_COUNT = Math.round(Math.log2(CONFIG.PASS_MULT_CAP));
  function renderPassMult(g) {
    const mb = $('mult-badge');
    if (!g.sk.pass) { mb.style.display = 'none'; S.lastMult = 1; return; }
    const mult = g.passMult[0], count = g.passCount[0];
    const atCap = mult >= CONFIG.PASS_MULT_CAP;
    mb.style.display = 'inline-flex';
    $('mult-value').textContent = '×' + mult;
    const used = count ? `${count} ${TEXT.passTimes}・` : '';
    $('mult-times').textContent = atCap
      ? `${used}${TEXT.passAtCap}`
      : `${used}${TEXT.passLeft} ${PASS_MAX_COUNT - count} ${TEXT.passTimes}`;
    mb.classList.toggle('live', mult > 1);
    mb.classList.toggle('capped', atCap);
    if (mult > S.lastMult) {                 // replay the pop each time it actually climbs
      mb.classList.remove('bump');
      void mb.offsetWidth;                   // force reflow so the animation restarts
      mb.classList.add('bump');
    }
    S.lastMult = mult;
  }

  // wipe the table back to a fresh "just sat down" state (no tiles from the finished round)
  function clearTable() {
    S.lastMult = 1;
    S.g = null;
    clearTimeout(S.timer);
    for (const id of ['ai-hand', 'ai-melds', 'ai-river', 'p-hand', 'p-melds', 'p-river', 'ting-live', 'actions']) {
      $(id).innerHTML = '';
    }
    for (const id of ['dealer-you', 'dealer-ai', 'mult-badge', 'ting-you', 'ting-ai']) {
      $(id).style.display = 'none';
    }
    $('opp-char').style.display = 'none';
    $('bonus').style.display = 'none';
    $('round-num').textContent = '-';
    $('suit-name').textContent = '-';   // innerHTML face is rebuilt by render() on the next round
    $('suit-stamp').style.display = 'none';
    $('suit-anim').style.display = 'none';
    clearTimeout(S.suitTimer);
    $('wall-count').textContent = '-';
    $('wager-info').textContent = '';
    $('credits').textContent = S.credits;
  }

  // --- bet selection screen (entry + after every settlement) ---
  function showBetSel() {
    hideOverlay();
    clearTable();
    $('betsel').style.display = 'flex';
    renderRoster();
    renderBetSel();
  }
  function renderRoster() {
    const wrap = $('bs-roster');
    wrap.innerHTML = '';
    CHARS.forEach((ch, i) => {
      const locked = !S.unlocked.has(ch.id);
      const slot = document.createElement('div');
      slot.className = 'bs-char p' + i + (locked ? ' locked' : '');
      const img = document.createElement('img');
      img.src = ch.img;
      img.alt = locked ? '' : ch.name;
      slot.appendChild(img);
      const q = document.createElement('span');
      q.className = 'bs-q'; q.textContent = '?';
      slot.appendChild(q);
      wrap.appendChild(slot);
    });
  }
  function renderBetSel() {
    const diff = curDiff();
    const floor = minBetIdx();
    if (S.betIdx < floor) S.betIdx = floor;          // clamp stake to the difficulty's floor
    const bet = curBet();
    const wager = bet * CONFIG.LOSS_CAP_MULT;
    $('bs-amount').textContent = bet;
    $('bs-req-num').textContent = wager;
    // difficulty tabs — highlight the active one
    DIFF_ORDER.forEach(k => $('diff-' + k).classList.toggle('active', k === S.diffKey));
    // This tier's one perk. 海底 and 對花 are universal, so they are not listed — the line
    // exists to say what makes THIS table different from the other two.
    let s = TEXT.perkNone;
    if (diff.skill.handLimit) s = TEXT.perkHandLimit + diff.skill.handLimit + TEXT.perkHandLimitUnit;
    else if (diff.skill.reveal) s = TEXT.revealPrefix + revealForBet(bet) + TEXT.revealUnit;
    else if (diff.skill.pass) s = TEXT.perkPass;
    $('bs-reveal').textContent = s;
    $('bs-credits').textContent = S.credits;
    const short = S.credits < wager;
    const btn = $('bs-start');
    btn.disabled = short;
    btn.textContent = short ? TEXT.betShort : TEXT.betStart;
    $('bs-minus').disabled = S.betIdx <= floor;      // can't go below the difficulty floor
    $('bs-plus').disabled = S.betIdx === BET_LADDER.length - 1;
    $('bs-diffinfo').textContent = `${diff.name}｜${TEXT.minBetPrefix}${diff.minBet}`;
  }

  function drive() {
    clearTimeout(S.timer);
    if (!S.g) return;
    render();
    const g = S.g;
    if (g.over) { onGameOver(); return; }
    const p = g.pending;
    const humanTurn = (p.type === 'self' && p.seat === 0) || (p.type === 'claim' && p.seat === 0) ||
                      (p.type === 'rob' && p.seat === 0) || p.type === 'haidi' || p.type === 'duihua';
    if (humanTurn && !S.auto) return; // wait for clicks
    const delay = p.type === 'draw' ? 120 : S.speed;
    S.timer = setTimeout(() => { act(g, aiDecision(g)); drive(); }, S.auto ? Math.min(delay, 200) : delay);
  }

  function onGameOver() {
    const g = S.g;
    recordResult(S.machine, g);
    S.credits += g.result.net;
    // beating this opponent reveals their portrait on the bet screen
    if (g.result.winner === 0) unlockChar(curChar().id);
    render();
    showOverlay(g.result);
    // only full auto-play (AI plays everything) auto-advances at settlement.
    // 自動下一局 (autoNext) still waits for a manual 下一局 click — it only skips the bet screen afterwards.
    if (S.auto) S.timer = setTimeout(advanceAfterSettle, 1500);
  }

  // called from the settlement overlay's next button, or auto-fired after a delay:
  // continue same opponent + same stake when auto/autoNext is on and credits suffice,
  // otherwise fall back to the bet screen
  function setAutoNext(v) {
    S.autoNext = v;
    $('autonext-toggle').checked = v;
    $('bs-autonext').checked = v;
  }

  function advanceAfterSettle() {
    clearTimeout(S.timer);
    if (!(S.auto || S.autoNext) || S.credits < curBet() * CONFIG.LOSS_CAP_MULT) { showBetSel(); return; }
    // both auto paths keep stake + difficulty and re-draw the opponent; only the reveal differs
    if (S.auto) { rollOpponent(); newRound(); }   // full auto-play: silent, no splash
    else playVsThenStart();                       // 自動下一局: VS splash reveals the new opponent
  }

  function humanAct(dec) {
    S.tingMode = false; S.tingSelect = null;
    act(S.g, dec);
    drive();
  }

  // --- rendering ---
  function render() {
    const g = S.g;
    if (!g) return;
    $('round-num').textContent = S.round;
    $('suit-name').innerHTML = doraFace(g);
    $('suit-stamp').style.display = 'inline-flex';
    // elite hand-limit rounds end at handLimit draws/seat (not wall exhaustion),
    // so show the shared remaining-draw budget (handLimit×2 − draws used) instead of raw wall size
    $('wall-count').textContent = g.sk.handLimit
      ? Math.max(0, g.sk.handLimit * 2 - (g.drawNum[0] + g.drawNum[1]))
      : g.wall.length;
    $('credits').textContent = S.credits;
    $('wager-info').textContent = `${TEXT.wager} ${g.base * CONFIG.LOSS_CAP_MULT}（底注 ${g.base}）`;
    $('dealer-you').style.display = g.dealer === 0 ? 'inline-flex' : 'none';
    $('dealer-ai').style.display = g.dealer === 1 ? 'inline-flex' : 'none';
    renderPassMult(g);
    $('ting-you').style.display = g.ting[0] ? 'inline-flex' : 'none';
    $('ting-ai').style.display = g.ting[1] ? 'inline-flex' : 'none';

    // persistent waits panel while the player is in declared ting
    const roundDecided = g.over ||
      (g.pending && (g.pending.type === 'end' || g.pending.type === 'haidi' || g.pending.type === 'duihua'));
    const tl = $('ting-live');
    if (g.ting[0] && !roundDecided) buildWaitsPanel(tl, liveWaitsInfo(), null);
    else tl.innerHTML = '';

    // surface the fold: declaring ting has to visibly scare the opponent off, or the
    // trade-off (locked hand + 1 fan vs. a defending opponent) is invisible to the player
    $('fold-ai').style.display = (!roundDecided && defenseMode(g, 1) === 2) ? 'inline-flex' : 'none';

    // AI zone: face-down while playing (bet tier reveals some tiles), all revealed once decided
    const ah = $('ai-hand'); ah.innerHTML = '';
    if (roundDecided) {
      const h = g.hands[1].slice(); sortHand(h);
      for (const t of h) ah.appendChild(tileEl(t));
    } else {
      const h = g.hands[1].slice(); sortHand(h);
      const slots = revealSlots(g, h.length);
      h.forEach((t, i) => ah.appendChild(slots.has(i) ? tileEl(t) : tileEl(0, { back: true })));
    }
    renderMelds($('ai-melds'), g.melds[1]);
    renderRiver($('ai-river'), g.rivers[1], g, 1);

    // player zone
    renderMelds($('p-melds'), g.melds[0]);
    renderRiver($('p-river'), g.rivers[0], g, 0);
    renderHand();
    renderActions();
    renderBonus();
    renderDebug();
  }

  // bet-tier peek: fixed random slot positions per round (seeded, stable across renders),
  // applied to the sorted current AI hand; slots beyond the current hand size are skipped
  function revealSlots(g, len) {
    const n = g.sk.revealN || 0; // tiles the character/stake reveals this round
    const set = new Set();
    if (!n) return set;
    const rng = mulberry32((g.seed ^ 0x5eed) >>> 0);
    const idx = Array.from({ length: 13 }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (const k of idx) {
      if (set.size >= n) break;
      if (k < len) set.add(k);
    }
    return set;
  }

  function renderBonus() {
    const g = S.g;
    const p = g.pending;
    const bz = $('bonus');
    if (!p || (p.type !== 'haidi' && p.type !== 'duihua')) {
      bz.style.display = 'none';
      document.body.classList.remove('bonus-open');
      return;
    }
    bz.style.display = 'flex';
    $('bonus-title').textContent = p.type === 'haidi' ? TEXT.haidiTitle : TEXT.duihuaTitle;
    $('bonus-note').textContent =
      `${p.type === 'haidi' ? TEXT.haidiNote : TEXT.duihuaNote}｜${TEXT.bonusLeft} ${(p.need || 3) - p.picks.length} ${TEXT.bonusUnit}`;
    document.body.classList.add('bonus-open');
    const poolEl = $('bonus-pool'); poolEl.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      let revealed = null, isRest = false;
      if (p.type === 'haidi') {
        if (p.picks.includes(i)) revealed = p.pool[i];
        else if (p.done) { revealed = { tile: p.pool[i].tile, hit: false }; isRest = true; }
      } else {
        revealed = p.picks.find(x => x.i === i) || null;
        if (!revealed && p.done && p.rest) {
          const r = p.rest.find(x => x.i === i);
          if (r) { revealed = { tile: r.tile, hit: false }; isRest = true; }
        }
      }
      let e;
      if (revealed) {
        e = tileEl(revealed.tile, { cls: revealed.hit ? 'bonus-hit' : isRest ? 'bonus-rest' : 'bonus-miss' });
      } else {
        e = tileEl(0, { back: true });
        if (!S.auto && !p.done) { e.classList.add('clickable'); e.onclick = () => humanAct({ t: 'pick', i }); }
      }
      poolEl.appendChild(e);
    }
    const cf = $('bonus-confirm');
    cf.style.display = (p.done && !S.auto) ? 'inline-block' : 'none';
    cf.onclick = () => humanAct({ t: 'resolve' });
  }

  function renderMelds(el, melds) {
    el.innerHTML = '';
    for (const m of melds) {
      const grp = document.createElement('div'); grp.className = 'meld';
      m.tiles.forEach((t, i) => {
        // concealed kong: reveal the middle two so the konged tile is visible
        const hidden = m.sub === 'an' && (i === 0 || i === 3);
        // melds score the dora too (hand + melds), so they carry the same highlight —
        // this also lets the player see the AI sitting on copies
        grp.appendChild(hidden ? tileEl(0, { back: true, cls: 'small' })
                               : tileEl(t, { cls: 'small' + (S.g && t === S.g.dora ? ' dora' : '') }));
      });
      el.appendChild(grp);
    }
  }
  function renderRiver(el, river, g, seat) {
    el.innerHTML = '';
    const list = river.slice();
    if (g.lastDiscard && g.lastDiscard.seat === seat) list.push(g.lastDiscard.tile);
    list.forEach((t, i) => {
      const e = tileEl(t, { cls: 'small' + (i === list.length - 1 && g.lastDiscard && g.lastDiscard.seat === seat ? ' fresh' : '') });
      el.appendChild(e);
    });
  }
  function renderHand() {
    const g = S.g;
    const el = $('p-hand'); el.innerHTML = '';
    const p = g.pending;
    const canDiscard = !g.over && p.type === 'self' && p.seat === 0 && !S.auto;
    let tingOK = null;
    if (S.tingMode) {
      tingOK = new Set();
      const c = countsOf(g.hands[0]);
      for (const k of KINDS) {
        if (!c[k]) continue;
        c[k]--;
        for (const w of KINDS) {
          if (c[w] >= 4) { continue; }
          c[w]++;
          if (canWinCounts(c, g.melds[0].length, g.suit, w)) { tingOK.add(k); c[w]--; break; }
          c[w]--;
        }
        c[k]++;
      }
    }
    const showGap = p.type === 'self' && p.seat === 0 && g.hasDrawn &&
                    g.hands[0].length === 14 - 3 * g.melds[0].length;
    // duihua: glow hand tiles that match revealed hits
    const hitKinds = new Set(
      p.type === 'duihua' ? p.picks.filter(x => x.hit).map(x => x.tile) : []
    );
    g.hands[0].forEach((t, idx) => {
      if (showGap && idx === g.hands[0].length - 1) {
        const gap = document.createElement('div'); gap.className = 'hand-gap';
        el.appendChild(gap);
      }
      const locked = g.ting[0] && p.type === 'self' && p.opts.mustDiscardDrawn && t !== g.lastDrawn;
      const isSel = S.tingMode && S.tingSelect === t;
      const e = tileEl(t, {
        cls: (canDiscard && !locked ? 'clickable' : '') +
             (S.tingMode && tingOK && !tingOK.has(t) ? ' dim' : '') +
             (isSel ? ' sel' : '') +
             (t === g.dora ? ' dora' : '') +
             (hitKinds.has(t) ? ' match-glow' : ''),
      });
      if (canDiscard && !locked && (!S.tingMode || (tingOK && tingOK.has(t)))) {
        e.onclick = () => {
          if (S.tingMode && S.tingSelect !== t) { S.tingSelect = t; render(); return; } // 1st tap: preview waits
          humanAct({ t: 'discard', tile: t, ting: S.tingMode });                        // 2nd tap (or normal play)
        };
      }
      el.appendChild(e);
    });
  }
  function waitsInfoFor(hand13) {
    const g = S.g;
    const savedHand = g.hands[0];
    g.hands[0] = hand13;
    const c = countsOf(hand13);
    const out = [];
    for (const w of KINDS) {
      if (c[w] >= 4) continue;
      c[w]++;
      if (canWinCounts(c, g.melds[0].length, g.suit, w)) {
        const fan = calcFan(g, 0, w, { tsumo: false }); // ron baseline (tsumo etc. adds on top)
        // unseen copies = 4 - own concealed - everything visible on the table
        out.push({ tile: w, fan: fan.total, left: Math.max(0, 4 - (c[w] - 1) - visibleCopies(g, w)) });
      }
      c[w]--;
    }
    g.hands[0] = savedHand;
    return out;
  }
  function tingWaitsInfo(tile) {
    const g = S.g;
    // preview state: hand after the discard, with the would-be ting declaration applied
    const savedTing = g.ting[0];
    const hand13 = g.hands[0].slice(); hand13.splice(hand13.indexOf(tile), 1);
    if (!savedTing) {
      const first = g.discNum[0] === 0 && !g.anyCall;
      g.ting[0] = { kind: first ? (g.dealer === 0 ? 'tian' : 'di') : 'normal' };
    }
    const out = waitsInfoFor(hand13);
    g.ting[0] = savedTing;
    return out;
  }
  function liveWaitsInfo() {
    // waits of the locked (declared-ting) 13-tile hand; drop the drawn tile if mid-turn
    const g = S.g;
    const hand = g.hands[0].slice();
    if (hand.length % 3 === 2) {
      const i = hand.indexOf(g.lastDrawn);
      if (i >= 0) hand.splice(i, 1); else hand.pop();
    }
    return waitsInfoFor(hand);
  }
  function buildWaitsPanel(el, waits, note) {
    el.innerHTML = '';
    const head = document.createElement('span');
    head.className = 'hu-mark'; head.textContent = '胡';
    el.appendChild(head);
    for (const w of waits) {
      const item = document.createElement('div'); item.className = 'wait-item';
      item.appendChild(tileEl(w.tile, { cls: 'small' }));
      const info = document.createElement('div'); info.className = 'wait-info';
      info.innerHTML = `<span>${w.fan}台</span><span>${w.left}張</span>`;
      item.appendChild(info);
      el.appendChild(item);
    }
    if (note) {
      const n = document.createElement('span');
      n.className = 'hint-note'; n.textContent = note;
      el.appendChild(n);
    }
  }
  function renderActions() {
    const g = S.g;
    const bar = $('actions'); bar.innerHTML = '';
    if (g.over || S.auto) return;
    const p = g.pending;
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'act-btn ' + cls; b.textContent = label; b.onclick = fn;
      bar.appendChild(b);
    };
    const passBtn = fn => {
      if (g.sk.pass) btn(TEXT.passHint + Math.min(g.passMult[0] * 2, CONFIG.PASS_MULT_CAP), 'pass', fn);
      else btn(TEXT.skip, 'skip', fn); // no pass-doubling on this table: declining is free
    };
    if (p.type === 'self' && p.seat === 0) {
      if (p.opts.hu) {
        btn(TEXT.huButton, 'hu', () => humanAct({ t: 'hu' }));
        passBtn(() => humanAct({ t: 'pass' }));
      }
      for (const kan of p.opts.kans) {
        btn(TEXT.gang + ' ' + tileLabel(kan.tile), 'call', () => humanAct({ t: 'gang', kan }));
      }
      if (!p.opts.hu && !g.ting[0]) {
        // offer ting toggle if some discard keeps tenpai
        const c = countsOf(g.hands[0]);
        let can = false;
        outer: for (const k of KINDS) {
          if (!c[k]) continue;
          c[k]--;
          for (const w of KINDS) {
            if (c[w] >= 4) continue;
            c[w]++;
            if (canWinCounts(c, g.melds[0].length, g.suit, w)) { can = true; c[w]--; c[k]++; break outer; }
            c[w]--;
          }
          c[k]++;
        }
        if (can) btn(S.tingMode ? TEXT.tingSelect : TEXT.ting, S.tingMode ? 'ting on' : 'ting',
          () => { S.tingMode = !S.tingMode; S.tingSelect = null; render(); });
      }
      if (S.tingMode && S.tingSelect) {
        const hint = document.createElement('div');
        hint.id = 'ting-hint';
        buildWaitsPanel(hint, tingWaitsInfo(S.tingSelect), '再點一次打出');
        bar.appendChild(hint);
      }
    }
    if (p.type === 'claim' && p.seat === 0) {
      const o = p.opts;
      if (o.hu) {
        btn(TEXT.huButton, 'hu', () => humanAct({ t: 'hu' }));
        passBtn(() => humanAct({ t: 'pass' }));
      }
      if (o.pon) btn(TEXT.pon, 'call', () => humanAct({ t: 'pon' }));
      if (o.gang) btn(TEXT.gang, 'call', () => humanAct({ t: 'gang' }));
      for (const s of o.chis) {
        btn(`${TEXT.chi} ${NUM_NAME[s]}${NUM_NAME[s + 1]}${NUM_NAME[s + 2]}`, 'call', () => humanAct({ t: 'chi', s }));
      }
      if (!o.hu) btn(TEXT.skip, 'skip', () => humanAct({ t: 'skip' }));
    }
    if (p.type === 'rob' && p.seat === 0) {
      btn(TEXT.robbed + ' ' + TEXT.huButton, 'hu', () => humanAct({ t: 'hu' }));
      passBtn(() => humanAct({ t: 'skip' }));
    }
  }
  function renderDebug() {
    const m = S.machine;
    $('debug-body').textContent =
      `games ${m.games} | RTP ${(machineRTP(m) * 100).toFixed(1)}%`;
  }

  function showOverlay(r) {
    const ov = $('overlay');
    ov.style.display = 'flex';
    const title = $('ov-title');
    if (r.winner === -1) { title.textContent = TEXT.draw; $('ov-fans').innerHTML = ''; $('ov-net').textContent = ''; }
    else {
      title.textContent = r.winner === 0 ? TEXT.youWin : TEXT.aiWin;
      title.className = r.winner === 0 ? 'win' : 'lose';
      const list = $('ov-fans'); list.innerHTML = '';
      for (const it of r.fan.items) {
        const li = document.createElement('div'); li.className = 'fan-item';
        li.innerHTML = `<span>${it.name}${it.n > 1 ? ' ×' + it.n : ''}</span><span>${it.fan * it.n} 台</span>`;
        list.appendChild(li);
      }
      const li = document.createElement('div'); li.className = 'fan-item total';
      let totalLine = `${TEXT.total} ${r.fan.total} 台`;
      if (r.mult > 1) totalLine += `　${TEXT.pass} ×${r.mult}`;
      li.innerHTML = `<span>${totalLine}</span><span></span>`;
      list.appendChild(li);
      $('ov-net').textContent = (r.net >= 0 ? TEXT.netWin + ' +' : TEXT.netLose + ' ') + r.net;
      $('ov-net').className = r.net >= 0 ? 'win' : 'lose';
      const capEl = $('ov-cap');
      if (r.winner === 1) {
        const raw = r.fan.total * r.mult * S.g.base;
        capEl.textContent = raw > r.wager ? `已達 16 倍輸分上限（原 ${raw}，封頂 ${r.wager}）` : '';
      } else capEl.textContent = '';
    }
    // show winner hand
    const wh = $('ov-hand'); wh.innerHTML = '';
    if (r.winner >= 0) {
      const g = S.g;
      for (const m of g.melds[r.winner]) for (const t of m.tiles) wh.appendChild(tileEl(t, { cls: 'small' }));
      const hand = g.hands[r.winner].slice(); sortHand(hand);
      for (const t of hand) wh.appendChild(tileEl(t, { cls: 'small' }));
      if (!r.tsumo || !g.hands[r.winner].includes(r.winTile)) wh.appendChild(tileEl(r.winTile, { cls: 'small fresh' }));
    }
  }
  function hideOverlay() { $('overlay').style.display = 'none'; }

  function init() {
    S.unlocked = loadUnlocks();
    $('next-btn').onclick = advanceAfterSettle;
    $('auto-toggle').onchange = e => { S.auto = e.target.checked; drive(); };
    // two autoNext checkboxes (in-play bottom-right + bet screen) share one state
    $('autonext-toggle').onchange = e => setAutoNext(e.target.checked);
    $('bs-autonext').onchange = e => setAutoNext(e.target.checked);
    $('debug-toggle').onclick = () => {
      const b = $('debug-body'); b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };
    $('bs-minus').onclick = () => { if (S.betIdx > minBetIdx()) { S.betIdx--; renderBetSel(); } };
    $('bs-plus').onclick = () => { if (S.betIdx < BET_LADDER.length - 1) { S.betIdx++; renderBetSel(); } };
    DIFF_ORDER.forEach(k => { $('diff-' + k).onclick = () => { S.diffKey = k; renderBetSel(); }; });
    $('bs-start').onclick = () => {
      if (S.credits < curBet() * CONFIG.LOSS_CAP_MULT) return;
      $('betsel').style.display = 'none';
      playVsThenStart();   // roll a random opponent + VS splash, then newRound
    };
    showBetSel();
  }
  init();
  setTimeout(() => selfTest(10, 42), 800); // quick smoke in browser; full run lives in sim/harness.js
}

// ---- 9. Node export shim ----
if (typeof module !== 'undefined') {
  module.exports = {
    mulberry32, countsOf, decompose, canWinCounts, canWinTile, waitsOf,
    calcFan, shantenOf, aiDecision, newGame, act, runHeadless,
    createMachine, machineRTP, recordResult, nextGameSeed,
    selfTest, tileConservation,
    CONFIG, FAN, KINDS,
  };
}
