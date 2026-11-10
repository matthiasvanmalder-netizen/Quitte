// Opslag. Met een Firebase-config in config.js delen alle toestellen dezelfde gegevens;
// zonder config draait de app in demo-modus en blijft alles in deze browser.
//
// Een regeling is groups/{gid} met vier subcollecties: members, expenses, log en photos.
// Schrijven gebeurt altijd via commit(gid, ops), met ops als
//   { col: 'members' | 'expenses' | 'log' | 'photos' | null, id, op: 'set' | 'merge' | 'delete', data }
// (col null = het regelingsdocument zelf), zodat een wijziging en de logregel samen worden opgeslagen.
// Foto's worden niet gevolgd zoals de rest: getPhoto haalt er één op wanneer je ze bekijkt.

import { firebaseConfig } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SUBS = ['members', 'expenses', 'log', 'photos'];

export async function openStore() {
  return firebaseConfig?.apiKey ? firebaseStore(firebaseConfig) : localStore();
}

const byLogTime = list => list.sort((a, b) => b.at - a.at).slice(0, 300);

async function firebaseStore(cfg) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  await auth.authStateReady();
  const user = auth.currentUser || (await A.signInAnonymously(auth)).user;
  const db = F.getFirestore(app);
  const ref = (gid, col, id) => (col ? F.doc(db, 'groups', gid, col, id) : F.doc(db, 'groups', gid));
  const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return {
    mode: 'firebase',
    uid: user.uid,
    newId: () => F.doc(F.collection(db, 'groups')).id,
    async getGroup(gid) {
      const s = await F.getDoc(ref(gid));
      return s.exists() ? { id: gid, ...s.data() } : null;
    },
    async getPhoto(gid, id) {
      const s = await F.getDoc(ref(gid, 'photos', id));
      return s.exists() ? s.data() : null;
    },
    watch(gid, h) {
      const col = name => F.collection(db, 'groups', gid, name);
      const offs = [
        F.onSnapshot(ref(gid), s => h.group(s.exists() ? { id: gid, ...s.data() } : null), h.error),
        F.onSnapshot(col('members'), s => h.members(rows(s)), h.error),
        F.onSnapshot(col('expenses'), s => h.expenses(rows(s)), h.error),
        F.onSnapshot(F.query(col('log'), F.orderBy('at', 'desc'), F.limit(300)), s => h.log(rows(s)), h.error),
      ];
      return () => offs.forEach(off => off());
    },
    commit(gid, ops) {
      const b = F.writeBatch(db);
      for (const o of ops) {
        const r = ref(gid, o.col, o.id);
        if (o.op === 'delete') b.delete(r);
        else if (o.op === 'merge') b.update(r, o.data);
        else b.set(r, o.data);
      }
      return b.commit();
    },
  };
}

function rid() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), n => abc[n % abc.length]).join('');
}

function localStore() {
  const KEY = 'quitte.demo';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let data = load();
  let uid = localStorage.getItem('quitte.demo.uid');
  if (!uid) { uid = rid(); localStorage.setItem('quitte.demo.uid', uid); }

  const watchers = new Map();
  const list = obj => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
  const push = (gid, h) => {
    const g = data[gid];
    h.group(g ? { id: gid, ...g.doc } : null);
    h.members(list(g?.members));
    h.expenses(list(g?.expenses));
    h.log(byLogTime(list(g?.log)));
  };
  const emit = gid => (watchers.get(gid) || new Set()).forEach(h => push(gid, h));
  const bc = 'BroadcastChannel' in self ? new BroadcastChannel('quitte-demo') : null;
  if (bc) bc.onmessage = e => { data = load(); emit(e.data); };

  return {
    mode: 'local',
    uid,
    newId: rid,
    async getGroup(gid) { return data[gid] ? { id: gid, ...data[gid].doc } : null; },
    async getPhoto(gid, id) { return load()[gid]?.photos?.[id] || null; },
    watch(gid, h) {
      if (!watchers.has(gid)) watchers.set(gid, new Set());
      watchers.get(gid).add(h);
      setTimeout(() => push(gid, h), 60);
      return () => watchers.get(gid).delete(h);
    },
    async commit(gid, ops) {
      data = load();
      const g = (data[gid] ??= { doc: null, members: {}, expenses: {}, log: {} });
      for (const o of ops) {
        if (o.col && !SUBS.includes(o.col)) throw new Error('onbekende collectie');
        const bag = o.col ? (g[o.col] ??= {}) : null;
        const cur = o.col ? bag[o.id] : g.doc;
        const next = o.op === 'delete' ? undefined : o.op === 'merge' ? { ...cur, ...o.data } : { ...o.data };
        if (o.col) { if (next) bag[o.id] = next; else delete bag[o.id]; }
        else g.doc = next ?? null;
      }
      localStorage.setItem(KEY, JSON.stringify(data));
      emit(gid);
      bc?.postMessage(gid);
    },
  };
}
