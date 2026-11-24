import {Cycle, labels as baseLabels} from './cycle.js?v=pc-perf';

export const hookLabels = {
  ...baseLabels,
  READY_X: '좌 버튼으로 줄 끝의 가로 위치를 정하세요',
  MOVING_Y: '뒤로 이동 중 · 놓으면 하강',
  LOWERING: '줄을 내리는 중',
  HOOK_DWELL: '하강 완료 · 상승 대기 중',
  LIFTING: '줄을 들어 올리는 중',
  HOOK_BLOCKED: '줄 끝이 걸렸어요. 새 판을 시작할 수 있어요.',
};

const equipment = [
  {key: 'hook_type', label: '받침대 후크 모양', initial: 0, options: ['기본형', '물음표형 (?)', '받침판 D링 (∩)']},
  {key: 'hook_height', label: '후크 높이 (mm)', initial: .112, multiplier: 1000, min: 20, max: 220},
  {key: 'ring_type', label: '줄 끝 링 모양', initial: 0, options: ['원형', '타원형', '갈고리형 (¿)']},
  {key: 'ring_width', label: '링 바깥 너비 (mm)', initial: .0816, multiplier: 1000, min: 20, max: 200},
  {key: 'chain_length', label: '줄 길이 (mm)', initial: .090, multiplier: 1000, min: 10, max: 400},
  {key: 'bottom_wait', label: '하강 후 대기 시간 (초)', initial: 0, source: 'cycle', min: 0},
];

export function applyHookDefaults(config, cycle) {
  Object.assign(config, {box_width: .15, box_length: .14, box_height: .09, box_mass: .22});
  cycle.lower_height = .440;
  for (const {source, key, initial} of equipment) (source === 'cycle' ? cycle : config)[key] = initial;
}

export function renderHookEquipment(container, fields) {
  const group = document.createElement('fieldset');
  group.className = 'settings-group';
  const legend = document.createElement('legend');
  legend.textContent = '후크·링과 승강';
  group.append(legend);
  for (const {key, label, options, min, max, multiplier = 1, source = 'config'} of equipment) {
    const row = document.createElement('label');
    row.className = 'field';
    const control = document.createElement(options ? 'select' : 'input');
    control.id = 'setting-' + key;
    control.name = key;
    control.required = true;
    if (options) {
      options.forEach((text, index) => control.add(new Option(text, String(index))));
    } else {
      control.type = 'number';
      control.inputMode = 'decimal';
      control.step = 'any';
      control.min = min;
      if (max !== undefined) control.max = max;
    }
    const title = document.createElement('span');
    title.className = 'field-name';
    title.textContent = label;
    row.append(title, control);
    group.append(row);
    fields.set(key, {input: control, source, multiplier});
  }
  container.append(group);
}

export function validateHookEquipment(values) {
  for (const {key, label, source = 'config', multiplier = 1, min, max, options} of equipment) {
    const value = values[source][key] * multiplier;
    if (options && (!Number.isInteger(value) || value < 0 || value >= options.length))
      throw new Error(label + '를 목록에서 선택해 주세요.');
    if (min !== undefined && value < min || max !== undefined && value > max)
      throw new Error(label + '의 입력 범위를 확인해 주세요.');
  }
}

export function setHookPage() {
  document.title = '후크&링 · UFO캐쳐 프리게임';
  document.querySelector('.brand').textContent = '후크&링';
  document.querySelector('#entry h1').textContent = '후크&링';
  document.querySelector('.entry-note').textContent = '좌 이동 · 상 이동 · 자동 하강';
  document.querySelector('#step-auto').textContent = '자동 하강';
  document.querySelector('.cycle-note').textContent = '좌·상 버튼으로 줄 끝을 조준하세요. 상 버튼을 놓으면 줄이 내려갔다 올라옵니다. 받침대를 걸어 기울이고 경품을 떨어뜨리세요.';
  document.querySelector('.settings-heading p').textContent = '후크·링의 형상, 줄 길이와 하강 후 대기 시간은 새 판에 적용됩니다. 헤드 강성과 감쇠는 즉시 반영됩니다.';
}

export function showHookSetting(key) {
  return !['gap', 'gap_12', 'gap_34', 'inner_height', 'outer_height', 'rod_radius',
    'tip_friction', 'arm_friction', 'rail_friction', 'inner_rail_friction', 'grip_kp',
    'grip_torque', 'open_duration', 'close_duration', 'release_duration', 'open_angle',
    'closed_angle', 'release_x', 'release_y', 'descent_yaw_deg'].includes(key) && !key.startsWith('rod_');
}

export class HookCycle extends Cycle {
  release(axis) {
    if (this.state === 'MOVING_Y' && (!axis || axis === 'y')) {
      this.loadTime = 0;
      this.sim.setTarget({z: this.settings.lower_height});
      this.enter('LOWERING');
    } else {
      super.release(axis);
    }
  }

  stopDescent(reason) {
    this.reason = reason;
    this.sim.setTarget({z: this.sim.pose()[2]});
    this.sim.data.ctrl[2] = this.sim.target[2];
    if (this.settings.bottom_wait > 0) this.enter('HOOK_DWELL');
    else this.startLift();
  }

  startLift() {
    this.sim.setTarget({z: this.settings.home_height});
    this.progressHeight = this.sim.pose()[2];
    this.stalled = 0;
    this.enter('LIFTING');
  }

  update(dt) {
    if (this.state === 'HOOK_DWELL') {
      this.elapsed += dt;
      if (this.elapsed >= this.settings.bottom_wait) this.startLift();
      return;
    }
    if (this.state !== 'LIFTING') {
      super.update(dt);
      return;
    }
    this.elapsed += dt;
    const z = this.sim.pose()[2], s = this.settings;
    if (Math.abs(z - s.home_height) < .002) {
      this.sim.setTarget({x: s.start_x, y: s.start_y});
      this.enter('RETURNING');
    } else if (z >= this.progressHeight + .002) {
      this.progressHeight = z;
      this.stalled = 0;
    } else if ((this.stalled += dt) > 1.5) {
      this.sim.setTarget({z});
      this.sim.data.ctrl[2] = this.sim.target[2];
      this.enter('HOOK_BLOCKED');
    }
  }
}
