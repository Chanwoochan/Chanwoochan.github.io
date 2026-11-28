import {games, readRecords} from './store.js?v=ranks1';
import {boxSpecs, dailyAt, prizes as dailyPrizes} from '../daily/catalog.js';

const prizes = [
  {id: 'dummy', name: 'DUMMY 박스', description: '두 프리게임에서 만날 수 있는 흰색 경품 상자.',
    image: '../simple/assets/dummy_front.png', modes: ['bridge', 'hook-ring']},
  ...dailyPrizes.map(p => ({id: p.key, name: p.name, description: boxSpecs(p), image: p.art.front, modes: [p.key]})),
];

const shelf = document.getElementById('shelf');
const progress = document.getElementById('progress');
const date = new Intl.DateTimeFormat('ko-KR', {year: 'numeric', month: 'long', day: 'numeric'});
const number = new Intl.NumberFormat('ko-KR');
progress.max = prizes.length;

function render(wins) {
  let collected = 0;
  const cards = document.createDocumentFragment();
  for (const prize of prizes) {
    const card = document.getElementById('prize').content.firstElementChild.cloneNode(true);
    const rows = prize.modes.map(mode => wins?.get(mode)).filter(Boolean);
    const count = rows.reduce((sum, row) => sum + row.count, 0);
    if (count) collected++;
    card.classList.add(prize.id);
    card.querySelector('.package').src = prize.image;
    const badge = card.querySelector('.ownership');
    badge.hidden = !wins;
    badge.textContent = count ? '획득 ' + number.format(count) + '개' : '미획득';
    if (count) {
      card.classList.add('owned');
      card.querySelector('.first').hidden = false;
      card.querySelector('dd').textContent = date.format(Math.min(...rows.map(row => row.firstWon)));
    }
    card.querySelector('h2').textContent = prize.name;
    card.querySelector('.description').textContent = prize.description;
    for (const mode of prize.modes) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = games[mode].url;
      link.append(mode === dailyAt().prize.key ? '오늘의 데일리 경품' : games[mode].name);
      const tally = document.createElement('small');
      if (wins) tally.textContent = number.format(wins.get(mode)?.count ?? 0) + '개 획득';
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      link.append(tally, arrow);
      li.append(link);
      card.querySelector('.games').append(li);
    }
    cards.append(card);
  }
  shelf.replaceChildren(cards);
  document.getElementById('storage-error').hidden = !!wins;
  document.getElementById('total').textContent = wins ? collected + ' / ' + prizes.length + '종' : '기록 확인 불가';
  progress.hidden = !wins;
  progress.value = collected;
}

let generation=0;
async function refresh() {
  const version=++generation;
  try {
    const {rows,owner,offline}=await readRecords();
    if (version!==generation) return;
    const wins=new Map(), history=new Map();
    for (const row of rows) {
      if (!games[row.mode]) continue;
      if (row.count) {
        const old=wins.get(row.mode);
        wins.set(row.mode,{count:(old?.count??0)+row.count,firstWon:Math.min(old?.firstWon??Infinity,row.firstWon)});
      }
      const key=row.date+'_'+row.mode;
      const group=history.get(key)??{mode:row.mode,date:row.date,plays:0,count:0};
      group.plays+=row.plays; group.count+=row.count; history.set(key,group);
    }
    render(wins);
    const list=document.getElementById('record-history');
    const sorted=[...history.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.mode.localeCompare(b.mode));
    list.replaceChildren(...sorted.map(row=>{
      const li=document.createElement('li'), tally=document.createElement('span');
      li.append([row.date,games[row.mode].name].filter(Boolean).join(' · '));
      tally.textContent='시도 '+row.plays+'회 · 획득 '+row.count+'개'; li.append(tally); return li;
    }));
    document.getElementById('record-status').textContent=offline?'오프라인 · 이 기기에서 확인되는 기록입니다.':owner==='guest'?'이 기기의 게스트 기록': 'Google 계정 기록';
  } catch {
    if (version!==generation) return;
    render(null); document.getElementById('record-history').replaceChildren();
    document.getElementById('record-status').textContent='기록을 불러오지 못했습니다.';
  }
}
window.addEventListener('claw-account',refresh);
window.addEventListener('online',refresh);

window.addEventListener('pageshow', refresh);
window.addEventListener('focus', refresh);
if (document.readyState === 'complete') refresh();
