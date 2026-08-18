// =============================================================================
// ui.js — World Cup 2026 simulator UI.
//
// Reads ONLY the engine's public API + data. The engine has no idea the UI
// exists; every match node carries data-* attributes and an empty `.flag-slot`
// hook so later Code-phase steps can attach flags / canvas / goal replay
// WITHOUT touching engine.js.
//
// Code phase step 2 — LIVE MATCH PLAYBACK (Single mode only):
//   The engine still computes the WHOLE deterministic tournament in one call
//   (simulateTournament(seed)). Playback is purely a progressive UI reveal of
//   that already-computed result, match by match, on a timer. The engine is
//   never called incrementally, so determinism is preserved and the final
//   state is identical to the old instant view (which "Skip to end" renders).
//
// Norway (NOR) and Belgium (BEL) are visually highlighted only — no boost.
// =============================================================================

import { TEAMS, GROUP_MATCHES, GROUP_LETTERS, GROUPS, KNOCKOUT_ROUNDS } from './data.js';
import { simulateTournament, monteCarlo } from './engine.js';
import { computeBacktest, championReport } from './backtest.js';
import { TEAM_COLORS } from './colors.js';
import { openReplay, closeReplay } from './replay.js';

const HIGHLIGHT = new Set(['NOR', 'BEL']); // narrative focus, zero strength effect
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') n.className = props[k];
    else if (k === 'text') n.textContent = props[k];
    else if (k.startsWith('data-')) n.setAttribute(k, props[k]);
    else n[k] = props[k];
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const teamName = (code) => (TEAMS.find((t) => t.code === code) || { name: code }).name;

// Paint a node with its team's kit colours (CSS custom props consumed by
// styles.css for accent stripes/borders). Purely cosmetic; no engine link.
function applyTeamColors(node, code) {
  const c = TEAM_COLORS[code];
  if (c) {
    node.style.setProperty('--team-1', c.primary);
    node.style.setProperty('--team-2', c.secondary);
  }
  return node;
}

// ----------------------------------------------------------------------------
// playback state (declared early so the mode toggle can pause it)
// ----------------------------------------------------------------------------
const PB_BASE_MS = 500; // ~ one match per 500 ms at 1×
const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let pb = null;            // active playback controller
let currentSeed = 42;
const groupByLetter = {}; // letter -> engine group result
let groupShells = {};     // letter -> { container, tbody, matchesDiv }
let revealedByGroup = {}; // letter -> Set of revealed match indices
let koCardRefs = {};      // knockout match id -> current card node
let koDoneIds = new Set(); // knockout match ids already revealed (for connectors)
let podiumSlots = [];      // 4 podium card nodes (skeleton then filled)
let playingNodes = [];    // nodes currently flagged `.playing`

let currentSim = null;    // the sim being played/shown (source for goal replay)
const koRecById = {};     // knockout match id -> record (for replay lookup)
const colorsOf = (code) => TEAM_COLORS[code] || { primary: '#6f86b8', secondary: '#31405f' };

// Build the replay payload for a knockout record.
function koReplayMatch(rec, stageLabel) {
  const r = rec.result;
  const ca = colorsOf(rec.teamA.code), cb = colorsOf(rec.teamB.code);
  return {
    id: rec.id, stageLabel,
    a: { code: rec.teamA.code, name: rec.teamA.name, c1: ca.primary, c2: ca.secondary },
    b: { code: rec.teamB.code, name: rec.teamB.name, c1: cb.primary, c2: cb.secondary },
    scoreA: r.finalScoreA, scoreB: r.finalScoreB,
    events: r.events || [],
    knockout: true, extraTime: !!r.extraTime, penalties: !!r.penalties, penA: r.penA, penB: r.penB,
  };
}
// Build the replay payload for a group match (m has a,b,scoreA,scoreB,result).
function groupReplayMatch(group, m) {
  const r = m.result;
  const ca = colorsOf(m.a), cb = colorsOf(m.b);
  return {
    id: `G_${group}_${m.a}_${m.b}`, stageLabel: `Group ${group}`,
    a: { code: m.a, name: teamName(m.a), c1: ca.primary, c2: ca.secondary },
    b: { code: m.b, name: teamName(m.b), c1: cb.primary, c2: cb.secondary },
    scoreA: m.scoreA, scoreB: m.scoreB,
    events: (r && r.events) || [],
    knockout: false, extraTime: false, penalties: false,
  };
}

// Pause tournament playback (step 2) when a replay opens, then open it.
function launchReplay(match) {
  if (pb && pb.isPlaying && pb.isPlaying()) pb.pause();
  openReplay(match);
}

// ----------------------------------------------------------------------------
// mode toggle
// ----------------------------------------------------------------------------
const views = { single: $('#view-single'), mc: $('#view-mc'), fasit: $('#view-fasit') };
const modeBtns = { single: $('#mode-single'), mc: $('#mode-mc'), fasit: $('#mode-fasit') };
function setMode(mode) {
  for (const k of Object.keys(views)) {
    views[k].classList.toggle('hidden', k !== mode);
    modeBtns[k].classList.toggle('active', k === mode);
  }
  if (mode !== 'single' && pb) pb.pause(); // don't mutate hidden single-view DOM on a timer
  if (mode === 'fasit') renderFasit();      // lazy: builds once, then cached
}
modeBtns.single.addEventListener('click', () => setMode('single'));
modeBtns.mc.addEventListener('click', () => setMode('mc'));
modeBtns.fasit.addEventListener('click', () => setMode('fasit'));

// ----------------------------------------------------------------------------
// SINGLE TOURNAMENT
// ----------------------------------------------------------------------------

// --- calendar parsing: turn a fixture's date + kickoff into a sortable key ---
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseKickoff(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec((s || '').trim());
  if (!m) return { h: 12, min: 0 };
  let h = (+m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return { h, min: m[2] ? +m[2] : 0 };
}
function chronoKey(fixture) {
  const dm = /([A-Za-z]{3})\s+(\d{1,2})/.exec(fixture.date || '');
  const mon = dm ? MONTHS[dm[1]] : NaN;
  const day = dm ? +dm[2] : NaN;
  const { h, min } = parseKickoff(fixture.kickoff);
  return ((mon * 31 + day) * 24 + h) * 60 + min;
}

// a team name cell with a Code-phase flag hook + highlight class.
// Renders the 3-letter code prominently with the full name muted alongside.
function nameCell(code) {
  const span = el('span', { class: 'codecell', 'data-team': code },
    el('span', { class: 'flag-slot', 'data-flag': code }), // empty hook for flags/canvas
    el('span', { class: 'code', text: code }),
    el('span', { class: 'teamname', text: ' ' + teamName(code) })
  );
  if (HIGHLIGHT.has(code)) span.classList.add('hl');
  return span;
}

const ROUND_TITLES = { R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinals', SF: 'Semifinals', THIRD: '3rd place', FINAL: 'Final' };
// THIRD renders as a trailing column (score + replay like any KO card); the
// bronze/4th TEAMS are additionally shown on the podium.
const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'FINAL', 'THIRD'];

function matchNode(rec) {
  const r = rec.result;
  const sideNode = (team, score, isWinner) => {
    const node = el('div', { class: 'team' + (isWinner ? ' winner' : ''), 'data-team': team.code },
      el('span', { class: 'flag-slot', 'data-flag': team.code }),
      el('span', { class: 'name' },
        el('span', { class: 'code', text: team.code }),
        el('span', { class: 'teamname', text: ' ' + team.name })
      ),
      el('span', { class: 'score', text: String(score) })
    );
    applyTeamColors(node, team.code);
    if (HIGHLIGHT.has(team.code)) node.classList.add('hl');
    return node;
  };
  const aWin = r.winnerSide === 'a';
  const node = el('div', {
    class: 'match',
    'data-match-id': rec.id,
    'data-home': aWin ? r.a : r.b,
  },
    sideNode(rec.teamA, r.finalScoreA, aWin),
    sideNode(rec.teamB, r.finalScoreB, !aWin)
  );
  if (r.penalties) {
    node.append(el('div', { class: 'extra', text: `after ET — penalties ${r.penA}–${r.penB}` }));
  } else if (r.extraTime) {
    node.append(el('div', { class: 'extra', text: `after extra time` }));
  }
  return node;
}

// --- group rendering: a shell built once, repainted as matches reveal --------
function buildGroupShell(g) {
  const tbody = el('tbody');
  const matchesDiv = el('div', { class: 'matches' });
  const container = el('div', { class: 'group', 'data-group': g.group },
    el('div', { class: 'group-head', text: `Group ${g.group}` }),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { text: '#' }),
        el('th', { text: `Group ${g.group}` }),
        el('th', { text: 'P' }), el('th', { text: 'W' }), el('th', { text: 'D' }), el('th', { text: 'L' }),
        el('th', { text: 'GF' }), el('th', { text: 'GA' }), el('th', { text: 'GD' }), el('th', { text: 'Pts' })
      )),
      tbody
    ),
    matchesDiv
  );
  return { container, tbody, matchesDiv };
}

// Standings reflecting exactly the revealed matches. When the group is COMPLETE
// we return the engine's canonical standings verbatim, so the final on-screen
// order is provably identical to engine output (incl. its head-to-head tiebreak).
// Partial states use points→GD→GF with the original seeding order as a stable,
// non-spoiling tiebreak.
function interimStandings(g, revealedSet) {
  if (revealedSet.size === g.matches.length) return g.standings;
  const rows = {};
  for (const r of g.standings) {
    rows[r.code] = { team: r.team, code: r.code, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
  }
  g.matches.forEach((m, idx) => {
    if (!revealedSet.has(idx)) return;
    const A = rows[m.a], B = rows[m.b];
    A.played++; B.played++;
    A.gf += m.scoreA; A.ga += m.scoreB; B.gf += m.scoreB; B.ga += m.scoreA;
    if (m.scoreA > m.scoreB) { A.won++; B.lost++; A.points += 3; }
    else if (m.scoreA < m.scoreB) { B.won++; A.lost++; B.points += 3; }
    else { A.drawn++; B.drawn++; A.points++; B.points++; }
    A.gd = A.gf - A.ga; B.gd = B.gf - B.ga;
  });
  const seed = {};
  (GROUPS[g.group] || []).forEach((c, i) => { seed[c] = i; });
  return Object.values(rows).sort((x, y) =>
    y.points - x.points || y.gd - x.gd || y.gf - x.gf || (seed[x.code] - seed[y.code])
  );
}

function paintGroup(shell, g, revealedSet, playingIdx = -1) {
  const rows = interimStandings(g, revealedSet);
  shell.tbody.replaceChildren();
  rows.forEach((r, i) => {
    const cls = [];
    if (i < 2) cls.push('adv');
    else if (i === 2) cls.push('adv-third');
    const tr = el('tr', { class: cls.join(' '), 'data-team': r.code },
      el('td', { text: String(i + 1) }),
      el('td', {}, nameCell(r.code)),
      el('td', { text: String(r.played) }),
      el('td', { text: String(r.won) }),
      el('td', { text: String(r.drawn) }),
      el('td', { text: String(r.lost) }),
      el('td', { text: String(r.gf) }),
      el('td', { text: String(r.ga) }),
      el('td', { text: (r.gd > 0 ? '+' : '') + r.gd }),
      el('td', { text: String(r.points) })
    );
    applyTeamColors(tr, r.code);
    shell.tbody.append(tr);
  });

  shell.matchesDiv.replaceChildren();
  g.matches.forEach((m, idx) => {
    const played = revealedSet.has(idx);
    const cls = 'm' + (idx === playingIdx ? ' playing' : '') + (played ? '' : ' pending');
    shell.matchesDiv.append(
      el('div', { class: cls, 'data-match': `${m.a}-${m.b}` },
        el('span', { text: `${m.a} v ${m.b}` }),
        el('span', { text: played ? `${m.scoreA}–${m.scoreB}` : '–' })
      )
    );
  });
}

// Full (instant) group render — used by Skip-to-end / reduced-motion.
function renderGroups(sim) {
  const wrap = $('#groups');
  wrap.replaceChildren();
  groupShells = {};
  for (const g of sim.groups) {
    const shell = buildGroupShell(g);
    groupShells[g.group] = shell;
    wrap.append(shell.container);
    paintGroup(shell, g, new Set(g.matches.map((_, i) => i)));
  }
}

// Empty group shells (zeroed tables, all fixtures pending) for playback start.
function buildGroupsSkeleton(sim) {
  const wrap = $('#groups');
  wrap.replaceChildren();
  groupShells = {};
  revealedByGroup = {};
  for (const g of sim.groups) {
    const shell = buildGroupShell(g);
    groupShells[g.group] = shell;
    revealedByGroup[g.group] = new Set();
    wrap.append(shell.container);
    paintGroup(shell, g, revealedByGroup[g.group]);
  }
}

// --- bracket TREE derivation (display-only; reads KNOCKOUT_ROUNDS feeds) ------
//
// The bracket is rendered as a real left→right tree. Display order is DERIVED
// from the winner-feeds in KNOCKOUT_ROUNDS so every next-round card sits between
// its two feeders (no crossing lines), all the way to the final. This touches
// only render order — match ids / data / engine are untouched.
//
// childWinners[id] = [feederId, feederId] for matches fed by winners.
function buildKoTree() {
  const childWinners = {};
  for (const rnd of KNOCKOUT_ROUNDS) {
    for (const m of rnd.matches) {
      const w = [m.a, m.b].filter((s) => s.take === 'winner').map((s) => s.from);
      if (w.length) childWinners[m.id] = w;
    }
  }
  // Order R32 by an in-order (DFS) walk down from the final, so leaves come out
  // already paired and aligned with every ancestor.
  const r32Order = [];
  (function walk(id) {
    const kids = childWinners[id];
    if (!kids) { r32Order.push(id); return; }
    walk(kids[0]);
    walk(kids[1]);
  })('FINAL');
  return { childWinners, r32Order };
}

function blankCard(id) {
  const blankTeam = () => el('div', { class: 'team' },
    el('span', { class: 'flag-slot' }),
    el('span', { class: 'name' }, el('span', { class: 'code', text: '—' }), el('span', { class: 'teamname', text: '' })),
    el('span', { class: 'score', text: '' })
  );
  return el('div', { class: 'match pending', 'data-match-id': id }, blankTeam(), blankTeam());
}

// Lay out one tree column. `recs` is the round's records; `order` is the desired
// top-to-bottom id order for THIS column (derived to align with feeders).
function buildColumn(round, recs, order, cardFor) {
  const byId = {};
  for (const rec of recs) byId[rec.id] = rec;
  const col = el('div', { class: `round r-${round}`, 'data-round': round },
    el('div', { class: 'round-title', text: ROUND_TITLES[round] })
  );
  const slots = el('div', { class: 'round-slots' });
  for (const id of order) {
    const rec = byId[id];
    if (!rec) continue;
    const card = cardFor(rec);
    const cell = el('div', { class: 'tcell', 'data-cell': id }, card);
    slots.append(cell);
  }
  col.append(slots);
  return col;
}

// Compute per-round display order from the R32 order + feed graph, so each
// round's cards line up with the midpoint of their two feeders.
function roundOrders(tree) {
  const orders = { R32: tree.r32Order };
  // For each subsequent round, order by the average index of its feeders in the
  // previous round's order.
  const prevIndex = (order) => { const idx = {}; order.forEach((id, i) => (idx[id] = i)); return idx; };
  let prev = 'R32';
  for (const round of ['R16', 'QF', 'SF', 'FINAL']) {
    const recs = KNOCKOUT_ROUNDS.find((r) => r.round === round).matches;
    const idx = prevIndex(orders[prev]);
    const withKey = recs.map((m) => {
      const feeders = (tree.childWinners[m.id] || []);
      const key = feeders.length ? feeders.reduce((s, f) => s + (idx[f] ?? 0), 0) / feeders.length : 0;
      return { id: m.id, key };
    });
    withKey.sort((a, b) => a.key - b.key);
    orders[round] = withKey.map((x) => x.id);
    prev = round;
  }
  orders.THIRD = ['THIRD']; // single-card trailing column, not part of the tree
  return orders;
}

let koTree = null;
let koOrders = null;
let koTargetY = {};       // analytic vertical center per match id (for connectors)

function buildBracketSkeleton(sim) {
  const wrap = $('#bracket');
  wrap.replaceChildren();
  koCardRefs = {};
  koDoneIds = new Set();
  koTree = buildKoTree();
  koOrders = roundOrders(koTree);
  for (const round of ROUND_ORDER) {
    const recs = sim.knockout.rounds[round];
    const col = buildColumn(round, recs, koOrders[round], (rec) => {
      const card = blankCard(rec.id);
      koCardRefs[rec.id] = card;
      return card;
    });
    wrap.append(col);
  }
  ensureConnectorLayer(wrap);
  requestAnimationFrame(() => layoutTree(wrap));
}

function revealKoCard(rec) {
  const real = matchNode(rec);
  real.classList.add('played', 'revealing');
  if (koCardRefs[rec.id]) koCardRefs[rec.id].replaceWith(real);
  koCardRefs[rec.id] = real;
  koDoneIds.add(rec.id);
  // clear the one-shot reveal flag after the transition
  requestAnimationFrame(() => requestAnimationFrame(() => real.classList.remove('revealing')));
  // Re-center the whole tree (the real card's height differs from the blank one:
  // wrapped names, ET/penalty line). offsetBox reads settled layout, so this is
  // safe to run immediately and keeps the tree aligned exactly like skip-to-end.
  const wrap = $('#bracket');
  if (wrap) layoutTree(wrap);
  // light connectors whose both endpoints are now done, and flag ready parents
  refreshConnectors();
  return real;
}

// Full (instant) bracket render — used by Skip-to-end / reduced-motion.
function renderBracket(sim) {
  const wrap = $('#bracket');
  wrap.replaceChildren();
  koCardRefs = {};
  koDoneIds = new Set(Object.values(sim.knockout.rounds).flat().map((r) => r.id));
  koTree = buildKoTree();
  koOrders = roundOrders(koTree);
  for (const round of ROUND_ORDER) {
    const recs = sim.knockout.rounds[round];
    const col = buildColumn(round, recs, koOrders[round], (rec) => {
      const card = matchNode(rec);
      koCardRefs[rec.id] = card;
      return card;
    });
    wrap.append(col);
  }
  ensureConnectorLayer(wrap);
  requestAnimationFrame(() => { layoutTree(wrap); refreshConnectors(); });
}

// --- connector layer: an SVG sitting behind the cards, lines feeder->parent ---
function ensureConnectorLayer(wrap) {
  let svg = wrap.querySelector('.bracket-links');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bracket-links');
    wrap.prepend(svg);
  }
  return svg;
}

// Settled layout box of an element relative to the bracket wrap's content box.
// Uses offsetTop/Left (which are LAYOUT values, unaffected by CSS transforms),
// so measurements are correct even mid reveal/shift animation — no waiting for
// transitions to settle. Walks the offsetParent chain up to `root`.
function offsetBox(elm, root) {
  let x = 0, y = 0, node = elm, guard = 0;
  while (node && node !== root && guard++ < 30) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return { left: x, top: y, width: elm.offsetWidth, height: elm.offsetHeight };
}

// Vertically center each parent card between its two feeder cards, then draw the
// connector paths. Centers are computed analytically (base layout center +
// propagated midpoint), measured via offsetBox so they reflect SETTLED positions
// — never a mid-transition transformed rect. Runs on build, on every KO reveal,
// and on resize (not per animation frame): ~15 reveals, so it's cheap.
function layoutTree(wrap) {
  if (!koTree) return;
  const svg = ensureConnectorLayer(wrap);
  const cellOf = (id) => wrap.querySelector(`.tcell[data-cell="${id}"]`);

  // size the svg to the scrollable content
  const w = wrap.scrollWidth, h = wrap.scrollHeight;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // base center for every card from the SETTLED layout box. offsetTop ignores the
  // --shift translateY and the ko-reveal transform, so no need to clear shifts.
  const baseCenter = {};
  for (const round of ['R32', 'R16', 'QF', 'SF', 'FINAL']) {
    for (const id of koOrders[round]) {
      const cell = cellOf(id);
      if (!cell) continue;
      const card = cell.querySelector('.match') || cell;
      const box = offsetBox(card, wrap);
      baseCenter[id] = box.top + box.height / 2;
    }
  }

  // target center: R32 stays at base; each parent = midpoint of feeders' targets
  const target = { ...baseCenter };
  for (const round of ['R16', 'QF', 'SF', 'FINAL']) {
    for (const id of koOrders[round]) {
      const feeders = koTree.childWinners[id];
      if (!feeders || feeders.length < 2) continue;
      const t0 = target[feeders[0]], t1 = target[feeders[1]];
      if (t0 == null || t1 == null) continue;
      target[id] = (t0 + t1) / 2;
      const cell = cellOf(id);
      if (cell && baseCenter[id] != null) cell.style.setProperty('--shift', `${target[id] - baseCenter[id]}px`);
    }
  }

  // THIRD-place column: outside the winner tree (no feeders/connectors), so
  // just align its single card vertically with the final's target center.
  const thirdCell = cellOf('THIRD');
  if (thirdCell && target.FINAL != null) {
    const card = thirdCell.querySelector('.match') || thirdCell;
    const box = offsetBox(card, wrap);
    thirdCell.style.setProperty('--shift', `${target.FINAL - (box.top + box.height / 2)}px`);
  }

  koTargetY = target; // cache for connector redraws on reveal
  drawConnectors(svg, wrap, target); // synchronous — offsets are available now
}

// Horizontal edge X of a card's settled layout box, relative to the wrap content
// box (transform-independent, so the ko-reveal translateX can't skew endpoints).
function edgeX(id, side, wrap) {
  const cell = wrap.querySelector(`.tcell[data-cell="${id}"]`);
  if (!cell) return null;
  const card = cell.querySelector('.match') || cell;
  const box = offsetBox(card, wrap);
  return side === 'right' ? box.left + box.width : box.left;
}

function drawConnectors(svg, wrap, target) {
  if (!koTree) return;
  svg.replaceChildren();
  const NS = 'http://www.w3.org/2000/svg';
  for (const round of ['R16', 'QF', 'SF', 'FINAL']) {
    for (const id of koOrders[round]) {
      const feeders = koTree.childWinners[id];
      if (!feeders) continue;
      const px = edgeX(id, 'left', wrap);
      const py = target[id];
      if (px == null || py == null) continue;
      for (const f of feeders) {
        const sx = edgeX(f, 'right', wrap);
        const sy = target[f];
        if (sx == null || sy == null) continue;
        const midX = (sx + px) / 2;
        const d = `M ${sx} ${sy} H ${midX} V ${py} H ${px}`;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'link' + (koDoneIds.has(f) && koDoneIds.has(id) ? ' lit' : (koDoneIds.has(f) ? ' half' : '')));
        path.setAttribute('data-from', f);
        path.setAttribute('data-to', id);
        svg.append(path);
      }
    }
  }
}

// Re-evaluate connector lit/half state + "ready" parent flag after a reveal.
function refreshConnectors() {
  const wrap = $('#bracket');
  const svg = wrap && wrap.querySelector('.bracket-links');
  if (!svg) return;
  for (const path of svg.querySelectorAll('path.link')) {
    const f = path.getAttribute('data-from');
    const to = path.getAttribute('data-to');
    path.classList.toggle('lit', koDoneIds.has(f) && koDoneIds.has(to));
    path.classList.toggle('half', koDoneIds.has(f) && !koDoneIds.has(to));
  }
  // mark a next-round card "ready" once both its feeders are done (and itself not yet played)
  if (koTree) {
    for (const id in koTree.childWinners) {
      const [a, b] = koTree.childWinners[id];
      const card = koCardRefs[id];
      if (!card) continue;
      const ready = koDoneIds.has(a) && koDoneIds.has(b) && !koDoneIds.has(id);
      card.classList.toggle('ready', ready);
    }
  }
}

// --- podium --------------------------------------------------------------
const PODIUM_DEFS = [
  { medal: '🥇', label: 'Champion' },
  { medal: '🥈', label: 'Runner-up' },
  { medal: '🥉', label: 'Third place' },
  { medal: '4️⃣', label: 'Fourth place' },
];

function podiumCard(def, team) {
  const card = el('div', { class: 'pod', 'data-team': team.code },
    el('div', { class: 'medal', text: def.medal }),
    el('div', { class: 'who' },
      el('span', { class: 'code', text: team.code }),
      el('span', { class: 'teamname', text: ' ' + team.name })
    ),
    el('div', { class: 'meta', text: `${def.label} · Elo ${team.elo} · ${team.confederation}` })
  );
  applyTeamColors(card, team.code);
  if (HIGHLIGHT.has(team.code)) card.classList.add('hl');
  return card;
}

function renderPodium(sim) {
  const pod = $('#podium');
  pod.replaceChildren();
  const ko = sim.knockout;
  const teams = [ko.champion, ko.runnerUp, ko.third, ko.fourth];
  PODIUM_DEFS.forEach((def, i) => pod.append(podiumCard(def, teams[i])));
}

function buildPodiumSkeleton() {
  const pod = $('#podium');
  pod.replaceChildren();
  podiumSlots = [];
  for (const def of PODIUM_DEFS) {
    const card = el('div', { class: 'pod pending' },
      el('div', { class: 'medal', text: def.medal }),
      el('div', { class: 'who' }, el('span', { class: 'code', text: '—' })),
      el('div', { class: 'meta', text: def.label })
    );
    podiumSlots.push(card);
    pod.append(card);
  }
}

function fillPodium(idx, team) {
  const card = podiumCard(PODIUM_DEFS[idx], team);
  podiumSlots[idx].replaceWith(card);
  podiumSlots[idx] = card;
}

// --- "now playing" highlight management --------------------------------------
function setPlaying(nodes) {
  for (const n of playingNodes) if (n) n.classList.remove('playing');
  playingNodes = (nodes || []).filter(Boolean);
  for (const n of playingNodes) n.classList.add('playing');
}

// --- ordered event list (group matches chronological, then KO by round) ------
function buildEvents(sim) {
  const ge = [];
  for (const g of sim.groups) for (const m of g.matches) ge.push({ type: 'group', group: g.group, m });
  const keys = ge.map((e) => chronoKey(e.m.fixture));
  const order = ge.map((_, k) => k);
  if (keys.every((k) => Number.isFinite(k))) {
    order.sort((a, b) => keys[a] - keys[b] || a - b); // stable chronological
  } // else: fall back to the engine's per-group order (already chronological)
  const events = order.map((k) => ge[k]);
  for (const round of ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL']) {
    for (const rec of sim.knockout.rounds[round]) events.push({ type: 'ko', round, rec });
  }
  return events;
}

function eventLabel(ev) {
  if (ev.type === 'group') {
    const g = groupByLetter[ev.group];
    const idx = g.matches.indexOf(ev.m);
    return `Matchday ${Math.floor(idx / 2) + 1}`;
  }
  return ROUND_TITLES[ev.round];
}

function revealEvent(ev) {
  if (ev.type === 'group') {
    const g = groupByLetter[ev.group];
    const set = revealedByGroup[ev.group];
    const idx = g.matches.indexOf(ev.m);
    set.add(idx);
    const shell = groupShells[ev.group];
    paintGroup(shell, g, set, idx);
    setPlaying([shell.container, shell.matchesDiv.children[idx]]);
  } else {
    const rec = ev.rec;
    if (ev.round === 'THIRD') {
      const card = revealKoCard(rec);
      fillPodium(2, rec.winner);
      fillPodium(3, rec.loser);
      setPlaying([card, podiumSlots[2], podiumSlots[3]]);
    } else if (ev.round === 'FINAL') {
      const card = revealKoCard(rec);
      fillPodium(0, rec.winner);
      fillPodium(1, rec.loser);
      card.classList.add('crescendo');
      podiumSlots[0].classList.add('crescendo');
      setPlaying([card, podiumSlots[0], podiumSlots[1]]);
    } else {
      setPlaying([revealKoCard(rec)]);
    }
  }
}

function setProgress(i, total, label) {
  const fill = $('#pb-fill');
  if (fill) fill.style.width = (total ? (i / total) * 100 : 0) + '%';
  const lab = $('#pb-label');
  if (lab) lab.textContent = `${label} · ${i} / ${total}`;
}

// --- playback controller: reveals a precomputed sim on a timer ----------------
function createPlayback(sim) {
  const events = buildEvents(sim);
  const total = events.length;
  let i = 0;
  let playing = false;
  let timer = null;
  let speed = 1;

  function finish() {
    playing = false;
    clearTimeout(timer);
    setPlaying([]);
    updatePlayBtn(false, true);
    $('#single-status').textContent = `seed ${sim.seed} · champion ${sim.champion.name}`;
  }
  function step() {
    if (i >= total) return finish();
    const ev = events[i];
    i++;
    revealEvent(ev);
    setProgress(i, total, eventLabel(ev));
    if (i >= total) return finish();
    if (playing) timer = setTimeout(step, PB_BASE_MS / speed);
  }
  return {
    total,
    get index() { return i; },
    isPlaying() { return playing; },
    play() {
      if (i >= total) return;
      playing = true;
      updatePlayBtn(true, false);
      clearTimeout(timer);
      timer = setTimeout(step, PB_BASE_MS / speed);
    },
    pause() {
      playing = false;
      clearTimeout(timer);
      updatePlayBtn(false, false);
    },
    toggle() { if (playing) this.pause(); else this.play(); },
    setSpeed(s) {
      speed = s;
      if (playing) { clearTimeout(timer); timer = setTimeout(step, PB_BASE_MS / speed); }
    },
    skip() {
      playing = false;
      clearTimeout(timer);
      renderFinal(sim);          // canonical instant view (== pre-step-2 output)
      setProgress(total, total, 'Complete');
      setPlaying([]);
      updatePlayBtn(false, true);
      i = total;
    },
    destroy() { playing = false; clearTimeout(timer); },
  };
}

// Render the complete end-state in one shot (the old instant view).
function renderFinal(sim) {
  renderGroups(sim);
  renderBracket(sim);
  renderPodium(sim);
  $('#single-status').textContent = `seed ${sim.seed} · champion ${sim.champion.name}`;
}

const KO_STAGE_LABEL = { R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', THIRD: '3rd place', FINAL: 'Final' };
function indexKnockout(sim) {
  for (const k in koRecById) delete koRecById[k];
  for (const round of ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL']) {
    for (const rec of sim.knockout.rounds[round]) koRecById[rec.id] = { rec, round };
  }
}

function startPlayback(seed) {
  currentSeed = seed;
  closeReplay();
  if (pb) pb.destroy();
  const sim = simulateTournament(seed);
  currentSim = sim;
  for (const g of sim.groups) groupByLetter[g.group] = g;
  indexKnockout(sim);

  buildGroupsSkeleton(sim);
  buildBracketSkeleton(sim);
  buildPodiumSkeleton();

  pb = createPlayback(sim);
  setProgress(0, pb.total, 'Kickoff');

  if (REDUCED_MOTION) {
    pb.skip(); // jump straight to the end-state, no time delay
    return;
  }
  $('#single-status').textContent = `seed ${seed} · playing…`;
  pb.play();
}

// --- playback controls (injected so index.html structure stays declarative) --
function updatePlayBtn(isPlaying, done) {
  const b = $('#pb-play');
  if (!b) return;
  b.textContent = done ? 'Replay' : (isPlaying ? 'Pause' : 'Play');
}

function mountPlaybackControls() {
  if ($('#playbar')) return;
  const speedSeg = el('div', { class: 'seg', id: 'pb-speed' });
  for (const s of [0.5, 1, 2, 4]) {
    const b = el('button', { text: s + '×', 'data-speed': String(s) });
    if (s === 1) b.classList.add('active');
    speedSeg.append(b);
  }
  const bar = el('div', { id: 'playbar', class: 'playbar' },
    el('button', { id: 'pb-play', text: 'Pause' }),
    speedSeg,
    el('button', { id: 'pb-skip', text: 'Skip to end' }),
    el('div', { class: 'pb-progress' }, el('div', { id: 'pb-fill', class: 'fill' })),
    el('span', { id: 'pb-label' })
  );
  $('#view-single .controls').insertAdjacentElement('afterend', bar);

  $('#pb-play').addEventListener('click', () => {
    if (!pb) return;
    if (pb.index >= pb.total) startPlayback(currentSeed); // Replay
    else pb.toggle();
  });
  $('#pb-skip').addEventListener('click', () => { if (pb) pb.skip(); });
  speedSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-speed]');
    if (!b) return;
    for (const x of speedSeg.children) x.classList.remove('active');
    b.classList.add('active');
    if (pb) pb.setSpeed(parseFloat(b.dataset.speed));
  });
}

$('#btn-sim').addEventListener('click', () => startPlayback(parseInt($('#seed').value, 10) || 0));
$('#btn-rand').addEventListener('click', () => {
  const s = Math.floor(Math.random() * 1e9);
  $('#seed').value = s;
  startPlayback(s);
});

// --- goal-replay triggers (delegated; survive re-renders) --------------------
// Bracket card click -> replay, only if the card is revealed (not pending).
$('#bracket').addEventListener('click', (e) => {
  const card = e.target.closest('.match');
  if (!card || card.classList.contains('pending')) return;
  const id = card.getAttribute('data-match-id');
  const entry = id && koRecById[id];
  if (!entry) return;
  launchReplay(koReplayMatch(entry.rec, KO_STAGE_LABEL[entry.round]));
});
// Group match-line click -> replay, only if played (not pending).
$('#groups').addEventListener('click', (e) => {
  const line = e.target.closest('.matches .m');
  if (!line || line.classList.contains('pending')) return;
  const groupEl = line.closest('.group');
  const group = groupEl && groupEl.getAttribute('data-group');
  const g = group && groupByLetter[group];
  if (!g) return;
  const pair = line.getAttribute('data-match'); // "A-B" codes
  const m = g.matches.find((x) => `${x.a}-${x.b}` === pair);
  if (m) launchReplay(groupReplayMatch(group, m));
});

// keep the bracket tree aligned + connectors redrawn on viewport changes
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const wrap = $('#bracket');
    if (wrap && koTree) layoutTree(wrap);
  });
});

// ----------------------------------------------------------------------------
// MONTE CARLO  (unchanged — aggregate only, no playback)
// ----------------------------------------------------------------------------
const MC_COLS = [
  { key: 'code', label: 'Team', kind: 'code' },
  { key: 'elo', label: 'Elo', kind: 'elo' },
  { key: 'winGroup', label: 'Win grp', kind: 'pct' },
  { key: 'reachR16', label: 'R16', kind: 'pct' },
  { key: 'reachQF', label: 'QF', kind: 'pct' },
  { key: 'reachSF', label: 'SF', kind: 'pct' },
  { key: 'reachFinal', label: 'Final', kind: 'pct' },
  { key: 'champion', label: 'Win cup', kind: 'pct' },
];
let mcData = null;
let mcSortKey = 'champion';

function renderMcTable() {
  if (!mcData) return;
  const thead = $('#mc-table thead');
  const tbody = $('#mc-table tbody');
  thead.replaceChildren();
  tbody.replaceChildren();

  const headRow = el('tr');
  for (const c of MC_COLS) {
    const th = el('th', { text: c.label, 'data-key': c.key });
    if (c.key === mcSortKey) th.classList.add('sorted');
    if (c.kind !== 'code') {
      th.addEventListener('click', () => { mcSortKey = c.key; renderMcTable(); });
    }
    headRow.append(th);
  }
  thead.append(headRow);

  const rows = TEAMS.map((t) => ({ team: t, p: mcData[t.code] }));
  rows.sort((a, b) => {
    // 'code' is never a sort key: the Team column header gets no click handler.
    if (mcSortKey === 'elo') return b.team.elo - a.team.elo;
    return b.p[mcSortKey] - a.p[mcSortKey];
  });

  const pct = (x) => (x * 100).toFixed(1) + '%';
  for (const { team, p } of rows) {
    const tr = el('tr', { 'data-team': team.code });
    for (const c of MC_COLS) {
      if (c.kind === 'code') {
        const td = el('td', {}, nameCell(team.code));
        td.style.textAlign = 'left';
        tr.append(td);
      } else if (c.kind === 'elo') {
        tr.append(el('td', { text: String(team.elo) }));
      } else {
        const v = p[c.key];
        const td = el('td', { class: 'bar' });
        td.append(el('div', { class: 'barfill', style: `width:${Math.min(100, v * 100)}%` }));
        td.append(el('span', { text: pct(v) }));
        tr.append(td);
      }
    }
    applyTeamColors(tr, team.code);
    if (HIGHLIGHT.has(team.code)) tr.classList.add('hl');
    tbody.append(tr);
  }
}

$('#btn-mc').addEventListener('click', () => {
  const n = Math.max(1, parseInt($('#mc-n').value, 10) || 10000);
  const status = $('#mc-status');
  status.textContent = `running ${n.toLocaleString()} tournaments…`;
  // let the status paint before the (synchronous) crunch
  setTimeout(() => {
    const t0 = performance.now();
    mcData = monteCarlo(n, 1);
    const ms = performance.now() - t0;
    status.textContent = `${n.toLocaleString()} runs in ${(ms / 1000).toFixed(2)} s (${(ms / n).toFixed(2)} ms/run)`;
    renderMcTable();
  }, 20);
});

// ----------------------------------------------------------------------------
// REALITY CHECK — the frozen pre-tournament model graded against the actual 2026
// results. Per-match scoring + calibration are instant (analytic); the title-odds
// forecast reuses the forward Monte Carlo (deterministic monteCarlo(10000, 1),
// exactly what the Monte Carlo tab produces). Built once, then cached.
// Editorial rule (2026-08-19): plain words first — every number is explained in
// football terms where it appears; the exact formulas live one click away in
// <details class="nerd"> “stats corner” boxes. Same numbers, no degree required.
// ----------------------------------------------------------------------------
const pctF = (x, d = 1) => (x * 100).toFixed(d) + '%';
const pct0 = (x) => Math.round(x * 100) + '%';
const num3 = (x) => x.toFixed(3);
const NS_SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS_SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

let fasitBuilt = false;
let fasitMc = null; // cached monteCarlo(10000, 1)

// Section wrapper with an editorial h2 (reuses global heading style).
function fasitSection(title, ...kids) {
  return el('section', { class: 'fasit-block' }, el('h2', { text: title }), ...kids);
}

// Collapsible “stats corner” — the exact numbers and formulas, one click away.
function nerdBox(label, ...kids) {
  return el('details', { class: 'nerd' },
    el('summary', {}, el('span', { class: 'nerd-tag', text: 'Stats corner' }), label),
    el('div', { class: 'nerd-body' }, ...kids)
  );
}

// --- the short version: the whole verdict in three plain sentences -----------
function takeawaySection(bt) {
  const skillAll = 1 - bt.perMatch.all.rps / bt.baseline.all.rps;
  const drawPred = bt.rows.reduce((s, r) => s + r.p[1], 0) / bt.rows.length;
  const drawObs = bt.rows.filter((r) => r.o === 1).length / bt.rows.length;
  const hot = bt.calibration.group[8]; // group-stage forecasts rated 80–90% likely
  const item = (mark, cls, ...body) => el('div', { class: 'take ' + cls },
    el('span', { class: 'take-mark', text: mark }), el('p', {}, ...body));
  return fasitSection('The short version',
    item('✓', 'good', el('strong', { text: 'It named the right teams. ' }),
      'Before a ball was kicked, its four most likely champions — Spain, Argentina, France and England — turned out to be the exact four semifinalists. Its top two were the finalists. Its #1 pick, Spain, lifted the cup.'),
    item('✓', 'good', el('strong', { text: 'Match by match, it clearly beat guessing. ' }),
      `Across all 104 games its win/draw/loss forecasts sat about ${pct0(skillAll)} of the way from blind guessing to a perfect crystal ball — sharpest in the knockouts, where the gaps between teams are widest.`),
    item('⚠', 'warn', el('strong', { text: 'It has two honest weaknesses. ' }),
      `It was too sure of big favourites (group-stage results it rated ~${pct0(hot.pred)} likely happened only ~${pct0(hot.obs)} of the time), and it under-called draws (expected ${pct0(drawPred)} of matches, reality served ${pct0(drawObs)}). Both are laid out below.`)
  );
}

// --- ordinal verdict: did the model call the right teams? --------------------
function verdictCard(icon, label, model, real, hit) {
  return el('div', { class: 'verdict' + (hit ? ' hit' : ' miss') },
    el('div', { class: 'v-top' }, el('span', { class: 'v-icon', text: icon }), el('span', { class: 'v-check', text: hit ? '✓' : '✗' })),
    el('div', { class: 'v-label', text: label }),
    el('div', { class: 'v-detail' },
      el('div', {}, el('span', { class: 'v-tag', text: 'model' }), ' ', model),
      el('div', {}, el('span', { class: 'v-tag', text: 'actual' }), ' ', real)
    )
  );
}

// --- title-odds table + market benchmark -------------------------------------
const RESULT_TAG = { ESP: '🥇 champion', ARG: '🥈 finalist', FRA: 'semifinal', ENG: 'semifinal' };
function championSection(rep) {
  // odds table (top 8)
  const table = el('table', { id: 'fasit-champ' });
  const thead = el('thead', {}, el('tr', {},
    el('th', { text: 'Team' }), el('th', { text: 'Title odds' }),
    el('th', { text: 'Reach final' }), el('th', { text: 'Reach SF' }), el('th', { text: 'Actual' })
  ));
  const tbody = el('tbody');
  for (const c of rep.top) {
    const td = el('td', { class: 'bar' },
      el('div', { class: 'barfill', style: `width:${Math.min(100, (c.champion / rep.top[0].champion) * 100)}%` }),
      el('span', { text: pctF(c.champion) })
    );
    const tr = el('tr', { 'data-team': c.code },
      (() => { const t = el('td', {}, nameCell(c.code)); t.style.textAlign = 'left'; return t; })(),
      td,
      el('td', { text: pctF(c.reachFinal) }),
      el('td', { text: pctF(c.reachSF) }),
      (() => { const t = el('td', { class: 'res-tag', text: RESULT_TAG[c.code] || '—' }); t.style.textAlign = 'left'; return t; })()
    );
    applyTeamColors(tr, c.code);
    if (HIGHLIGHT.has(c.code)) tr.classList.add('hl');
    if (RESULT_TAG[c.code] === '🥇 champion') tr.classList.add('champ-row');
    tbody.append(tr);
  }
  table.append(thead, tbody);

  // market benchmark on Spain, in plain sight; the log-loss maths one click down
  const bench = el('div', { class: 'benchbox' },
    el('div', { class: 'benchrow' },
      el('span', { class: 'benchlab', text: "Spain's title odds" }),
      el('span', { class: 'benchval gold', text: `model ${pctF(rep.spain)}` }),
      el('span', { class: 'benchval', text: `Opta ${pctF(rep.benchmark.opta)}` }),
      el('span', { class: 'benchval', text: `Groll/Zeileis/Hvattum ${pctF(rep.benchmark.gzh)}` }),
      el('span', { class: 'sub', text: '· the pros said roughly 1-in-6; the model more than doubled that' })
    )
  );
  const caveat = el('p', { class: 'caveat' },
    'Before the model takes a victory lap: it “beats” the pros here only because it bet hardest on Spain — and Spain happened to win. ',
    'That 37% was genuinely over-confident, as the favourites check further down shows. The stronger evidence is the order it got right: the champion, both finalists, all four semifinalists.'
  );
  const nerd = nerdBox('champion log-loss vs the market',
    el('p', {},
      `One-number version of the same comparison — score −ln(chance given to the actual champion), lower is better: model ${num3(rep.championLL.model)} · Opta ${num3(rep.championLL.opta)} · GZH ${num3(rep.championLL.gzh)}. `,
      'One tournament is a single sample, and this score mostly rewards whoever bet biggest on the team that happened to win — which is exactly why the caveat above matters.'
    )
  );
  return fasitSection('Title odds vs the market', table, bench, caveat, nerd);
}

// --- per-match quality: skill bars up front, exact scoring one click away ----
function perMatchSection(bt) {
  const seg = [
    { key: 'all', label: 'All 104 matches' },
    { key: 'group', label: 'Group stage (72)' },
    { key: 'ko', label: 'Knockout (32)' },
  ];
  // Skill = how far from blind guessing towards a perfect forecast, by RPS.
  const skill = (k) => 1 - bt.perMatch[k].rps / bt.baseline[k].rps;
  const bars = el('div', { class: 'skillbars' }, ...seg.map((s) => {
    const v = skill(s.key);
    return el('div', { class: 'skillrow' },
      el('span', { class: 'skill-lab', text: s.label }),
      el('div', { class: 'skill-track' }, el('div', { class: 'skill-fill', style: `width:${(v * 100).toFixed(1)}%` })),
      el('span', { class: 'skill-val', text: pct0(v) })
    );
  }));
  const scale = el('div', { class: 'skill-scale' },
    el('span', { text: '0% = blind guessing (1⁄3 win, 1⁄3 draw, 1⁄3 loss — every match)' }),
    el('span', { text: '100% = called every result perfectly' })
  );
  const favLine = el('p', { class: 'note' },
    'Before every match the model published a win/draw/loss probability (same Elo→Poisson core the simulator runs on, at the real venue), scored against the 90-minute result. The simplest yardstick: the side it favoured won ',
    el('strong', { text: pctF(bt.perMatch.all.favHit) }),
    ' of the 104 matches, with draws counted as misses. Football is low-scoring chaos — nobody calls them all; what matters is being reliably closer than guessing, which is what the bars measure.'
  );
  const metricCell = (model, base) => el('td', { class: 'metric' },
    el('span', { class: 'm-model', text: num3(model) }),
    el('span', { class: 'm-base', text: `unif ${num3(base)}` })
  );
  const table = el('table', { id: 'fasit-metrics' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'Segment' }), el('th', { text: 'RPS' }), el('th', { text: 'Brier' }),
      el('th', { text: 'Log-loss' }), el('th', { text: 'Favourite hit' })
    )),
    el('tbody', {}, ...seg.map((s) => {
      const m = bt.perMatch[s.key], b = bt.baseline[s.key];
      const first = el('td', { text: s.label }); first.style.textAlign = 'left';
      return el('tr', {}, first, metricCell(m.rps, b.rps), metricCell(m.brier, b.brier), metricCell(m.logloss, b.logloss),
        el('td', {}, el('span', { class: 'm-model', text: pctF(m.favHit) })));
    }))
  );
  const nerd = nerdBox('exact scores — RPS, Brier, log-loss',
    table,
    el('p', {},
      'All three grade the full probability forecast against the result, and all are lower-is-better; the muted number under each is blind guessing (1⁄3, 1⁄3, 1⁄3) on the same matches. ',
      el('strong', { text: 'RPS' }),
      ' (ranked probability score, the standard in football forecasting) charges more the further the forecast lands from the result — saying “home win” before a draw costs less than saying it before an away win. ',
      el('strong', { text: 'Brier' }), ' is the same idea without that ordering; ',
      el('strong', { text: 'log-loss' }),
      ' punishes confident misses hardest. The skill bars above are 1 − RPS ÷ RPS(guessing).'
    )
  );
  return fasitSection('Match by match: how much better than guessing?', bars, scale, favLine, nerd);
}

// --- the shock list: honest about exactly where it was most wrong ------------
function shockSection(bt) {
  const stageLbl = (r) => (r.stage === 'group' ? `Group ${r.grp}` : r.round);
  const shocks = [...bt.rows].sort((a, b) => b.surprise - a.surprise).slice(0, 5);
  const table = el('table', { id: 'fasit-shocks' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'Result (90′)' }), el('th', { text: 'Stage' }),
      el('th', { text: 'Model said' }), el('th', { text: 'Chance it gave this' })
    )),
    el('tbody', {}, ...shocks.map((r) => {
      const favIsA = r.p[0] >= r.p[2];
      const match = el('td', { class: 'shock-match' },
        nameCell(r.a), el('span', { class: 'shock-score', text: ` ${r.ft[0]}–${r.ft[1]} ` }), nameCell(r.b));
      match.style.textAlign = 'left';
      const said = el('td', { class: 'shock-said', text: `${teamName(favIsA ? r.a : r.b)} win — ${pct0(r.favProb)}` });
      said.style.textAlign = 'left';
      return el('tr', {}, match, el('td', { class: 'shock-stage', text: stageLbl(r) }), said,
        el('td', {}, el('span', { class: 'shock-p', text: pctF(r.p[r.o]) })));
    }))
  );
  const safest = [...bt.rows].sort((a, b) => b.p[b.o] - a.p[a.o])[0];
  const note = el('p', { class: 'note' },
    `Everything is scored on the 90-minute result, so a shock draw counts even when the favourite went through afterwards. At the other end of the list, its safest call that landed: ${teamName(safest.a)} ${safest.ft[0]}–${safest.ft[1]} ${teamName(safest.b)} — it gave that ${pct0(safest.p[safest.o])}.`
  );
  return fasitSection('The five results that shocked it most', table, note);
}

// --- the draw blind spot ------------------------------------------------------
function drawSection(bt) {
  const pred = bt.rows.reduce((s, r) => s + r.p[1], 0) / bt.rows.length;
  const nObs = bt.rows.filter((r) => r.o === 1).length;
  const obs = nObs / bt.rows.length;
  const box = el('div', { class: 'drawbox' },
    el('div', { class: 'draw-stat' },
      el('span', { class: 'draw-big', text: pct0(pred) }),
      el('span', { class: 'draw-lab', text: 'of matches expected level after 90 minutes' })),
    el('span', { class: 'draw-vs', text: 'vs' }),
    el('div', { class: 'draw-stat' },
      el('span', { class: 'draw-big', text: pct0(obs) }),
      el('span', { class: 'draw-lab', text: `actually were (${nObs} of ${bt.rows.length})` }))
  );
  const note = el('p', { class: 'note' },
    `Why: the engine rolls each team's goals independently, and that simplification quietly under-rates tight, cagey stalemates. The standard fix (a Dixon–Coles low-score correction) sits in the engine as a deliberately empty, documented hook — the model was frozen before kickoff, and it stays honest rather than quietly patched afterwards.`
  );
  return fasitSection('The blind spot: draws', box, note);
}

// --- calibration (reliability) chart ------------------------------------------
function calibChart(bt) {
  const W = 560, H = 340, pad = { l: 52, r: 16, t: 14, b: 44 };
  const px = (v) => pad.l + v * (W - pad.l - pad.r);
  const py = (v) => H - pad.b - v * (H - pad.t - pad.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'calib-svg', preserveAspectRatio: 'xMidYMid meet' });

  // grid + axes
  for (let g = 0; g <= 4; g++) {
    const t = g / 4;
    root.append(svg('line', { x1: px(t), y1: py(0), x2: px(t), y2: py(1), class: 'calib-grid' }));
    root.append(svg('line', { x1: px(0), y1: py(t), x2: px(1), y2: py(t), class: 'calib-grid' }));
    root.append(svg('text', { x: px(t), y: H - pad.b + 16, class: 'calib-axtext', 'text-anchor': 'middle' }, `${t * 100}%`));
    root.append(svg('text', { x: pad.l - 8, y: py(t) + 3, class: 'calib-axtext', 'text-anchor': 'end' }, `${t * 100}%`));
  }
  // perfect-calibration diagonal
  root.append(svg('line', { x1: px(0), y1: py(0), x2: px(1), y2: py(1), class: 'calib-diag' }));
  // axis labels
  root.append(svg('text', { x: px(0.5), y: H - 6, class: 'calib-axlab', 'text-anchor': 'middle' }, 'What the model said'));
  root.append(svg('text', { x: 14, y: py(0.5), class: 'calib-axlab', 'text-anchor': 'middle', transform: `rotate(-90 14 ${py(0.5)})` }, 'How often it happened'));

  const series = [
    { key: 'group', cls: 'group', label: 'Group stage' },
    { key: 'ko', cls: 'ko', label: 'Knockout' },
  ];
  for (const s of series) {
    const pts = bt.calibration[s.key].filter((b) => b.n > 0);
    // reliability line through the points
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${px(p.pred).toFixed(1)} ${py(p.obs).toFixed(1)}`).join(' ');
      root.append(svg('path', { d, class: `calib-line ${s.cls}` }));
    }
    for (const p of pts) {
      root.append(svg('circle', { cx: px(p.pred), cy: py(p.obs), r: Math.max(3, Math.sqrt(p.n) * 1.6), class: `calib-dot ${s.cls}` }));
    }
  }
  // legend
  const leg = el('div', { class: 'calib-legend' },
    el('span', { class: 'lg group' }, el('span', { class: 'lg-dot' }), 'Group stage'),
    el('span', { class: 'lg ko' }, el('span', { class: 'lg-dot' }), 'Knockout'),
    el('span', { class: 'lg diag' }, el('span', { class: 'lg-line' }), 'Perfect calibration')
  );
  const howto = el('p', { class: 'note' },
    'An honest forecaster is right exactly as often as it claims: of all the things it calls “80% likely”, about 80% should actually happen. Every dot below checks that — across is what the model said, up is how often it came true, and a bigger dot means more forecasts in that bucket. ',
    el('strong', { text: 'On the dashed line = honest confidence. Below it = over-confident. Above it = under-confident.' })
  );
  const note = el('p', { class: 'note' },
    'The group-stage dots sag under the line on the right: results the model rated ~86% likely landed only ~63% of the time — the same over-confidence as that bold 37% on Spain. The knockout dots hug the line: there, its confidence was honest. ',
    el('em', { text: 'One tournament is a small sample — read the shape, not any single dot.' })
  );
  return fasitSection('When it said 80%, did 80% happen?', howto, el('div', { class: 'calib-wrap' }, root), leg, note);
}

// Fill the two MC-dependent sections once the Monte Carlo is ready.
function fillChampionSections(rep) {
  const ord = $('#fasit-ordinal');
  if (ord) {
    ord.replaceChildren(
      verdictCard('🏆', 'Champion', 'Spain ranked #1 by title odds', 'Spain won', rep.hits.champion),
      verdictCard('🥇🥈', 'Both finalists', 'top-2 odds: Spain, Argentina', 'final: Spain–Argentina', rep.hits.finalists),
      verdictCard('4️⃣', 'All four semifinalists', 'top-4 odds: ESP, ARG, FRA, ENG', 'semis: ESP, ARG, FRA, ENG', rep.hits.semifinalists)
    );
  }
  const champ = $('#fasit-champ-slot');
  if (champ) champ.replaceChildren(championSection(rep));
}

function renderFasit() {
  if (fasitBuilt) return;
  const body = $('#fasit-body');
  const bt = computeBacktest();

  const ordinal = fasitSection('Did it call the right teams?',
    el('div', { id: 'fasit-ordinal', class: 'verdict-row' },
      el('div', { class: 'verdict pending', text: 'computing title odds…' }))
  );
  const champSlot = el('div', { id: 'fasit-champ-slot' },
    el('p', { class: 'note', text: 'Replaying the tournament 10 000 times for the title odds…' }));

  body.replaceChildren(takeawaySection(bt), ordinal, champSlot, shockSection(bt), perMatchSection(bt), drawSection(bt), calibChart(bt));
  fasitBuilt = true;

  // reuse the forward MC (deterministic, seed base 1) for the title odds
  if (fasitMc) { fillChampionSections(championReport(fasitMc)); return; }
  setTimeout(() => {
    fasitMc = monteCarlo(10000, 1);
    fillChampionSections(championReport(fasitMc));
  }, 20);
}

// ----------------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------------
mountPlaybackControls();
$('#engine-tag').textContent = `${TEAMS.length} teams · ${GROUP_LETTERS.length} groups · seeded engine`;
startPlayback(42); // plays out by default (no instant dump)
