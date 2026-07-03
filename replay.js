// =============================================================================
// replay.js — 2D goal replay (Code phase step 4). UI-ONLY, additive.
//
// Reads a precomputed match result's event stream (result.events: array of
// { side:'a'|'b', team:<code>, minute }) plus knockout extras (extraTime,
// penalties, penA, penB). Draws a top-down 2D pitch on a canvas and plays the
// goals out minute-by-minute, with a clock, timeline, and scoreboard that land
// on the exact final score. Nothing here touches engine.js / data.js.
//
// Determinism: all positional "flourishes" derive from a seed built from the
// match id + goal minute (mulberry32-style), so the same match always replays
// identically. Penalties are synthesised into a scored/missed sequence that
// sums EXACTLY to penA–penB.
//
// The canvas loop runs ONLY while the modal is open; close() cancels it.
// =============================================================================

const NS_BG = '#070b16';
let active = null; // single live replay controller

// small seedable RNG (local copy — engine.js is off-limits and UI-only anyway)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// hex "#rrggbb" → "rgba(r,g,b,alpha)" — tints the net ripple in the scoring team's kit colour
function teamRgba(hex, alpha) {
  const n = parseInt(String(hex || '#ffffff').slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEEDS = [0.5, 1, 2, 4];
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') n.className = props[k];
    else if (k === 'text') n.textContent = props[k];
    else if (k === 'role' || k.startsWith('aria-') || k.startsWith('data-')) n.setAttribute(k, props[k]);
    else n[k] = props[k];
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

// Synthesise a deterministic penalty sequence that sums to penA / penB.
// Standard order A,B,A,B,... best-of-5 then sudden death. Marks which kicks
// score so the tally lands exactly on (penA, penB).
function buildPenalties(penA, penB, rng) {
  // total kicks per side = at least 5, or more if sudden death was needed.
  const kicksPerSide = Math.max(5, penA, penB);
  // distribute `made` scores across kicks deterministically (front-load misses
  // pseudo-randomly but reproducibly). Build per-side boolean arrays.
  const makeSide = (made, kicks) => {
    const arr = new Array(kicks).fill(false);
    // choose which kicks are scored: spread using rng but exactly `made` true
    const idx = [...Array(kicks).keys()];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let i = 0; i < made; i++) arr[idx[i]] = true;
    return arr;
  };
  const a = makeSide(penA, kicksPerSide);
  const b = makeSide(penB, kicksPerSide);
  // interleave A,B,A,B
  const seq = [];
  for (let i = 0; i < kicksPerSide; i++) {
    seq.push({ side: 'a', made: a[i] });
    seq.push({ side: 'b', made: b[i] });
  }
  return seq;
}

// ---------------------------------------------------------------------------
// Public entry: openReplay(match)
//   match = {
//     id, a:{code,name,c1,c2}, b:{code,name,c1,c2},
//     scoreA, scoreB, events:[{side,team,minute}],
//     knockout, extraTime, penalties, penA, penB
//   }
// ---------------------------------------------------------------------------
export function openReplay(match) {
  closeReplay(); // only one at a time
  const prevFocus = document.activeElement; // restore on close (a11y)

  const seedBase = seedFrom(match.id || `${match.a.code}-${match.b.code}`);
  const maxMinute = match.extraTime ? 120 : 90;
  const events = [...(match.events || [])].sort((x, y) => x.minute - y.minute);

  // ---- DOM scaffold -------------------------------------------------------
  const canvas = el('canvas', { class: 'rp-pitch' });
  const clockEl = el('span', { class: 'rp-clock', text: "0′" });
  const scoreEl = el('span', { class: 'rp-score' });
  const timeline = el('div', { class: 'rp-timeline' });
  const tlFill = el('div', { class: 'rp-tl-fill' });
  timeline.append(tlFill);
  const banner = el('div', { class: 'rp-banner' });          // "⚽ NOR 23′"
  const penWrap = el('div', { class: 'rp-pens hidden' });      // penalty dots

  const codeA = el('span', { class: 'rp-team rp-team-a' },
    el('span', { class: 'sw' }), el('span', { class: 'code', text: match.a.code }));
  const codeB = el('span', { class: 'rp-team rp-team-b' },
    el('span', { class: 'code', text: match.b.code }), el('span', { class: 'sw' }));
  codeA.querySelector('.sw').style.background = match.a.c1;
  codeB.querySelector('.sw').style.background = match.b.c1;

  const playBtn = el('button', { class: 'rp-btn', id: 'rp-play', text: 'Pause' });
  const speedSeg = el('div', { class: 'seg rp-speed' });
  for (const s of SPEEDS) {
    const b = el('button', { text: s + '×', 'data-speed': String(s) });
    if (s === 1) b.classList.add('active');
    speedSeg.append(b);
  }
  const skipBtn = el('button', { class: 'rp-btn', text: 'Skip to end' });
  const closeBtn = el('button', { class: 'rp-close', text: '✕', title: 'Close (Esc)' });

  const stage = el('div', { class: 'rp-stage' },
    el('div', { class: 'rp-scorebar' }, codeA, scoreEl, codeB, el('span', { class: 'rp-clockwrap' }, clockEl)),
    el('div', { class: 'rp-canvas-wrap' }, canvas, banner),
    penWrap,
    timeline,
    el('div', { class: 'rp-controls' }, playBtn, speedSeg, skipBtn)
  );
  const card = el('div', { class: 'rp-card' },
    el('div', { class: 'rp-head' },
      el('div', { class: 'rp-title', text: titleFor(match) }),
      closeBtn
    ),
    stage
  );
  const overlay = el('div', { class: 'rp-overlay', role: 'dialog', 'aria-modal': 'true' }, card);
  document.body.append(overlay);
  closeBtn.focus(); // move focus into the dialog on open

  // summary list (used for reduced-motion + screen readers)
  const summary = el('div', { class: 'rp-summary' });
  stage.append(summary);

  // ---- canvas sizing ------------------------------------------------------
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    const wrap = canvas.parentElement;
    const cw = Math.max(280, wrap.clientWidth);
    const ch = Math.round(cw * 0.62);
    W = cw; H = ch;
    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawPitch();
  }

  // ---- model --------------------------------------------------------------
  const ctrl = {
    minute: 0, score: { a: 0, b: 0 }, playing: false, speed: 1,
    raf: 0, lastT: 0, done: false, inPens: false, balls: [], ripples: [], penIndex: -1, pens: null,
  };
  active = { overlay, destroy };

  // place goal markers on the timeline
  for (const ev of events) {
    const pct = (ev.minute / maxMinute) * 100;
    const dot = el('div', { class: 'rp-tl-goal rp-tl-' + ev.side, title: `${ev.team} ${ev.minute}′` });
    dot.style.left = `min(100%, ${pct}%)`;
    timeline.append(dot);
  }
  updateScore();

  // ---- pitch drawing ------------------------------------------------------
  function drawPitch() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    // turf
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c2a1a'); g.addColorStop(1, '#0a2216');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // mow stripes
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 10; i++) { if (i % 2) { ctx.fillStyle = '#ffffff'; ctx.fillRect((i / 10) * W, 0, W / 10, H); } }
    ctx.globalAlpha = 1;
    // lines
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
    const pad = 10;
    ctx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
    ctx.beginPath(); ctx.moveTo(W / 2, pad); ctx.lineTo(W / 2, H - pad); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    // goals + boxes (team A defends left, B defends right)
    const boxH = H * 0.46, boxW = W * 0.12;
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
    drawGoal(pad, true, match.a.c1);
    drawGoal(W - pad, false, match.b.c1);
  }
  function drawGoal(x, left, color) {
    const gh = H * 0.22;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, (H - gh) / 2); ctx.lineTo(x, (H + gh) / 2); ctx.stroke();
    ctx.restore();
  }

  // a ball streak toward the scoring side's attacking goal
  function spawnGoalBall(side, rng) {
    // attacking direction: side 'a' attacks right goal, 'b' attacks left.
    // Start in the ATTACKING THIRD near the box — never own half / midfield.
    const toRight = side === 'a';
    const u = rng(); // 0..1 across the attacking-third band (keeps rng sequence)
    const startX = toRight
      ? W * (0.60 + u * 0.22)   // right attack: [0.60·W, 0.82·W]
      : W * (0.18 + u * 0.22);  // left attack:  [0.18·W, 0.40·W]
    const startY = H * (0.25 + rng() * 0.5);
    const endX = toRight ? W - 12 : 12;
    const endY = H / 2 + (rng() - 0.5) * H * 0.28;
    ctrl.balls.push({ x: startX, y: startY, sx: startX, sy: startY, ex: endX, ey: endY, t: 0, side, dur: 520 });
  }
  function spawnRipple(side) {
    const x = side === 'a' ? W - 12 : 12;
    const color = side === 'a' ? match.a.c1 : match.b.c1;
    ctrl.ripples.push({ x, y: H / 2, r: 4, a: 1, side, color });
  }

  function render(dt) {
    drawPitch();
    // balls
    for (const ball of ctrl.balls) {
      ball.t = Math.min(1, ball.t + dt / ball.dur);
      const e = 1 - Math.pow(1 - ball.t, 3);
      ball.x = ball.sx + (ball.ex - ball.sx) * e;
      ball.y = ball.sy + (ball.ey - ball.sy) * e;
      // trail
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ball.sx, ball.sy); ctx.lineTo(ball.x, ball.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(ball.x, ball.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
    }
    ctrl.balls = ctrl.balls.filter((b) => b.t < 1);
    // ripples (net blink in the scoring team's kit colour — a goal, not a champion)
    for (const rp of ctrl.ripples) {
      rp.r += dt * 0.07; rp.a -= dt / 700;
      ctx.strokeStyle = teamRgba(rp.color, Math.max(0, rp.a)); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctrl.ripples = ctrl.ripples.filter((r) => r.a > 0);
  }

  function updateScore() {
    scoreEl.textContent = `${ctrl.score.a} – ${ctrl.score.b}`;
  }
  function showBanner(ev) {
    banner.textContent = `⚽ ${ev.team} ${ev.minute}′`;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  }

  // ---- timeline / clock ---------------------------------------------------
  let nextEvent = 0;
  const MIN_MS = 90; // ms of wall-clock per match-minute at 1× (so 90' ≈ 8.1s)

  function applyGoalsUpTo(minute) {
    while (nextEvent < events.length && events[nextEvent].minute <= minute) {
      const ev = events[nextEvent++];
      ctrl.score[ev.side]++;
      updateScore();
      if (!REDUCED) {
        const rng = mulberry32(seedBase + ev.minute * 2654435761);
        spawnGoalBall(ev.side, rng);
        spawnRipple(ev.side);
        showBanner(ev);
      }
      flashScore(ev.side);
    }
    clockEl.textContent = `${Math.floor(minute)}′`;
    tlFill.style.width = `min(100%, ${(minute / maxMinute) * 100}%)`;
  }
  function flashScore(side) {
    (side === 'a' ? codeA : codeB).classList.add('scored');
    setTimeout(() => (side === 'a' ? codeA : codeB).classList.remove('scored'), 600);
  }

  // ---- penalties ----------------------------------------------------------
  function renderPensStatic() {
    penWrap.classList.remove('hidden');
    penWrap.replaceChildren(
      el('div', { class: 'rp-pens-title', text: `Penalties ${match.penA}–${match.penB}` })
    );
    const rowA = el('div', { class: 'rp-pen-row' }, el('span', { class: 'rp-pen-code', text: match.a.code }));
    const rowB = el('div', { class: 'rp-pen-row' }, el('span', { class: 'rp-pen-code', text: match.b.code }));
    ctrl.pens = ctrl.pens || buildPenalties(match.penA, match.penB, mulberry32(seedBase ^ 0x9e3779b9));
    for (const k of ctrl.pens) {
      const dot = el('span', { class: 'rp-pen-dot ' + (k.made ? 'made' : 'miss') });
      (k.side === 'a' ? rowA : rowB).append(dot);
    }
    penWrap.append(rowA, rowB);
  }
  // animated penalties: reveal dots one at a time after full time
  function animatePensStep(i, done) {
    if (i === 0) {
      penWrap.classList.remove('hidden');
      penWrap.replaceChildren(el('div', { class: 'rp-pens-title', text: 'Penalties' }));
      ctrl._rowA = el('div', { class: 'rp-pen-row' }, el('span', { class: 'rp-pen-code', text: match.a.code }));
      ctrl._rowB = el('div', { class: 'rp-pen-row' }, el('span', { class: 'rp-pen-code', text: match.b.code }));
      penWrap.append(ctrl._rowA, ctrl._rowB);
      ctrl.pens = buildPenalties(match.penA, match.penB, mulberry32(seedBase ^ 0x9e3779b9));
    }
    if (i >= ctrl.pens.length) {
      penWrap.querySelector('.rp-pens-title').textContent = `Penalties ${match.penA}–${match.penB}`;
      done(); return;
    }
    const k = ctrl.pens[i];
    const dot = el('span', { class: 'rp-pen-dot ' + (k.made ? 'made' : 'miss') });
    (k.side === 'a' ? ctrl._rowA : ctrl._rowB).append(dot);
    const delay = 420 / ctrl.speed;
    ctrl.penTimer = setTimeout(() => animatePensStep(i + 1, done), delay);
  }

  // ---- main loop ----------------------------------------------------------
  function finish() {
    ctrl.playing = false; ctrl.done = true; ctrl.inPens = false;
    cancelAnimationFrame(ctrl.raf);
    // ensure exact final score
    ctrl.score.a = match.scoreA; ctrl.score.b = match.scoreB; updateScore();
    clockEl.textContent = `${maxMinute}′${match.extraTime ? ' (ET)' : ''}`;
    tlFill.style.width = '100%';
    playBtn.disabled = false;
    playBtn.textContent = 'Replay';
    buildSummary();
  }
  function afterRegulation() {
    // penalties phase (knockout, drawn after ET)
    if (match.penalties) {
      if (REDUCED) { renderPensStatic(); finish(); return; }
      clearTimeout(ctrl.penTimer); // never stack a second reveal chain
      ctrl.inPens = true;
      playBtn.disabled = true; // play/pause is meaningless mid-shootout; finish() re-enables
      animatePensStep(0, () => finish());
    } else {
      finish();
    }
  }

  function tick(now) {
    if (!ctrl.playing) return;
    const dt = Math.min(64, now - (ctrl.lastT || now));
    ctrl.lastT = now;
    ctrl.minute += (dt / MIN_MS) * ctrl.speed;
    if (ctrl.minute >= maxMinute) {
      ctrl.minute = maxMinute;
      applyGoalsUpTo(maxMinute);
      render(dt);
      ctrl.playing = false;
      cancelAnimationFrame(ctrl.raf);
      afterRegulation();
      return;
    }
    applyGoalsUpTo(ctrl.minute);
    render(dt);
    ctrl.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (ctrl.done || ctrl.inPens) return; // re-entering tick() mid-shootout would restart the pens
    ctrl.playing = true; ctrl.lastT = 0; playBtn.textContent = 'Pause';
    ctrl.raf = requestAnimationFrame(tick);
  }
  function pause() {
    ctrl.playing = false; cancelAnimationFrame(ctrl.raf); playBtn.textContent = 'Play';
  }
  function skip() {
    ctrl.playing = false; cancelAnimationFrame(ctrl.raf);
    clearTimeout(ctrl.penTimer);
    ctrl.minute = maxMinute;
    applyGoalsUpTo(maxMinute);
    render(0);
    if (match.penalties) renderPensStatic();
    finish();
  }

  function buildSummary() {
    summary.replaceChildren();
    const list = el('div', { class: 'rp-sum-list' });
    if (events.length === 0) {
      list.append(el('div', { class: 'rp-sum-row', text: 'No goals in regulation.' }));
    }
    for (const ev of events) {
      list.append(el('div', { class: 'rp-sum-row' },
        el('span', { class: 'rp-sum-min', text: ev.minute + "′" }),
        el('span', { class: 'rp-sum-team', text: ev.team })
      ));
    }
    const ftLabel = `Full time ${match.scoreA}–${match.scoreB}` +
      (match.penalties ? ` (pens ${match.penA}–${match.penB})` : match.extraTime ? ' (AET)' : '');
    summary.append(el('div', { class: 'rp-sum-ft', text: ftLabel }), list);
  }

  // ---- controls wiring ----------------------------------------------------
  playBtn.addEventListener('click', () => {
    if (ctrl.done) { restart(); return; }
    if (ctrl.playing) pause(); else play();
  });
  skipBtn.addEventListener('click', skip);
  speedSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-speed]'); if (!b) return;
    for (const x of speedSeg.children) x.classList.remove('active');
    b.classList.add('active');
    ctrl.speed = parseFloat(b.dataset.speed);
  });
  closeBtn.addEventListener('click', closeReplay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeReplay(); });
  const onKey = (e) => { if (e.key === 'Escape') closeReplay(); };
  document.addEventListener('keydown', onKey);

  function restart() {
    ctrl.done = false; ctrl.minute = 0; nextEvent = 0;
    ctrl.score = { a: 0, b: 0 }; ctrl.balls = []; ctrl.ripples = []; ctrl.pens = null;
    penWrap.classList.add('hidden'); penWrap.replaceChildren();
    summary.replaceChildren();
    updateScore(); resize();
    play();
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  function destroy() {
    ctrl.playing = false;
    cancelAnimationFrame(ctrl.raf);
    clearTimeout(ctrl.penTimer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus(); // give focus back
  }

  // ---- boot ---------------------------------------------------------------
  resize();
  if (REDUCED) {
    // jump straight to static summary + final score, no animation
    ctrl.minute = maxMinute; nextEvent = events.length;
    ctrl.score.a = match.scoreA; ctrl.score.b = match.scoreB; updateScore();
    clockEl.textContent = `${maxMinute}′`;
    tlFill.style.width = '100%';
    if (match.penalties) renderPensStatic();
    ctrl.done = true; playBtn.textContent = 'Replay';
    buildSummary();
  } else {
    play(); // autoplay on open
  }
}

function titleFor(match) {
  const stage = match.stageLabel ? match.stageLabel + ' · ' : '';
  return `${stage}${match.a.name} v ${match.b.name}`;
}

export function closeReplay() {
  if (active) { active.destroy(); active = null; }
}

export function isReplayOpen() { return !!active; }
