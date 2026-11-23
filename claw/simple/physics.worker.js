import {HeadTilt} from './head-tilt.js';
import loadMujoco from '../vendor/mujoco/mujoco.js';
import {loadPyodide} from '../vendor/pyodide/pyodide.mjs';
import {BridgeCycle as Cycle} from './rod-recovery.js?v=20261123-rod-release';

let mj, py, sim, cycle, paused = false, hidden = false, started = false;
let timer, lastWall = 0, accumulator = 0, lastFrame = 0, winAt = null;
let revision = 0, busy = false, inputDeadline = 0;
const speedLimits = [.14, .14, .10, .75, .45, .45];
const send = (type, payload = {}) => postMessage({type, ...payload});
const phase = state => send('phase', {state});
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
async function fetchFile(path, binary = false) {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}
function id(model, kind, name) { return mj.mj_name2id(model, mj.mjtObj[kind].value, name); }
function name(model, kind, index) { return mj.mj_id2name(model, mj.mjtObj[kind].value, index) || ''; }

class Simulation {
  constructor(model, config) {
    this.model = model; this.data = new mj.MjData(model); this.config = config;
    const option = model.opt; this.dt = option.timestep; option.delete();
    this.gantry = id(model, 'mjOBJ_BODY', 'gantry');
    this.prize = id(model, 'mjOBJ_BODY', 'prize');
    this.tilt = new HeadTilt(model, id);
    this.target = new Float64Array(6); this.force = new mj.DoubleBuffer(6);
    this.clawBodies = new Set();
    for (let b = 1; b < model.nbody; b++) {
      let a = b;
      while (a) {
        if (a === this.gantry) { this.clawBodies.add(b); break; }
        a = model.body_parentid[a];
      }
    }
    this.rodIds = new Set([1, 2, 3, 4].map(i => id(model, 'mjOBJ_FLEX', 'rod_' + i)));
    this.clawGeoms = new Set();
    for (let g = 0; g < model.ngeom; g++) if (this.clawBodies.has(model.geom_bodyid[g])) this.clawGeoms.add(g);
  }
  dispose() { this.force.delete(); this.data.delete(); this.model.delete(); }
  qadr(joint) { return this.model.jnt_qposadr[id(this.model, 'mjOBJ_JOINT', joint)]; }
  pose() { return this.data.xpos.subarray(this.gantry * 3, this.gantry * 3 + 3); }
  reset(s) {
    mj.mj_resetData(this.model, this.data);
    const q = this.data.qpos;
    q[this.qadr('gantry_x')] = s.start_x; q[this.qadr('gantry_y')] = s.start_y;
    q[this.qadr('gantry_z')] = s.home_height - .8;
    q[this.qadr('left_hinge')] = q[this.qadr('right_hinge')] = s.closed_angle;
    this.target.set([s.start_x, s.start_y, s.home_height - .8, 0, s.closed_angle, s.closed_angle]);
    this.data.ctrl.set(this.target); mj.mj_forward(this.model, this.data);
  }
  setTarget({x, y, z, yaw, opening}) {
    const values = [x, y, z === undefined ? undefined : z - .8, yaw, opening, opening];
    for (let i = 0; i < 6; i++) if (values[i] !== undefined)
      this.target[i] = clip(values[i], this.model.actuator_ctrlrange[i * 2], this.model.actuator_ctrlrange[i * 2 + 1]);
  }
  step() {
    const dt = this.dt, ctrl = this.data.ctrl;
    for (let i = 0; i < 6; i++) ctrl[i] += clip(this.target[i] - ctrl[i], -speedLimits[i] * dt, speedLimits[i] * dt);
    mj.mj_step(this.model, this.data);
  }
  clawExternalZ() {
    this.touchingRod = false;
    let forceZ = 0;
    if (!this.data.ncon) return 0;
    const contacts = this.data.contact;
    try {
      for (let i = 0; i < this.data.ncon; i++) {
        const contact = contacts.get(i);
        if (!contact) continue;
        try {
          const geoms = contact.geom;
          const a = this.clawGeoms.has(geoms[0]), b = this.clawGeoms.has(geoms[1]);
          if (a === b) continue;
          mj.mj_contactForce(this.model, this.data, i, this.force);
          const f = this.force.GetView(), frame = contact.frame;
          if (f[0] > 0 && this.rodIds.has(contact.flex[a ? 1 : 0])) this.touchingRod = true;
          forceZ += (frame[2] * f[0] + frame[5] * f[1] + frame[8] * f[2]) * (b ? 1 : -1);
        } finally { contact.delete(); }
      }
    } finally { contacts.delete(); }
    return forceZ;
  }
  won() {
    const p = this.prize * 3, r = this.prize * 9, c = this.config;
    const top = this.data.xpos[p + 2] + (Math.abs(this.data.xmat[r + 6]) * c.box_width +
      Math.abs(this.data.xmat[r + 7]) * c.box_length + Math.abs(this.data.xmat[r + 8]) * c.box_height) / 2;
    return top < -.02 && Math.abs(this.data.xpos[p]) < 0.335 && this.data.xpos[p + 1] > -0.375 && this.data.xpos[p + 1] < 0.119;
  }
  tune(values) {
    const m = this.model;
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) continue;
      if (key === 'grip_kp') {
        const v = clip(value, 0, 100);
        for (const motor of ['left_motor', 'right_motor']) {
          const a = id(m, 'mjOBJ_ACTUATOR', motor);
          m.actuator_gainprm[a * 10] = v; m.actuator_biasprm[a * 10 + 1] = -v;
        }
        this.config[key] = v;
      } else if (key === 'grip_torque' || key === 'z_force_limit') {
        const v = key === 'grip_torque' ? clip(value, .005, .8) : clip(value, 20, 150);
        for (const motor of key === 'grip_torque' ? ['left_motor', 'right_motor'] : ['z_motor']) {
          const a = id(m, 'mjOBJ_ACTUATOR', motor); m.actuator_forcerange[a * 2] = -v; m.actuator_forcerange[a * 2 + 1] = v;
        }
        this.config[key] = v;
      } else if (['tip_friction', 'arm_friction', 'rail_friction', 'inner_rail_friction'].includes(key)) {
        const v = clip(value, 0, key === 'inner_rail_friction' ? 5 : 2);
        if (key === 'rail_friction' || key === 'inner_rail_friction') {
          for (const rod of (key === 'rail_friction' ? [1, 4] : [2, 3])) {
            const flex = id(m, 'mjOBJ_FLEX', 'rod_' + rod);
            m.flex_friction[3 * flex] = v;
          }
          this.config[key] = v;
          continue;
        }
        const geoms = new Set();
        for (let g = 0; g < m.ngeom; g++) {
          const n = name(m, 'mjOBJ_GEOM', g);
          if ((key === 'tip_friction' && /^(left|right)_tip/.test(n)) ||
              (key === 'arm_friction' && /^(left|right)_(upper_front|upper_back|elbow|lower)$/.test(n))) geoms.add(g);
        }
        for (const g of geoms) m.geom_friction[g * 3] = v;
        for (let p = 0; p < m.npair; p++) if (geoms.has(m.pair_geom1[p]) || geoms.has(m.pair_geom2[p])) {
          m.pair_friction[p * 5] = m.pair_friction[p * 5 + 1] = v;
        }
        this.config[key] = v;
      } else if (['head_stiffness', 'head_damping', 'head_limit_deg'].includes(key)) {
        this.config[key] = this.tilt.tune(key, value);
      }
    }
  }
  scene(xml) {
    const m = this.model, meshes = {};
    for (let i = 0; i < m.nmesh; i++) {
      const va = m.mesh_vertadr[i], vn = m.mesh_vertnum[i], fa = m.mesh_faceadr[i], fn = m.mesh_facenum[i];
      const ta = m.mesh_texcoordadr[i], tn = m.mesh_texcoordnum[i];
      meshes[i] = {
        vertex: Array.from(m.mesh_vert.subarray(va * 3, (va + vn) * 3)),
        face: Array.from(m.mesh_face.subarray(fa * 3, (fa + fn) * 3)),
        uv: ta < 0 ? [] : Array.from(m.mesh_texcoord.subarray(ta * 2, (ta + tn) * 2)),
        faceUV: Array.from(m.mesh_facetexcoord.subarray(fa * 3, (fa + fn) * 3)),
      };
    }
    const geoms = [];
    for (let i = 0; i < m.ngeom; i++) geoms.push({
      name: name(m, 'mjOBJ_GEOM', i), type: m.geom_type[i], body: m.geom_bodyid[i],
      size: Array.from(m.geom_size.subarray(i * 3, i * 3 + 3)),
      pos: Array.from(m.geom_pos.subarray(i * 3, i * 3 + 3)),
      quat: Array.from(m.geom_quat.subarray(i * 4, i * 4 + 4)), mesh: m.geom_dataid[i],
      material: m.geom_matid[i] < 0 ? '' : name(m, 'mjOBJ_MATERIAL', m.geom_matid[i]),
      rgba: Array.from(m.geom_rgba.subarray(i * 4, i * 4 + 4)),
    });
    const rods = [1, 2, 3, 4].map(rod => {
      const f = id(m, 'mjOBJ_FLEX', 'rod_' + rod), mat = m.flex_matid[f];
      return {first: m.flex_vertadr[f], count: m.flex_vertnum[f], radius: m.flex_radius[f],
        color: Array.from(m.mat_rgba.subarray(mat * 4, mat * 4 + 3)), metal: rod === 1 || rod === 4};
    });
    return {xml, geoms, meshes, rods, nbody: m.nbody, dynamicBodies: [...this.clawBodies, this.prize]};
  }
}

async function initRuntimes() {
  send('loading', {message: '물리 엔진과 모델을 준비하고 있어요'});
  const files = ['model_author.py', 'appearance.py', 'cycle_settings.py', 'cabinet.py'];
  const [engine, python, sources, assets] = await Promise.all([
    loadMujoco({locateFile: file => new URL(`../vendor/mujoco/${file}`, import.meta.url).href}),
    loadPyodide({indexURL: new URL('../vendor/pyodide/', import.meta.url).href}),
    Promise.all(files.map(file => fetchFile(`./model/${file}${new URL(import.meta.url).search}`))),
    fetchFile('./assets/manifest.json').then(JSON.parse),
  ]);
  mj = engine; py = python;
  py.FS.mkdirTree('/model'); mj.FS.mkdirTree('/model/assets');
  files.forEach((file, i) => py.FS.writeFile(`/model/${file}`, sources[i]));
  await Promise.all(assets.map(async file => mj.FS.writeFile(`/model/assets/${file}`, await fetchFile(`./assets/${file}`, true))));
  py.runPython(`
import sys, json
sys.path.insert(0, '/model')
from model_author import Config, model_xml
from cycle_settings import CycleSettings
def author(payload):
    values = json.loads(payload)
    config = Config(**values['config'])
    settings = CycleSettings(**values['cycle'])
    settings.validate()
    return model_xml(config)
`);
}
async function rebuild(config, settings, requestId) {
  busy = true; clearTimeout(timer); cycle?.release();
  send('loading', {message: '설정을 적용하고 새 판을 준비해요'});
  let fresh;
  try {
    const author = py.globals.get('author');
    let xml;
    try { xml = author(JSON.stringify({config, cycle: settings})); } finally { author.destroy(); }
    const model = mj.MjModel.from_xml_string(xml);
    try { fresh = new Simulation(model, config); } catch (e) { model.delete(); throw e; }
    fresh.reset(settings);
    const scene = fresh.scene(xml);
    sim?.dispose(); sim = fresh; fresh = null; revision++;
    cycle = new Cycle(sim, settings, phase); winAt = null;
    send('scene', {scene, revision});
    send('configured', {config, settings, requestId});
    send('reset');
    phase(cycle.state); sendFrame();
  } catch (error) {
    fresh?.dispose(); send('error', {message: String(error?.message || error), requestId, recoverable: !!sim});
  } finally { busy = false; lastWall = performance.now(); accumulator = 0; timer = setTimeout(tick, 4); }
}
function reset() {
  if (!sim) return;
  sim.reset(cycle.settings); cycle = new Cycle(sim, cycle.settings, phase);
  winAt = null; accumulator = 0; lastWall = performance.now(); phase('READY_X'); send('reset'); sendFrame();
}
function sendFrame() {
  if (!sim) return;
  const d = sim.data, count = sim.model.nbody;
  const transforms = new Float32Array(count * 7), x = d.xpos, q = d.xquat;
  for (let b = 0; b < count; b++) {
    transforms.set(x.subarray(b * 3, b * 3 + 3), b * 7);
    transforms.set(q.subarray(b * 4, b * 4 + 4), b * 7 + 3);
  }
  const headVertical = d.xmat[9 * sim.tilt.body + 8];
  const rodPoints = new Float32Array(d.flexvert_xpos);
  const payload = {type: 'frame', revision, transforms, rodPoints, state: cycle.state, elapsed: d.time,
    heldX: cycle.heldX, heldY: cycle.heldY, zLoad: cycle.zLoad, position: Array.from(sim.pose()),
    headAngle: Math.acos(clip(headVertical, -1, 1)) * 180 / Math.PI,
    reason: cycle.reason, paused: paused || hidden, winning: winAt !== null};
  postMessage(payload, [transforms.buffer, rodPoints.buffer]);
}
function tick() {
  if (!sim || busy) return;
  const now = performance.now(), wallDt = Math.max(0, (now - lastWall) / 1000); lastWall = now;
  if (started && !paused && !hidden) {
    accumulator = Math.min(.1, accumulator + wallDt);
    const dt = sim.dt, end = performance.now() + 8;
    // Cap wall-time work, never change the solver step or parcel state.
    while (accumulator >= dt && performance.now() < end) {
      if ((cycle.state === 'MOVING_X' || cycle.state === 'MOVING_Y') && now > inputDeadline) cycle.release();
      cycle.update(dt); sim.step(); accumulator -= dt;
      if (winAt === null && sim.won()) { winAt = sim.data.time; send('win'); }
      if (winAt !== null && sim.data.time - winAt >= 2.5) { reset(); break; }
    }
  } else accumulator = 0;
  if (now - lastFrame >= 1000 / 30) { sendFrame(); lastFrame = now; }
  timer = setTimeout(tick, 4);
}
let queue = Promise.resolve();
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'boot' || message.type === 'configure') {
    queue = queue.then(async () => {
      if (!mj) await initRuntimes();
      await rebuild(message.config, message.settings, message.requestId);
    }).catch(error => send('error', {message: String(error?.message || error), recoverable: !!sim}));
    return;
  }
  if (!sim || busy) return;
  switch (message.type) {
    case 'start': started = true; paused = false; lastWall = performance.now(); sendFrame(); break;
    case 'press': if (started && !paused && !hidden && winAt === null) { inputDeadline = performance.now() + 1000; cycle.press(message.axis); } break;
    case 'hold': inputDeadline = performance.now() + 1000; break;
    case 'release': cycle.release(message.axis); break;
    case 'pause': cycle.release(); paused = !!message.value; accumulator = 0; sendFrame(); break;
    case 'visibility': cycle.release(); hidden = !!message.hidden; accumulator = 0; lastWall = performance.now(); sendFrame(); break;
    case 'retry-rod':
      if (started && !paused && !hidden && winAt === null) cycle.retryRelease();
      break;
    case 'reset': reset(); break;
    case 'tune': sim.tune(message.values); break;
  }
};
