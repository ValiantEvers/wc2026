// =============================================================================
// ui.js — raw UI for the World Cup 2026 simulator (Cowork phase).
//
// Reads ONLY the engine's public API + data. The engine has no idea the UI
// exists. Every match node is rendered with data-* attributes and an empty
// `.flag-slot` so the later Code phase can attach flags / canvas / 2D goal
// replay WITHOUT touching engine.js.
//
// Norway (NOR) and Belgium (BEL) are visually highlighted only — no boost.
// =============================================================================

import { TEAMS, GROUP_MATCHES, GROUP_LETTERS } from './data.js';
import { simulateTournament, monteCarlo } from './engine.js';
import { TEAM_COLORS } from './colors.js';

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
// mode toggle
// ----------------------------------------------------------------------------
const views = { single: $('#view-single'), mc: $('#view-mc') };
const modeBtns = { single: $('#mode-single'), mc: $('#mode-mc') };
function setMode(mode) {
  for (const k of Object.keys(views)) {
    views[k].classList.toggle('hidden', k !== mode);
    modeBtns[k].classList.toggle('active', k === mode);
  }
}
modeBtns.single.addEventListener('click', () => setMode('single'));
modeBtns.mc.addEventListener('click', () => setMode('mc'));

// ----------------------------------------------------------------------------
// SINGLE TOURNAMENT
// ----------------------------------------------------------------------------
function renderGroups(sim) {
  const wrap = $('#groups');
  wrap.replaceChildren();

  for (const g of sim.groups) {
    const fixtures = GROUP_MATCHES.filter((m) => m.group === g.group);

    const thead = el('tr', {},
      el('th', { text: '#' }),
      el('th', { text: `Group ${g.group}` }),
      el('th', { text: 'P' }), el('th', { text: 'W' }), el('th', { text: 'D' }), el('th', { text: 'L' }),
      el('th', { text: 'GF' }), el('th', { text: 'GA' }), el('th', { text: 'GD' }), el('th', { text: 'Pts' })
    );

    const tbody = el('tbody');
    g.standings.forEach((r, i) => {
      const cls = [];
      if (i < 2) cls.push('adv');
      else if (i === 2) cls.push('adv-third');
      const row = el('tr', { class: cls.join(' '), 'data-team': r.code },
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
      applyTeamColors(row, r.code);
      tbody.append(row);
    });

    const matchList = el('div', { class: 'matches' });
    for (const m of g.matches) {
      matchList.append(
        el('div', { class: 'm', 'data-match': `${m.a}-${m.b}` },
          el('span', { text: `${m.a} v ${m.b}` }),
          el('span', { text: `${m.scoreA}–${m.scoreB}` })
        )
      );
    }

    wrap.append(
      el('div', { class: 'group', 'data-group': g.group },
        el('div', { class: 'group-head', text: `Group ${g.group}` }),
        el('table', {}, el('thead', {}, thead), tbody),
        matchList
      )
    );
  }
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

function renderBracket(sim) {
  const wrap = $('#bracket');
  wrap.replaceChildren();
  for (const round of ROUND_ORDER) {
    const recs = sim.knockout.rounds[round];
    const col = el('div', { class: `round r-${round}`, 'data-round': round },
      el('div', { class: 'round-title', text: ROUND_TITLES[round] })
    );
    for (const rec of recs) col.append(matchNode(rec));
    wrap.append(col);
  }
}

function renderPodium(sim) {
  const pod = $('#podium');
  pod.replaceChildren();
  const ko = sim.knockout;
  const entries = [
    { medal: '🥇', label: 'Champion', team: ko.champion },
    { medal: '🥈', label: 'Runner-up', team: ko.runnerUp },
    { medal: '🥉', label: 'Third place', team: ko.third },
    { medal: '4️⃣', label: 'Fourth place', team: ko.fourth },
  ];
  for (const e of entries) {
    const card = el('div', { class: 'pod', 'data-team': e.team.code },
      el('div', { class: 'medal', text: e.medal }),
      el('div', { class: 'who' },
        el('span', { class: 'code', text: e.team.code }),
        el('span', { class: 'teamname', text: ' ' + e.team.name })
      ),
      el('div', { class: 'meta', text: `${e.label} · Elo ${e.team.elo} · ${e.team.confederation}` })
    );
    applyTeamColors(card, e.team.code);
    if (HIGHLIGHT.has(e.team.code)) card.classList.add('hl');
    pod.append(card);
  }
}

function runSingle(seed) {
  const t0 = performance.now();
  const sim = simulateTournament(seed);
  renderGroups(sim);
  renderBracket(sim);
  renderPodium(sim);
  const ms = (performance.now() - t0).toFixed(1);
  $('#single-status').textContent = `seed ${seed} · champion ${sim.champion.name} · ${ms} ms`;
}

$('#btn-sim').addEventListener('click', () => runSingle(parseInt($('#seed').value, 10) || 0));
$('#btn-rand').addEventListener('click', () => {
  const s = Math.floor(Math.random() * 1e9);
  $('#seed').value = s;
  runSingle(s);
});

// ----------------------------------------------------------------------------
// MONTE CARLO
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
$('#engine-tag').textContent = `${TEAMS.length} teams · ${GROUP_LETTERS.length} groups · seeded engine`;
runSingle(42); // show something immediately
