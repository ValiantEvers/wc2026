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
const views = { single: $('#view-single'), mc: $('#view-mc') };
const modeBtns = { single: $('#mode-single'), mc: $('#mode-mc') };
function setMode(mode) {
  for (const k of Object.keys(views)) {
    views[k].classList.toggle('hidden', k !== mode);
    modeBtns[k].classList.toggle('active', k === mode);
  }
  if (mode === 'mc' && pb) pb.pause(); // don't mutate hidden DOM on a timer
}
modeBtns.single.addEventListener('click', () => setMode('single'));
modeBtns.mc.addEventListener('click', () => setMode('mc'));

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
const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'FINAL']; // THIRD shown with the podium

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
  const round16Ids = KNOCKOUT_ROUNDS.find((r) => r.round === 'R16').matches.map((m) => m.id);
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
  void round16Ids;
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

// Vertically center each parent card between its two feeder cards, then draw the
// connector paths. We compute target centers analytically (base unshifted center
// + intended shift), propagating round by round, so a parent centers on its
// feeders' INTENDED positions — not on a mid-transition transformed rect. Pure
// transform/positioning; runs on build + resize, not on the per-match timer.
function layoutTree(wrap) {
  if (!koTree) return;
  const svg = ensureConnectorLayer(wrap);
  const wrapRect = wrap.getBoundingClientRect();
  const cellOf = (id) => wrap.querySelector(`.tcell[data-cell="${id}"]`);

  // size the svg to the scrollable content
  const w = wrap.scrollWidth, h = wrap.scrollHeight;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // base (unshifted) center for every card: clear shifts first so reads are clean
  for (const round of ['R16', 'QF', 'SF', 'FINAL']) {
    for (const id of koOrders[round]) {
      const cell = cellOf(id);
      if (cell) cell.style.setProperty('--shift', '0px');
    }
  }
  const baseCenter = {};
  const allRounds = ['R32', 'R16', 'QF', 'SF', 'FINAL'];
  for (const round of allRounds) {
    for (const id of koOrders[round]) {
      const cell = cellOf(id);
      if (!cell) continue;
      const card = cell.querySelector('.match') || cell;
      const r = card.getBoundingClientRect();
      baseCenter[id] = r.top - wrapRect.top + wrap.scrollTop + r.height / 2;
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

  koTargetY = target; // cache for connector redraws on reveal
  requestAnimationFrame(() => drawConnectors(svg, wrap, wrapRect, target));
}

// Horizontal edges from a card's column box (X is stable — only Y transitions,
// and we take Y from the analytic `target` map so paths are exact immediately).
function edgeX(id, side, wrap, wrapRect) {
  const cell = wrap.querySelector(`.tcell[data-cell="${id}"]`);
  if (!cell) return null;
  const card = cell.querySelector('.match') || cell;
  const r = card.getBoundingClientRect();
  return (side === 'right' ? r.right : r.left) - wrapRect.left + wrap.scrollLeft;
}

function drawConnectors(svg, wrap, wrapRect, target) {
  if (!koTree) return;
  svg.replaceChildren();
  const NS = 'http://www.w3.org/2000/svg';
  for (const round of ['R16', 'QF', 'SF', 'FINAL']) {
    for (const id of koOrders[round]) {
      const feeders = koTree.childWinners[id];
      if (!feeders) continue;
      const px = edgeX(id, 'left', wrap, wrapRect);
      const py = target[id];
      if (px == null || py == null) continue;
      for (const f of feeders) {
        const sx = edgeX(f, 'right', wrap, wrapRect);
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
      fillPodium(2, rec.winner);
      fillPodium(3, rec.loser);
      setPlaying([podiumSlots[2], podiumSlots[3]]);
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
    if (mcSortKey === 'code') return a.team.code < b.team.code ? -1 : 1;
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
// boot
// ----------------------------------------------------------------------------
mountPlaybackControls();
$('#engine-tag').textContent = `${TEAMS.length} teams · ${GROUP_LETTERS.length} groups · seeded engine`;
startPlayback(42); // plays out by default (no instant dump)
