import {cloud} from './cloud.js';

export const defaultNickname = '플레이어';
export const formatTag = number => '#' + String(number).padStart(5, '0');
let assigned;
// Concurrent writers can advance the counter before Firestore checks its rules.
// Retry a rejected transaction only if the observed counter actually changed.
async function countTransaction(db,store,ref,field,work) {
  for (let attempt=0; ; attempt++) {
    let seen;
    try {
      return await store.runTransaction(db, tx => work(tx,async () => {
        seen=(await tx.get(ref)).data()?.[field] ?? 0;
        return seen;
      }));
    } catch (error) {
      if (error.code!=='permission-denied' || seen===undefined || attempt>=4) throw error;
      const current=(await store.getDocFromServer(ref)).data()?.[field] ?? 0;
      if (current===seen) throw error;
    }
  }
}
export async function playerNumber(uid) {
  if (assigned?.uid === uid) return assigned.promise;
  const promise = allocate(uid);
  assigned = {uid,promise};
  try { return await promise; }
  catch (error) { if (assigned?.promise === promise) assigned = null; throw error; }
}
async function allocate(uid) {
  const {auth,db,store} = await cloud();
  if (auth.currentUser?.uid !== uid) throw Error('먼저 로그인해 주세요.');
  const player = store.doc(db,'players',uid);
  const sequence = store.doc(db,'sequences','players');
  return countTransaction(db,store,sequence,'last', async (tx,readCount) => {
    const existing = await tx.get(player);
    if (existing.exists()) return existing.data().number;
    const number = (await readCount()) + 1;
    if (number > 99999) throw Error('다섯 자리 번호가 모두 사용되었습니다.');
    tx.set(sequence,{last:number});
    tx.set(player,{number});
    tx.set(store.doc(db,'handles',String(number)),{nickname:defaultNickname});
    return number;
  });
}
export async function getNickname(number) {
  const {db,store} = await cloud();
  return (await store.getDoc(store.doc(db,'handles',String(number)))).data()?.nickname ?? defaultNickname;
}
export async function rename(number, value) {
  const nickname = value.trim().normalize('NFC');
  if (!nickname || [...nickname].length > 16 || /[\p{Cc}\p{Cf}]/u.test(nickname))
    throw Error('닉네임은 제어 문자 없이 1~16자로 입력해 주세요.');
  const {db,store} = await cloud();
  const handle=store.doc(db,'handles',String(number));
  await store.runTransaction(db, async tx => { tx.update(handle,{nickname}); });
  return nickname;
}

export async function uploadRankWin(uid, number, win) {
  const {db,store} = await cloud();
  const receipt = store.doc(db,'players',uid,'rankWins',win.id);
  const score = store.doc(db,'boards',String(win.day),'scores',String(number));
  await countTransaction(db,store,score,'count', async (tx,readCount) => {
    if ((await tx.get(receipt)).exists()) return;
    const count = await readCount();
    tx.set(receipt,{day:win.day});
    tx.set(score,{count:count+1,lastWin:win.id});
  });
}
