// The spatial stop limits the inclination of the shaft as a whole.
// For axial anchor radii a, b and tilt t, its length squared is
// (b - a)^2 + 4ab sin^2(t/2). Rotation about vertical leaves it unchanged.
export class HeadTilt {
  constructor(model, id) {
    this.model = model;
    this.yawMotor = id(model, 'mjOBJ_ACTUATOR', 'yaw_motor');
    this.body = id(model, 'mjOBJ_BODY', 'claw_head');
    this.pitch = id(model, 'mjOBJ_JOINT', 'head_pitch');
    this.roll = id(model, 'mjOBJ_JOINT', 'head_roll');
    this.stop = id(model, 'mjOBJ_TENDON', 'head_tilt_stop');
    const pivotZ = model.jnt_pos[3 * this.pitch + 2];
    const radius = name => pivotZ - model.site_pos[3 * id(model, 'mjOBJ_SITE', name) + 2];
    const a = radius('tilt_anchor'), b = radius('tilt_tip');
    this.axialGap = b - a;
    this.chordScale = 2 * Math.sqrt(a * b);
  }

  tune(key, value) {
    const m = this.model;
    if (key === 'yaw_kp') {
      const kp = Math.max(0, Math.min(50, value));
      m.actuator_gainprm[10 * this.yawMotor] = kp;
      m.actuator_biasprm[10 * this.yawMotor + 1] = -kp;
      return kp;
    }
    if (key === 'yaw_kd') {
      const kd = Math.max(0, Math.min(5, value));
      m.actuator_biasprm[10 * this.yawMotor + 2] = -kd;
      return kd;
    }
    if (key === 'pitch_stiffness' || key === 'head_stiffness') {
      const stiffness = Math.max(0, Math.min(30, value));
      m.jnt_stiffness[key === 'pitch_stiffness' ? this.pitch : this.roll] = stiffness;
      return stiffness;
    }
    if (key === 'pitch_damping' || key === 'head_damping') {
      const damping = Math.max(0, Math.min(3, value));
      const joint = key === 'pitch_damping' ? this.pitch : this.roll;
      m.dof_damping[m.jnt_dofadr[joint]] = damping;
      return damping;
    }
    const degrees = Math.max(1, Math.min(25, value));
    const chord = this.chordScale * Math.sin(degrees * Math.PI / 360);
    m.tendon_range[2 * this.stop + 1] = Math.hypot(this.axialGap, chord);
    return degrees;
  }
}
