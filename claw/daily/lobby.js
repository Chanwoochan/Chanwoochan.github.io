import {dailyAt} from './catalog.js';

let timer;
function showToday() {
  const {prize, next} = dailyAt();
  document.querySelector('#daily-name').textContent = prize.name;
  const cover = document.querySelector('#daily-cover');
  cover.src = prize.art.front;
  cover.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(showToday, Math.max(1, next - Date.now() + 30));
}
window.addEventListener('pageshow', showToday);
document.addEventListener('visibilitychange', () => { if (!document.hidden) showToday(); });
showToday();
