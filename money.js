// Bedragen, verdelen, saldo's en afrekenen.
// Intern rekenen we altijd in de kleinste eenheid van een munt (centen, of yen voor JPY).

const digitsCache = {};
export function digits(cur) {
  if (!(cur in digitsCache)) {
    try { digitsCache[cur] = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; }
    catch { digitsCache[cur] = 2; }
  }
  return digitsCache[cur];
}
export const unit = cur => 10 ** digits(cur);
export const toMinor = (amount, cur) => Math.round(amount * unit(cur));
export const fromMinor = (minor, cur) => minor / unit(cur);

const NARROW = new Set(['EUR', 'USD', 'GBP', 'JPY']);
const fmtCache = {};
export function fmt(minor, cur, sign = false) {
  const key = cur + sign;
  fmtCache[key] ??= new Intl.NumberFormat('nl-BE', {
    style: 'currency', currency: cur,
    currencyDisplay: NARROW.has(cur) ? 'narrowSymbol' : 'symbol',
    signDisplay: sign ? 'exceptZero' : 'auto',
  });
  return fmtCache[key].format(fromMinor(minor, cur));
}
export const fmtAmount = (amount, cur) => fmt(toMinor(amount, cur), cur);

// Getal zoals iemand het intikt: "0,5", "0.5", "1.234,56" of "1,234.56".
// Staat er maar één soort scheidingsteken, dan is dat de komma (koersen, delen, procenten).
export function parseNumber(s, thousands = false) {
  s = String(s ?? '').trim().replace(/[\s'€$£¥%]/g, '');
  if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    const dec = lc > ld ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lc > -1 || ld > -1) {
    const parts = s.split(lc > -1 ? ',' : '.');
    // Bij bedragen is "500.000" of "1.250" vijfhonderdduizend en twaalfhonderdvijftig, zoals in België gebruikelijk.
    const grouped = parts.length > 2 || (thousands && ld > -1 && parts[1].length === 3 && parts[0] !== '0');
    s = grouped ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export const parseAmount = s => parseNumber(s, true);

// Getal tonen in een invulveld, zonder duizendtallen: 12,5 → "12,50".
export function inputValue(n, cur) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toFixed(cur ? digits(cur) : 2).replace('.', ',');
}

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

// Verdeel `total` (gehele eenheden) volgens gewichten. De restcenten gaan naar wie het grootste
// restdeel heeft; bij gelijke stand beslist de seed, zodat niet altijd dezelfde persoon de extra cent krijgt.
export function allocate(total, weights, seed = '') {
  const ids = Object.keys(weights).filter(id => weights[id] > 0);
  const W = ids.reduce((s, id) => s + weights[id], 0);
  const out = {};
  if (!ids.length || W <= 0) return out;
  let rest = total;
  const fr = ids.map(id => {
    const exact = total * weights[id] / W;
    const base = Math.floor(exact + 1e-9);
    out[id] = base; rest -= base;
    return { id, f: exact - base, r: hash(seed + id) };
  });
  fr.sort((a, b) => b.f - a.f || a.r - b.r);
  for (let i = 0; i < rest; i++) out[fr[i % fr.length].id]++;
  return out;
}

export function weightsOf(e) {
  const w = {};
  for (const [id, v] of Object.entries(e.parts || {})) {
    const n = e.mode === 'equal' ? (v ? 1 : 0) : Number(v);
    if (n > 0) w[id] = n;
  }
  return w;
}

// Bedrag van een uitgave in de hoofdmunt van de regeling.
export function totalMinor(e, cur) {
  const rate = e.currency === cur ? 1 : (e.rate || 0);
  return toMinor(e.amount * rate, cur);
}

export function shares(e, cur) {
  return allocate(totalMinor(e, cur), weightsOf(e), e.id || '');
}

// paid = wat je voorschoot, owed = jouw deel, spent = jouw deel in echte uitgaven (zonder terugbetalingen).
export function balances(memberIds, expenses, cur) {
  const byId = {};
  const ensure = id => (byId[id] ??= { paid: 0, owed: 0, spent: 0, net: 0 });
  memberIds.forEach(ensure);
  let total = 0;
  for (const e of expenses) {
    const T = totalMinor(e, cur);
    ensure(e.paidBy).paid += T;
    for (const [id, v] of Object.entries(allocate(T, weightsOf(e), e.id || ''))) {
      ensure(id).owed += v;
      if (e.kind !== 'transfer') byId[id].spent += v;
    }
    if (e.kind !== 'transfer') total += T;
  }
  for (const id in byId) byId[id].net = byId[id].paid - byId[id].owed;
  return { byId, total };
}

// Zo weinig mogelijk overschrijvingen: eerst wie exact tegen elkaar wegvalt, daarna telkens de grootste schuld
// tegen het grootste tegoed.
export function settle(byId) {
  let debt = [], cred = [];
  for (const [id, { net }] of Object.entries(byId)) {
    if (net > 0) cred.push({ id, v: net });
    else if (net < 0) debt.push({ id, v: -net });
  }
  const out = [];
  for (const d of debt) {
    const c = cred.find(c => c.v === d.v);
    if (c) { out.push({ from: d.id, to: c.id, amount: d.v }); d.v = 0; c.v = 0; }
  }
  for (;;) {
    debt = debt.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    cred = cred.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    if (!debt.length || !cred.length) break;
    const v = Math.min(debt[0].v, cred[0].v);
    out.push({ from: debt[0].id, to: cred[0].id, amount: v });
    debt[0].v -= v; cred[0].v -= v;
  }
  return out;
}

// ---------- IBAN en betaal-QR ----------

export const normIban = s => String(s || '').replace(/\s+/g, '').toUpperCase();
export const prettyIban = s => normIban(s).replace(/(.{4})/g, '$1 ').trim();

export function validIban(s) {
  const v = normIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  let m = 0;
  for (const ch of v.slice(4) + v.slice(0, 4)) {
    const n = ch >= 'A' ? ch.charCodeAt(0) - 55 : +ch;
    m = Number(String(m) + n) % 97;
  }
  return m === 1;
}

// EPC-QR (SEPA-overschrijving), te scannen met de meeste Europese bankapps. Alleen voor euro.
export function epcPayload({ name, iban, minor, text }) {
  return ['BCD', '002', '1', 'SCT', '', String(name).slice(0, 70), normIban(iban),
    'EUR' + (minor / 100).toFixed(2), '', '', String(text || '').slice(0, 140)].join('\n');
}

// ---------- munten en wisselkoersen ----------

// Munten waarvoor de ECB dagelijks een koers publiceert.
export const ECB = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'AUD', 'BGN', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'HKD', 'HUF',
  'IDR', 'ILS', 'INR', 'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR'];
// Gangbare reismunten zonder ECB-koers: die vul je zelf in.
export const OTHER = ['AED', 'ARS', 'CLP', 'COP', 'CRC', 'EGP', 'GEL', 'JOD', 'KES', 'LKR', 'MAD', 'NPR', 'PEN',
  'QAR', 'RSD', 'SAR', 'TND', 'TWD', 'TZS', 'UAH', 'VND'];
export const CURRENCIES = [...ECB.slice(0, 5), ...[...ECB.slice(5), ...OTHER].sort()];

let names;
export function currencyName(code) {
  try { names ??= new Intl.DisplayNames(['nl'], { type: 'currency' }); return names.of(code); }
  catch { return code; }
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Koers van `from` naar `to` op een datum (ECB, via Frankfurter). Geeft {rate, date} of gooit een fout.
export async function fetchRate(from, to, date) {
  if (!ECB.includes(from) || !ECB.includes(to)) throw new Error('geen ECB-koers');
  const today = todayStr();
  const key = `quitte.rate.${from}.${to}.${date}`;
  if (date < today) {
    try { const hit = JSON.parse(localStorage.getItem(key)); if (hit) return hit; } catch {}
  }
  const res = await fetch(`https://api.frankfurter.dev/v1/${date >= today ? 'latest' : date}?base=${from}&symbols=${to}`);
  if (!res.ok) throw new Error('koers niet gevonden');
  const j = await res.json();
  const rate = j.rates?.[to];
  if (!rate) throw new Error('koers niet gevonden');
  const out = { rate, date: j.date };
  if (date < today) { try { localStorage.setItem(key, JSON.stringify(out)); } catch {} }
  return out;
}
