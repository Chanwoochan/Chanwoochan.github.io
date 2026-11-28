import {DualRenderer} from './renderer.js?v=pc-perf';
import {Sounds} from './audio.js?v=jazz-shuffle-1';
import {labels} from './cycle.js';
import {recordGame} from './collection/store.js?v=accounts1';
import {managing, gameDefaults} from './account/presets.js';

const $ = id => document.getElementById(id);
const STORAGE = 'cygnus-ufo-defaults-v1';
const prizeMode = 'cygnus';
const sessionDate = '';
let published;
const mixerStorage = STORAGE + '-mix';
const clone = value => JSON.parse(JSON.stringify(value));
let worker, renderer, latestFrame, base, config, settings, currentAudio;
let started = false, paused = false, ready = false, sceneReady = false, configured = false, winning = false;
let nextTelemetry = 0;
let held = null, holdTimer, toastTimer, pending = null, requestId = 0, fatalError = false;
const sounds = new Sounds(message => toast(message, true));
const fields = new Map();

// group, key, Korean label, display multiplier, step, min, max, live
const schema = [
  ['박스 크기와 접촉', 'box_width', '가로 X (mm)', 1000, 1, .001],
  ['박스 크기와 접촉', 'box_length', '세로 Y (mm)', 1000, 1, .001],
  ['박스 크기와 접촉', 'box_height', '높이 Z (mm)', 1000, 1, .001],
  ['박스 크기와 접촉', 'box_mass', '박스 질량 (g)', 1000, 1, 50, 2000],
  ['박스 크기와 접촉', 'com_x', '무게중심 X (mm)', 1000, 1],
  ['박스 크기와 접촉', 'com_y', '무게중심 Y (mm)', 1000, 1],
  ['박스 크기와 접촉', 'box_contact_timeconst', '접촉 복원 시간 (ms)', 1000, 1, 4, 100],
  ['박스 크기와 접촉', 'box_contact_width', '접촉 완충 전이 (mm)', 1000, .1, .1, 10],
  ['봉 간격과 높이', 'gap_12', '1·2번 봉 사이 (mm)', 1000, 1, 20, 350],
  ['봉 간격과 높이', 'gap', '2·3번 봉 사이 (mm)', 1000, 1, .001],
  ['봉 간격과 높이', 'gap_34', '3·4번 봉 사이 (mm)', 1000, 1, 20, 350],
  ['봉 간격과 높이', 'inner_height', '2·3번 봉 높이 (mm)', 1000, 1],
  ['봉 간격과 높이', 'outer_height', '1·4번 봉 높이 (mm)', 1000, 1],
  ['봉 간격과 높이', 'rod_radius', '봉 반지름 (mm)', 1000, .5, 4, 20],
  ['집게 힘과 마찰', 'grip_kp', '집게 P게인 (N·m/rad)', 1, .1, 0, 100, true],
  ['집게 힘과 마찰', 'grip_torque', '팔 모터 토크 (N·m)', 1, .005, .005, .8, true],
  ['집게 힘과 마찰', 'z_force_limit', 'Z 모터 최대 힘 (N)', 1, 1, 20, 150, true],
  ['집게 힘과 마찰', 'tip_friction', '금속 팁 마찰계수', 1, .01, 0, 2, true],
  ['집게 힘과 마찰', 'arm_friction', '아크릴 팔 마찰계수', 1, .01, 0, 2, true],
  ['집게 힘과 마찰', 'rail_friction', '1·4번 봉 마찰계수', 1, .01, 0, 2, true],
  ['집게 힘과 마찰', 'inner_rail_friction', '2·3번 실리콘 마찰계수', 1, .05, 0, 5, true],
  ['헤드와 계산', 'claw_scale', '집게 전체 크기 (%)', 100, 1, 65, 110],
  ['헤드와 계산', 'head_stiffness', '헤드 복원 강성 (N·m/rad)', 1, .1, 0, 30, true],
  ['헤드와 계산', 'head_damping', '헤드 감쇠 (N·m·s/rad)', 1, .01, 0, 3, true],
  ['헤드와 계산', 'head_limit_deg', '헤드 최대 꺾임 (°)', 1, .5, 1, 25, true],
  ['헤드와 계산', 'timestep', '물리 계산 간격 (ms)', 1000, .05, .25, 2],
  ['자동 집기 동작', 'move_speed', 'XY 이동 속도 (mm/s)', 1000, 1, 10, 140],
  ['자동 집기 동작', 'lower_height', '하강 한계 높이 (mm)', 1000, 1, 200, 750],
  ['자동 집기 동작', 'z_load_threshold', '하강 정지 Z 외력 (N)', 1, .1, .1, 30],
  ['자동 집기 동작', 'contact_hold_time', '외력 유지 시간 (ms)', 1000, 1, 0, 200],
  ['자동 집기 동작', 'open_duration', '벌림 고정 대기 (s)', 1, .1, 0, 10],
  ['자동 집기 동작', 'close_duration', '닫힘 대기 (s)', 1, .1, .2, 5],
  ['자동 집기 동작', 'release_duration', '놓기 추가 대기 (s)', 1, .1, 0, 3],
  ['원점과 집게 각도', 'start_x', '우측 앞 원점 X (mm)', 1000, 1, -330, 330],
  ['원점과 집게 각도', 'start_y', '우측 앞 원점 Y (mm)', 1000, 1, -270, 270],
  ['원점과 집게 각도', 'home_height', '시작·상승 높이 (mm)', 1000, 1, 650, 950],
  ['원점과 집게 각도', 'release_x', '놓기 위치 X (mm)', 1000, 1, -330, 330],
  ['원점과 집게 각도', 'release_y', '놓기 위치 Y (mm)', 1000, 1, -270, 270],
  ['원점과 집게 각도', 'closed_angle', '닫힘 목표 각도 (°)', 180 / Math.PI, .1, 0, 45.83],
  ['원점과 집게 각도', 'open_angle', '벌림 목표 각도 (°)', 180 / Math.PI, .1, 0, 45.83],
];

function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error);
  $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4200);
}
function error(message, recoverable = false) {
  releaseHeld(); ready = recoverable; pending = null;
  if (recoverable) {
    $('entry').hidden = started; $('engine-status').textContent = '이전 설정 유지';
    $('apply-settings').disabled = $('save-settings').disabled = false; toast(message, true);
  } else {
    fatalError = true; $('entry').hidden = false; $('loading-line').hidden = true;
    $('loading-message').textContent = '불러오지 못했습니다. ' + message;
    $('start').textContent = '다시 불러오기'; $('start').disabled = false;
    $('engine-status').textContent = '연결 오류'; $('engine-dot').classList.remove('ready');
  }
  updateControls();
}
function renderSettings() {
  const groups = new Map();
  for (const row of schema) {
    const [groupName, key, label, multiplier, step, min, max, live] = row;
    let group = groups.get(groupName);
    if (!group) {
      group = document.createElement('fieldset'); group.className = 'settings-group';
      const legend = document.createElement('legend'); legend.textContent = groupName;
      group.append(legend); groups.set(groupName, group); $('settings-fields').append(group);
    }
    const labelNode = document.createElement('label'); labelNode.className = 'field' + (live ? ' live-field' : '');
    const title = document.createElement('span'); title.className = 'field-name'; title.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.required = true;
    // Arbitrary finite dimensions and heights retain the native model's lack of upper limits.
    input.step = 'any'; input.inputMode = 'decimal'; input.id = `setting-${key}`; input.name = key;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.dataset.increment = step;
    labelNode.append(title, input); group.append(labelNode);
    fields.set(key, {input, multiplier, source: Object.hasOwn(base.config, key) ? 'config' : 'cycle', live});
    if (live) input.addEventListener('input', () => {
      if (!ready || !input.value.trim() || !input.checkValidity()) return;
      const value = Number(input.value) / multiplier;
      if (!Number.isFinite(value)) return;
      config[key] = value; worker.postMessage({type: 'tune', values: {[key]: value}});
    });
  }
  populate({config, cycle: settings});
}
function populate(values) {
  for (const [key, f] of fields) {
    const value = values[f.source]?.[key];
    f.input.value = Number.isFinite(value) ? Number((value * f.multiplier).toPrecision(12)) : '';
  }
}
function collect() {
  if (!$('settings-form').reportValidity()) return null;
  const result = {config: clone(config), cycle: clone(settings), audio: currentMix()};
  for (const [key, f] of fields) {
    if (!f.input.value.trim() || !Number.isFinite(Number(f.input.value))) { f.input.reportValidity(); return null; }
    result[f.source][key] = Number(f.input.value) / f.multiplier;
  }
  return result;
}
function normalise(values) {
  const result = clone(base);
  for (const group of ['config', 'cycle']) {
    if (!values || typeof values[group] !== 'object') throw new Error('config와 cycle 항목이 있는 설정 파일이 필요합니다.');
    for (const key of Object.keys(result[group])) if (Object.hasOwn(values[group], key)) {
      if (!Number.isFinite(values[group][key])) throw new Error(`${key}: 유한한 숫자가 필요합니다.`);
      result[group][key] = values[group][key];
    }
  }
  if (values.audio) {
    result.audio = readMix(values.audio, result.audio);
  }
  return result;
}
function configure(values, save = false) {
  releaseHeld(); ready = false; sceneReady = configured = false;
  pending = {id: ++requestId, save, audio: values.audio};
  $('apply-settings').disabled = $('save-settings').disabled = true;
  $('entry').hidden = false; $('start').disabled = true; $('loading-line').hidden = false;
  $('start').textContent = '적용 중…'; $('loading-message').textContent = '설정을 적용하고 새 판을 준비합니다.';
  worker.postMessage({type: 'configure', config: values.config, settings: values.cycle, requestId}); updateControls();
}
function currentMix() {
  return {enabled: sounds.enabled, volume: sounds.volume, musicEnabled: sounds.musicEnabled, musicVolume: sounds.musicVolume};
}
function readMix(values, defaults) {
  const mix = {...defaults};
  if (!values || typeof values !== 'object') return mix;
  for (const key of ['enabled', 'musicEnabled']) if (typeof values[key] === 'boolean') mix[key] = values[key];
  for (const key of ['volume', 'musicVolume']) if (Number.isFinite(values[key])) mix[key] = Math.max(0, Math.min(100, values[key]));
  if (!('musicEnabled' in values) && (values.enabled === false || values.volume === 0)) mix.musicEnabled = false;
  return mix;
}
function setAudio(values) {
  sounds.setEnabled(values.enabled); sounds.setVolume(values.volume);
  sounds.setMusicEnabled(values.musicEnabled); sounds.setMusicVolume(values.musicVolume);
  $('sound').checked = values.enabled; $('music').checked = values.musicEnabled;
  for (const [id, level] of [['volume', values.volume], ['music-volume', values.musicVolume]]) {
    $(id).value = level; $(id + '-value').value = level + '%';
  }
  if (started) sounds.unlock();
}
function rememberMix() {
  try { localStorage.setItem(mixerStorage, JSON.stringify(currentMix())); } catch { /* The current session still uses this mix. */ }
}
function maybeReady() {
  if (!configured || !sceneReady || fatalError) return;
  ready = true; $('engine-dot').classList.add('ready'); $('engine-status').textContent = '준비 완료';
  $('loading-line').hidden = true; $('start').textContent = '플레이 시작'; $('start').disabled = false;
  $('loading-message').textContent = '좌, 상 버튼으로 집게의 위치를 정해보세요.';
  if (started) { $('entry').hidden = true; $('engine-status').textContent = paused ? '일시 정지' : '플레이 중'; }
  $('apply-settings').disabled = $('save-settings').disabled = false; updateControls();
}
function updateControls() {
  const active = ready && started && !paused && !latestFrame?.winning;
  const state = latestFrame?.state || 'READY_X';
  $('left').disabled = !active || !['READY_X', 'MOVING_X'].includes(state);
  $('back').disabled = !active || !['READY_Y', 'MOVING_Y'].includes(state);
  $('pause').disabled = $('reset').disabled = !ready || !started;
}
function press(axis) {
  if (held || !ready || !started || paused || $(axis === 'x' ? 'left' : 'back').disabled) return false;
  if (sounds.context?.state !== 'running') sounds.unlock();
  held = axis; $(axis === 'x' ? 'left' : 'back').classList.add('holding');
  worker.postMessage({type: 'press', axis});
  holdTimer = setInterval(() => worker.postMessage({type: 'hold'}), 200);
  return true;
}
function releaseHeld(axis) {
  if (!held || axis && axis !== held) return;
  worker?.postMessage({type: 'release', axis: held});
  $('left').classList.remove('holding'); $('back').classList.remove('holding'); held = null; clearInterval(holdTimer);
}
for (const [id, axis] of [['left', 'x'], ['back', 'y']]) {
  $(id).addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); if (press(axis)) $(id).setPointerCapture(event.pointerId);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $(id).addEventListener(event, () => releaseHeld(axis));
  $(id).addEventListener('contextmenu', event => event.preventDefault());
}
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault(); if (!event.repeat) press(event.key === 'ArrowLeft' ? 'x' : 'y');
  } else if (!event.repeat && event.key.toLowerCase() === 'p' && !$('pause').disabled) $('pause').click();
  else if (!event.repeat && event.key.toLowerCase() === 'r' && !$('reset').disabled) $('reset').click();
  else if (!event.repeat && event.key.toLowerCase() === 'f') renderer?.setMode(renderer.mode);
});
window.addEventListener('keyup', event => {
  if (event.key === 'ArrowLeft') releaseHeld('x'); if (event.key === 'ArrowUp') releaseHeld('y');
});
window.addEventListener('blur', () => releaseHeld());
document.addEventListener('visibilitychange', () => {
  releaseHeld(); worker?.postMessage({type: 'visibility', hidden: document.hidden}); sounds.setPaused(document.hidden || paused);
});
window.addEventListener('pagehide', () => { releaseHeld(); worker?.postMessage({type: 'visibility', hidden: true}); sounds.setPaused(true); });
window.addEventListener('pageshow', () => {
  worker?.postMessage({type: 'visibility', hidden: document.hidden}); sounds.setPaused(document.hidden || paused);
});

$('start').addEventListener('click', () => {
  if (fatalError) { location.reload(); return; }
  if (!ready) return;
  started = true; $('entry').hidden = true; $('engine-status').textContent = '플레이 중';
  sounds.unlock(); sounds.play(latestFrame?.state || 'READY_X'); worker.postMessage({type: 'start'}); updateControls();
});
$('pause').addEventListener('click', () => {
  releaseHeld(); paused = !paused; worker.postMessage({type: 'pause', value: paused});
  sounds.setPaused(paused); $('pause').textContent = paused ? '계속하기' : '일시 정지';
  $('engine-status').textContent = paused ? '일시 정지' : '플레이 중'; updateControls();
});
$('reset').addEventListener('click', () => { releaseHeld(); worker.postMessage({type: 'reset'}); });
for (const mode of ['play', 'cabinet']) $('view-' + mode).addEventListener('click', () => {
  renderer?.setMode(mode);
  for (const other of ['play', 'cabinet']) {
    $('view-' + other).classList.toggle('selected', other === mode); $('view-' + other).setAttribute('aria-pressed', other === mode);
  }
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.querySelector('.machine').requestFullscreen) await document.querySelector('.machine').requestFullscreen();
    else toast('이 브라우저에서는 전체 화면을 지원하지 않습니다.');
  } catch { toast('전체 화면으로 전환하지 못했습니다.'); }
});
function showSettings(open) {
  releaseHeld(); $('settings-panel').hidden = !open; $('settings-toggle').setAttribute('aria-expanded', open);
  if (open) $('settings-panel').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
}
$('settings-toggle').addEventListener('click', () => showSettings($('settings-panel').hidden));
$('settings-close').addEventListener('click', () => showSettings(false));
for (const [toggle, slider, setEnabled, setVolume] of [
  ['sound', 'volume', value => sounds.setEnabled(value), value => sounds.setVolume(value)],
  ['music', 'music-volume', value => sounds.setMusicEnabled(value), value => sounds.setMusicVolume(value)],
]) {
  $(toggle).addEventListener('change', () => {
    setEnabled($(toggle).checked); if (started) sounds.unlock(); rememberMix();
  });
  $(slider).addEventListener('input', () => { setVolume($(slider).value); $(slider + '-value').value = $(slider).value + '%'; });
  $(slider).addEventListener('change', rememberMix);
}
$('settings-form').addEventListener('submit', event => { event.preventDefault(); const v = collect(); if (v) configure(v); });
$('save-settings').addEventListener('click', () => { const v = collect(); if (v) configure(v, true); });
$('restore-settings').addEventListener('click', () => { if (base) { populate(base); configure(clone(base)); } });
$('export-settings').addEventListener('click', () => {
  const values = collect(); if (!values) return;
  const file = new Blob([JSON.stringify({version: 1, ...values}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = 'cygnus-ufo-settings.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import-settings').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !base) return;
  try { const values = normalise(JSON.parse(await file.text())); populate(values); configure(values); }
  catch (e) { toast('설정을 가져오지 못했습니다. ' + e.message, true); }
  finally { event.target.value = ''; }
});

async function boot() {
  if (!window.WebAssembly || !window.Worker) throw new Error('WebAssembly와 Web Worker를 지원하는 브라우저가 필요합니다.');
  const fetchJSON = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`설정 불러오기 실패: ${r.status}`); return r.json(); };
  const [c, s, audio] = await Promise.all(['config.json', 'cycle_config.json', 'audio_config.json'].map(f => fetchJSON('./model/' + f)));
  Object.assign(audio, readMix(audio, currentMix()));
  base = {config: c, cycle: s, audio};
  published = await gameDefaults(base, prizeMode, sessionDate);
  base = published.values; let values = clone(base);
  try { const saved = localStorage.getItem(STORAGE); if (!managing && saved) values = normalise(JSON.parse(saved)); }
  catch { toast('저장된 설정을 읽지 못해 배포 기본값으로 시작합니다.'); }
  try { values.audio = readMix(JSON.parse(localStorage.getItem(mixerStorage)), values.audio); } catch { /* Use the saved game or factory mix. */ }
  config = values.config; settings = values.cycle; currentAudio = values.audio;
  setAudio(currentAudio); renderSettings();
  if (managing) {
    $('save-settings').textContent = '모두의 기본값으로 게시';
    $('save-settings').title = published.label+' · 다음에 여는 게임부터 적용';
    $('settings-toggle').hidden = false;
    $('settings-toggle').textContent = '관리자 · '+published.label;
    const heading = $('studio-mode') ?? document.querySelector('.settings-heading h2');
    if (heading) heading.textContent='관리자 · '+published.label;
    $('restore-settings').textContent = '상위 기본값 불러오기';
    base = clone(published.parent);
    showSettings(true);
  }
  renderer = new DualRenderer($('scene'), [$('front-pane'), $('left-pane')]);
  worker = new Worker(new URL('./physics.worker.js?v=pc-perf', import.meta.url), {type: 'module'});
  worker.addEventListener('error', event => error(event.message || '브라우저 물리 엔진 로딩 오류'));
  worker.addEventListener('message', async event => {
    const m = event.data;
    switch (m.type) {
      case 'loading': $('loading-message').textContent = m.message; break;
      case 'scene':
        sceneReady = false;
        try {
          await renderer.load(m.scene, m.revision);
          if (renderer.revision !== m.revision) return;
          sceneReady = true; if (latestFrame) renderer.requestDraw(latestFrame); maybeReady();
        } catch (e) { error('3D 화면을 준비하지 못했습니다. ' + e.message); }
        break;
      case 'configured':
        config = m.config; settings = m.settings; configured = true;
        if (pending && pending.id === m.requestId) {
          setAudio(pending.audio); rememberMix(); currentAudio = pending.audio;
          if (pending.save && managing) {
            published.publish(config,settings).then(() => toast(published.label+' 기본값을 게시했습니다.'))
              .catch(e => toast('게시 실패 · '+e.message,true));
          } else if (pending.save) {
            try {
              localStorage.setItem(STORAGE, JSON.stringify({version: 1, config, cycle: settings, audio: currentAudio}));
              toast('기본값으로 저장했습니다. 다음 접속에도 적용됩니다.');
            } catch { toast('설정은 적용했지만 이 브라우저에 저장할 수 없습니다. JSON 내보내기를 이용하세요.', true); }
          } else toast('설정을 적용했습니다. 새 판을 시작합니다.');
          pending = null;
        }
        populate({config, cycle: settings}); maybeReady(); break;
      case 'frame': {
        const previous = latestFrame;
        latestFrame = m; if (sceneReady) renderer.requestDraw(m);
        const stateChanged = !previous || previous.state !== m.state || previous.reason !== m.reason ||
          previous.winning !== m.winning || previous.paused !== m.paused || previous.revision !== m.revision ||
          m.elapsed < previous.elapsed;
        const now = performance.now();
        if (stateChanged || now >= nextTelemetry) {
          nextTelemetry = now + 100;
          $('z-load').firstChild.data = m.zLoad.toFixed(2) + ' ';
          $('height').firstChild.data = (m.position[2] * 1000).toFixed(0) + ' ';
          $('head-angle').firstChild.data = m.headAngle.toFixed(1) + ' ';
          $('sim-time').firstChild.data = m.elapsed.toFixed(1) + ' ';
          $('held-x').textContent = m.heldX.toFixed(2) + ' s'; $('held-y').textContent = m.heldY.toFixed(2) + ' s';
        }
        if (!stateChanged) break;
        $('phase').textContent = m.winning ? '경품 획득! 새 판을 준비합니다' : labels[m.state] || m.state;
        $('reason').textContent = m.reason ? '하강 종료: ' + m.reason : '';
        const x = ['READY_X', 'MOVING_X'].includes(m.state), y = ['READY_Y', 'MOVING_Y'].includes(m.state);
        $('step-x').classList.toggle('active', x); $('step-y').classList.toggle('active', y); $('step-auto').classList.toggle('active', !x && !y);
        updateControls(); break;
      }
      case 'phase':
        if (started && !winning) sounds.play(m.state);
        if (started && !managing && m.state==='MOVING_X')
          recordGame(prizeMode,sessionDate,false).catch(() => toast('플레이 기록을 저장하지 못했습니다.',true));
        break;
      case 'win':
        if (winning) break;
        winning = true;
        releaseHeld();
        $('win').hidden = false;
        if (!managing) recordGame(prizeMode,sessionDate,true).catch(() => toast('경품을 획득했지만 이 브라우저에 도감을 저장할 수 없습니다.', true));
        sounds.play('WIN');
        break;
      case 'reset': winning = false; $('win').hidden = true; if (started) sounds.play('READY_X'); break;
      case 'error': error(m.message, m.recoverable); break;
    }
  });
  worker.postMessage({type: 'boot', config, settings});
  worker.postMessage({type: 'visibility', hidden: document.hidden});
}
boot().catch(e => error(e.message));
