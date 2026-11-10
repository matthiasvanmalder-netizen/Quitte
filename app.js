import { openStore } from './store.js';
import * as M from './money.js';

// ---------- hulpjes ----------

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chev: svg('<path d="M9 5l7 7-7 7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  gear: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  swap: svg('<path d="M5 8h13l-3-3M19 16H6l3 3"/>'),
};
const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--logo-bg)"/><rect x="8" y="11" width="16" height="3.6" rx="1.8" fill="#FFC93C"/><rect x="8" y="17.4" width="16" height="3.6" rx="1.8" fill="#FFC93C"/></svg>';

const EMOJI = ['✈️', '🏖️', '🏔️', '⛺', '🚗', '🏠', '🍻', '🍕', '🍣', '🎉', '🎿', '🎁', '⚽', '💸'];
const MODES = [['equal', 'Gelijk'], ['exact', 'Bedragen'], ['shares', 'Delen'], ['percent', 'Procent']];
const HUES = [212, 262, 328, 14, 38, 152, 188, 292];

const S = {
  store: null, gid: null, group: undefined, members: [], expenses: [], log: [], ready: {},
  calc: null, error: null, slow: false, unwatch: null,
  view: 'home', tab: 'uitgaven', sheet: null, draft: null, claimArm: null, afterCreate: null, animBal: false,
};

// ---------- mijn regelingen (alleen op dit toestel) ----------

const MINE = 'quitte.groups';
const mine = () => { try { return JSON.parse(localStorage.getItem(MINE)) || {}; } catch { return {}; } };
const saveMine = m => { try { localStorage.setItem(MINE, JSON.stringify(m)); } catch {} };
function remember(gid, patch) { const m = mine(); m[gid] = { ...(m[gid] || {}), ...patch }; saveMine(m); }
function forget(gid) { const m = mine(); delete m[gid]; saveMine(m); }

// ---------- afgeleide gegevens ----------

const member = id => S.members.find(m => m.id === id);
const nameOf = id => member(id)?.name || 'Iemand';
const myId = () => { const id = mine()[S.gid]?.me; return member(id) ? id : null; };
const who = id => (id === myId() ? 'Jij' : nameOf(id));
const cur = () => S.group.currency;
const tone = n => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'even');
const hue = id => { let x = 0; for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return HUES[x % HUES.length]; };
const initial = n => ([...String(n || '?').trim()][0] || '?').toUpperCase();
const avatar = (id, cls = '', name = nameOf(id)) => `<span class="avatar ${cls}" style="--h:${hue(id)}" aria-hidden="true">${esc(initial(name))}</span>`;
const groupUrl = () => `${location.origin}${location.pathname}#/g/${S.gid}`;
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const curLabel = c => `${capital(M.currencyName(c))} (${c})`;

const dateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayFmt = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit' });
const shortDate = s => (s ? shortFmt.format(parseDay(s)) : '');
const fmtRate = n => (Number.isFinite(n) ? n.toLocaleString('nl-BE', { maximumSignificantDigits: 6 }) : '');
function dayLabel(s) {
  if (!s) return 'Zonder datum';
  if (s === M.todayStr()) return 'Vandaag';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === dateStr(y)) return 'Gisteren';
  const d = parseDay(s);
  return capital(dayFmt.format(d)) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}

function netLine(net, c) {
  if (net == null || !c) return 'Open om je saldo te zien';
  if (net > 0) return `Je krijgt ${M.fmt(net, c)} terug`;
  if (net < 0) return `Je moet nog ${M.fmt(-net, c)} betalen`;
  return 'Je staat quitte';
}

function qrCode(text) {
  if (typeof qrcode !== 'function') return null;
  const qr = qrcode(0, 'M');
  qr.addData(String.fromCharCode(...new TextEncoder().encode(text)));
  qr.make();
  return qr;
}

function qrSvg(text) {
  const qr = qrCode(text);
  if (!qr) return '';
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg class="qr-svg" viewBox="-3 -3 ${n + 6} ${n + 6}" role="img" aria-label="QR-code" shape-rendering="crispEdges"><rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// De QR als PNG-bestand, met een regel tekst eronder zodat je hem later in je foto's herkent.
// Synchroon gebouwd: iOS opent het deelmenu alleen rechtstreeks vanuit de tik.
function qrFile(text, caption) {
  const qr = qrCode(text);
  if (!qr) return null;
  const n = qr.getModuleCount(), s = 12, pad = 4 * s, size = n * s + 2 * pad;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size + 44;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(pad + c * s, pad + r * s, s, s);
  g.font = '600 26px "Schibsted Grotesk", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(caption, size / 2, size + 10, size - 2 * pad);
  const bin = atob(cv.toDataURL('image/png').split(',')[1]);
  return new File([Uint8Array.from(bin, ch => ch.charCodeAt(0))], 'betaling.png', { type: 'image/png' });
}

// Alleen op touchtoestellen: daar scan je de code niet, je betaalt op hetzelfde scherm.
function canShareQr() {
  try {
    return matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch { return false; }
}

// ---------- melding onderaan ----------

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  void el.offsetWidth; // eerst tekenen zonder .show, anders schuift de melding niet in
  el.classList.add('show');
  if (action) el.querySelector('button').onclick = () => { hideToast(); action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 2600);
}
function hideToast() { const el = $('#toast'); el.classList.remove('show'); setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 250); }

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || 'Gekopieerd'); }
  catch { window.prompt('Kopieer dit:', text); }
}

// ---------- opslaan ----------

// Firestore aanvaardt geen undefined: weg ermee, ook dieper in objecten.
const clean = v => (Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)])) : v);

function commitTo(gid, ops) {
  return S.store.commit(gid, ops.map(o => (o.data ? { ...o, data: clean(o.data) } : o))).catch(err => {
    console.error(err);
    toast(err?.code === 'permission-denied' ? 'Opslaan geweigerd. Kijk de Firebase-regels na.' : 'Opslaan mislukt. Controleer je verbinding en probeer opnieuw.');
  });
}
const commit = ops => commitTo(S.gid, ops);
function logOp(type, extra = {}, by = myId()) {
  return { col: 'log', id: S.store.newId(), op: 'set', data: { at: Date.now(), by, byName: by ? nameOf(by) : '', type, ...extra } };
}

// ---------- routes ----------

function parseRoute() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'nieuw') return { view: 'new' };
  if (p[0] === 'g' && p[1]) {
    if (p[2] === 'instellingen') return { view: 'settings', gid: p[1] };
    return { view: 'group', gid: p[1], tab: ['saldo', 'wijzigingen'].includes(p[2]) ? p[2] : 'uitgaven' };
  }
  return { view: 'home' };
}

function onRoute() {
  const r = parseRoute(), prevView = S.view;
  if (S.sheet) dropSheet();
  S.view = r.view;
  if (r.tab) { S.animBal = r.tab === 'saldo' && S.tab !== 'saldo'; S.tab = r.tab; }
  if (r.gid && r.gid !== S.gid) watchGroup(r.gid);
  if (!r.gid && S.gid) { S.unwatch?.(); S.unwatch = null; S.gid = null; }
  if (r.view === 'new' && !S.draft) S.draft = { emoji: '✈️', name: '', currency: 'EUR', me: '', others: [''] };
  if (r.gid && mine()[r.gid]?.me) remember(r.gid, { opened: Date.now() });
  render();
  if (prevView !== S.view) window.scrollTo(0, 0);
}

let slowTimer;
function watchGroup(gid) {
  S.unwatch?.();
  Object.assign(S, { gid, group: undefined, members: [], expenses: [], log: [], ready: {}, calc: null, error: null, slow: false, claimArm: null });
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { if (!S.ready.members) { S.slow = true; render(); } }, 10000);
  S.unwatch = S.store.watch(gid, {
    group: g => { S.group = g; S.ready.group = true; changed(); },
    members: l => { S.members = l.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); S.ready.members = true; changed(); },
    expenses: l => { S.expenses = l; S.ready.expenses = true; changed(); },
    log: l => { S.log = l; S.ready.log = true; changed(); },
    error: err => { console.error(err); S.error = err; changed(); },
  });
}

// Updates die kort na elkaar binnenkomen (regeling, deelnemers, uitgaven, log) samen tekenen.
// Geen requestAnimationFrame: dat staat stil zolang de pagina niet zichtbaar is.
let pending = 0;
function changed() {
  if (S.group && S.ready.members && S.ready.expenses) {
    S.calc = M.balances(S.members.map(m => m.id), S.expenses, S.group.currency);
    const me = myId();
    if (me) remember(S.gid, { name: S.group.name, emoji: S.group.emoji, currency: S.group.currency, net: S.calc.byId[me]?.net ?? 0 });
  }
  if (!pending) pending = setTimeout(() => { pending = 0; render(); }, 0);
}

// ---------- tekenen ----------

function render() {
  const app = $('#app');
  // Wat iemand aan het typen is, mag een update van een ander toestel niet wissen.
  const keep = $$('input[data-keep]', app).map(el => [el.id, el.value, el === document.activeElement ? el.selectionStart : null]);
  app.innerHTML = page();
  for (const [id, value, sel] of keep) {
    const el = document.getElementById(id);
    if (!el || !app.contains(el)) continue;
    el.value = value;
    if (sel != null) { el.focus(); try { el.setSelectionRange(sel, sel); } catch {} }
  }
  S.animBal = false;
  if (S.afterCreate && S.afterCreate === S.gid && S.view === 'group' && S.group && myId()) {
    S.afterCreate = null;
    openSheet('share');
  }
}

function page() {
  if (S.view === 'home') return vHome();
  if (S.view === 'new') return vNew();
  if (S.error) return vError();
  if (!S.ready.group || !S.ready.members) return vLoading();
  if (!S.group) return vMissing();
  if (!myId()) return vWho();
  if (!S.ready.expenses) return vLoading();
  return S.view === 'settings' ? vSettings() : vGroup();
}

const topBar = (back, title, right = '<span class="icon-space"></span>') => `
  <header class="top">
    <a class="icon-btn" href="${back}" aria-label="Terug">${I.back}</a>
    <div class="top-title">${title}</div>
    ${right}
  </header>`;

function demoNote() {
  return S.store.mode === 'local'
    ? '<p class="demo">Demo-modus: alles blijft in deze browser. Koppel Firebase om regelingen met vrienden te delen.</p>' : '';
}

function vHome() {
  const list = Object.entries(mine()).sort((a, b) => (b[1].opened || 0) - (a[1].opened || 0));
  return `
  <header class="top home-top"><div class="brand">${LOGO}<span>Quitte</span></div></header>
  <main class="page">
    ${demoNote()}
    ${list.length ? `
      <h1 class="h-page">Jouw regelingen</h1>
      <ul class="groups">${list.map(([gid, g]) => `
        <li><a class="group-row" href="#/g/${esc(gid)}">
          <span class="emoji-tile">${esc(g.emoji || '💸')}</span>
          <span class="group-main"><b>${esc(g.name || 'Regeling')}</b>
            <small class="${g.me ? tone(g.net) : ''}">${g.me ? netLine(g.net, g.currency) : 'Kies wie je bent'}</small></span>
          ${I.chev}
        </a></li>`).join('')}
      </ul>` : `
      <section class="intro">
        <h1>Nog geen regelingen</h1>
        <p>Maak er een aan voor een reis, een weekend weg of de gedeelde huur. Daarna nodig je je vrienden uit met een link.</p>
      </section>`}
    <a class="btn btn-sun btn-wide" href="#/nieuw">${I.plus}Nieuwe regeling</a>
    <form class="open-link" data-form="open-link">
      <label for="link-in">Kreeg je een link van een vriend?</label>
      <div class="row-input">
        <input id="link-in" data-keep placeholder="Plak de link hier" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn btn-ghost" type="submit">Openen</button>
      </div>
      <p class="form-error" id="link-err" role="alert"></p>
    </form>
  </main>`;
}

function currencyOptions(sel, short = false) {
  return M.CURRENCIES.map(c => `<option value="${c}"${c === sel ? ' selected' : ''}>${short ? c : esc(curLabel(c))}</option>`).join('');
}

function emojiPicker(sel, act) {
  return `<div class="emoji-pick">${EMOJI.map(e => `<button type="button" class="emoji-opt" aria-pressed="${e === sel}" data-act="${act}" data-v="${e}" aria-label="Icoon ${e}">${e}</button>`).join('')}</div>`;
}

function vNew() {
  const d = S.draft;
  return `
  ${topBar('#/', '<h1>Nieuwe regeling</h1>')}
  <main class="page">
    <form class="form" data-form="create" novalidate>
      <fieldset class="field"><legend>Icoon</legend>${emojiPicker(d.emoji, 'draft-emoji')}</fieldset>
      <label class="field"><span>Naam van de regeling</span>
        <input id="ng-name" data-draft="name" value="${esc(d.name)}" placeholder="Weekend Ardennen" maxlength="60" autocomplete="off"></label>
      <label class="field"><span>Hoofdmunt</span>
        <select id="ng-cur" data-draft="currency">${currencyOptions(d.currency)}</select>
        <small>Hierin worden de saldo's berekend. Uitgaven in een andere munt worden omgerekend.</small></label>
      <label class="field"><span>Jouw naam</span>
        <input id="ng-me" data-draft="me" value="${esc(d.me)}" placeholder="Zoals je vrienden je noemen" maxlength="40" autocomplete="given-name"></label>
      <fieldset class="field"><legend>Wie doet er nog mee?</legend>
        <small>Mag je ook leeg laten: vrienden kunnen zichzelf toevoegen via de link.</small>
        ${d.others.map((v, i) => `
          <div class="row-input">
            <input id="ng-o${i}" data-draft="others" data-i="${i}" value="${esc(v)}" placeholder="Naam" maxlength="40" autocomplete="off">
            <button type="button" class="icon-btn" data-act="draft-del" data-i="${i}" aria-label="Verwijder deze naam">${I.close}</button>
          </div>`).join('')}
        <button type="button" class="btn btn-ghost btn-small" data-act="draft-add">${I.plus}Nog iemand</button>
      </fieldset>
      <p class="form-error" id="ng-err" role="alert"></p>
      <button class="btn btn-sun btn-wide" type="submit">Regeling aanmaken</button>
    </form>
  </main>`;
}

function vLoading() {
  return `${topBar('#/', '')}
  <main class="page"><p class="loading">${S.slow ? 'Dit duurt lang. Controleer je internetverbinding.' : 'Regeling laden…'}</p></main>`;
}

function vMissing() {
  const known = mine()[S.gid];
  return `${topBar('#/', '')}
  <main class="page">
    <section class="intro"><h1>Regeling niet gevonden</h1>
      <p>Controleer of je de volledige link hebt gekregen.${S.store.mode === 'local' ? ' In demo-modus werken links alleen in de browser waar de regeling gemaakt is.' : ''}</p></section>
    ${known ? '<button class="btn btn-ghost btn-wide" data-act="hide-group">Verwijder uit je lijst</button>' : ''}
    <a class="btn btn-sun btn-wide" href="#/">Naar je regelingen</a>
  </main>`;
}

function vError() {
  const code = S.error?.code || '';
  const msg = code === 'permission-denied'
    ? 'Geen toegang tot deze regeling. Kijk na of de Firebase-regels gepubliceerd zijn.'
    : 'De regeling kon niet geladen worden. Controleer je verbinding en herlaad de pagina.';
  return `${topBar('#/', '')}<main class="page"><section class="intro"><h1>Er ging iets mis</h1><p>${msg}</p></section></main>`;
}

function vWho() {
  const g = S.group, uid = S.store.uid;
  const taken = m => (m.devices || []).length && !(m.devices || []).includes(uid);
  return `
  ${topBar('#/', `<span class="emoji">${esc(g.emoji)}</span><h1>${esc(g.name)}</h1>`)}
  <main class="page who">
    <h2 class="h-big">Wie ben jij?</h2>
    <p class="lead">Tik je naam aan. Staat die er niet bij, voeg jezelf dan toe.</p>
    ${S.members.length ? `<div class="who-grid">${S.members.map(m => `
      <button type="button" class="who-btn${S.claimArm === m.id ? ' armed' : ''}" data-act="claim" data-id="${m.id}">
        ${avatar(m.id, 'lg')}<b>${esc(m.name)}</b>
        ${S.claimArm === m.id ? `<small>Tik nog eens als jij ${esc(m.name)} bent</small>` : taken(m) ? '<small>Al gekozen op een ander toestel</small>' : ''}
      </button>`).join('')}</div>` : ''}
    <form class="who-new" data-form="join">
      <label for="join-name">Ik sta er niet bij</label>
      <div class="row-input">
        <input id="join-name" data-keep placeholder="Jouw naam" maxlength="40" autocomplete="given-name">
        <button class="btn btn-sun" type="submit">Meedoen</button>
      </div>
      <p class="form-error" id="join-err" role="alert"></p>
    </form>
  </main>`;
}

function vGroup() {
  const g = S.group, c = cur(), me = myId(), net = S.calc.byId[me]?.net || 0;
  const tabs = [['uitgaven', 'Uitgaven'], ['saldo', 'Saldo'], ['wijzigingen', 'Wijzigingen']];
  const label = net > 0 ? 'Je krijgt terug' : net < 0 ? 'Je moet nog betalen' : 'Je staat';
  return `
  ${topBar('#/', `<span class="emoji">${esc(g.emoji)}</span><h1>${esc(g.name)}</h1>`,
    `<a class="icon-btn" href="#/g/${S.gid}/instellingen" aria-label="Instellingen en uitnodigen">${I.gear}</a>`)}
  <section class="hero ${tone(net)}">
    <p class="hero-label">${label}</p>
    <p class="hero-amount">${net ? M.fmt(Math.abs(net), c) : 'quitte'}</p>
    <p class="hero-who">Je bent ${esc(nameOf(me))} in deze regeling</p>
  </section>
  <nav class="tabs" aria-label="Weergave"><div class="tabs-in">${tabs.map(([k, l]) => `
    <a href="#/g/${S.gid}${k === 'uitgaven' ? '' : '/' + k}" data-act="tab"${S.tab === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
  </div></nav>
  <main class="page with-fab">
    ${S.tab === 'saldo' ? tBalance() : S.tab === 'wijzigingen' ? tLog() : tExpenses()}
  </main>
  ${S.tab !== 'wijzigingen' ? `<button type="button" class="fab" data-act="new-expense">${I.plus}<span>Uitgave</span></button>` : ''}`;
}

function tExpenses() {
  const c = cur(), me = myId();
  if (!S.expenses.length) return `
    <div class="empty"><p class="empty-title">Nog niets ingegeven</p>
      <p>Tik op Uitgave zodra iemand iets betaalt voor de groep. Wie wat moet terugbetalen, rekent Quitte uit.</p></div>`;
  const list = [...S.expenses].sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.createdAt || 0) - (x.createdAt || 0));
  let out = `<dl class="stats">
    <div><dt>Samen uitgegeven</dt><dd>${M.fmt(S.calc.total, c)}</dd></div>
    <div><dt>Jouw kosten</dt><dd>${M.fmt(S.calc.byId[me]?.spent || 0, c)}</dd></div></dl>`;
  let day;
  for (const e of list) {
    if (e.date !== day) { if (day !== undefined) out += '</ul>'; day = e.date; out += `<h3 class="day">${dayLabel(day)}</h3><ul class="rows">`; }
    out += expRow(e, c, me);
  }
  return out + '</ul>';
}

function expRow(e, c, me) {
  const T = M.totalMinor(e, c);
  if (e.kind === 'transfer') {
    const to = Object.keys(e.parts || {})[0];
    return `<li><button type="button" class="exp-row" data-act="edit-expense" data-id="${e.id}">
      <span class="exp-icon">${I.swap}</span>
      <span class="exp-main"><b>${esc(who(e.paidBy))} → ${esc(to === me ? 'jou' : nameOf(to))}</b><small>Terugbetaling</small></span>
      <span class="exp-amt"><b>${M.fmt(T, c)}</b></span></button></li>`;
  }
  const part = M.shares(e, c)[me] || 0;
  const foreign = e.currency !== c ? ` ${M.fmtAmount(e.amount, e.currency)}` : '';
  return `<li><button type="button" class="exp-row" data-act="edit-expense" data-id="${e.id}">
    ${avatar(e.paidBy)}
    <span class="exp-main"><b>${esc(e.title)}</b><small>${esc(e.paidBy === me ? 'Jij betaalde' : nameOf(e.paidBy) + ' betaalde')}${foreign}</small></span>
    <span class="exp-amt"><b>${M.fmt(T, c)}</b><small>${part ? 'jouw deel ' + M.fmt(part, c) : 'niet voor jou'}</small></span></button></li>`;
}

function tBalance() {
  const c = cur(), me = myId(), by = S.calc.byId;
  const rows = S.members.map(m => ({ m, net: by[m.id]?.net || 0 })).sort((a, b) => b.net - a.net);
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  const bars = rows.map(({ m, net }) => {
    const label = `<span class="bal-label"><b>${esc(m.name)}${m.id === me ? ' (jij)' : ''}</b><span>${net ? M.fmt(net, c, true) : 'quitte'}</span></span>`;
    const bar = net ? `<span class="bal-bar" style="--w:${Math.max(4, Math.round(Math.abs(net) / max * 100))}%"></span>` : '';
    return `<li class="bal-row ${tone(net)}"><div class="bal-side left">${net < 0 ? bar : label}</div><div class="bal-side right">${net < 0 ? label : bar}</div></li>`;
  }).join('');
  const tr = M.settle(by);
  return `
    <div class="bal-wrap${S.animBal ? ' grow' : ''}">
      <p class="bal-cap"><span>moet nog betalen</span><span>krijgt terug</span></p>
      <ul class="bal">${bars}</ul>
    </div>
    ${tr.length ? `<h2 class="h-sec">Zo staan jullie quitte</h2><ul class="settle">${tr.map(t => settleRow(t, c, me)).join('')}</ul>`
      : S.expenses.length ? '<p class="all-even">Iedereen staat quitte. Er hoeft niemand iets te betalen.</p>' : ''}
    <button type="button" class="btn btn-ghost btn-wide" data-act="new-transfer">${I.swap}Terugbetaling ingeven</button>`;
}

function settleRow(t, c, me) {
  const to = member(t.to), canPay = to && M.validIban(to.iban);
  const sentence = `<b>${esc(who(t.from))}</b> betaalt <b>${esc(t.to === me ? 'jou' : nameOf(t.to))}</b>`;
  const data = `data-from="${t.from}" data-to="${t.to}" data-amount="${t.amount}"`;
  return `<li class="settle-row">
    <div class="settle-top">${avatar(t.from)}<p>${sentence}</p><b class="settle-amt">${M.fmt(t.amount, c)}</b></div>
    <div class="btn-row end">
      ${canPay ? `<button type="button" class="btn btn-small btn-ghost" data-act="pay" ${data}>Betaalgegevens</button>`
        : t.to === me ? `<button type="button" class="btn btn-small btn-ghost" data-act="edit-member" data-id="${me}">Rekeningnummer toevoegen</button>` : ''}
      <button type="button" class="btn btn-small btn-sun" data-act="settle" ${data}>Markeer als betaald</button>
    </div></li>`;
}

function logText(e) {
  const by = esc(e.by && member(e.by) ? nameOf(e.by) : e.byName || 'Iemand');
  const t = `<b>${esc(e.title || '')}</b>`;
  const amt = e.amount != null && e.currency ? esc(M.fmtAmount(e.amount, e.currency)) : '';
  const from = esc(e.fromName || ''), to = esc(e.toName || '');
  switch (e.type) {
    case 'group.create': return `${by} maakte de regeling aan`;
    case 'group.edit': return `${by} paste de regeling aan`;
    case 'member.join': return `${by} doet mee`;
    case 'member.add': return `${by} voegde ${esc(e.name)} toe`;
    case 'member.edit': return e.name === e.byName ? `${by} paste de eigen gegevens aan` : `${by} paste ${esc(e.name)} aan`;
    case 'member.delete': return `${by} verwijderde ${esc(e.name)}`;
    case 'expense.add': return `${by} voegde ${t} toe (${amt})`;
    case 'expense.edit': return `${by} paste ${t} aan`;
    case 'expense.delete': return `${by} verwijderde ${t} (${amt})`;
    case 'expense.restore': return `${by} zette ${t} terug`;
    case 'transfer.add': return `${by} registreerde dat ${from} ${amt} terugbetaalde aan ${to}`;
    case 'transfer.edit': return `${by} paste de terugbetaling van ${from} aan ${to} aan`;
    case 'transfer.delete': return `${by} verwijderde de terugbetaling van ${from} aan ${to} (${amt})`;
    case 'transfer.restore': return `${by} zette de terugbetaling van ${from} aan ${to} terug`;
    default: return `${by} wijzigde iets`;
  }
}

function tLog() {
  if (!S.log.length) return '<div class="empty"><p>Hier zie je wie wat toevoegde, aanpaste of verwijderde.</p></div>';
  const seen = new Set();
  let out = '', day;
  for (const e of S.log) {
    const d = dateStr(new Date(e.at));
    if (d !== day) { if (day !== undefined) out += '</ul>'; day = d; out += `<h3 class="day">${dayLabel(d)}</h3><ul class="rows log">`; }
    let restore = false;
    if (e.ref && /^(expense|transfer)[.]/.test(e.type || '')) {
      restore = e.snapshot && e.type.endsWith('.delete') && !seen.has(e.ref) && !S.expenses.some(x => x.id === e.ref);
      seen.add(e.ref);
    }
    out += `<li class="log-row">
      ${avatar(e.by || e.byName || '?', 'sm', e.by && member(e.by) ? nameOf(e.by) : e.byName)}
      <div class="log-main"><p>${logText(e)}</p>
        ${(e.changes || []).map(ch => `<p class="log-ch">${esc(ch.label)}${'a' in ch ? `: <s>${esc(ch.a)}</s> ${esc(ch.b)}` : ''}</p>`).join('')}
        <small>${timeFmt.format(e.at)}</small></div>
      ${restore ? `<button type="button" class="btn btn-small btn-ghost" data-act="restore" data-id="${e.id}">Terugzetten</button>` : ''}
    </li>`;
  }
  return out + '</ul>';
}

function inviteBlock() {
  const url = groupUrl();
  return `<div class="invite">
    <p>Stuur deze link naar wie meedoet. Ze tikken hun naam aan of voegen zichzelf toe.</p>
    <p class="link-box">${esc(url)}</p>
    <div class="btn-row">
      ${navigator.share ? `<button type="button" class="btn btn-sun" data-act="share-link">${I.share}Deel link</button>` : ''}
      <button type="button" class="btn btn-ghost" data-act="copy" data-copy="${esc(url)}" data-msg="Link gekopieerd">${I.copy}Kopieer link</button>
    </div>
    <details class="qr-details"><summary>QR-code om te scannen</summary><div class="qr">${qrSvg(url)}</div></details>
  </div>`;
}

function vSettings() {
  const g = S.group, me = myId();
  return `
  ${topBar(`#/g/${S.gid}`, '<h1>Instellingen</h1>')}
  <main class="page settings">
    <section><h2 class="h-sec">Regeling</h2>
      <button type="button" class="set-row" data-act="edit-group">
        <span class="emoji-tile">${esc(g.emoji)}</span>
        <span class="set-main"><b>${esc(g.name)}</b><small>Hoofdmunt: ${esc(curLabel(g.currency))}</small></span>${I.chev}
      </button></section>
    <section><h2 class="h-sec">Vrienden uitnodigen</h2>${inviteBlock()}</section>
    <section><h2 class="h-sec">Deelnemers</h2>
      <ul class="rows">${S.members.map(m => `<li><button type="button" class="set-row" data-act="edit-member" data-id="${m.id}">
        ${avatar(m.id)}<span class="set-main"><b>${esc(m.name)}${m.id === me ? ' (jij)' : ''}</b>
        <small>${m.iban ? esc(M.prettyIban(m.iban)) : 'Geen rekeningnummer'}</small></span>${I.chev}</button></li>`).join('')}
      </ul>
      <button type="button" class="btn btn-ghost btn-small" data-act="new-member">${I.plus}Deelnemer toevoegen</button></section>
    <section><h2 class="h-sec">Op dit toestel</h2>
      <p>Je bent <b>${esc(nameOf(me))}</b> in deze regeling.</p>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost btn-small" data-act="switch-me">Ik ben iemand anders</button>
        <button type="button" class="btn btn-ghost btn-small" data-act="hide-group">Verberg deze regeling</button>
      </div></section>
  </main>`;
}

// ---------- panelen (onderaan uitschuivend) ----------

function openSheet(kind, st = {}) {
  S.sheet = { kind, error: '', confirmDelete: false, ...st };
  if (!history.state?.sheet) history.pushState({ sheet: 1 }, '');
  renderSheet(true);
}
function closeSheet() { if (history.state?.sheet) history.back(); else dropSheet(); }
function dropSheet() {
  S.sheet = null;
  renderSheet();
}
function renderSheet(first) {
  const root = $('#sheet');
  if (!S.sheet) { root.hidden = true; root.innerHTML = ''; document.body.classList.remove('has-sheet'); return; }
  const scroll = $('.sheet-body', root)?.scrollTop || 0;
  root.hidden = false;
  document.body.classList.add('has-sheet');
  root.innerHTML = `<div class="scrim" data-act="close-sheet"></div>
    <section class="sheet${first ? ' enter' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${SHEETS[S.sheet.kind]()}</section>`;
  const body = $('.sheet-body', root);
  if (body) body.scrollTop = scroll;
  if (S.sheet.kind === 'expense') updateEditor();
  if (first) {
    const f = $('[data-autofocus]', root);
    if (f) setTimeout(() => f.focus(), 60); else $('.sheet-head button', root)?.focus();
  }
}

const sheetHead = (title, saveAct, saveLabel = 'Opslaan') => `
  <header class="sheet-head">
    <button type="button" class="icon-btn" data-act="close-sheet" aria-label="Sluiten">${I.close}</button>
    <h2 id="sheet-title">${title}</h2>
    ${saveAct ? `<button type="button" class="btn btn-sun btn-small" data-act="${saveAct}">${saveLabel}</button>` : '<span class="icon-space"></span>'}
  </header>`;

const chip = (act, m, on) => `<button type="button" class="chip" data-act="${act}" data-id="${m.id}" aria-pressed="${on}">${avatar(m.id, 'xs')}${esc(m.name)}</button>`;

const deleteBlock = (act, label) => `<div class="danger">${S.sheet.confirmDelete
  ? `<p>Zeker weten? Je kan het daarna nog terugzetten via Wijzigingen.</p><div class="btn-row"><button type="button" class="btn btn-danger" data-act="${act}">Ja, verwijderen</button><button type="button" class="btn btn-ghost" data-act="cancel-delete">Toch niet</button></div>`
  : `<button type="button" class="btn btn-ghost btn-danger-text" data-act="${act}">${label}</button>`}</div>`;

const SHEETS = {
  expense: shExpense, transfer: shTransfer, member: shMember, group: shGroup, pay: shPay,
  share: () => `${sheetHead('Vrienden uitnodigen')}<div class="sheet-body">${inviteBlock()}
    <button type="button" class="btn btn-ghost btn-wide" data-act="close-sheet">Klaar</button></div>`,
};

// ---------- uitgave ----------

function startExpense(e) {
  const c = cur(), ids = S.members.map(m => m.id);
  const st = {
    id: e?.id || null, orig: e || null,
    title: e?.title || '', amountStr: e ? M.inputValue(e.amount, e.currency) : '',
    currency: e?.currency || mine()[S.gid]?.lastCur || c, date: e?.date || M.todayStr(), paidBy: e?.paidBy || myId(),
    mode: e?.mode || 'equal', inc: new Set(ids), exact: {}, shares: {}, pct: {},
    rate: e?.rate || 1, rateDate: e?.rateDate || null, rateSource: e?.rateSource || 'ecb', rateState: 'idle', rateStr: '',
  };
  if (!M.CURRENCIES.includes(st.currency)) st.currency = c;
  ids.forEach(id => { st.shares[id] = '1'; });
  if (e) {
    const parts = e.parts || {};
    st.inc = new Set(Object.keys(parts).filter(id => parts[id]));
    if (e.mode === 'exact') for (const [id, v] of Object.entries(parts)) st.exact[id] = M.inputValue(v, e.currency);
    if (e.mode === 'shares') { ids.forEach(id => { st.shares[id] = '0'; }); for (const [id, v] of Object.entries(parts)) st.shares[id] = String(v).replace('.', ','); }
    if (e.mode === 'percent') for (const [id, v] of Object.entries(parts)) st.pct[id] = String(v).replace('.', ',');
    if (e.rateSource === 'manual') st.rateStr = fmtRate(e.rate);
  }
  openSheet('expense', st);
  if (!e && st.currency !== c) refreshRate();
}

function shExpense() {
  const st = S.sheet, c = cur(), foreign = st.currency !== c;
  return `${sheetHead(st.id ? 'Uitgave aanpassen' : 'Nieuwe uitgave', 'save-expense')}
  <div class="sheet-body">
    <div class="amount-field">
      <input id="ex-amount" data-ex="amountStr" inputmode="decimal" placeholder="0,00" value="${esc(st.amountStr)}" aria-label="Bedrag" autocomplete="off"${st.id ? '' : ' data-autofocus'}>
      <select id="ex-cur" data-ex="currency" aria-label="Munt">${currencyOptions(st.currency, true)}</select>
    </div>
    ${foreign ? `<div class="rate" data-out="rate">${rateHtml()}</div>` : ''}
    <label class="field"><span>Omschrijving</span>
      <input id="ex-title" data-ex="title" value="${esc(st.title)}" placeholder="Sushi, taxi, boodschappen…" maxlength="80" autocomplete="off"></label>
    <label class="field"><span>Datum</span><input id="ex-date" type="date" data-ex="date" value="${esc(st.date)}"></label>
    <fieldset class="field"><legend>Betaald door</legend>
      <div class="chips">${S.members.map(m => chip('ex-payer', m, st.paidBy === m.id)).join('')}</div></fieldset>
    <fieldset class="field"><legend>Voor wie</legend>
      <div class="seg" role="radiogroup" aria-label="Manier van verdelen">${MODES.map(([k, l]) => `
        <button type="button" role="radio" aria-checked="${st.mode === k}" data-act="ex-mode" data-v="${k}">${l}</button>`).join('')}</div>
      <p class="seg-hint">${{
        equal: 'Iedereen die aangevinkt is, betaalt evenveel.',
        exact: `Vul per persoon het bedrag in ${esc(st.currency)} in.`,
        shares: 'Wie 2 delen heeft, betaalt dubbel zoveel als wie 1 deel heeft. Een halve mag ook.',
        percent: 'Samen moet het 100 % zijn.',
      }[st.mode]}</p>
      ${st.mode === 'equal' ? `<button type="button" class="link" data-act="ex-all">${st.inc.size === S.members.length ? 'Niemand aanvinken' : 'Iedereen aanvinken'}</button>` : ''}
      <ul class="split">${S.members.map(splitRow).join('')}</ul>
      <p class="split-status" data-out="status"></p>
    </fieldset>
    <p class="form-error" data-out="error" role="alert">${esc(st.error)}</p>
    ${st.id ? deleteBlock('delete-expense', 'Uitgave verwijderen') : ''}
  </div>`;
}

function splitRow(m) {
  const st = S.sheet, id = m.id, name = esc(m.name);
  const out = `<span class="split-amt" data-out="amt-${id}"></span>`;
  if (st.mode === 'equal') return `<li class="split-row">
    <label class="check"><input type="checkbox" data-ex-inc="${id}"${st.inc.has(id) ? ' checked' : ''}><span class="box"></span>${avatar(id, 'sm')}<span class="split-name">${name}</span></label>${out}</li>`;
  // Bij delen en procenten staat het bedrag onder de naam, anders past de rij niet op een smalle gsm.
  const named = `${avatar(id, 'sm')}<span class="split-name">${name}<small data-out="amt-${id}"></small></span>`;
  if (st.mode === 'exact') return `<li class="split-row">
    ${avatar(id, 'sm')}<span class="split-name">${name}</span>
    <input class="split-in" inputmode="decimal" data-ex-exact="${id}" value="${esc(st.exact[id] || '')}" placeholder="0" aria-label="Bedrag voor ${name}" autocomplete="off"></li>`;
  if (st.mode === 'shares') return `<li class="split-row">
    ${named}
    <span class="stepper">
      <button type="button" data-act="ex-step" data-id="${id}" data-d="-1" aria-label="Een deel minder voor ${name}">${I.minus}</button>
      <input inputmode="decimal" data-ex-share="${id}" value="${esc(st.shares[id] ?? '0')}" aria-label="Delen voor ${name}" autocomplete="off">
      <button type="button" data-act="ex-step" data-id="${id}" data-d="1" aria-label="Een deel meer voor ${name}">${I.plus}</button>
    </span></li>`;
  return `<li class="split-row">
    ${named}
    <span class="pct"><input inputmode="decimal" data-ex-pct="${id}" value="${esc(st.pct[id] || '')}" placeholder="0" aria-label="Percentage voor ${name}" autocomplete="off"><span>%</span></span></li>`;
}

function rateHtml() {
  const st = S.sheet, c = cur(), ecb = M.ECB.includes(st.currency);
  if (st.rateState === 'loading') return '<p class="rate-line">Koers ophalen…</p>';
  if (st.rateSource === 'manual' || !ecb) return `
    <label class="rate-in"><span>1 ${st.currency} =</span>
      <input id="ex-rate" data-ex="rateStr" inputmode="decimal" value="${esc(st.rateStr)}" placeholder="koers" autocomplete="off"><span>${c}</span></label>
    <p class="rate-line"><span>${!ecb ? 'Voor deze munt heeft de ECB geen koers. Vul ze zelf in.'
      : st.rateState === 'error' ? 'De koers ophalen lukte niet. Vul ze zelf in.'
      : '<button type="button" class="link" data-act="ex-rate-auto">ECB-koers gebruiken</button>'}</span><b data-out="conv"></b></p>`;
  return `<p class="rate-line"><span>1 ${st.currency} = ${fmtRate(st.rate)} ${c}<small>ECB-koers van ${shortDate(st.rateDate)}</small></span><b data-out="conv"></b></p>
    <button type="button" class="link" data-act="ex-rate-manual">Koers aanpassen</button>`;
}

async function refreshRate() {
  const st = S.sheet, c = cur();
  if (!st || st.kind !== 'expense' || st.currency === c || st.rateSource === 'manual') return;
  if (!M.ECB.includes(st.currency)) { st.rateSource = 'manual'; renderSheet(); return; }
  const token = (st.rateToken = {});
  st.rateState = 'loading';
  redrawRate();
  try {
    const r = await M.fetchRate(st.currency, c, st.date || M.todayStr());
    if (st.rateToken !== token) return;
    Object.assign(st, { rate: r.rate, rateDate: r.date, rateSource: 'ecb', rateState: 'idle' });
  } catch {
    if (st.rateToken !== token) return;
    Object.assign(st, { rateState: 'error', rateSource: 'manual', rate: M.parseNumber(st.rateStr) });
  }
  if (S.sheet === st) { redrawRate(); updateEditor(); }
}

function redrawRate() {
  const el = $('#sheet [data-out="rate"]');
  if (el) el.innerHTML = rateHtml(); else renderSheet();
}

function exCalc() {
  const st = S.sheet, ec = st.currency;
  const amount = M.parseAmount(st.amountStr), ok = amount > 0;
  const total = ok ? M.toMinor(amount, ec) : 0;
  const weights = {};
  let status = '', valid = ok;
  if (st.mode === 'equal') {
    st.inc.forEach(id => { weights[id] = 1; });
    if (!st.inc.size) { status = 'Vink minstens één persoon aan.'; valid = false; }
  } else if (st.mode === 'shares') {
    for (const [id, v] of Object.entries(st.shares)) { const n = M.parseNumber(v); if (n > 0) weights[id] = n; }
    if (!Object.keys(weights).length) { status = 'Geef minstens één persoon een deel.'; valid = false; }
  } else if (st.mode === 'percent') {
    let sum = 0;
    for (const [id, v] of Object.entries(st.pct)) { const n = M.parseNumber(v); if (n > 0) { weights[id] = n; sum += n; } }
    const diff = Math.round((100 - sum) * 100) / 100;
    if (Math.abs(diff) > 0.05) { valid = false; status = diff > 0 ? `Nog ${fmtRate(diff)} % te verdelen` : `${fmtRate(-diff)} % te veel`; }
  } else {
    let sum = 0;
    for (const [id, v] of Object.entries(st.exact)) { const n = M.toMinor(M.parseAmount(v) || 0, ec); if (n > 0) { weights[id] = n; sum += n; } }
    const diff = total - sum;
    if (!sum) { valid = false; status = ok ? 'Vul in hoeveel elk moet betalen.' : ''; }
    else if (diff) { valid = false; status = diff > 0 ? `Nog ${M.fmt(diff, ec)} te verdelen` : `${M.fmt(-diff, ec)} te veel`; }
    else status = 'Klopt precies.';
  }
  return { amount, ok, total, weights, valid, status, alloc: ok ? M.allocate(total, weights, st.id || '') : {} };
}

function updateEditor() {
  const st = S.sheet, root = $('#sheet'), r = exCalc(), c = cur();
  for (const m of S.members) {
    const el = root.querySelector(`[data-out="amt-${m.id}"]`);
    if (el) el.textContent = r.alloc[m.id] ? M.fmt(r.alloc[m.id], st.currency) : '';
  }
  const status = root.querySelector('[data-out="status"]');
  if (status) { status.textContent = r.status; status.classList.toggle('warn', r.ok && !r.valid); }
  const conv = root.querySelector('[data-out="conv"]');
  if (conv) conv.textContent = r.ok && st.rate > 0 ? '= ' + M.fmt(M.toMinor(r.amount * st.rate, c), c) : '';
}

function showSheetError(msg) {
  S.sheet.error = msg;
  const el = $('#sheet [data-out="error"]');
  if (el) { el.textContent = msg; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

function splitSummary(e) {
  const ids = Object.keys(M.weightsOf(e));
  const names = ids.length <= 3 ? ids.map(nameOf).join(', ') : `${ids.length} personen`;
  return { equal: 'gelijk over ', exact: 'bedragen voor ', shares: 'delen voor ', percent: 'procenten voor ' }[e.mode] + names;
}
const sameParts = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

function diffExpense(a, b) {
  const ch = [];
  if (a.title !== b.title) ch.push({ label: 'Omschrijving', a: a.title, b: b.title });
  if (a.amount !== b.amount || a.currency !== b.currency) ch.push({ label: 'Bedrag', a: M.fmtAmount(a.amount, a.currency), b: M.fmtAmount(b.amount, b.currency) });
  else if (a.rate !== b.rate && b.currency !== cur()) ch.push({ label: 'Koers', a: fmtRate(a.rate), b: fmtRate(b.rate) });
  if (a.paidBy !== b.paidBy) ch.push({ label: b.kind === 'transfer' ? 'Van' : 'Betaald door', a: nameOf(a.paidBy), b: nameOf(b.paidBy) });
  if (a.date !== b.date) ch.push({ label: 'Datum', a: shortDate(a.date), b: shortDate(b.date) });
  if (b.kind === 'transfer') {
    const ta = Object.keys(a.parts || {})[0], tb = Object.keys(b.parts || {})[0];
    if (ta !== tb) ch.push({ label: 'Aan', a: nameOf(ta), b: nameOf(tb) });
  } else if (a.mode !== b.mode || !sameParts(a.parts, b.parts)) {
    ch.push({ label: 'Verdeling', a: splitSummary(a), b: splitSummary(b) });
  }
  return ch;
}

function saveExpense() {
  const st = S.sheet, c = cur(), r = exCalc(), title = st.title.trim(), foreign = st.currency !== c;
  const err = !r.ok ? 'Vul een bedrag in.'
    : !title ? 'Vul een omschrijving in.'
    : !member(st.paidBy) ? 'Kies wie betaalde.'
    : foreign && !(st.rate > 0) ? 'Vul een geldige wisselkoers in.'
    : !r.valid ? r.status || 'De verdeling klopt nog niet.' : '';
  if (err) return showSheetError(err);
  const nums = (obj, parse = M.parseNumber) => Object.fromEntries(Object.entries(obj).map(([id, v]) => [id, parse(v)]).filter(([, n]) => n > 0));
  const parts = st.mode === 'equal' ? Object.fromEntries([...st.inc].map(id => [id, 1]))
    : st.mode === 'exact' ? nums(st.exact, M.parseAmount) : st.mode === 'shares' ? nums(st.shares) : nums(st.pct);
  const now = Date.now(), me = myId(), id = st.id || S.store.newId();
  const data = {
    kind: 'expense', title, amount: r.amount, currency: st.currency,
    rate: foreign ? st.rate : 1, rateDate: foreign && st.rateSource === 'ecb' ? st.rateDate : null,
    rateSource: foreign ? st.rateSource : 'same',
    paidBy: st.paidBy, mode: st.mode, parts, date: st.date || M.todayStr(),
    createdAt: st.orig?.createdAt || now, createdBy: st.orig?.createdBy || me, updatedAt: now, updatedBy: me,
  };
  const ops = [{ col: 'expenses', id, op: 'set', data }];
  if (st.orig) {
    const changes = diffExpense(st.orig, data);
    if (!changes.length) return closeSheet();
    ops.push(logOp('expense.edit', { ref: id, title, amount: data.amount, currency: data.currency, changes }));
  } else {
    ops.push(logOp('expense.add', { ref: id, title, amount: data.amount, currency: data.currency }));
  }
  commit(ops);
  remember(S.gid, { lastCur: st.currency });
  closeSheet();
  toast(st.orig ? 'Uitgave aangepast' : 'Uitgave toegevoegd');
}

const transferNames = e => ({ fromName: nameOf(e.paidBy), toName: nameOf(Object.keys(e.parts || {})[0]) });

function deleteEntry() {
  const st = S.sheet;
  if (!st.confirmDelete) { st.confirmDelete = true; renderSheet(); return; }
  const { id, ...snap } = st.orig, isT = snap.kind === 'transfer';
  commit([{ col: 'expenses', id, op: 'delete' },
    logOp(isT ? 'transfer.delete' : 'expense.delete', { ref: id, title: snap.title, amount: snap.amount, currency: snap.currency, snapshot: snap, ...(isT ? transferNames(snap) : {}) })]);
  closeSheet();
  toast(isT ? 'Terugbetaling verwijderd' : 'Uitgave verwijderd', { label: 'Ongedaan maken', run: () => restoreEntry(id, snap) });
}

function restoreEntry(id, snap) {
  if (S.expenses.some(x => x.id === id)) return;
  const isT = snap.kind === 'transfer';
  commit([{ col: 'expenses', id, op: 'set', data: snap },
    logOp(isT ? 'transfer.restore' : 'expense.restore', { ref: id, title: snap.title, amount: snap.amount, currency: snap.currency, ...(isT ? transferNames(snap) : {}) })]);
  toast('Teruggezet');
}

// ---------- terugbetaling ----------

function startTransfer(e, pre = {}) {
  const c = cur(), me = myId();
  const from = e?.paidBy || pre.from || me;
  const to = e ? Object.keys(e.parts || {})[0] : pre.to || S.members.find(m => m.id !== from)?.id;
  openSheet('transfer', {
    id: e?.id || null, orig: e || null, from, to,
    amountStr: e ? M.inputValue(e.amount, c) : pre.amount ? M.inputValue(M.fromMinor(pre.amount, c), c) : '',
    date: e?.date || M.todayStr(),
  });
}

function shTransfer() {
  const st = S.sheet;
  return `${sheetHead(st.id ? 'Terugbetaling aanpassen' : 'Terugbetaling', 'save-transfer')}
  <div class="sheet-body">
    <p class="seg-hint">Geld dat iemand rechtstreeks aan een ander gaf, bijvoorbeeld om quitte te staan.</p>
    <div class="amount-field">
      <input id="tr-amount" data-f="amountStr" inputmode="decimal" placeholder="0,00" value="${esc(st.amountStr)}" aria-label="Bedrag" autocomplete="off"${st.id ? '' : ' data-autofocus'}>
      <span class="amount-cur">${cur()}</span>
    </div>
    <fieldset class="field"><legend>Van</legend><div class="chips">${S.members.map(m => chip('tr-from', m, st.from === m.id)).join('')}</div></fieldset>
    <fieldset class="field"><legend>Aan</legend><div class="chips">${S.members.map(m => chip('tr-to', m, st.to === m.id)).join('')}</div></fieldset>
    <label class="field"><span>Datum</span><input type="date" data-f="date" value="${esc(st.date)}"></label>
    <p class="form-error" data-out="error" role="alert">${esc(st.error)}</p>
    ${st.id ? deleteBlock('delete-expense', 'Terugbetaling verwijderen') : ''}
  </div>`;
}

function transferData(from, to, amount, date, orig) {
  const c = cur(), now = Date.now(), me = myId();
  return {
    kind: 'transfer', title: 'Terugbetaling', amount, currency: c, rate: 1, rateDate: null, rateSource: 'same',
    paidBy: from, mode: 'exact', parts: { [to]: amount }, date,
    createdAt: orig?.createdAt || now, createdBy: orig?.createdBy || me, updatedAt: now, updatedBy: me,
  };
}

function saveTransfer() {
  const st = S.sheet, amount = M.parseAmount(st.amountStr);
  const err = !(amount > 0) ? 'Vul een bedrag in.' : !member(st.from) || !member(st.to) ? 'Kies wie betaalde en wie het kreeg.'
    : st.from === st.to ? 'Van en aan moeten twee verschillende personen zijn.' : '';
  if (err) return showSheetError(err);
  const id = st.id || S.store.newId(), data = transferData(st.from, st.to, amount, st.date || M.todayStr(), st.orig);
  const base = { ref: id, amount, currency: data.currency, ...transferNames(data) };
  if (st.orig) {
    const changes = diffExpense(st.orig, data);
    if (!changes.length) return closeSheet();
    commit([{ col: 'expenses', id, op: 'set', data }, logOp('transfer.edit', { ...base, changes })]);
  } else {
    commit([{ col: 'expenses', id, op: 'set', data }, logOp('transfer.add', base)]);
  }
  closeSheet();
  toast(st.orig ? 'Terugbetaling aangepast' : 'Terugbetaling geregistreerd');
}

function settleNow(from, to, minor) {
  const c = cur(), id = S.store.newId(), amount = M.fromMinor(minor, c);
  const data = transferData(from, to, amount, M.todayStr());
  commit([{ col: 'expenses', id, op: 'set', data }, logOp('transfer.add', { ref: id, amount, currency: c, ...transferNames(data) })]);
  if (S.sheet) closeSheet();
  toast('Terugbetaling geregistreerd', {
    label: 'Ongedaan maken',
    run: () => commit([{ col: 'expenses', id, op: 'delete' }, logOp('transfer.delete', { ref: id, amount, currency: c, snapshot: data, ...transferNames(data) })]),
  });
}

function payInfo(st) {
  const to = member(st.to);
  if (!to) return null;
  const holder = to.holder || to.name, text = `Quitte ${S.group.name}`.slice(0, 140);
  const epc = cur() === 'EUR' ? M.epcPayload({ name: holder, iban: to.iban, minor: st.amount, text }) : '';
  return { to, holder, text, epc };
}

function shPay() {
  const st = S.sheet, c = cur(), me = myId(), p = payInfo(st);
  if (!p) return `${sheetHead('Betalen')}<div class="sheet-body"><p>Deze persoon bestaat niet meer.</p></div>`;
  const { to, holder, text, epc } = p, tap = epc && canShareQr();
  const amountTxt = M.inputValue(M.fromMinor(st.amount, c), c);
  return `${sheetHead(`Betalen aan ${esc(to.name)}`)}
  <div class="sheet-body pay">
    <p class="pay-amt">${M.fmt(st.amount, c)}</p>
    <p class="pay-sub">${esc(who(st.from))} betaalt ${esc(st.to === me ? 'jou' : to.name)}</p>
    ${!epc ? '' : tap ? `<button type="button" class="qr qr-tap" data-act="share-qr" aria-label="Deel of bewaar de betaal-QR">${qrSvg(epc)}</button>
      <p class="seg-hint center">Tik op de code om hem te delen of te bewaren. Bedrag en mededeling staan er al in.</p>`
    : `<div class="qr">${qrSvg(epc)}</div>
      <p class="seg-hint center">Scan met je bankapp. Bedrag en mededeling staan er al in.</p>`}
    <dl class="pay-data">
      <div><dt>Rekeningnummer</dt><dd>${esc(M.prettyIban(to.iban))}</dd>
        <button type="button" class="btn btn-small btn-ghost" data-act="copy" data-copy="${esc(M.normIban(to.iban))}" data-msg="Rekeningnummer gekopieerd">${I.copy}Kopieer</button></div>
      <div><dt>Op naam van</dt><dd>${esc(holder)}</dd></div>
      <div><dt>Bedrag</dt><dd>${M.fmt(st.amount, c)}</dd>
        <button type="button" class="btn btn-small btn-ghost" data-act="copy" data-copy="${esc(amountTxt)}" data-msg="Bedrag gekopieerd">${I.copy}Kopieer</button></div>
      <div><dt>Mededeling</dt><dd>${esc(text)}</dd>
        <button type="button" class="btn btn-small btn-ghost" data-act="copy" data-copy="${esc(text)}" data-msg="Mededeling gekopieerd">${I.copy}Kopieer</button></div>
    </dl>
    <button type="button" class="btn btn-sun btn-wide" data-act="settle" data-from="${st.from}" data-to="${st.to}" data-amount="${st.amount}">${st.from === me ? 'Ik heb betaald' : 'Markeer als betaald'}</button>
  </div>`;
}

// ---------- deelnemers ----------

function startMember(m) {
  openSheet('member', { id: m?.id || null, orig: m || null, name: m?.name || '', iban: m?.iban ? M.prettyIban(m.iban) : '', holder: m?.holder || '' });
}

const usedInExpenses = id => S.expenses.some(e => e.paidBy === id || (e.parts && id in e.parts));

function shMember() {
  const st = S.sheet, isMe = st.id && st.id === myId();
  const canDelete = st.id && !isMe && !usedInExpenses(st.id);
  return `${sheetHead(st.id ? (isMe ? 'Jouw gegevens' : esc(st.orig.name)) : 'Deelnemer toevoegen', 'save-member')}
  <div class="sheet-body">
    <label class="field"><span>Naam</span><input id="mb-name" data-f="name" value="${esc(st.name)}" maxlength="40" autocomplete="off"${st.id ? '' : ' data-autofocus'}></label>
    <label class="field"><span>Rekeningnummer (IBAN)</span>
      <input id="mb-iban" data-f="iban" value="${esc(st.iban)}" placeholder="BE00 0000 0000 0000" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <small>Mag leeg blijven. Met een rekeningnummer kunnen anderen terugbetalen via een QR-code in hun bankapp.</small></label>
    <label class="field"><span>Naam van de rekeninghouder</span>
      <input id="mb-holder" data-f="holder" value="${esc(st.holder)}" placeholder="${esc(st.name || 'Voornaam Achternaam')}" maxlength="70" autocomplete="off">
      <small>Zoals bij de bank, als die anders is dan de naam hierboven. Banken controleren die naam bij een overschrijving.</small></label>
    <p class="form-error" data-out="error" role="alert">${esc(st.error)}</p>
    ${canDelete ? deleteBlock('delete-member', 'Deelnemer verwijderen')
      : st.id && !isMe ? `<p class="seg-hint">${esc(st.orig.name)} komt voor in uitgaven en kan daarom niet verwijderd worden.</p>` : ''}
  </div>`;
}

function saveMember() {
  const st = S.sheet, name = st.name.trim(), iban = M.normIban(st.iban), holder = st.holder.trim();
  const dup = S.members.some(m => m.id !== st.id && m.name.trim().toLowerCase() === name.toLowerCase());
  const err = !name ? 'Vul een naam in.' : dup ? 'Die naam bestaat al in deze regeling.'
    : iban && !M.validIban(iban) ? 'Dat rekeningnummer klopt niet. Kijk het nog eens na.' : '';
  if (err) return showSheetError(err);
  if (st.orig) {
    const o = st.orig, changes = [];
    if (o.name !== name) changes.push({ label: 'Naam', a: o.name, b: name });
    // Het nummer zelf hoort niet in het log; alleen dat het veranderde.
    if ((o.iban || '') !== iban) changes.push({ label: !o.iban ? 'Rekeningnummer toegevoegd' : iban ? 'Rekeningnummer gewijzigd' : 'Rekeningnummer verwijderd' });
    if ((o.holder || '') !== holder) changes.push({ label: 'Rekeninghouder', a: o.holder || 'leeg', b: holder || 'leeg' });
    if (!changes.length) return closeSheet();
    commit([{ col: 'members', id: o.id, op: 'merge', data: { name, iban, holder } }, logOp('member.edit', { name, changes })]);
    toast('Opgeslagen');
  } else {
    commit([{ col: 'members', id: S.store.newId(), op: 'set', data: { name, iban, holder, devices: [], createdAt: Date.now() } }, logOp('member.add', { name })]);
    toast(`${name} doet mee`);
  }
  closeSheet();
}

function deleteMember() {
  const st = S.sheet;
  if (!st.confirmDelete) { st.confirmDelete = true; renderSheet(); return; }
  if (usedInExpenses(st.id)) return showSheetError('Deze persoon komt voor in uitgaven.');
  commit([{ col: 'members', id: st.id, op: 'delete' }, logOp('member.delete', { name: st.orig.name })]);
  closeSheet();
  toast(`${st.orig.name} verwijderd`);
}

// ---------- regeling aanpassen ----------

function shGroup() {
  const st = S.sheet, locked = S.expenses.length > 0;
  return `${sheetHead('Regeling aanpassen', 'save-group')}
  <div class="sheet-body">
    <fieldset class="field"><legend>Icoon</legend>${emojiPicker(st.emoji, 'grp-emoji')}</fieldset>
    <label class="field"><span>Naam</span><input id="gr-name" data-f="name" value="${esc(st.name)}" maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Hoofdmunt</span>
      <select data-f="currency"${locked ? ' disabled' : ''}>${currencyOptions(st.currency)}</select>
      ${locked ? '<small>Er zijn al uitgaven, dus de hoofdmunt ligt vast.</small>' : ''}</label>
    <p class="form-error" data-out="error" role="alert">${esc(st.error)}</p>
  </div>`;
}

function saveGroup() {
  const st = S.sheet, g = S.group, name = st.name.trim();
  if (!name) return showSheetError('Geef de regeling een naam.');
  const currency = S.expenses.length ? g.currency : st.currency;
  const changes = [];
  if (g.name !== name) changes.push({ label: 'Naam', a: g.name, b: name });
  if (g.emoji !== st.emoji) changes.push({ label: 'Icoon', a: g.emoji, b: st.emoji });
  if (g.currency !== currency) changes.push({ label: 'Hoofdmunt', a: g.currency, b: currency });
  if (!changes.length) return closeSheet();
  commit([{ col: null, op: 'merge', data: { name, emoji: st.emoji, currency } }, logOp('group.edit', { changes })]);
  closeSheet();
  toast('Opgeslagen');
}

// ---------- aanmaken en meedoen ----------

function formError(id, msg, focusId) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
  if (focusId) document.getElementById(focusId)?.focus();
}

function createGroup() {
  const d = S.draft, name = d.name.trim(), meName = d.me.trim();
  if (!name) return formError('ng-err', 'Geef de regeling een naam.', 'ng-name');
  if (!meName) return formError('ng-err', 'Vul je eigen naam in.', 'ng-me');
  const seen = new Set([meName.toLowerCase()]);
  const others = d.others.map(s => s.trim()).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  const st = S.store, gid = st.newId(), meId = st.newId(), now = Date.now();
  const ops = [
    { col: null, op: 'set', data: { name, emoji: d.emoji, currency: d.currency, createdAt: now, createdBy: st.uid } },
    { col: 'members', id: meId, op: 'set', data: { name: meName, iban: '', holder: '', devices: [st.uid], createdAt: now } },
    ...others.map((n, i) => ({ col: 'members', id: st.newId(), op: 'set', data: { name: n, iban: '', holder: '', devices: [], createdAt: now + i + 1 } })),
    { col: 'log', id: st.newId(), op: 'set', data: { at: now, by: meId, byName: meName, type: 'group.create' } },
  ];
  commitTo(gid, ops);
  remember(gid, { me: meId, name, emoji: d.emoji, currency: d.currency, net: 0, opened: now });
  S.draft = null;
  S.afterCreate = gid;
  location.hash = '#/g/' + gid;
}

function claim(id) {
  const m = member(id), uid = S.store.uid;
  if (!m) return;
  const devices = m.devices || [];
  if (devices.length && !devices.includes(uid) && S.claimArm !== id) { S.claimArm = id; render(); return; }
  S.claimArm = null;
  const ops = [{ col: 'members', id, op: 'merge', data: { devices: [...devices.filter(u => u !== uid), uid] } }];
  if (!devices.length) ops.push(logOp('member.join', {}, id));
  remember(S.gid, { me: id, name: S.group.name, emoji: S.group.emoji, currency: S.group.currency, opened: Date.now() });
  commit(ops);
  changed();
  toast(`Welkom, ${m.name}`);
}

function joinGroup(form) {
  const input = form.querySelector('input'), name = input.value.trim();
  if (!name) return formError('join-err', 'Vul je naam in.', 'join-name');
  const same = S.members.find(m => m.name.trim().toLowerCase() === name.toLowerCase());
  if (same) return formError('join-err', `${same.name} staat er al bij. Ben jij dat? Tik de naam dan hierboven aan.`);
  const id = S.store.newId();
  input.value = '';
  remember(S.gid, { me: id, name: S.group.name, emoji: S.group.emoji, currency: S.group.currency, opened: Date.now() });
  commit([{ col: 'members', id, op: 'set', data: { name, iban: '', holder: '', devices: [S.store.uid], createdAt: Date.now() } },
    { col: 'log', id: S.store.newId(), op: 'set', data: { at: Date.now(), by: id, byName: name, type: 'member.join' } }]);
  toast(`Welkom, ${name}`);
}

function openLink(form) {
  const v = form.querySelector('input').value.trim();
  const gid = v.match(/#\/g\/([A-Za-z0-9]+)/)?.[1] || (/^[A-Za-z0-9]{12,}$/.test(v) ? v : null);
  if (!gid) return formError('link-err', 'Dat lijkt geen Quitte-link. Plak de volledige link die je kreeg.', 'link-in');
  form.querySelector('input').value = '';
  location.hash = '#/g/' + gid;
}

function switchMe() {
  const me = member(myId()), uid = S.store.uid;
  if (me && (me.devices || []).includes(uid)) commit([{ col: 'members', id: me.id, op: 'merge', data: { devices: me.devices.filter(u => u !== uid) } }]);
  remember(S.gid, { me: null });
  location.hash = '#/g/' + S.gid;
  render();
}

function hideGroup() {
  forget(S.gid);
  location.hash = '#/';
  toast('Regeling verborgen. Open de link opnieuw om ze terug te halen.');
}

// ---------- gebeurtenissen ----------

const num = el => Number(el.dataset.amount);
const ACT = {
  'close-sheet': () => closeSheet(),
  tab: el => location.replace(el.getAttribute('href')),
  'draft-emoji': el => { S.draft.emoji = el.dataset.v; render(); },
  'draft-add': () => { S.draft.others.push(''); render(); document.getElementById(`ng-o${S.draft.others.length - 1}`)?.focus(); },
  'draft-del': el => { S.draft.others.splice(+el.dataset.i, 1); if (!S.draft.others.length) S.draft.others.push(''); render(); },
  claim: el => claim(el.dataset.id),
  'new-expense': () => startExpense(null),
  'edit-expense': el => { const e = S.expenses.find(x => x.id === el.dataset.id); if (e) (e.kind === 'transfer' ? startTransfer(e) : startExpense(e)); },
  'new-transfer': () => startTransfer(null),
  'ex-mode': el => {
    const st = S.sheet; st.mode = el.dataset.v;
    if (st.mode === 'percent' && !Object.values(st.pct).some(Boolean) && st.inc.size) {
      const each = Math.round(10000 / st.inc.size) / 100;
      st.inc.forEach(id => { st.pct[id] = String(each).replace('.', ','); });
    }
    renderSheet();
  },
  'ex-payer': el => { S.sheet.paidBy = el.dataset.id; renderSheet(); },
  'ex-all': () => { const st = S.sheet; st.inc = st.inc.size === S.members.length ? new Set() : new Set(S.members.map(m => m.id)); renderSheet(); },
  'ex-step': el => {
    const st = S.sheet, id = el.dataset.id;
    const n = Math.max(0, Math.floor((M.parseNumber(st.shares[id]) || 0) + Number(el.dataset.d)));
    st.shares[id] = String(n);
    const input = $(`#sheet [data-ex-share="${id}"]`);
    if (input) input.value = st.shares[id];
    updateEditor();
  },
  'ex-rate-manual': () => { const st = S.sheet; st.rateSource = 'manual'; st.rateStr = fmtRate(st.rate); redrawRate(); updateEditor(); $('#ex-rate')?.focus(); },
  'ex-rate-auto': () => { S.sheet.rateSource = 'ecb'; refreshRate(); },
  'save-expense': saveExpense,
  'delete-expense': deleteEntry,
  'cancel-delete': () => { S.sheet.confirmDelete = false; renderSheet(); },
  'tr-from': el => { S.sheet.from = el.dataset.id; renderSheet(); },
  'tr-to': el => { S.sheet.to = el.dataset.id; renderSheet(); },
  'save-transfer': saveTransfer,
  settle: el => settleNow(el.dataset.from, el.dataset.to, num(el)),
  pay: el => openSheet('pay', { from: el.dataset.from, to: el.dataset.to, amount: num(el) }),
  'edit-member': el => startMember(member(el.dataset.id)),
  'new-member': () => startMember(null),
  'save-member': saveMember,
  'delete-member': deleteMember,
  'edit-group': () => openSheet('group', { name: S.group.name, emoji: S.group.emoji, currency: S.group.currency }),
  'grp-emoji': el => { S.sheet.emoji = el.dataset.v; renderSheet(); },
  'save-group': saveGroup,
  'share-link': async () => {
    try { await navigator.share({ title: `Quitte: ${S.group.name}`, text: `Doe mee met "${S.group.name}" op Quitte en tik je naam aan.`, url: groupUrl() }); } catch {}
  },
  // Alleen het bestand delen: met tekst erbij verdwijnt op iOS 'Bewaar afbeelding' uit het menu.
  'share-qr': () => {
    const p = payInfo(S.sheet), file = p?.epc && qrFile(p.epc, `${M.fmt(S.sheet.amount, cur())} aan ${p.holder}`);
    if (file) navigator.share({ files: [file] }).catch(() => {});
  },
  copy: el => copy(el.dataset.copy, el.dataset.msg),
  restore: el => { const e = S.log.find(x => x.id === el.dataset.id); if (e?.snapshot) restoreEntry(e.ref, e.snapshot); },
  'switch-me': switchMe,
  'hide-group': hideGroup,
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  const fn = el && ACT[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  fn(el, ev);
});

document.addEventListener('submit', ev => {
  const fn = { create: createGroup, join: joinGroup, 'open-link': openLink }[ev.target.dataset.form];
  if (!fn) return;
  ev.preventDefault();
  fn(ev.target);
});

document.addEventListener('input', ev => {
  const el = ev.target, d = el.dataset, st = S.sheet;
  if (d.draft) {
    if (d.draft === 'others') S.draft.others[+d.i] = el.value; else S.draft[d.draft] = el.value;
    return;
  }
  if (!st) return;
  if (d.ex) {
    st[d.ex] = el.value;
    if (d.ex === 'rateStr') st.rate = M.parseNumber(el.value);
    if (d.ex !== 'currency') updateEditor();
  } else if (d.exExact) { st.exact[d.exExact] = el.value; updateEditor(); }
  else if (d.exShare) { st.shares[d.exShare] = el.value; updateEditor(); }
  else if (d.exPct) { st.pct[d.exPct] = el.value; updateEditor(); }
  else if (d.f) st[d.f] = el.value;
});

document.addEventListener('change', ev => {
  const el = ev.target, d = el.dataset, st = S.sheet;
  if (!st) return;
  if (d.exInc) { if (el.checked) st.inc.add(d.exInc); else st.inc.delete(d.exInc); updateEditor(); }
  else if (d.ex === 'currency') {
    st.currency = el.value;
    Object.assign(st, el.value === cur() ? { rate: 1, rateSource: 'same' } : { rateSource: 'ecb', rateStr: '', rate: 1 });
    renderSheet();
    refreshRate();
  } else if (d.ex === 'date' && st.rateSource === 'ecb') refreshRate();
  else if (d.f === 'currency') st.currency = el.value;
});

document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.sheet) closeSheet(); });
window.addEventListener('popstate', () => { if (S.sheet && !history.state?.sheet) dropSheet(); });

// ---------- start ----------

async function boot() {
  try {
    S.store = await openStore();
  } catch (err) {
    console.error(err);
    const auth = /operation-not-allowed|admin-restricted/.test(err?.code || '');
    $('#app').innerHTML = `<main class="page"><section class="intro"><h1>Quitte kon niet starten</h1>
      <p>${auth ? 'Anoniem aanmelden staat nog niet aan in Firebase (Authentication → Sign-in method).' : 'Controleer je internetverbinding en herlaad de pagina.'}</p></section></main>`;
    return;
  }
  window.addEventListener('hashchange', onRoute);
  onRoute();
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
