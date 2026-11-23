import {labels as cycleLabels} from './cycle.js';
import {DescentYawCycle} from './descent-yaw.js';

export const labels = {
  ...cycleLabels,
  ROD_RELEASE: '봉 걸림 · 하중을 풀고 집게를 벌리는 중',
  ROD_BLOCKED: '봉이 아직 걸려 있어요. 걸림 해제를 다시 시도하세요.',
};

export class BridgeCycle extends DescentYawCycle {
  enter(state) {
    if (state === 'LOWERING') this.releaseAttempts = 0;
    if (state === 'LOWERING' || state === 'LIFTING') {
      this.progressZ = this.sim.pose()[2];
      this.lastProgress = 0;
      this.lastRodContact = -Infinity;
    }
    super.enter(state);
  }

  releaseRod() {
    const sim = this.sim, s = this.settings, z = sim.pose()[2];
    // Take the load off the Z servo by cancelling its accumulated command
    // error. Subsequent motion still goes through the normal motor slew limit.
    sim.setTarget({z, opening: s.open_angle});
    sim.data.ctrl[2] = sim.target[2];
    if (this.releaseAttempts >= 2) {
      this.enter('ROD_BLOCKED');
      return;
    }
    this.releaseAttempts++;
    const backoff = .012 * this.releaseAttempts;
    if (this.state === 'LOWERING') {
      this.reason = '봉 접촉으로 하강 정체';
      sim.setTarget({z: Math.min(s.home_height, z + backoff)});
    } else {
      sim.setTarget({z: Math.min(z, Math.max(s.lower_height, z - backoff))});
    }
    this.enter('ROD_RELEASE');
  }

  retryRelease() {
    if (this.state !== 'ROD_BLOCKED') return;
    this.releaseAttempts = 0;
    this.releaseRod();
  }

  update(dt) {
    const state = this.state;
    super.update(dt);
    if (this.state !== state) return;
    if (state === 'ROD_RELEASE') {
      // At the maximum configured opening the finger command needs about
      // 1.8 s to traverse its range, even with a zero pre-descent wait.
      if (this.elapsed >= Math.max(1.8, this.settings.open_duration)) {
        this.sim.setTarget({z: this.settings.home_height});
        this.enter('LIFTING');
      }
      return;
    }
    if (state !== 'LOWERING' && state !== 'LIFTING') return;
    const z = this.sim.pose()[2];
    const advance = state === 'LIFTING' ? z - this.progressZ : this.progressZ - z;
    if (this.sim.touchingRod) this.lastRodContact = this.elapsed;
    // A contact may drop out for a few steps as the elastic rod vibrates.
    // After a confirmed jam, also monitor the open-claw extraction itself.
    if (advance >= .003 || (this.releaseAttempts === 0 && this.elapsed - this.lastRodContact > .10)) {
      this.progressZ = z;
      this.lastProgress = this.elapsed;
    } else if (this.elapsed - this.lastProgress >= .45) {
      this.releaseRod();
    }
  }
}
