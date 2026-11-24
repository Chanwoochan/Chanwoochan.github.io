import {games, readWins} from './store.js';

const prizes = [
  {id: 'dummy', name: 'DUMMY 박스', description: '두 프리게임에서 만날 수 있는 흰색 경품 상자.',
    image: '../simple/assets/dummy_front.png', modes: ['bridge', 'hook-ring']},
  {id: 'cygnus', name: '시그너스 피규어', description: '스완로보틱스의 휴머노이드 로봇 시그너스.',
    image: '../assets/cygnus_box_front_v1.png', modes: ['cygnus']},
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
      link.append(games[mode].name);
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

async function refresh() {
  try { render(await readWins()); }
  catch { render(null); }
}

window.addEventListener('pageshow', refresh);
window.addEventListener('focus', refresh);
if (document.readyState === 'complete') refresh();
