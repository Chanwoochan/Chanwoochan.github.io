import {Cycle} from './cycle.js?v=pc-perf';

const yawTravelMetres = 0.30;

export class DescentYawCycle extends Cycle {
  constructor(sim, settings, onPhase) {
    super(sim, settings, onPhase);
    this.fullYaw = settings.descent_yaw_deg * Math.PI / 180;
  }

  enter(state) {
    if (state === 'LOWERING') {
      this.startZ = this.sim.pose()[2];
    } else if (state === 'MOVING_CENTER') {
      this.sim.setTarget({yaw: 0});
    }
    super.enter(state);
  }

  update(dt) {
    if (this.state === 'LOWERING' || this.state === 'LIFTING') {
      const fraction = (this.startZ - this.sim.pose()[2]) / yawTravelMetres;
      this.sim.setTarget({yaw: this.fullYaw * Math.max(0, Math.min(1, fraction))});
    }
    super.update(dt);
  }
}
