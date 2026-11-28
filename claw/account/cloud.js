// Keep the SDK lazy so guest play also works when the identity service is offline.
const sdk = new URL('../vendor/firebase/', import.meta.url).href;
let connection;
export function cloud() {
  if (!connection) connection = connect().catch(error => { connection = null; throw error; });
  return connection;
}
async function connect() {
  const response = await fetch(new URL('./firebase.json', import.meta.url));
  if (!response.ok) throw Error('계정 서비스 설정을 불러올 수 없습니다.');
  const [config, app, account, store] = await Promise.all([response.json(),
    import(sdk + 'firebase-app.js'), import(sdk + 'firebase-auth.js'), import(sdk + 'firebase-firestore.js')]);
  const project = app.initializeApp(config);
  const auth = account.getAuth(project);
  const db = store.initializeFirestore(project, {localCache:store.persistentLocalCache({tabManager:store.persistentMultipleTabManager()})});
  await auth.authStateReady();
  return {auth, db, account, store};
}
export async function canPublish() {
  const {auth,db,store} = await cloud();
  if (!auth.currentUser) return false;
  try { await store.getDocFromServer(store.doc(db,'permissions','publish')); return true; }
  catch (error) { if (error.code === 'permission-denied') return false; throw error; }
}
export async function publicPreset(key) {
  const cacheKey = 'claw-public-preset:' + key;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch {}
  try {
    const {db, store} = await cloud();
    if (!navigator.onLine) return cached;
    return await store.getDoc(store.doc(db,'defaults',key)).then(snapshot => {
      const value = snapshot.data() ?? null;
      try { localStorage.setItem(cacheKey, JSON.stringify(value)); } catch {}
      return value;
    });
  } catch { return cached; }
}
export async function editorPreset(key) {
  const {db,store} = await cloud();
  return (await store.getDocFromServer(store.doc(db,'defaults',key))).data() ?? null;
}
export async function publishPreset(key, revision, config, cycle) {
  const {db,store} = await cloud();
  const ref = store.doc(db,'defaults',key);
  await store.runTransaction(db, async tx => {
    const prior = (await tx.get(ref)).data()?.revision ?? 0;
    if (prior !== revision) throw Error('다른 관리자가 먼저 게시했습니다. 새로고침한 뒤 변경해 주세요.');
    tx.set(ref, {config,cycle,revision: prior + 1,updatedAt:store.serverTimestamp()});
  });
}
