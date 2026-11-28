import {cloud} from './cloud.js';
import {playerNumber, uploadRankWin} from './profile.js';
import {dailyAt} from '../daily/catalog.js';

const guest = 'guest';
let database;
function openDB() {
  if (database) return database;
  database = new Promise((resolve,reject) => {
    const request = indexedDB.open('ufo-catcher-prize-collection', 3);
    request.onupgradeneeded = event => {
      const db = request.result;
      const queue = db.createObjectStore('rankQueue',{keyPath:'id'});
      queue.createIndex('owner','owner');
      const today = dailyAt();
      function importGuest(row) {
        if (row.count && (row.date === today.date || dailyAt(row.firstWon).day === today.day)) {
          for (let i=0; i<row.count; i++) queue.put({id:crypto.randomUUID(),owner:guest,day:today.day});
        }
      }
      if (event.oldVersion === 2) {
        const guests = request.transaction.objectStore('runs').index('owner').openCursor(guest);
        guests.onsuccess = () => {
          const cursor = guests.result;
          if (cursor) { importGuest(cursor.value); cursor.continue(); }
        };
        return;
      }
      const runs = db.createObjectStore('runs', {keyPath:['owner','mode','date']});
      runs.createIndex('owner','owner');
      db.createObjectStore('meta').put(crypto.randomUUID(),'device');
      if (!db.objectStoreNames.contains('wins')) return;
      const cursor = request.transaction.objectStore('wins').openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const {mode,count,firstWon} = entry.value;
        runs.put({owner:guest,mode,date:'',plays:0,count,firstWon,dirty:true});
        importGuest({count,firstWon});
        entry.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => { database=null; reject(request.error); };
  });
  return database;
}
async function transaction(names, access, work) {
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(names,access);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? Error('기록 저장이 중단되었습니다.'));
    work(tx, value => { result = value; });
  });
}
function first(a,b) { return a && b ? Math.min(a,b) : a || b || 0; }
export async function identity() {
  try { return (await cloud()).auth.currentUser?.uid ?? guest; }
  catch { return guest; }
}
async function claim(owner) {
  if (owner === guest) return;
  await transaction(['runs','rankQueue'],'readwrite', tx => {
    const cursor = tx.objectStore('rankQueue').index('owner').openCursor(guest);
    cursor.onsuccess = () => {
      const win = cursor.result;
      if (win) { win.update({...win.value,owner}); win.continue(); }
    };
    const runs = tx.objectStore('runs');
    const all = runs.index('owner').getAll(guest);
    all.onsuccess = () => {
      for (const row of all.result) {
        const get = runs.get([owner,row.mode,row.date]);
        get.onsuccess = () => {
          const current = get.result;
          runs.put({...row,owner,plays:row.plays+(current?.plays??0),count:row.count+(current?.count??0),
            firstWon:first(row.firstWon,current?.firstWon),dirty:true});
          runs.delete([guest,row.mode,row.date]);
        };
      }
    };
  });
}
async function local(owner) {
  return transaction(['runs','meta'],'readonly',(tx,done) => {
    const rows = tx.objectStore('runs').index('owner').getAll(owner);
    const device = tx.objectStore('meta').get('device');
    device.onsuccess = () => done({rows:rows.result,device:device.result});
  });
}
function key(device,row) { return [device,row.mode,row.date].join('_'); }
function merge(a,b) {
  return {...b,plays:Math.max(a?.plays??0,b.plays),count:Math.max(a?.count??0,b.count),firstWon:first(a?.firstWon,b.firstWon)};
}
export async function note(mode,date,won) {
  const when = Date.now();
  const owner = await identity();
  await transaction(['runs','rankQueue'],'readwrite',tx => {
    if (won) tx.objectStore('rankQueue').add({id:crypto.randomUUID(),owner,day:dailyAt(when).day});
    const runs = tx.objectStore('runs');
    const read = runs.get([owner,mode,date]);
    read.onsuccess = () => {
      const row = read.result ?? {owner,mode,date,plays:0,count:0,firstWon:0};
      if (won) { row.count++; row.firstWon ||= when; } else row.plays++;
      runs.put({...row,dirty:true});
    };
  });
  if (owner !== guest) scheduleSync(owner);
}
let pending = Promise.resolve();
function scheduleSync(owner) {
  // Serialize this tab's snapshots. The server transaction also handles other tabs.
  pending = pending.catch(() => {}).then(() => flush(owner));
  pending.catch(() => { window.dispatchEvent(new Event('claw-sync-pending')); });
  return pending;
}
async function flush(owner) {
  const {auth,db,store} = await cloud();
  if (auth.currentUser?.uid !== owner) return;
  await claim(owner);
  const {device,rows} = await local(owner);
  for (const row of rows.filter(row => row.dirty)) {
    if (auth.currentUser?.uid !== owner) return;
    const {mode,date,plays,count,firstWon} = row;
    const ref = store.doc(db,'users',owner,'records',key(device,row));
    await store.runTransaction(db, async tx => {
      const prior = (await tx.get(ref)).data();
      tx.set(ref,merge(prior,{device,mode,date,plays,count,firstWon}));
    });
    await transaction(['runs'],'readwrite',tx => {
      const runs=tx.objectStore('runs'), read=runs.get([owner,mode,date]);
      read.onsuccess = () => {
        const now=read.result;
        if (now?.count===count && now.plays===plays && now.firstWon===firstWon) runs.put({...now,dirty:false});
      };
    });
  }
  const wins = await transaction(['rankQueue'],'readonly',(tx,done) => {
    const get=tx.objectStore('rankQueue').index('owner').getAll(owner);
    get.onsuccess=()=>done(get.result);
  });
  let scored=false;
  for (const win of wins) {
    if (auth.currentUser?.uid !== owner) return;
    if (win.day === dailyAt().day) {
      await uploadRankWin(owner,await playerNumber(owner),win);
      scored=true;
    }
    await transaction(['rankQueue'],'readwrite',tx => tx.objectStore('rankQueue').delete(win.id));
  }
  if (scored) window.dispatchEvent(new Event('claw-rank-synced'));
}
export async function retrySync() {
  const owner=await identity();
  if (owner!==guest) await scheduleSync(owner);
}
window.addEventListener('online', () => retrySync().catch(() => {}));
export async function readRecords() {
  const owner=await identity();
  if (owner!==guest) await claim(owner);
  const {device,rows}=await local(owner);
  const all = new Map();
  let offline=false;
  if (owner!==guest) {
    try {
      const {auth,db,store}=await cloud();
      const docs=await store.getDocs(store.collection(db,'users',owner,'records'));
      if (auth.currentUser?.uid!==owner) return readRecords();
      for (const doc of docs.docs) all.set(doc.id,doc.data());
      offline=docs.metadata.fromCache;
    } catch { offline=true; }
    if (!offline) scheduleSync(owner);
  }
  for (const row of rows) {
    const id=key(device,row);
    all.set(id,merge(all.get(id),row));
  }
  return {rows:[...all.values()],owner,offline};
}
