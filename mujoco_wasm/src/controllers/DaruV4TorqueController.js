import loadDaruRbdl from '../ik_rbdl/daru_rbdl_ik.js';

export const DARU_TORQUE_SCENE = 'DARU_NEW_260323/scene.xml';

const DARU_RBDL_URDF_ASSET = 'DARU_V4/DARU_V4.urdf';

const ARM_JOINT_NAMES = [
  'Waist_Joint', 'LSP_Joint', 'LSR_Joint', 'LSY_Joint', 'LEP_Joint', 'LEY_Joint', 'LWR_Joint', 'LWP_Joint',
  'RSP_Joint', 'RSR_Joint', 'RSY_Joint', 'REP_Joint', 'REY_Joint', 'RWR_Joint', 'RWP_Joint',
];
const HEAD_JOINT_NAMES = ['HY_Joint', 'HP_Joint'];
const HAND_JOINT_NAMES = [
  'rh_f1_Motor_Linear_Joint', 'rh_f2_Motor_Linear_Joint', 'rh_f3_Motor_Linear_Joint',
  'rh_f4_Motor_Linear_Joint', 'rh_c_t_Motor_Linear_Joint', 'rh_c_Motor_Linear_Joint',
  'lh_f1_Motor_Linear_Joint', 'lh_f2_Motor_Linear_Joint', 'lh_f3_Motor_Linear_Joint',
  'lh_f4_Motor_Linear_Joint', 'lh_c_t_Motor_Linear_Joint', 'lh_c_Motor_Linear_Joint',
];

const ARM_PD_LIMITS = [100.0, 60.0, 60.0, 60.0, 60.0, 10.0, 10.0, 10.0, 60.0, 60.0, 60.0, 60.0, 10.0, 10.0, 10.0];
const CG_COMPENSATION_SCALE = 1.2;
const HOME_MODE_END_COUNT = 6000;
const DEFAULT_LEFT_POS = new Float64Array([0.2930, 0.2250, 0.0725]);
const DEFAULT_RIGHT_POS = new Float64Array([0.2930, -0.2250, 0.0725]);
const DEFAULT_LEFT_QUAT_WXYZ = new Float64Array([0.707, 0.0, -0.707, 0.0]);
const DEFAULT_RIGHT_QUAT_WXYZ = new Float64Array([0.707, 0.0, -0.707, 0.0]);
const EE_LOCAL_OFFSET = new Float64Array([0.0, 0.0, -0.0825]);
const ARM_INDEX = Object.freeze({
  WAIST: 0,
  LSP: 1,
  LSR: 2,
  LSY: 3,
  LEP: 4,
  LEY: 5,
  LWR: 6,
  LWP: 7,
  RSP: 8,
  RSR: 9,
  RSY: 10,
  REP: 11,
  REY: 12,
  RWR: 13,
  RWP: 14,
});
const HEAD_INDEX = Object.freeze({
  HY: 0,
  HP: 1,
});

let rbdlModulePromise = null;

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function cosineBlend(phaseCount, durationCount) {
  const normalized = clamp(phaseCount / durationCount, 0.0, 1.0);
  return 0.5 * (1.0 - Math.cos(Math.PI * normalized));
}

function rotateVectorByQuatWxyz(quat, vector) {
  const w = quat[0];
  const x = quat[1];
  const y = quat[2];
  const z = quat[3];
  const vx = vector[0];
  const vy = vector[1];
  const vz = vector[2];

  const tx = 2.0 * (y * vz - z * vy);
  const ty = 2.0 * (z * vx - x * vz);
  const tz = 2.0 * (x * vy - y * vx);

  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function writeIkTargetQuatWithNegatedW(targetView, sourceQuatWxyz) {
  targetView[0] = -sourceQuatWxyz[0];
  targetView[1] = sourceQuatWxyz[1];
  targetView[2] = sourceQuatWxyz[2];
  targetView[3] = sourceQuatWxyz[3];
}

function multiplyQuatWxyz(lhs, rhs, out) {
  const lw = lhs[0];
  const lx = lhs[1];
  const ly = lhs[2];
  const lz = lhs[3];
  const rw = rhs[0];
  const rx = rhs[1];
  const ry = rhs[2];
  const rz = rhs[3];

  out[0] = lw * rw - lx * rx - ly * ry - lz * rz;
  out[1] = lw * rx + lx * rw + ly * rz - lz * ry;
  out[2] = lw * ry - lx * rz + ly * rw + lz * rx;
  out[3] = lw * rz + lx * ry - ly * rx + lz * rw;
}

function normalizeQuatWxyz(quat) {
  const norm = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
  if (norm <= 1e-12) {
    quat[0] = 1.0;
    quat[1] = 0.0;
    quat[2] = 0.0;
    quat[3] = 0.0;
    return;
  }

  quat[0] /= norm;
  quat[1] /= norm;
  quat[2] /= norm;
  quat[3] /= norm;
}

function writeAxisAngleQuatWxyz(axisX, axisY, axisZ, angle, out) {
  const halfAngle = 0.5 * angle;
  const sinHalfAngle = Math.sin(halfAngle);
  const axisNorm = Math.hypot(axisX, axisY, axisZ);
  if (axisNorm <= 1e-12) {
    out[0] = 1.0;
    out[1] = 0.0;
    out[2] = 0.0;
    out[3] = 0.0;
    return;
  }

  out[0] = Math.cos(halfAngle);
  out[1] = (axisX / axisNorm) * sinHalfAngle;
  out[2] = (axisY / axisNorm) * sinHalfAngle;
  out[3] = (axisZ / axisNorm) * sinHalfAngle;
}

async function getRbdlModule(debugCallback) {
  const reportDebug = (message) => {
    if (typeof debugCallback === 'function') {
      debugCallback(message);
    }
  };

  const resolveRbdlAssetUrl = (path) => {
    if (typeof window !== 'undefined' && window.location) {
      return new URL(`src/ik_rbdl/${path}`, window.location.href).href;
    }
    return new URL(`../ik_rbdl/${path}`, import.meta.url).href;
  };

  if (!rbdlModulePromise) {
    rbdlModulePromise = loadDaruRbdl({
      locateFile: (path) => {
        const url = resolveRbdlAssetUrl(path);
        reportDebug(`locateFile ${path}`);
        return url;
      },
      setStatus: (text) => {
        if (text) {
          reportDebug(`status ${text}`);
        }
      },
      monitorRunDependencies: (count) => {
        reportDebug(`deps ${count}`);
      },
      printErr: (...args) => {
        console.error(...args);
        reportDebug(`printErr ${args.join(' ')}`);
      },
      onAbort: (what) => {
        reportDebug(`abort ${what}`);
      },
    });
  }

  const module = await rbdlModulePromise;
  reportDebug('ready');
  return module;
}

async function fetchRbdlUrdf(debugCallback) {
  const reportDebug = (message) => {
    if (typeof debugCallback === 'function') {
      debugCallback(message);
    }
  };

  reportDebug('fetch urdf');
  const response = await fetch(`./assets/scenes/${DARU_RBDL_URDF_ASSET}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${DARU_RBDL_URDF_ASSET}: ${response.status}`);
  }
  const urdfXml = await response.text();
  reportDebug(`urdf fetched ${urdfXml.length}`);
  return urdfXml;
}

function findActuatorForJoint(model, jointId) {
  for (let actuatorId = 0; actuatorId < model.nu; actuatorId += 1) {
    if (model.actuator_trnid[2 * actuatorId] === jointId) {
      return actuatorId;
    }
  }
  return -1;
}

function clampActuatorCommand(model, actuatorId, fallbackLimit, command) {
  let lower = -fallbackLimit;
  let upper = fallbackLimit;
  if (actuatorId >= 0 && model.actuator_ctrllimited[actuatorId]) {
    lower = model.actuator_ctrlrange[2 * actuatorId + 0];
    upper = model.actuator_ctrlrange[2 * actuatorId + 1];
  }
  return clamp(command, lower, upper);
}

function jointRangeOrFallback(model, jointId) {
  if (jointId >= 0) {
    const lower = model.jnt_range[2 * jointId + 0];
    const upper = model.jnt_range[2 * jointId + 1];
    if (Number.isFinite(lower) && Number.isFinite(upper) && lower < upper) {
      return [lower, upper];
    }
  }
  return [-Infinity, Infinity];
}

export class DaruV4TorqueController {
  static async create(mujoco, model, data, debugCallback) {
    const rbdl = await getRbdlModule(debugCallback);
    const urdfXml = await fetchRbdlUrdf(debugCallback);
    const initialized = rbdl.ccall('daru_ik_init_from_xml', 'number', ['string'], [urdfXml]);
    if (!initialized) {
      throw new Error('Failed to initialize RBDL IK from URDF xml');
    }
    if (typeof debugCallback === 'function') {
      debugCallback('ik init ok');
    }
    return new DaruV4TorqueController(mujoco, model, data, rbdl);
  }

  constructor(mujoco, model, data, rbdl) {
    this.mujoco = mujoco;
    this.model = model;
    this.data = data;
    this.rbdl = rbdl;

    this.armJointIds = new Int32Array(ARM_JOINT_NAMES.length);
    this.armQposIds = new Int32Array(ARM_JOINT_NAMES.length);
    this.armDofIds = new Int32Array(ARM_JOINT_NAMES.length);
    this.armActuatorIds = new Int32Array(ARM_JOINT_NAMES.length);
    this.armLowerLimits = new Float64Array(ARM_JOINT_NAMES.length);
    this.armUpperLimits = new Float64Array(ARM_JOINT_NAMES.length);
    this.headJointIds = new Int32Array(HEAD_JOINT_NAMES.length).fill(-1);
    this.headQposIds = new Int32Array(HEAD_JOINT_NAMES.length).fill(-1);
    this.headDofIds = new Int32Array(HEAD_JOINT_NAMES.length).fill(-1);
    this.headActuatorIds = new Int32Array(HEAD_JOINT_NAMES.length).fill(-1);
    this.handJointIds = new Int32Array(HAND_JOINT_NAMES.length).fill(-1);
    this.handQposIds = new Int32Array(HAND_JOINT_NAMES.length).fill(-1);
    this.handDofIds = new Int32Array(HAND_JOINT_NAMES.length).fill(-1);
    this.handActuatorIds = new Int32Array(HAND_JOINT_NAMES.length).fill(-1);

    this.armPos = new Float64Array(ARM_JOINT_NAMES.length);
    this.armVel = new Float64Array(ARM_JOINT_NAMES.length);
    this.armVelOld = new Float64Array(ARM_JOINT_NAMES.length);
    this.armTau = new Float64Array(ARM_JOINT_NAMES.length);
    this.armRefPos = new Float64Array(ARM_JOINT_NAMES.length);
    this.armRefTau = new Float64Array(ARM_JOINT_NAMES.length);
    this.armDesPos = new Float64Array(ARM_JOINT_NAMES.length);
    this.armPosInit = new Float64Array(ARM_JOINT_NAMES.length);

    this.headPos = new Float64Array(HEAD_JOINT_NAMES.length);
    this.headVel = new Float64Array(HEAD_JOINT_NAMES.length);
    this.headPosInit = new Float64Array(HEAD_JOINT_NAMES.length);
    this.headDesPos = new Float64Array(HEAD_JOINT_NAMES.length);
    this.headCmdTau = new Float64Array(HEAD_JOINT_NAMES.length);

    this.handPos = new Float64Array(HAND_JOINT_NAMES.length);
    this.handVel = new Float64Array(HAND_JOINT_NAMES.length);
    this.handDesPos = new Float64Array(HAND_JOINT_NAMES.length);
    this.handCmd = new Float64Array(HAND_JOINT_NAMES.length);
    this.leftPosTarget = new Float64Array(DEFAULT_LEFT_POS);
    this.rightPosTarget = new Float64Array(DEFAULT_RIGHT_POS);
    this.leftQuatTargetWxyz = new Float64Array(DEFAULT_LEFT_QUAT_WXYZ);
    this.rightQuatTargetWxyz = new Float64Array(DEFAULT_RIGHT_QUAT_WXYZ);

    this.worldCount = 0;
    this.mode = 0;
    this.count = 0;
    this.initialized = false;
    this.lastUpdateTime = 0.0;
    this.dt = this.model.opt.timestep;
    this.handControlAccumulator = 0.0;

    this.qRefBuffer = this.allocateF64(ARM_JOINT_NAMES.length);
    this.qdotBuffer = this.allocateF64(ARM_JOINT_NAMES.length);
    this.leftPosBuffer = this.allocateF64(3);
    this.rightPosBuffer = this.allocateF64(3);
    this.leftQuatBuffer = this.allocateF64(4);
    this.rightQuatBuffer = this.allocateF64(4);
    this.cgBuffer = this.allocateF64(ARM_JOINT_NAMES.length);
    this.qOutBuffer = this.allocateF64(ARM_JOINT_NAMES.length);

    this.mapModel();
    this.initializeRbdl();
    this.reset();
  }

  allocateF64(length) {
    const pointer = this.rbdl._malloc(length * Float64Array.BYTES_PER_ELEMENT);
    return {
      pointer,
      view: this.rbdl.HEAPF64.subarray(pointer / Float64Array.BYTES_PER_ELEMENT, pointer / Float64Array.BYTES_PER_ELEMENT + length),
    };
  }

  mapModel() {
    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      const jointId = this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_JOINT.value, ARM_JOINT_NAMES[index]);
      if (jointId < 0) {
        throw new Error(`Joint not found: ${ARM_JOINT_NAMES[index]}`);
      }

      this.armJointIds[index] = jointId;
      this.armQposIds[index] = this.model.jnt_qposadr[jointId];
      this.armDofIds[index] = this.model.jnt_dofadr[jointId];
      this.armActuatorIds[index] = findActuatorForJoint(this.model, jointId);
      [this.armLowerLimits[index], this.armUpperLimits[index]] = jointRangeOrFallback(this.model, jointId);
    }

    this.leftWristBodyId = this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_BODY.value, 'LWP_Link');
    this.rightWristBodyId = this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_BODY.value, 'RWP_Link');

    for (let index = 0; index < HEAD_JOINT_NAMES.length; index += 1) {
      const jointId = this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_JOINT.value, HEAD_JOINT_NAMES[index]);
      if (jointId < 0) {
        continue;
      }

      this.headJointIds[index] = jointId;
      this.headQposIds[index] = this.model.jnt_qposadr[jointId];
      this.headDofIds[index] = this.model.jnt_dofadr[jointId];
      this.headActuatorIds[index] = findActuatorForJoint(this.model, jointId);
    }

    for (let index = 0; index < HAND_JOINT_NAMES.length; index += 1) {
      const jointId = this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_JOINT.value, HAND_JOINT_NAMES[index]);
      if (jointId < 0) {
        continue;
      }

      this.handJointIds[index] = jointId;
      this.handQposIds[index] = this.model.jnt_qposadr[jointId];
      this.handDofIds[index] = this.model.jnt_dofadr[jointId];
      this.handActuatorIds[index] = findActuatorForJoint(this.model, jointId);
    }
  }

  initializeRbdl() {
    // RBDL model is initialized in create() from an in-memory URDF string.
  }

  reset() {
    this.worldCount = 0;
    this.count = 0;
    this.mode = 0;
    this.initialized = false;
    this.lastUpdateTime = 0.0;
    this.dt = this.model.opt.timestep;
    this.handControlAccumulator = 0.0;

    this.armPos.fill(0.0);
    this.armVel.fill(0.0);
    this.armVelOld.fill(0.0);
    this.armTau.fill(0.0);
    this.armRefPos.fill(0.0);
    this.armRefTau.fill(0.0);
    this.armDesPos.fill(0.0);
    this.armPosInit.fill(0.0);
    this.headPos.fill(0.0);
    this.headVel.fill(0.0);
    this.headPosInit.fill(0.0);
    this.headDesPos.fill(0.0);
    this.headCmdTau.fill(0.0);
    this.handPos.fill(0.0);
    this.handVel.fill(0.0);
    this.handDesPos.fill(0.0);
    this.handCmd.fill(0.0);
    this.setDefaultEeTargets();
  }

  nudgeRightTargetPosition(deltaX, deltaY, deltaZ) {
    this.rightPosTarget[0] += deltaX;
    this.rightPosTarget[1] += deltaY;
    this.rightPosTarget[2] += deltaZ;
  }

  rotateRightTargetLocal(axisX, axisY, axisZ, angle) {
    if (Math.abs(angle) <= 1e-12) {
      return;
    }

    const deltaQuat = [1.0, 0.0, 0.0, 0.0];
    const nextQuat = [1.0, 0.0, 0.0, 0.0];
    writeAxisAngleQuatWxyz(axisX, axisY, axisZ, angle, deltaQuat);
    multiplyQuatWxyz(this.rightQuatTargetWxyz, deltaQuat, nextQuat);
    normalizeQuatWxyz(nextQuat);
    this.rightQuatTargetWxyz.set(nextQuat);
  }

  dispose() {
    this.rbdl._free(this.qRefBuffer.pointer);
    this.rbdl._free(this.qdotBuffer.pointer);
    this.rbdl._free(this.leftPosBuffer.pointer);
    this.rbdl._free(this.rightPosBuffer.pointer);
    this.rbdl._free(this.leftQuatBuffer.pointer);
    this.rbdl._free(this.rightQuatBuffer.pointer);
    this.rbdl._free(this.cgBuffer.pointer);
    this.rbdl._free(this.qOutBuffer.pointer);
  }

  initializeHomeModeIfNeeded() {
    if (this.initialized) {
      return;
    }

    this.stateUpdate();
    this.armPosInit.set(this.armPos);
    this.armDesPos.set(this.armPos);
    this.armRefPos.set(this.armPos);
    this.headPosInit.set(this.headPos);
    this.headDesPos.set(this.headPos);
    this.handDesPos.set(this.handPos);

    this.qRefBuffer.view.set(this.armRefPos);
    this.rbdl._daru_ik_reset_ref(this.qRefBuffer.pointer);

    this.mode = 1;
    this.count = 0;
    this.initialized = true;
  }

  step() {
    this.initializeHomeModeIfNeeded();

    const currentTime = this.data.time;
    this.dt = currentTime - this.lastUpdateTime;
    if (this.dt <= 1e-9) {
      this.dt = this.model.opt.timestep;
    }
    this.handControlAccumulator += this.dt;

    if (this.worldCount % 2 === 1) {
      this.stateUpdate();
      this.armRefTau.fill(0.0);

      if (this.mode === 1) {
        this.setHomePose();
        this.applyCgCompensation();
        this.count += 1;
        if (this.count > HOME_MODE_END_COUNT) {
          this.mode = 2;
          this.count = 0;
          this.setDefaultEeTargets();
          this.armRefPos.set(this.armDesPos);
          this.qRefBuffer.view.set(this.armRefPos);
          this.rbdl._daru_ik_reset_ref(this.qRefBuffer.pointer);
        }
      } else if (this.mode === 2 || this.mode === 3) {
        this.solveIkTargets();
        this.applyCgCompensation();
        this.count += 1;
      }

      if (this.mode === 1 || this.mode === 2 || this.mode === 3) {
        this.updateArmPdTorques();
        this.updateHeadPdTorques();
        this.updateHandCommands();
      }
    }

    this.applyCommands();
    this.worldCount += 1;
    this.lastUpdateTime = currentTime;
  }

  stateUpdate() {
    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      const qposId = this.armQposIds[index];
      const dofId = this.armDofIds[index];
      const velocity = this.data.qvel[dofId];

      this.armPos[index] = this.data.qpos[qposId];
      this.armVel[index] = velocity;
      this.armTau[index] = this.data.qfrc_actuator[dofId] + this.data.qfrc_applied[dofId];
      this.armVelOld[index] = velocity;
    }

    for (let index = 0; index < HEAD_JOINT_NAMES.length; index += 1) {
      const qposId = this.headQposIds[index];
      const dofId = this.headDofIds[index];
      if (qposId < 0 || dofId < 0) {
        continue;
      }

      this.headPos[index] = this.data.qpos[qposId];
      this.headVel[index] = this.data.qvel[dofId];
    }

    for (let index = 0; index < HAND_JOINT_NAMES.length; index += 1) {
      const qposId = this.handQposIds[index];
      const dofId = this.handDofIds[index];
      if (qposId < 0 || dofId < 0) {
        continue;
      }

      this.handPos[index] = this.data.qpos[qposId];
      this.handVel[index] = this.data.qvel[dofId];
    }
  }

  setHomePose() {
    const stage1 = cosineBlend(this.count, 1000.0);
    const stage2 = cosineBlend(this.count - 1000.0, 1000.0);
    const stage3 = cosineBlend(this.count - 2000.0, 2000.0);
    const stage4 = cosineBlend(this.count - 4000.0, 2000.0);

    if (this.count < 1000) {
      this.armDesPos.set(this.armPosInit);
      this.headDesPos.set(this.headPosInit);

      this.armDesPos[ARM_INDEX.LSR] =
        this.armPosInit[ARM_INDEX.LSR] + ((Math.PI / 6.0) - this.armPosInit[ARM_INDEX.LSR]) * stage1;
      this.armDesPos[ARM_INDEX.RSR] =
        this.armPosInit[ARM_INDEX.RSR] + ((-Math.PI / 6.0) - this.armPosInit[ARM_INDEX.RSR]) * stage1;
      this.armDesPos[ARM_INDEX.WAIST] =
        this.armPosInit[ARM_INDEX.WAIST] + (0.0 - this.armPosInit[ARM_INDEX.WAIST]) * stage1;
      this.headDesPos[HEAD_INDEX.HY] =
        this.headPosInit[HEAD_INDEX.HY] + (0.0 - this.headPosInit[HEAD_INDEX.HY]) * stage1;
      this.headDesPos[HEAD_INDEX.HP] =
        this.headPosInit[HEAD_INDEX.HP] + (0.0 - this.headPosInit[HEAD_INDEX.HP]) * stage1;
    }

    if (this.count >= 1000 && this.count < 2000) {
      this.armDesPos[ARM_INDEX.LSP] =
        this.armPosInit[ARM_INDEX.LSP] + (0.0 - this.armPosInit[ARM_INDEX.LSP]) * stage2;
      this.armDesPos[ARM_INDEX.LSY] =
        this.armPosInit[ARM_INDEX.LSY] + (0.0 - this.armPosInit[ARM_INDEX.LSY]) * stage2;
      this.armDesPos[ARM_INDEX.LEP] =
        this.armPosInit[ARM_INDEX.LEP] + (0.0 - this.armPosInit[ARM_INDEX.LEP]) * stage2;
      this.armDesPos[ARM_INDEX.RSP] =
        this.armPosInit[ARM_INDEX.RSP] + (0.0 - this.armPosInit[ARM_INDEX.RSP]) * stage2;
      this.armDesPos[ARM_INDEX.RSY] =
        this.armPosInit[ARM_INDEX.RSY] + (0.0 - this.armPosInit[ARM_INDEX.RSY]) * stage2;
      this.armDesPos[ARM_INDEX.REP] =
        this.armPosInit[ARM_INDEX.REP] + (0.0 - this.armPosInit[ARM_INDEX.REP]) * stage2;
      this.armDesPos[ARM_INDEX.LEY] =
        this.armPosInit[ARM_INDEX.LEY] + (0.0 - this.armPosInit[ARM_INDEX.LEY]) * stage2;
      this.armDesPos[ARM_INDEX.LWR] =
        this.armPosInit[ARM_INDEX.LWR] + (0.0 - this.armPosInit[ARM_INDEX.LWR]) * stage2;
      this.armDesPos[ARM_INDEX.LWP] =
        this.armPosInit[ARM_INDEX.LWP] + (0.0 - this.armPosInit[ARM_INDEX.LWP]) * stage2;
      this.armDesPos[ARM_INDEX.REY] =
        this.armPosInit[ARM_INDEX.REY] + (0.0 - this.armPosInit[ARM_INDEX.REY]) * stage2;
      this.armDesPos[ARM_INDEX.RWR] =
        this.armPosInit[ARM_INDEX.RWR] + (0.0 - this.armPosInit[ARM_INDEX.RWR]) * stage2;
      this.armDesPos[ARM_INDEX.RWP] =
        this.armPosInit[ARM_INDEX.RWP] + (0.0 - this.armPosInit[ARM_INDEX.RWP]) * stage2;
    }

    if (this.count >= 2000 && this.count < 4000) {
      this.armDesPos[ARM_INDEX.LSP] = ((Math.PI * 3.0) / 8.0) * stage3;
      this.armDesPos[ARM_INDEX.RSP] = ((Math.PI * 3.0) / 8.0) * stage3;
      this.armDesPos[ARM_INDEX.LSR] = (Math.PI / 6.0) + (0.0 - (Math.PI / 6.0)) * stage3;
      this.armDesPos[ARM_INDEX.LEP] = ((-Math.PI * 3.0) / 4.0) * stage3;
      this.armDesPos[ARM_INDEX.RSR] = (-Math.PI / 6.0) + (0.0 - (-Math.PI / 6.0)) * stage3;
      this.armDesPos[ARM_INDEX.REP] = ((-Math.PI * 3.0) / 4.0) * stage3;
    }

    if (this.count >= 4000 && this.count < 6000) {
      this.armDesPos[ARM_INDEX.LSP] = ((Math.PI * 3.0) / 8.0) + (0.0 - ((Math.PI * 3.0) / 8.0)) * stage4;
      this.armDesPos[ARM_INDEX.RSP] = ((Math.PI * 3.0) / 8.0) + (0.0 - ((Math.PI * 3.0) / 8.0)) * stage4;
      this.armDesPos[ARM_INDEX.LEP] = ((-Math.PI * 3.0) / 4.0) + ((-Math.PI / 2.0) - ((-Math.PI * 3.0) / 4.0)) * stage4;
      this.armDesPos[ARM_INDEX.REP] = ((-Math.PI * 3.0) / 4.0) + ((-Math.PI / 2.0) - ((-Math.PI * 3.0) / 4.0)) * stage4;
    }

    if (this.count >= 6000) {
      this.armDesPos[ARM_INDEX.WAIST] = 0.0;
      this.armDesPos[ARM_INDEX.LSP] = 0.0;
      this.armDesPos[ARM_INDEX.LSR] = 0.0;
      this.armDesPos[ARM_INDEX.LSY] = 0.0;
      this.armDesPos[ARM_INDEX.LEP] = -Math.PI / 2.0;
      this.armDesPos[ARM_INDEX.LEY] = 0.0;
      this.armDesPos[ARM_INDEX.LWR] = 0.0;
      this.armDesPos[ARM_INDEX.LWP] = 0.0;
      this.armDesPos[ARM_INDEX.RSP] = 0.0;
      this.armDesPos[ARM_INDEX.RSR] = 0.0;
      this.armDesPos[ARM_INDEX.RSY] = 0.0;
      this.armDesPos[ARM_INDEX.REP] = -Math.PI / 2.0;
      this.armDesPos[ARM_INDEX.REY] = 0.0;
      this.armDesPos[ARM_INDEX.RWR] = 0.0;
      this.armDesPos[ARM_INDEX.RWP] = 0.0;
      this.headDesPos[HEAD_INDEX.HY] = 0.0;
      this.headDesPos[HEAD_INDEX.HP] = 0.0;
    }

    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      this.armDesPos[index] = clamp(this.armDesPos[index], this.armLowerLimits[index], this.armUpperLimits[index]);
    }
  }

  setDefaultEeTargets() {
    this.leftPosTarget.set(DEFAULT_LEFT_POS);
    this.rightPosTarget.set(DEFAULT_RIGHT_POS);
    this.leftQuatTargetWxyz.set(DEFAULT_LEFT_QUAT_WXYZ);
    this.rightQuatTargetWxyz.set(DEFAULT_RIGHT_QUAT_WXYZ);
  }

  captureCurrentEeTargets() {
    this.captureEeTarget(this.leftWristBodyId, this.leftPosTarget, this.leftQuatTargetWxyz);
    this.captureEeTarget(this.rightWristBodyId, this.rightPosTarget, this.rightQuatTargetWxyz);
  }

  captureCurrentRightEeTarget() {
    this.stateUpdate();
    this.captureEeTarget(this.rightWristBodyId, this.rightPosTarget, this.rightQuatTargetWxyz);
  }

  captureEeTarget(bodyId, posTarget, quatTarget) {
    if (bodyId < 0) {
      return;
    }

    const posBase = 3 * bodyId;
    const quatBase = 4 * bodyId;
    const quat = [
      this.data.xquat[quatBase + 0],
      this.data.xquat[quatBase + 1],
      this.data.xquat[quatBase + 2],
      this.data.xquat[quatBase + 3],
    ];
    const tipOffset = rotateVectorByQuatWxyz(quat, EE_LOCAL_OFFSET);

    posTarget[0] = this.data.xpos[posBase + 0] + tipOffset[0];
    posTarget[1] = this.data.xpos[posBase + 1] + tipOffset[1];
    posTarget[2] = this.data.xpos[posBase + 2] + tipOffset[2];
    quatTarget[0] = quat[0];
    quatTarget[1] = quat[1];
    quatTarget[2] = quat[2];
    quatTarget[3] = quat[3];
  }

  solveIkTargets() {
    this.qRefBuffer.view.set(this.armRefPos);
    this.leftPosBuffer.view.set(this.leftPosTarget);
    this.rightPosBuffer.view.set(this.rightPosTarget);
    writeIkTargetQuatWithNegatedW(this.leftQuatBuffer.view, this.leftQuatTargetWxyz);
    writeIkTargetQuatWithNegatedW(this.rightQuatBuffer.view, this.rightQuatTargetWxyz);

    const solved = this.rbdl._daru_ik_step(
      this.qRefBuffer.pointer,
      this.leftPosBuffer.pointer,
      this.rightPosBuffer.pointer,
      this.leftQuatBuffer.pointer,
      this.rightQuatBuffer.pointer,
      this.qOutBuffer.pointer,
    );

    if (!solved) {
      throw new Error('RBDL IK step failed');
    }

    this.armRefPos.set(this.qOutBuffer.view);
    this.clampArmReferenceToModelLimits();
    this.armDesPos.set(this.armRefPos);
  }

  clampArmReferenceToModelLimits() {
    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      this.armRefPos[index] = clamp(this.armRefPos[index], this.armLowerLimits[index], this.armUpperLimits[index]);
    }
  }

  applyCgCompensation() {
    this.qRefBuffer.view.set(this.armPos);
    this.qdotBuffer.view.set(this.armVel);

    const solved = this.rbdl._daru_cg_from_state(
      this.qRefBuffer.pointer,
      this.qdotBuffer.pointer,
      this.cgBuffer.pointer,
    );
    if (!solved) {
      throw new Error('RBDL CG compensation failed');
    }

    for (let index = 1; index < ARM_JOINT_NAMES.length; index += 1) {
      this.armRefTau[index] += CG_COMPENSATION_SCALE * this.cgBuffer.view[index];
    }
  }

  updateArmPdTorques() {
    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      let command = 15.0 * (this.armDesPos[index] - this.armPos[index]) + 1.0 * (0.0 - this.armVel[index]);
      if (index === 0) {
        command = 200.0 * (this.armDesPos[index] - this.armPos[index]) + 20.0 * (0.0 - this.armVel[index]);
      } else if (index === 5 || index === 6 || index === 7 || index === 12 || index === 13 || index === 14) {
        command = 10.0 * (this.armDesPos[index] - this.armPos[index]) + 0.005 * (0.0 - this.armVel[index]);
      }

      this.armRefTau[index] += clamp(command, -ARM_PD_LIMITS[index], ARM_PD_LIMITS[index]);
    }
  }

  updateHeadPdTorques() {
    const kp = [25.0, 25.0];
    const kd = [1.5, 1.5];
    const fallbackLimit = [7.0, 7.0];
    for (let index = 0; index < HEAD_JOINT_NAMES.length; index += 1) {
      if (this.headDofIds[index] < 0) {
        this.headCmdTau[index] = 0.0;
        continue;
      }

      const command = kp[index] * (this.headDesPos[index] - this.headPos[index]) - kd[index] * this.headVel[index];
      this.headCmdTau[index] =
        clampActuatorCommand(this.model, this.headActuatorIds[index], fallbackLimit[index], command);
    }
  }

  updateHandCommands() {
    const handControlPeriod = 0.020;
    if (this.handControlAccumulator + 1e-9 < handControlPeriod) {
      return;
    }
    while (this.handControlAccumulator >= handControlPeriod) {
      this.handControlAccumulator -= handControlPeriod;
    }

    const kp = 2000.0;
    const kd = 9.0;
    const fallbackLimit = 56.0;
    for (let index = 0; index < HAND_JOINT_NAMES.length; index += 1) {
      if (this.handJointIds[index] < 0) {
        this.handCmd[index] = 0.0;
        continue;
      }

      const forceCommand = kp * (this.handDesPos[index] - this.handPos[index]) - kd * this.handVel[index];
      this.handCmd[index] =
        clampActuatorCommand(this.model, this.handActuatorIds[index], fallbackLimit, forceCommand);
    }
  }

  applyCommands() {
    this.data.ctrl.fill(0.0);
    this.data.qfrc_applied.fill(0.0);

    for (let index = 0; index < ARM_JOINT_NAMES.length; index += 1) {
      const actuatorId = this.armActuatorIds[index];
      const dofId = this.armDofIds[index];
      if (actuatorId >= 0) {
        this.data.ctrl[actuatorId] = this.armRefTau[index];
      } else {
        this.data.qfrc_applied[dofId] = this.armRefTau[index];
      }
    }

    for (let index = 0; index < HEAD_JOINT_NAMES.length; index += 1) {
      const dofId = this.headDofIds[index];
      if (dofId < 0) {
        continue;
      }

      const actuatorId = this.headActuatorIds[index];
      if (actuatorId >= 0) {
        this.data.ctrl[actuatorId] = this.headCmdTau[index];
      } else {
        this.data.qfrc_applied[dofId] += this.headCmdTau[index];
      }
    }

    for (let index = 0; index < HAND_JOINT_NAMES.length; index += 1) {
      const dofId = this.handDofIds[index];
      if (dofId < 0) {
        continue;
      }

      const actuatorId = this.handActuatorIds[index];
      if (actuatorId >= 0) {
        this.data.ctrl[actuatorId] = this.handCmd[index];
      } else {
        this.data.qfrc_applied[dofId] += this.handCmd[index];
      }
    }
  }
}
