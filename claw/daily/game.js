import {dailyAt} from './catalog.js';

export function setDailyPage({prize, date}, config) {
  const card = document.querySelector('.prize-card');
  card.querySelector('img').src = prize.art.front;
  card.querySelector('img').alt = prize.name + ' 패키지';
  card.querySelector('h3').textContent = prize.name;
  card.querySelector('p').textContent = [config.box_width,config.box_length,config.box_height].map(v=>Math.round(v*1000)).join(' × ')+' mm · '+Math.round(config.box_mass*1000)+' g';
  document.querySelector('#daily-date').textContent = date + ' · 한국 시간';
  document.querySelector('#daily-rods').textContent =
    '1–2번 ' + Math.round(config.gap_12 * 1000) + ' / 2–3번 ' + Math.round(config.gap * 1000) +
    ' / 3–4번 ' + Math.round(config.gap_34 * 1000) + ' mm';
  const source = document.querySelector('#daily-source');
  source.href = prize.source;
  source.textContent = prize.reference + ' ↗';
  document.querySelector('.entry h1').textContent = prize.name;
  document.querySelector('#win h2').textContent = prize.name + ' 획득!';
}

// Keep the selected prize through an attempt that straddles midnight.
// Refresh before the next attempt, including a tab restored from suspension.
export function watchDailyRound(session, idle) {
  function expired() { return dailyAt().day !== session.day; }
  function refreshIfIdle() { if (idle() && expired()) location.reload(); }
  const remaining = Math.max(0, session.next - Date.now());
  setTimeout(refreshIfIdle, remaining + 30);
  window.addEventListener('pageshow', refreshIfIdle);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfIdle(); });
  function nextRound(event) {
    if (!expired()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.reload();
  }
  document.querySelector('#reset').addEventListener('click', nextRound, true);
  document.querySelector('#start').addEventListener('click', nextRound, true);
  document.querySelector('#left').addEventListener('pointerdown', event => { if (idle()) nextRound(event); }, true);
  window.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' && !event.repeat && idle()) nextRound(event);
  }, true);
  return refreshIfIdle;
}
