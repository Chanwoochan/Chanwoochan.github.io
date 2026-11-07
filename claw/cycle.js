// Same actuator-only sequence as cycle.py. No ongoing prize pose/force edits.
export const labels = {
  READY_X: '좌 버튼으로 가로 위치를 정하세요', MOVING_X: '왼쪽 이동 중 · 놓으면 위치 확정',
  READY_Y: '상 버튼으로 깊이를 정하세요', MOVING_Y: '뒤로 이동 중 · 놓으면 자동 집기',
  OPEN_BEFORE_LOWER: '집게를 벌리고 있어요', LOWERING: '집게가 내려갑니다',
  CLOSING: '집게를 닫고 있어요', LIFTING: '집게가 올라갑니다',
  MOVING_CENTER: '중앙으로 이동 중', RELEASING: '중앙에서 경품 놓기',
  RECLOSING: '집게를 다시 닫는 중', RETURNING: '처음 위치로 돌아갑니다',
};
export class Cycle {
  constructor(sim, settings, onPhase) {
    this.sim = sim; this.settings = settings; this.onPhase = onPhase;
    this.state = 'READY_X'; this.elapsed = 0; this.heldX = 0; this.heldY = 0;
    this.loadTime = 0; this.zLoad = 0; this.reason = '';
  }
  enter(state) { this.state = state; this.elapsed = 0; this.onPhase(state); }
  press(axis) {
    if (axis === 'x' && this.state === 'READY_X') this.enter('MOVING_X');
    if (axis === 'y' && this.state === 'READY_Y') this.enter('MOVING_Y');
  }
  release(axis) {
    if (this.state === 'MOVING_X' && (!axis || axis === 'x')) this.enter('READY_Y');
    else if (this.state === 'MOVING_Y' && (!axis || axis === 'y')) {
      this.loadTime = 0; this.sim.setTarget({opening: this.settings.open_angle});
      this.enter('OPEN_BEFORE_LOWER');
    }
  }
  stopDescent(reason) {
    this.reason = reason;
    this.sim.setTarget({z: this.sim.pose()[2], opening: this.settings.closed_angle});
    this.sim.data.ctrl[2] = this.sim.target[2]; this.enter('CLOSING');
  }
  update(dt) {
    const s = this.settings, sim = this.sim, p = sim.pose();
    this.elapsed += dt; this.zLoad = sim.clawExternalZ();
    switch (this.state) {
      case 'MOVING_X': this.heldX += dt; sim.setTarget({x: sim.target[0] - s.move_speed * dt}); break;
      case 'MOVING_Y': this.heldY += dt; sim.setTarget({y: sim.target[1] + s.move_speed * dt}); break;
      case 'OPEN_BEFORE_LOWER':
        if (this.elapsed >= s.open_duration) { sim.setTarget({z: s.lower_height}); this.enter('LOWERING'); } break;
      case 'LOWERING':
        this.loadTime = this.zLoad >= s.z_load_threshold ? this.loadTime + dt : 0;
        if (this.zLoad >= s.z_load_threshold && this.loadTime >= s.contact_hold_time)
          this.stopDescent(`Z 접촉 하중 ${this.zLoad.toFixed(2)} N ≥ ${s.z_load_threshold} N`);
        else if (p[2] <= s.lower_height + .002 && Math.abs(sim.data.ctrl[2] - sim.target[2]) < .001)
          this.stopDescent('하강 한계 도달');
        break;
      case 'CLOSING':
        if (this.elapsed >= s.close_duration) { sim.setTarget({z: s.home_height}); this.enter('LIFTING'); } break;
      case 'LIFTING':
        if (Math.abs(p[2] - s.home_height) < .002) {
          sim.setTarget({x: s.release_x, y: s.release_y, z: s.home_height}); this.enter('MOVING_CENTER');
        } break;
      case 'MOVING_CENTER':
        if (Math.abs(p[0] - s.release_x) < .003 && Math.abs(p[1] - s.release_y) < .003 && Math.abs(p[2] - s.home_height) < .003) {
          sim.setTarget({opening: s.open_angle}); this.enter('RELEASING');
        } break;
      case 'RELEASING':
        if (this.elapsed >= s.open_duration + s.release_duration) {
          sim.setTarget({opening: s.closed_angle}); this.enter('RECLOSING');
        } break;
      case 'RECLOSING':
        if (this.elapsed >= s.close_duration) {
          sim.setTarget({x: s.start_x, y: s.start_y, z: s.home_height, yaw: 0}); this.enter('RETURNING');
        } break;
      case 'RETURNING':
        if (Math.abs(p[0] - s.start_x) < .003 && Math.abs(p[1] - s.start_y) < .003 && Math.abs(p[2] - s.home_height) < .003) {
          this.heldX = this.heldY = 0; this.reason = ''; this.enter('READY_X');
        } break;
    }
  }
}
