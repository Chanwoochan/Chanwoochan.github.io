import {prizes as dailyPrizes} from '../daily/catalog.js';

export const games = {
  bridge: {name: '하시와타시', url: '../freegame/play/?mode=bridge'},
  'hook-ring': {name: '후크&링', url: '../freegame/play/?mode=hook-ring'},
  cygnus: {name: '시그너스 버전', url: '../'},
  ...Object.fromEntries(dailyPrizes.map(prize => [prize.key, {name: '데일리 모드', url: '../daily/'}])),
};

export {readRecords} from '../account/records.js?v=ranks1';
import {note} from '../account/records.js?v=ranks1';
export function recordGame(mode, date, won) {
  if (!Object.hasOwn(games,mode)) return Promise.reject(Error('알 수 없는 게임입니다.'));
  return note(mode,date,won);
}

export function recordWin(mode) { return recordGame(mode,'',true); }
export async function readWins() {
  const {readRecords}=await import('../account/records.js?v=ranks1');
  const {rows}=await readRecords();
  const wins=new Map();
  for (const row of rows.filter(row=>row.count)) {
    const old=wins.get(row.mode);
    wins.set(row.mode,{mode:row.mode,count:(old?.count??0)+row.count,firstWon:Math.min(old?.firstWon??Infinity,row.firstWon)});
  }
  return wins;
}
