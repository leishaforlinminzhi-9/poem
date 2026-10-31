// 拼贴诗: one phone, two people, one sheet. Both pull words cut from "magazines" onto it whenever they like;
// when both hold a heart at the same time the poem is done: it becomes a picture, goes on the 诗集墙 and, if they want, on the
// love calendar as a 回音 entry whose link (#p=...) redraws the same collage on any device.
import { WORDS, MIX, FLAVOR, REUSE, ALWAYS } from './words.js';

const BW = 750, BH = 1000; // the sheet, in logical units
const API = new URLSearchParams(location.search).get('api') || 'https://love-calendar-api.linmz21.workers.dev';
const WHO = [
  { name: '小狗', cls: 'dog', pron: '她', tape: '#f19bb8' },
  { name: '小猫', cls: 'cat', pron: '他', tape: '#8fb0cf' },
];
const FONTS = {
  serif: '"Noto Serif SC", serif', sans: '"Noto Sans SC", sans-serif', kuaile: '"ZCOOL KuaiLe", sans-serif',
  mashan: '"Ma Shan Zheng", cursive', qingke: '"ZCOOL QingKe HuangYou", sans-serif',
};
// newsprint, magazine black, poster red, ... (index is stored in the link: append, never reorder)
const STYLES = [
  ['#f3eee2', '#1b1b1b', 'serif', 900, 40], ['#161616', '#f7f2e8', 'sans', 900, 36], ['#d8332f', '#ffffff', 'sans', 900, 38],
  ['#f6d23c', '#1d1d1d', 'kuaile', 400, 42], ['#c9a27a', '#2b1d12', 'mashan', 400, 46], ['#f7c1cf', '#7a1236', 'serif', 700, 40],
  ['#2f5fb3', '#fff6d8', 'qingke', 400, 44], ['#ffffff', '#d8332f', 'serif', 900, 42], ['#bcd9ac', '#1f3d1b', 'sans', 900, 36],
  ['#e4e1da', '#333333', 'mashan', 400, 44], ['#f08a3c', '#ffffff', 'kuaile', 400, 40], ['#1f2a4d', '#f6d23c', 'serif', 900, 40],
].map(([bg, fg, f, w, fs]) => ({ bg, fg, font: FONTS[f], w, fs }));

const $ = (id) => document.getElementById(id);
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2400);
}
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
}

// ---------- how a cut-out word looks (all derived from text + style + a 3-bit seed, so a link can redraw it) ----------

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.codePointAt(0)) | 0, 7);
const PUNCT = /^[，。！？、…,.!?]+$/;
const looks = new Map();
function look(t) {
  const key = `${t.t}|${t.s}|${t.seed}`;
  if (looks.has(key)) return looks.get(key);
  const r = rng(hash(t.t) * 8 + t.seed);
  const st = STYLES[t.s] ?? STYLES[0];
  const fs = Math.round(st.fs * (0.85 + r() * 0.35) * (PUNCT.test(t.t) ? 0.8 : 1));
  // a torn outline: corners pulled in a little, a few nicks along each edge (percent of the box)
  const j = (a) => +(r() * a).toFixed(1);
  const poly = [
    [j(4), j(8)], [25 + j(10), j(7)], [55 + j(10), j(6)], [100 - j(4), j(9)],
    [100 - j(4), 50 + j(10) - 5], [100 - j(5), 100 - j(9)], [60 + j(10), 100 - j(6)], [30 + j(10), 100 - j(8)],
    [j(5), 100 - j(9)], [j(4), 45 + j(10)],
  ];
  const l = { ...st, fs, padX: fs * 0.34, padY: fs * 0.28, poly, tapeL: 8 + r() * 40, tapeR: -14 + r() * 28 };
  looks.set(key, l);
  return l;
}

function tileEl(t, k, owner) {
  const l = look(t);
  const el = document.createElement('div');
  el.className = 'tile' + (owner == null ? '' : ` mine-${owner}`);
  el.dataset.id = t.id;
  const cut = document.createElement('span');
  cut.className = 'cut';
  cut.textContent = t.t;
  Object.assign(cut.style, {
    background: l.bg, color: l.fg, fontFamily: l.font, fontWeight: l.w, fontSize: `${l.fs * k}px`,
    padding: `${l.padY * k}px ${l.padX * k}px`, clipPath: `polygon(${l.poly.map(([x, y]) => `${x}% ${y}%`).join(',')})`,
  });
  el.append(cut);
  if (owner != null) {
    const tape = document.createElement('i');
    tape.className = 'tape';
    tape.style.left = `${l.tapeL}%`;
    tape.style.transform = `rotate(${l.tapeR}deg)`;
    el.append(tape);
  }
  return el;
}

// ---------- the link: a version byte, the day (2 bytes), then per word x y (8 bits each), rotation + style, owner + seed + length, UTF-16 ----------

const EPOCH = Date.UTC(2020, 0, 1);
export function encode(tiles, at) {
  const d = Math.max(0, Math.round((at - EPOCH) / 86400000));
  const bytes = [1, d >> 8, d & 255];
  for (const t of tiles) {
    const units = t.t.slice(0, 15);
    bytes.push(
      Math.round((t.x / BW) * 255), Math.round((t.y / BH) * 255),
      ((t.r + 7) << 4) | t.s, (t.o << 7) | (t.seed << 4) | units.length,
    );
    for (let i = 0; i < units.length; i++) bytes.push(units.charCodeAt(i) >> 8, units.charCodeAt(i) & 255);
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const b = [...bin].map((c) => c.charCodeAt(0));
  if (b[0] !== 1) throw new Error('unknown version');
  const tiles = [];
  tiles.at = EPOCH + ((b[1] << 8) | b[2]) * 86400000 + 43200000; // midday, so the day is right in any time zone
  for (let i = 3; i + 4 <= b.length; ) {
    const [x, y, rs, osl] = b.slice(i, i + 4);
    i += 4;
    const n = osl & 15;
    let text = '';
    for (let j = 0; j < n; j++, i += 2) text += String.fromCharCode((b[i] << 8) | b[i + 1]);
    tiles.push({ id: `d${tiles.length}`, t: text, x: (x / 255) * BW, y: (y / 255) * BH, r: (rs >> 4) - 7, s: rs & 15, o: osl >> 7, seed: (osl >> 4) & 7 });
  }
  return tiles;
}

// reading order: rows by height on the sheet, left to right inside a row
function poemText(tiles) {
  const rows = [];
  for (const t of [...tiles].sort((a, b) => a.y - b.y)) {
    const row = rows.at(-1);
    if (row && t.y - row.y < 34) {
      row.items.push(t);
      row.y = row.items.reduce((s, i) => s + i.y, 0) / row.items.length;
    } else rows.push({ y: t.y, items: [t] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((t) => t.t).join('')).join('\n');
}

// ---------- the picture ----------

const faces = WHO.map((w) => Object.assign(new Image(), { src: `assets/${w.cls}.webp` }));
async function render(tiles, scale, stamp) {
  // a slow network must not leave the picture blank forever: after 4 s it is drawn with whatever fonts have arrived
  const late = (p) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  await late(Promise.all(tiles.map((t) => { const l = look(t); return document.fonts.load(`${l.w} ${l.fs}px ${l.font}`, t.t); })));
  if (stamp) await late(Promise.all(faces.map((f) => f.decode())));
  const c = document.createElement('canvas');
  c.width = BW * scale;
  c.height = BH * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#f6f0e3';
  g.fillRect(0, 0, BW, BH);
  const r = rng(42);
  g.fillStyle = 'rgba(120,90,60,.08)';
  for (let i = 0; i < 2600; i++) g.fillRect(r() * BW, r() * BH, 1.4, 1.4);
  for (const t of tiles) {
    const l = look(t);
    g.save();
    g.translate(t.x, t.y);
    g.rotate((t.r * Math.PI) / 180);
    g.font = `${l.w} ${l.fs}px ${l.font}`;
    const w = g.measureText(t.t).width + l.padX * 2, h = l.fs + l.padY * 2;
    g.translate(-w / 2, -h / 2);
    g.beginPath();
    l.poly.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo']((x / 100) * w, (y / 100) * h));
    g.closePath();
    Object.assign(g, { shadowColor: 'rgba(0,0,0,.28)', shadowBlur: 3, shadowOffsetY: 1.5, fillStyle: l.bg });
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = l.fg;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(t.t, w / 2, h / 2 + l.fs * 0.04);
    // a strip of washi tape in the colour of whoever stuck it
    const tw = Math.max(16, w * 0.46), th = h * 0.34;
    g.translate((l.tapeL / 100) * w + tw / 2, -h * 0.14 + th / 2);
    g.rotate((l.tapeR * Math.PI) / 180);
    g.globalAlpha = 0.78;
    g.fillStyle = WHO[t.o].tape;
    g.fillRect(-tw / 2, -th / 2, tw, th);
    g.restore();
  }
  if (stamp) {
    g.save();
    faces.forEach((f, i) => {
      const cx = BW - 112 + i * 52, cy = BH - 52;
      g.beginPath();
      g.arc(cx, cy, 24, 0, Math.PI * 2);
      g.fillStyle = '#fff8ec';
      g.fill();
      g.save();
      g.clip();
      if (f.naturalWidth) g.drawImage(f, cx - 24, cy - 24, 48, 48);
      g.restore();
    });
    g.fillStyle = '#9c8a74';
    g.font = '700 20px "Noto Serif SC", serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(stamp, BW - 150, BH - 52);
    g.restore();
  }
  return c;
}

// ---------- a game: one sheet, one pile of words, both of you at the same time ----------

let S = null; // { tiles, hand, bags, started }
let K = 0.5; // screen px per logical unit
let nextId = 1;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const save = () => ls.set('poem-draft', S);
const inPlay = () => new Set([...S.tiles, ...S.hand].map((t) => t.t));

const pickFlavor = () => {
  const total = Object.values(FLAVOR).reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (const [f, w] of Object.entries(FLAVOR)) if ((x -= w) < 0) return f;
  return 'ours';
};
// n words of one part of speech; names / verbs / adjectives mix the flavours, and never repeat a word already in play
function draw(group, n, taken) {
  const out = [];
  if (REUSE.includes(group)) {
    const have = new Set(S.hand.map((h) => h.t));
    for (const w of ALWAYS) if (out.length < n && WORDS[group].includes(w) && !have.has(w)) out.push(w);
    for (const w of shuffle([...WORDS[group]])) if (out.length < n && !out.includes(w)) out.push(w);
  } else {
    for (let tries = 0; out.length < n && tries < 20; tries++) {
      const flavor = Array.isArray(WORDS[group]) ? null : pickFlavor();
      const list = flavor ? WORDS[group][flavor] : WORDS[group];
      const key = flavor ? `${group}.${flavor}` : group;
      if (!S.bags[key]?.length) S.bags[key] = shuffle(list.filter((w) => !taken.has(w)));
      const w = S.bags[key].pop();
      if (w && !taken.has(w) && !out.includes(w)) out.push(w);
    }
  }
  // the tape colour (pink / blue) is just a mix on one sheet now; it is the 'owner' bit of the link
  return out.map((t) => ({ id: `w${Date.now().toString(36)}${nextId++}`, t, s: (Math.random() * STYLES.length) | 0, seed: (Math.random() * 8) | 0, g: group, o: (Math.random() * 2) | 0 }));
}
function refill() {
  const taken = inPlay();
  for (const [group, n] of Object.entries(MIX)) {
    const have = S.hand.filter((h) => h.g === group).length;
    if (have < n) S.hand.push(...draw(group, n - have, taken));
  }
  shuffle(S.hand);
}

function newGame() {
  S = { tiles: [], hand: [], bags: {}, started: Date.now() };
  refill();
  save();
  play();
}
function play() {
  show('play');
  layout();
}

function layout() {
  if (!$('play').classList.contains('on')) return;
  const play = $('play'), cs = getComputedStyle(play);
  const used = play.querySelector('.bar').offsetHeight + 8 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availH = innerHeight - used - 200; // 200: room for the punctuation row and the pile of words
  K = Math.min((innerWidth - 16) / BW, availH / BH, 0.9);
  $('board').style.width = `${BW * K}px`;
  $('board').style.height = `${BH * K}px`;
  paint();
}

function place(el, t) {
  el.style.left = `${t.x * K}px`;
  el.style.top = `${t.y * K}px`;
  el.style.transform = `translate(-50%,-50%) rotate(${t.r}deg)`;
}
function paint() {
  const board = $('board');
  board.querySelectorAll('.tile').forEach((e) => e.remove());
  $('boardHint').hidden = S.tiles.length > 0;
  for (const t of S.tiles) {
    const el = tileEl(t, K, t.o);
    place(el, t);
    el.addEventListener('pointerdown', (e) => dragBoard(e, t, el));
    board.append(el);
  }
  const tray = $('tray');
  tray.replaceChildren();
  // punctuation is always there: every drag takes a fresh copy
  const stock = document.createElement('div');
  stock.className = 'stock';
  WORDS.punct.forEach((p, i) => {
    const el = tileEl({ id: `p${i}`, t: p, s: 0, seed: i % 8 }, K, null);
    el.addEventListener('pointerdown', (e) => dragHand(e, null, el, p));
    stock.append(el);
  });
  tray.append(stock);
  for (const h of S.hand) {
    const el = tileEl(h, K, null);
    el.addEventListener('pointerdown', (e) => dragHand(e, h, el));
    tray.append(el);
  }
}

const within = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const clampX = (x) => Math.min(BW - 40, Math.max(40, x));
const clampY = (y) => Math.min(BH - 30, Math.max(30, y));

// every finger is its own drag, so two people can pull words onto the sheet at the same time.
// `punct`: a mark from the stock row; it gets a new look each time and the row stays as it is
function dragHand(e, h, el, punct) {
  e.preventDefault();
  if (punct) h = { id: `w${Date.now().toString(36)}${nextId++}`, t: punct, s: (Math.random() * STYLES.length) | 0, seed: (Math.random() * 8) | 0, g: 'punct', o: (Math.random() * 2) | 0 };
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!ghost) {
      ghost = tileEl(h, K, h.o);
      ghost.classList.add('ghost', 'dragging');
      document.body.append(ghost);
      el.style.opacity = '0';
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY - 24}px`;
    ghost.style.transform = 'translate(-50%,-50%) rotate(-3deg)';
  };
  const up = (ev) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    const r = $('board').getBoundingClientRect();
    let at = null;
    if (!ghost) at = { x: BW / 2 + (Math.random() - 0.5) * 240, y: BH / 2 + (Math.random() - 0.5) * 300 }; // a tap: somewhere in the middle
    else if (within(r, ev.clientX, ev.clientY - 24)) at = { x: (ev.clientX - r.left) / K, y: (ev.clientY - 24 - r.top) / K };
    ghost?.remove();
    el.style.opacity = '';
    if (!at || ev.type === 'pointercancel') return;
    if (!punct) S.hand = S.hand.filter((x) => x !== h);
    S.tiles.push({ ...h, x: clampX(at.x), y: clampY(at.y), r: Math.round(Math.random() * 12 - 6) });
    save();
    paint();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function dragBoard(e, t, el) {
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  S.tiles = [...S.tiles.filter((x) => x !== t), t]; // on top (the .dragging z-index shows it; moving the node would drop the capture)
  el.classList.add('dragging');
  const r = $('board').getBoundingClientRect();
  const dx = e.clientX - (r.left + t.x * K), dy = e.clientY - (r.top + t.y * K);
  const move = (ev) => {
    t.x = clampX((ev.clientX - dx - r.left) / K);
    t.y = clampY((ev.clientY - dy - r.top) / K);
    place(el, t);
  };
  const up = (ev) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    // dropped on the pile below: the word comes off the sheet
    if (within($('tray').getBoundingClientRect(), ev.clientX, ev.clientY)) {
      S.tiles = S.tiles.filter((x) => x !== t);
      const { x, y, r: _r, ...h } = t;
      if (!PUNCT.test(t.t)) S.hand.push(h); // a mark just goes back to the stock
    }
    save();
    paint();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// ---------- finishing: both hold a heart ----------

const held = [false, false];
let holdStart = 0;
function holdTick() {
  if (!$('finish').classList.contains('on')) return;
  const both = held[0] && held[1];
  if (!both) holdStart = 0;
  else if (!holdStart) holdStart = performance.now();
  const p = holdStart ? Math.min(1, (performance.now() - holdStart) / 1200) : 0;
  $('meter').style.width = `${p * 100}%`;
  if (p >= 1) return finishPoem();
  requestAnimationFrame(holdTick);
}
document.querySelectorAll('.heart').forEach((b) => {
  const i = +b.dataset.h;
  const set = (v) => { held[i] = v; b.classList.toggle('held', v); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse') return set(!held[i]); // a computer has one pointer: click to latch
    b.setPointerCapture(e.pointerId);
    set(true);
  });
  const off = (e) => { if (e.pointerType !== 'mouse') set(false); };
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});
function openFinish() {
  if (S.tiles.length < 3) return toast('至少贴三个词吧');
  held.fill(false);
  document.querySelectorAll('.heart').forEach((b) => b.classList.remove('held'));
  show('finish');
  requestAnimationFrame(holdTick);
}

const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const linkOf = (code) => `${location.origin}${location.pathname}#p=${code}`;
const wallLocal = () => ls.get('poem-wall') ?? [];

function finishPoem() {
  const item = { code: encode(S.tiles, Date.now()), text: poemText(S.tiles), at: Date.now() };
  ls.set('poem-wall', [item, ...wallLocal()]);
  ls.del('poem-draft');
  S = null;
  showDone(item, { local: true });
}

// ---------- the finished poem ----------

let current = null;
async function showDone(item, { local = false, fromLink = false } = {}) {
  current = item;
  show('done');
  $('donePoem').textContent = item.text;
  $('doneImg').removeAttribute('src');
  const acts = [['保存图片', saveImage]];
  if (!item.onCal) acts.push(['挂到爱的日历', openCal]);
  acts.push(['诗集墙', openWall]);
  if (local && !item.onCal) acts.push(['从墙上取下', unpin]);
  acts.push(['再拼一首', startScreen]);
  $('doneActions').replaceChildren(...acts.map(([label, fn], i) => {
    const b = document.createElement('button');
    b.className = i ? 'btn light' : 'btn';
    b.textContent = label;
    b.onclick = fn;
    return b;
  }));
  const note = item.onCal ? `挂在爱的日历 ${item.onCal.slice(5).replace('-', '月')}日 · 长按图片也能存` : fromLink ? '长按图片也能存到相册' : '已经钉到诗集墙上了 · 长按图片也能存到相册';
  $('doneNote').textContent = '正在把词贴到纸上……';
  const canvas = await render(decode(item.code), 1.6, day(item.at));
  if (current !== item) return; // left for another poem meanwhile
  item.canvas = canvas;
  $('doneImg').src = canvas.toDataURL('image/png');
  $('doneNote').textContent = note;
}
async function saveImage() {
  if (!current.canvas) return toast('图片还在画,等一下');
  const blob = await new Promise((r) => current.canvas.toBlob(r, 'image/png'));
  const file = new File([blob], `拼贴诗-${day(current.at)}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function unpin() {
  if (!confirm('把这首从墙上取下来?取下就没有了。')) return;
  ls.set('poem-wall', wallLocal().filter((w) => w.code !== current.code));
  openWall();
}

// ---------- the love calendar ----------

const pad2 = (n) => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
async function api(body) {
  const res = await fetch(`${API}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function openCal() {
  $('calDate').value = todayKey();
  $('calMsg').textContent = '';
  $('calGo').disabled = false;
  $('calSheet').classList.add('on');
}
async function hang() {
  const date = $('calDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ($('calMsg').textContent = '先选一天');
  $('calGo').disabled = true;
  $('calMsg').textContent = '正在挂……';
  try {
    const link = linkOf(current.code);
    // the calendar keeps at most 600 characters of a 回音; the link must survive whole
    const text = `${current.text.slice(0, 600 - link.length - 2)}\n\n${link}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const all = await api({ changes: [] });
      const live = new Map(all.entries.map((e) => [e.id, e]));
      const already = all.entries.find((e) => !e.deleted && e.text.includes(`#p=${current.code}`));
      if (already) return markHung(already.date, '这首已经挂过了');
      let slot = -1;
      for (let s = 0; s < 6 && slot < 0; s++) if (!live.get(`${date}_${s}`) || live.get(`${date}_${s}`).deleted) slot = s;
      if (slot < 0) return ($('calMsg').textContent = '这一天已经挂满了,换一天吧', $('calGo').disabled = false);
      const now = Date.now();
      const id = `${date}_${slot}`;
      const res = await api({
        epoch: all.epoch, since: all.cursor,
        changes: [{ date, slot, kind: 'love', type: 'poem', text, createdAt: now, updatedAt: now, deleted: false, baseRev: live.get(id)?.rev ?? 0 }],
      });
      if (res.conflicts?.includes(id)) continue; // someone wrote that slot just now: look again
      if (res.entries.some((e) => e.id === id && e.text.includes(current.code))) return markHung(date);
    }
    throw new Error('not stored');
  } catch (err) {
    console.error(err);
    $('calMsg').textContent = '没挂上,可能是网不好,再试一次';
    $('calGo').disabled = false;
  }
}
function markHung(date, msg) {
  current.onCal = date;
  ls.set('poem-wall', wallLocal().map((w) => (w.code === current.code ? { ...w, onCal: date } : w)));
  $('calSheet').classList.remove('on');
  toast(msg ?? `挂好了:${date.slice(5).replace('-', '月')}日`);
  showDone(current, { local: true });
}

// ---------- the wall: poems made on this phone + every poem hung on the calendar ----------

async function openWall() {
  show('wall');
  const grid = $('grid');
  const items = new Map(wallLocal().map((w) => [w.code, { ...w, local: true }]));
  grid.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: '正在把诗钉上墙……' }));
  try {
    const all = await api({ changes: [] });
    for (const e of all.entries) {
      const m = !e.deleted && e.type === 'poem' && e.text.match(/#p=([A-Za-z0-9_-]+)/);
      if (!m) continue;
      const known = items.get(m[1]);
      items.set(m[1], { ...known, code: m[1], text: known?.text ?? e.text.replace(/\n*https?:\/\/\S+/g, '').trim(), at: known?.at ?? e.createdAt, onCal: e.date, local: known?.local });
    }
  } catch {} // offline: the poems on this phone are still there
  const list = [...items.values()].sort((a, b) => b.at - a.at);
  if (!list.length) {
    grid.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: '墙上还空着。拼一首吧。' }));
    return;
  }
  grid.replaceChildren();
  for (const item of list) {
    const b = document.createElement('button');
    b.className = 'pin';
    const img = document.createElement('img');
    img.alt = '';
    const cap = document.createElement('small');
    cap.textContent = `${day(item.at)} · ${item.text.split('\n')[0]}`;
    b.append(img, cap);
    b.onclick = () => showDone(item, { local: item.local });
    grid.append(b);
    render(decode(item.code), 0.32, day(item.at)).then((c) => (img.src = c.toDataURL('image/jpeg', 0.85))).catch(() => {});
  }
}

// ---------- wiring ----------

function logo() {
  const letters = [['拼', 2, 3], ['贴', 3, 5], ['诗', 11, 1]];
  $('logo').replaceChildren(...letters.map(([t, s, seed], i) => {
    const el = tileEl({ id: `l${i}`, t, s, seed }, 1.15, i % 2);
    el.style.position = 'relative';
    el.style.display = 'inline-block';
    el.style.margin = '0 6px';
    el.style.transform = `rotate(${[-5, 3, -2][i]}deg)`;
    return el;
  }));
}

$('newGame').onclick = newGame;
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => (b.dataset.go === 'wall' ? openWall() : startScreen())));
$('resume').onclick = () => { S = ls.get('poem-draft'); play(); };
// a new pile: the words not on the sheet go back in the bag
$('redraw').onclick = () => {
  S.hand = [];
  refill();
  save();
  paint();
};
$('finishBtn').onclick = openFinish;
$('finishBack').onclick = play;
$('calCancel').onclick = () => $('calSheet').classList.remove('on');
$('calGo').onclick = hang;
addEventListener('resize', layout);

function startScreen() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('resume').hidden = !ls.get('poem-draft')?.hand;
  show('start');
}
function route() {
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)/);
  if (m) {
    try {
      const tiles = decode(m[1]);
      const known = wallLocal().find((w) => w.code === m[1]);
      return showDone(known ?? { code: m[1], text: poemText(tiles), at: tiles.at }, { local: !!known, fromLink: true });
    } catch {}
  }
  startScreen();
}
logo();
route();
addEventListener('hashchange', route);
