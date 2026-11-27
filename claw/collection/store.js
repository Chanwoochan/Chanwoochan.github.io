import {prizes as dailyPrizes} from '../daily/catalog.js';

export const games = {
  bridge: {name: '하시와타시', url: '../freegame/play/?mode=bridge'},
  'hook-ring': {name: '후크&링', url: '../freegame/play/?mode=hook-ring'},
  cygnus: {name: '시그너스 버전', url: '../cygnus.html'},
  ...Object.fromEntries(dailyPrizes.map(prize => [prize.key, {name: '데일리 모드', url: '../daily/'}])),
};

function openCollection() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ufo-catcher-prize-collection', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('wins', {keyPath: 'mode'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recordWin(mode) {
  if (!Object.hasOwn(games, mode)) throw new Error('알 수 없는 게임입니다.');
  const db = await openCollection();
  try {
    await new Promise((resolve, reject) => {
      // Read and increment in one transaction, also when two tabs win together.
      const tx = db.transaction('wins', 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      const wins = tx.objectStore('wins');
      const current = wins.get(mode);
      current.onsuccess = () => {
        const row = current.result ?? {mode, count: 0, firstWon: Date.now()};
        row.count++;
        wins.put(row);
      };
    });
  } finally { db.close(); }
}

export async function readWins() {
  const db = await openCollection();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('wins');
      const rows = tx.objectStore('wins').getAll();
      tx.oncomplete = () => resolve(new Map(rows.result.map(row => [row.mode, row])));
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
