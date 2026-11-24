import {Cycle, labels as baseLabels} from './cycle.js';

export const hookLabels = {
  ...baseLabels,
  READY_X: '좌 버튼으로 링의 가로 위치를 정하세요',
  MOVING_Y: '뒤로 이동 중 · 놓으면 링 하강',
  LOWERING: '링을 후크로 내리는 중',
  LIFTING: '링을 들어 올리는 중',
  HOOK_BLOCKED: '링이 걸렸어요. 새 판을 시작할 수 있어요.',
};

export function setHookPage() {
  document.title = '후크&링 · UFO캐쳐 프리게임';
  document.querySelector('.brand').textContent = '후크&링';
  document.querySelector('#entry h1').textContent = '후크&링';
  document.querySelector('.entry-note').textContent = '좌 이동 · 상 이동 · 링 내리기';
  document.querySelector('#step-auto').textContent = '링 내리기';
  document.querySelector('.cycle-note').textContent = '좌·상 버튼으로 링을 후크 끝에 맞추세요. 상 버튼을 놓으면 링이 내려갔다 올라옵니다. 받침대가 기울어 경품이 떨어지면 성공입니다.';
  document.querySelector('.settings-heading p').textContent = '경품 치수와 동작은 새 판에 적용됩니다. 헤드 강성과 감쇠는 즉시 반영됩니다.';
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
    this.sim.setTarget({z: this.settings.home_height});
    this.progressHeight = this.sim.pose()[2];
    this.stalled = 0;
    this.enter('LIFTING');
  }

  update(dt) {
    if (this.state !== 'LIFTING') {
      super.update(dt);
      return;
    }
    this.elapsed += dt;
    this.zLoad = this.sim.clawExternalZ();
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
