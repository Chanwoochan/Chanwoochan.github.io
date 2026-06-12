
import * as THREE           from 'three';
import { GUI              } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls    } from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { DragStateManager } from './utils/DragStateManager.js';
import { DaruV4TorqueController, DARU_TORQUE_SCENE } from './controllers/DaruV4TorqueController.js';
import { setupGUI, downloadExampleScenesFolder, loadSceneFromURL, drawTendonsAndFlex, getPosition, getQuaternion, toMujocoPos, standardNormal } from './mujocoUtils.js';
import   load_mujoco        from '../node_modules/mujoco-js/dist/mujoco_wasm.js';

// Load the MuJoCo Module
const mujoco = await load_mujoco();
const MJDSBL_CONTACT = 1 << 4;
const MJDSBL_ACTUATION = 1 << 11;
const RIGHT_TARGET_POSITION_SPEED = 0.20;
const RIGHT_TARGET_ROTATION_SPEED = Math.PI * 0.75;
const DEFAULT_CAMERA_POSITION = [0.18, 1.78, -2.45];
const DEFAULT_CAMERA_TARGET = [0.10, 0.78, 0.0];
const ACTIVE_TARGET_HAND_TOGGLE_KEY = 'KeyT';
const ACTIVE_TARGET_HAND_GRIP_TOGGLE_COUNT = 5;
const RIGHT_TARGET_INPUT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF']);
const DARU_NON_HAND_COLLISION_BODY_NAMES = new Set([
  'Base', 'UB_Link',
  'RSP_Link', 'RSR_Link', 'RSY_Link', 'REP_Link', 'REY_Link', 'RWR_Link', 'RWP_Link',
  'LSP_Link', 'LSR_Link', 'LSY_Link', 'LEP_Link', 'LEY_Link', 'LWR_Link', 'LWP_Link',
  'HY_Link', 'HP_Link',
]);
const RIGHT_TARGET_POSITION_PAD_BUTTONS = [
  { code: 'KeyW', label: 'X+' },
  { code: 'KeyS', label: 'X-' },
  { code: 'KeyA', label: 'Y+' },
  { code: 'KeyD', label: 'Y-' },
  { code: 'KeyR', label: 'Z+' },
  { code: 'KeyF', label: 'Z-' },
];
const RIGHT_TARGET_ROTATION_PAD_BUTTONS = [
  { code: 'KeyW', label: 'Ry+' },
  { code: 'KeyS', label: 'Ry-' },
  { code: 'KeyA', label: 'Rz+' },
  { code: 'KeyD', label: 'Rz-' },
  { code: 'KeyR', label: 'Rx+' },
  { code: 'KeyF', label: 'Rx-' },
];

// Set up Emscripten's Virtual File System
var initialScene = DARU_TORQUE_SCENE;
mujoco.FS.mkdir('/working');
mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
// mujoco.FS.writeFile("/working/" + initialScene, await(await fetch("./assets/scenes/" + initialScene)).text());

export class MuJoCoDemo {
  constructor() {
    this.mujoco = mujoco;

    // Load in the state from XML
    // this.model = mujoco.MjModel.loadFromXML("/working/" + initialScene);
    // this.data  = new mujoco.MjData(this.model);
    this.model = null;
    this.data  = null;
    this.controller = null;
    this.controllerLoading = false;
    this.controllerInitGeneration = 0;
    this.controllerInitStartedAt = 0.0;
    this.debugState = { status: 'boot', rbdl: '' };
    this.activeTargetKeys = new Set();
    this.activePadPositionKeys = new Set();
    this.activePadRotationKeys = new Set();
    this.activeTargetHand = 'right';
    this.handGripClosedState = { right: false, left: false };
    this.rightTargetRotationMode = false;
    this.lastRenderTimeMs = null;


    // Define Random State Variables
    this.params = {
      scene: initialScene,
      paused: false,
      help: false,
      collisionsDisabled: false,
      controlsDisabled: false,
      ctrlnoiserate: 0.0,
      ctrlnoisestd: 0.0,
      keyframeNumber: 0,
    };
    this.mujoco_time = 0.0;
    this.bodies  = {}, this.lights = {};
    this.tmpVec  = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.updateGUICallbacks = [];
    this.textDecoder = new TextDecoder('utf-8');

    this.container = document.createElement( 'div' );
    document.body.appendChild( this.container );
    this.container.style.position = 'relative';

    this.debugOverlay = document.createElement('div');
    this.debugOverlay.style.position = 'absolute';
    this.debugOverlay.style.left = '10px';
    this.debugOverlay.style.bottom = '10px';
    this.debugOverlay.style.padding = '8px 10px';
    this.debugOverlay.style.background = 'rgba(0, 0, 0, 0.55)';
    this.debugOverlay.style.color = '#fff';
    this.debugOverlay.style.font = '12px monospace';
    this.debugOverlay.style.whiteSpace = 'pre';
    this.debugOverlay.style.zIndex = '1000';
    this.debugOverlay.style.pointerEvents = 'none';

    this.rightTargetPad = this.createRightTargetPad();

    this.scene = new THREE.Scene();
    this.scene.name = 'scene';

    this.camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.001, 100 );
    this.camera.name = 'PerspectiveCamera';
    this.camera.position.set(...DEFAULT_CAMERA_POSITION);
    this.scene.add(this.camera);

    this.scene.background = new THREE.Color(0.15, 0.25, 0.35);
    this.scene.fog = new THREE.Fog(this.scene.background, 15, 25.5 );

    this.ambientLight = new THREE.AmbientLight( 0xffffff, 0.1 * 3.14 );
    this.ambientLight.name = 'AmbientLight';
    this.scene.add( this.ambientLight );

    this.spotlight = new THREE.SpotLight();
    this.spotlight.angle = 1.11;
    this.spotlight.distance = 10000;
    this.spotlight.penumbra = 0.5;
    this.spotlight.castShadow = true; // default false
    this.spotlight.intensity = this.spotlight.intensity * 3.14 * 10.0;
    this.spotlight.shadow.mapSize.width = 1024; // default
    this.spotlight.shadow.mapSize.height = 1024; // default
    this.spotlight.shadow.camera.near = 0.1; // default
    this.spotlight.shadow.camera.far = 100; // default
    this.spotlight.position.set(0, 3, 3);
    const targetObject = new THREE.Object3D();
    this.scene.add(targetObject);
    this.spotlight.target = targetObject;
    targetObject.position.set(0, 1, 0);
    this.scene.add( this.spotlight );

    this.renderer = new THREE.WebGLRenderer( { antialias: true } );
    this.renderer.setPixelRatio(1.0);////window.devicePixelRatio );
    this.renderer.setSize( window.innerWidth, window.innerHeight );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
    THREE.ColorManagement.enabled = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    //this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    //this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    //this.renderer.toneMappingExposure = 2.0;
    this.renderer.useLegacyLights = true;

    this.renderer.setAnimationLoop( this.render.bind(this) );

    this.container.appendChild( this.renderer.domElement );
    this.container.appendChild( this.debugOverlay );
    this.container.appendChild( this.rightTargetPad );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...DEFAULT_CAMERA_TARGET);
    this.controls.panSpeed = 2;
    this.controls.zoomSpeed = 1;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.10;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    this.handleTargetKeyDown = this.onTargetKeyDown.bind(this);
    this.handleTargetKeyUp = this.onTargetKeyUp.bind(this);
    this.handleTargetKeyClear = this.clearTargetKeys.bind(this);

    window.addEventListener('resize', this.onWindowResize.bind(this));
    window.addEventListener('keydown', this.handleTargetKeyDown);
    window.addEventListener('keyup', this.handleTargetKeyUp);
    window.addEventListener('blur', this.handleTargetKeyClear);

    // Initialize the Drag State Manager.
    this.dragStateManager = new DragStateManager(this.scene, this.renderer, this.camera, this.container.parentElement, this.controls);
  }

  createRightTargetPad() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'absolute',
      right: '16px',
      bottom: '16px',
      width: '250px',
      padding: '12px',
      borderRadius: '12px',
      background: 'rgba(9, 16, 24, 0.84)',
      border: '1px solid rgba(120, 154, 189, 0.35)',
      boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)',
      backdropFilter: 'blur(8px)',
      color: '#e8f0f7',
      font: '12px/1.35 monospace',
      zIndex: '1001',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      marginBottom: '4px',
    });

    const title = document.createElement('div');
    title.textContent = 'Hand Target Pad';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.04em',
    });
    header.appendChild(title);

    this.targetHandToggleButton = document.createElement('button');
    this.targetHandToggleButton.type = 'button';
    Object.assign(this.targetHandToggleButton.style, {
      appearance: 'none',
      border: '1px solid rgba(124, 160, 196, 0.35)',
      borderRadius: '999px',
      background: 'rgba(24, 43, 62, 0.95)',
      color: '#f0f6fb',
      padding: '6px 10px',
      font: '600 11px monospace',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    this.targetHandToggleButton.addEventListener('click', (event) => {
      this.toggleActiveTargetHand();
      event.preventDefault();
      event.stopPropagation();
    });
    header.appendChild(this.targetHandToggleButton);
    panel.appendChild(header);

    this.rightTargetPadStatus = document.createElement('div');
    this.rightTargetPadStatus.textContent = 'waiting for torque mode';
    Object.assign(this.rightTargetPadStatus.style, {
      color: '#8ea7bc',
      marginBottom: '10px',
    });
    panel.appendChild(this.rightTargetPadStatus);

    this.handGripToggleButton = document.createElement('button');
    this.handGripToggleButton.type = 'button';
    Object.assign(this.handGripToggleButton.style, {
      appearance: 'none',
      width: '100%',
      border: '1px solid rgba(124, 160, 196, 0.35)',
      borderRadius: '9px',
      background: 'rgba(24, 43, 62, 0.95)',
      color: '#f0f6fb',
      padding: '8px 10px',
      marginBottom: '10px',
      font: '600 11px monospace',
      cursor: 'pointer',
      textAlign: 'left',
    });
    this.handGripToggleButton.addEventListener('click', (event) => {
      this.toggleSelectedHandGrip();
      event.preventDefault();
      event.stopPropagation();
    });
    panel.appendChild(this.handGripToggleButton);

    const sections = document.createElement('div');
    Object.assign(sections.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '10px',
    });

    sections.appendChild(this.createRightTargetPadSection('Position', RIGHT_TARGET_POSITION_PAD_BUTTONS, this.activePadPositionKeys));
    sections.appendChild(this.createRightTargetPadSection('Rotation', RIGHT_TARGET_ROTATION_PAD_BUTTONS, this.activePadRotationKeys));
    panel.appendChild(sections);

    const hint = document.createElement('div');
    hint.textContent = 'Hold a button to move the selected hand target continuously.';
    Object.assign(hint.style, {
      marginTop: '10px',
      color: '#8ea7bc',
      fontSize: '11px',
    });
    panel.appendChild(hint);

    this.updateTargetHandUi();
    this.updateHandGripUi();
    return panel;
  }

  createRightTargetPadSection(titleText, buttonSpecs, targetSet) {
    const section = document.createElement('div');
    Object.assign(section.style, {
      display: 'grid',
      gap: '6px',
      minWidth: '0',
    });

    const title = document.createElement('div');
    title.textContent = titleText;
    Object.assign(title.style, {
      fontWeight: '600',
      color: '#b9cad9',
      marginBottom: '2px',
    });
    section.appendChild(title);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '6px',
    });

    for (const spec of buttonSpecs) {
      grid.appendChild(this.createRightTargetPadButton(spec.label, spec.code, targetSet));
    }

    section.appendChild(grid);
    return section;
  }

  createRightTargetPadButton(label, code, targetSet) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      appearance: 'none',
      border: '1px solid rgba(124, 160, 196, 0.35)',
      borderRadius: '9px',
      background: 'linear-gradient(180deg, rgba(30, 51, 72, 0.95), rgba(18, 33, 48, 0.95))',
      color: '#f0f6fb',
      padding: '10px 0',
      font: '600 12px monospace',
      cursor: 'pointer',
      transition: 'transform 80ms ease, border-color 80ms ease, background 80ms ease',
      touchAction: 'none',
    });

    const activate = (event) => {
      targetSet.add(code);
      button.style.transform = 'translateY(1px)';
      button.style.borderColor = 'rgba(148, 202, 255, 0.9)';
      button.style.background = 'linear-gradient(180deg, rgba(49, 86, 120, 0.98), rgba(31, 55, 79, 0.98))';
      if (event.pointerId !== undefined && button.setPointerCapture) {
        button.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const deactivate = (event) => {
      targetSet.delete(code);
      button.style.transform = 'translateY(0)';
      button.style.borderColor = 'rgba(124, 160, 196, 0.35)';
      button.style.background = 'linear-gradient(180deg, rgba(30, 51, 72, 0.95), rgba(18, 33, 48, 0.95))';
      if (event.pointerId !== undefined && button.releasePointerCapture && button.hasPointerCapture?.(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
    };

    button.addEventListener('pointerdown', activate);
    button.addEventListener('pointerup', deactivate);
    button.addEventListener('pointercancel', deactivate);
    button.addEventListener('lostpointercapture', deactivate);
    button.addEventListener('contextmenu', (event) => event.preventDefault());

    return button;
  }

  toggleActiveTargetHand() {
    const previousHand = this.activeTargetHand;
    this.activeTargetHand = this.activeTargetHand === 'right' ? 'left' : 'right';
    if (this.controller) {
      this.controller.setHandMotorTarget(previousHand, 5, 0.0);
      this.controller.setHandMotorTarget(this.activeTargetHand, 5, 0.01);
    }
    this.updateTargetHandUi();
    this.updateHandGripUi();
  }

  updateTargetHandUi() {
    if (!this.targetHandToggleButton) {
      return;
    }

    const handLabel = this.activeTargetHand === 'right' ? 'Right' : 'Left';
    this.targetHandToggleButton.textContent = `Hand: ${handLabel} (T)`;
  }

  toggleSelectedHandGrip() {
    const hand = this.activeTargetHand;
    const nextClosed = !this.handGripClosedState[hand];
    this.handGripClosedState[hand] = nextClosed;

    if (this.controller) {
      for (let motorIndex = 0; motorIndex < ACTIVE_TARGET_HAND_GRIP_TOGGLE_COUNT; motorIndex += 1) {
        const target = nextClosed ? this.controller.getHandMotorMaxTarget(hand, motorIndex) : 0.0;
        this.controller.setHandMotorTarget(hand, motorIndex, target);
      }
    }

    this.updateHandGripUi();
  }

  resetHandGripStates() {
    this.handGripClosedState.right = false;
    this.handGripClosedState.left = false;
    this.updateHandGripUi();
  }

  updateHandGripUi() {
    if (!this.handGripToggleButton) {
      return;
    }

    const handLabel = this.activeTargetHand === 'right' ? 'Right' : 'Left';
    const closed = this.handGripClosedState[this.activeTargetHand];
    const nextLabel = closed ? '0.0' : 'MAX';
    this.handGripToggleButton.textContent = `Finger 1-5 ${handLabel} -> ${nextLabel}`;
  }

  async init() {
    // Download the the examples to MuJoCo's virtual file system
    await downloadExampleScenesFolder(mujoco, initialScene);

    // Initialize the three.js Scene using the .xml Model in initialScene
    [this.model, this.data, this.bodies, this.lights] =
      await loadSceneFromURL(mujoco, initialScene, this);
    this.mujoco.mj_forward(this.model, this.data);
    await this.configureSceneController();
    window.mujocoDemo = this;

    this.gui = new GUI();
    setupGUI(this);
  }

  sceneUsesPositionTargets() {
    return typeof this.params.scene === 'string'
      && (this.params.scene.endsWith('_position.xml') || this.params.scene.endsWith('_hands_pos.xml'));
  }

  getActuatorName(actuatorId) {
    return this.textDecoder.decode(
      this.model.names.subarray(this.model.name_actuatoradr[actuatorId]),
    ).split('\u0000')[0];
  }

  getBodyName(bodyId) {
    if (!this.model || bodyId < 0 || bodyId >= this.model.nbody) {
      return '';
    }
    return this.textDecoder.decode(
      this.model.names.subarray(this.model.name_bodyadr[bodyId]),
    ).split('\u0000')[0];
  }

  applyHandOnlyCollisionMask() {
    if (!this.model) {
      return;
    }

    for (let geomId = 0; geomId < this.model.ngeom; geomId += 1) {
      const bodyName = this.getBodyName(this.model.geom_bodyid[geomId]);
      if (DARU_NON_HAND_COLLISION_BODY_NAMES.has(bodyName)) {
        this.model.geom_contype[geomId] = 0;
        this.model.geom_conaffinity[geomId] = 0;
      }
    }
  }

  syncPassiveSceneControls() {
    if (!this.model || !this.data || !this.sceneUsesPositionTargets()) {
      return;
    }

    for (let actuatorId = 0; actuatorId < this.model.nu; actuatorId += 1) {
      const name = this.getActuatorName(actuatorId);
      if (!name.endsWith('_pos')) {
        continue;
      }

      const jointId = this.model.actuator_trnid[2 * actuatorId];
      if (jointId < 0 || jointId >= this.model.njnt) {
        continue;
      }

      const qposId = this.model.jnt_qposadr[jointId];
      let target = this.data.qpos[qposId];
      if (this.model.actuator_ctrllimited[actuatorId]) {
        target = Math.min(
          this.model.actuator_ctrlrange[2 * actuatorId + 1],
          Math.max(this.model.actuator_ctrlrange[2 * actuatorId + 0], target),
        );
      }

      this.data.ctrl[actuatorId] = target;
      this.params[name] = target;
    }
  }

  applyControlDisableState() {
    if (!this.model || !this.data) {
      return;
    }

    if (this.params.controlsDisabled) {
      this.clearTargetKeys();
      this.model.opt.disableflags |= MJDSBL_ACTUATION;
      this.data.ctrl.fill(0.0);
      this.data.qfrc_applied.fill(0.0);
      this.debugState.status = this.controller ? 'controller:bypassed' : 'controller:off';
    } else {
      this.model.opt.disableflags &= ~MJDSBL_ACTUATION;
      if (!this.controller) {
        this.syncPassiveSceneControls();
      }
      if (this.params.scene === DARU_TORQUE_SCENE) {
        this.debugState.status = this.controller ? 'controller:ready' : 'controller:init';
      } else {
        this.debugState.status = 'controller:disabled';
      }
    }
  }

  applyCollisionDisableState() {
    if (!this.model || !this.data) {
      return;
    }

    if (this.params.collisionsDisabled) {
      this.model.opt.disableflags |= MJDSBL_CONTACT;
    } else {
      this.model.opt.disableflags &= ~MJDSBL_CONTACT;
      this.applyHandOnlyCollisionMask();
    }
    this.mujoco.mj_forward(this.model, this.data);
  }

  async configureSceneController() {
    const generation = ++this.controllerInitGeneration;
    this.clearTargetKeys();
    this.resetHandGripStates();

    if (this.controller) {
      this.controller.dispose();
      this.controller = null;
    }

    this.data.qfrc_applied.fill(0.0);

    if (this.params.scene !== DARU_TORQUE_SCENE) {
      this.controllerLoading = false;
      this.debugState.status = 'controller:disabled';
      this.debugState.rbdl = '';
      this.syncPassiveSceneControls();
      this.applyControlDisableState();
      this.applyCollisionDisableState();
      return;
    }

    this.data.ctrl.fill(0.0);
    this.controllerLoading = true;
    this.controllerInitStartedAt = performance.now();
    this.debugState.status = 'controller:init';
    this.debugState.rbdl = 'starting';

    try {
      const controller = await Promise.race([
        DaruV4TorqueController.create(this.mujoco, this.model, this.data, (message) => {
          if (generation !== this.controllerInitGeneration) {
            return;
          }
          this.debugState.rbdl = message;
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('controller init timeout')), 8000);
        }),
      ]);

      if (generation !== this.controllerInitGeneration) {
        controller.dispose?.();
        return;
      }

      this.controller = controller;
      this.controllerLoading = false;
      this.debugState.status = 'controller:ready';
      this.debugState.rbdl = 'ready';
      this.applyControlDisableState();
      this.applyCollisionDisableState();
      console.info('DARU torque controller initialized');
    } catch (error) {
      if (generation !== this.controllerInitGeneration) {
        return;
      }
      console.error('Failed to initialize DARU torque controller:', error);
      this.controller = null;
      this.controllerLoading = false;
      this.debugState.status = `controller:error ${error.message}`;
    }
  }

  updateDebugOverlay() {
    const controllerMode = this.controller ? this.controller.mode : 'none';
    const loadingSeconds = this.controllerLoading
      ? ((performance.now() - this.controllerInitStartedAt) / 1000.0).toFixed(1)
      : '0.0';
    const ctrl0 = this.data && this.data.ctrl.length > 0 ? this.data.ctrl[0].toFixed(3) : 'n/a';
    const ctrl4 = this.data && this.data.ctrl.length > 4 ? this.data.ctrl[4].toFixed(3) : 'n/a';
    const ctrl11 = this.data && this.data.ctrl.length > 11 ? this.data.ctrl[11].toFixed(3) : 'n/a';
    const tau4 = this.controller ? this.controller.armRefTau[4].toFixed(3) : 'n/a';
    const tau11 = this.controller ? this.controller.armRefTau[11].toFixed(3) : 'n/a';
    const q4 = this.controller ? this.controller.armPos[4].toFixed(3) : 'n/a';
    const q11 = this.controller ? this.controller.armPos[11].toFixed(3) : 'n/a';
    const activeTargetPos = this.controller ? this.controller.getTargetPosition(this.activeTargetHand) : null;
    const activeTargetQuat = this.controller ? this.controller.getTargetQuaternion(this.activeTargetHand) : null;
    const targetX = activeTargetPos ? activeTargetPos[0].toFixed(3) : 'n/a';
    const targetY = activeTargetPos ? activeTargetPos[1].toFixed(3) : 'n/a';
    const targetZ = activeTargetPos ? activeTargetPos[2].toFixed(3) : 'n/a';
    const targetQuatW = activeTargetQuat ? activeTargetQuat[0].toFixed(3) : 'n/a';
    const targetQuatX = activeTargetQuat ? activeTargetQuat[1].toFixed(3) : 'n/a';
    const targetQuatY = activeTargetQuat ? activeTargetQuat[2].toFixed(3) : 'n/a';
    const targetQuatZ = activeTargetQuat ? activeTargetQuat[3].toFixed(3) : 'n/a';
    const inputMode = this.rightTargetRotationMode ? 'rot' : 'pos';
    this.updateRightTargetPadState(controllerMode);
    this.debugOverlay.textContent =
      `scene: ${this.params.scene}
loading: ${this.controllerLoading}
loading_s: ${loadingSeconds}
controller: ${this.controller ? 'yes' : 'no'}
collisions_disabled: ${this.params.collisionsDisabled}
controls_disabled: ${this.params.controlsDisabled}
mode: ${controllerMode}
status: ${this.debugState.status}
rbdl: ${this.debugState.rbdl}
ctrl0/4/11: ${ctrl0} ${ctrl4} ${ctrl11}
tau4/11: ${tau4} ${tau11}
q4/11: ${q4} ${q11}
target_hand: ${this.activeTargetHand}
target_input: pad+kb (hand:t rot:v)
target_mode: ${inputMode}
target_xyz: ${targetX} ${targetY} ${targetZ}
target_quat: ${targetQuatW} ${targetQuatX} ${targetQuatY} ${targetQuatZ}`;
  }

  updateRightTargetPadState(controllerMode) {
    if (!this.rightTargetPad || !this.rightTargetPadStatus) {
      return;
    }

    const enabled =
      Boolean(this.controller)
      && this.params.scene === DARU_TORQUE_SCENE
      && !this.params.controlsDisabled
      && (controllerMode === 2 || controllerMode === 3);

    this.rightTargetPad.style.opacity = enabled ? '1' : '0.6';
    this.rightTargetPad.style.pointerEvents = enabled ? 'auto' : 'none';

    if (enabled) {
      this.rightTargetPadStatus.textContent = `${this.activeTargetHand} hand position and rotation pads are live`;
      this.rightTargetPadStatus.style.color = '#a7e3b3';
      return;
    }

    if (this.params.controlsDisabled) {
      this.rightTargetPadStatus.textContent = 'controls disabled';
    } else if (this.controllerLoading) {
      this.rightTargetPadStatus.textContent = 'controller loading';
    } else if (!this.controller) {
      this.rightTargetPadStatus.textContent = 'torque controller unavailable';
    } else {
      this.rightTargetPadStatus.textContent = 'waiting for mode 2';
    }
    this.rightTargetPadStatus.style.color = '#8ea7bc';
  }

  shouldIgnoreTargetKeyEvent(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return true;
    }

    const activeElement = document.activeElement;
    if (!activeElement) {
      return false;
    }

    const tagName = activeElement.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true;
    }

    return activeElement.isContentEditable;
  }

  onTargetKeyDown(event) {
    if (this.shouldIgnoreTargetKeyEvent(event)) {
      return;
    }

    if (event.code === ACTIVE_TARGET_HAND_TOGGLE_KEY) {
      if (!event.repeat) {
        this.toggleActiveTargetHand();
      }
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyV') {
      if (!event.repeat) {
        this.rightTargetRotationMode = !this.rightTargetRotationMode;
      }
      event.preventDefault();
      return;
    }

    if (!RIGHT_TARGET_INPUT_KEYS.has(event.code)) {
      return;
    }

    this.activeTargetKeys.add(event.code);
    event.preventDefault();
  }

  onTargetKeyUp(event) {
    if (event.code === ACTIVE_TARGET_HAND_TOGGLE_KEY) {
      if (!this.shouldIgnoreTargetKeyEvent(event)) {
        event.preventDefault();
      }
      return;
    }

    if (event.code === 'KeyV') {
      if (!this.shouldIgnoreTargetKeyEvent(event)) {
        event.preventDefault();
      }
      return;
    }

    if (!RIGHT_TARGET_INPUT_KEYS.has(event.code)) {
      return;
    }

    this.activeTargetKeys.delete(event.code);
    if (!this.shouldIgnoreTargetKeyEvent(event)) {
      event.preventDefault();
    }
  }

  clearTargetKeys() {
    this.activeTargetKeys.clear();
    this.activePadPositionKeys.clear();
    this.activePadRotationKeys.clear();
    this.activeTargetHand = 'right';
    this.rightTargetRotationMode = false;
    this.updateTargetHandUi();
    this.updateHandGripUi();
  }

  applyRightTargetInput(frameDt) {
    if (!this.controller || this.params.scene !== DARU_TORQUE_SCENE) {
      return;
    }
    if (this.controller.mode !== 2 && this.controller.mode !== 3) {
      return;
    }

    const clampedDt = Math.min(Math.max(frameDt, 0.0), 0.1);
    const positionStep = RIGHT_TARGET_POSITION_SPEED * clampedDt;
    const rotationStep = RIGHT_TARGET_ROTATION_SPEED * clampedDt;
    const rotationMode = this.rightTargetRotationMode;
    const targetHand = this.activeTargetHand;

    const hasRotationInput = (code) => this.activePadRotationKeys.has(code) || (rotationMode && this.activeTargetKeys.has(code));
    const hasPositionInput = (code) => this.activePadPositionKeys.has(code) || (!rotationMode && this.activeTargetKeys.has(code));

    if (this.activePadRotationKeys.size > 0 || rotationMode) {
      if (hasRotationInput('KeyW')) {
        this.controller.rotateTargetLocal(targetHand, 0.0, 1.0, 0.0, rotationStep);
      }
      if (hasRotationInput('KeyS')) {
        this.controller.rotateTargetLocal(targetHand, 0.0, 1.0, 0.0, -rotationStep);
      }
      if (hasRotationInput('KeyA')) {
        this.controller.rotateTargetLocal(targetHand, 0.0, 0.0, 1.0, rotationStep);
      }
      if (hasRotationInput('KeyD')) {
        this.controller.rotateTargetLocal(targetHand, 0.0, 0.0, 1.0, -rotationStep);
      }
      if (hasRotationInput('KeyR')) {
        this.controller.rotateTargetLocal(targetHand, 1.0, 0.0, 0.0, rotationStep);
      }
      if (hasRotationInput('KeyF')) {
        this.controller.rotateTargetLocal(targetHand, 1.0, 0.0, 0.0, -rotationStep);
      }
    }

    let deltaX = 0.0;
    let deltaY = 0.0;
    let deltaZ = 0.0;

    if (hasPositionInput('KeyW')) {
      deltaX += positionStep;
    }
    if (hasPositionInput('KeyS')) {
      deltaX -= positionStep;
    }
    if (hasPositionInput('KeyA')) {
      deltaY += positionStep;
    }
    if (hasPositionInput('KeyD')) {
      deltaY -= positionStep;
    }
    if (hasPositionInput('KeyR')) {
      deltaZ += positionStep;
    }
    if (hasPositionInput('KeyF')) {
      deltaZ -= positionStep;
    }

    if (deltaX !== 0.0 || deltaY !== 0.0 || deltaZ !== 0.0) {
      this.controller.nudgeTargetPosition(targetHand, deltaX, deltaY, deltaZ);
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize( window.innerWidth, window.innerHeight );
  }

  render(timeMS) {
    if (!this.model || !this.data) return;
    this.controls.update();
    const frameDt = this.lastRenderTimeMs === null
      ? this.model.opt.timestep
      : (timeMS - this.lastRenderTimeMs) / 1000.0;
    this.lastRenderTimeMs = timeMS;
    this.applyRightTargetInput(frameDt);
    const holdForController =
      this.params.scene === DARU_TORQUE_SCENE
      && this.controllerLoading
      && !this.controller
      && !this.params.controlsDisabled;

    if (!this.params["paused"] && !holdForController) {
      let timestep = this.model.opt.timestep;
      if (timeMS - this.mujoco_time > 35.0) { this.mujoco_time = timeMS;}
      while (this.mujoco_time < timeMS) {
        if (this.params.controlsDisabled) {
          this.data.ctrl.fill(0.0);
          this.data.qfrc_applied.fill(0.0);
        } else if (this.controller) {
          this.controller.step();
        } else {
          for (let i = 0; i < this.data.qfrc_applied.length; i++) { this.data.qfrc_applied[i] = 0.0; }
        }

        // Jitter the control state with gaussian random noise
        if (!this.params.controlsDisabled && this.params["ctrlnoisestd"] > 0.0) {
          let rate  = Math.exp(-timestep / Math.max(1e-10, this.params["ctrlnoiserate"]));
          let scale = this.params["ctrlnoisestd"] * Math.sqrt(1 - rate * rate);
          let currentCtrl = this.data.ctrl;
          for (let i = 0; i < currentCtrl.length; i++) {
            currentCtrl[i] = rate * currentCtrl[i] + scale * standardNormal();
            this.params["Actuator " + i] = currentCtrl[i];
          }
        }

        let dragged = this.dragStateManager.physicsObject;
        if (dragged && dragged.bodyID) {
          for (let b = 0; b < this.model.nbody; b++) {
            if (this.bodies[b]) {
              getPosition  (this.data.xpos , b, this.bodies[b].position);
              getQuaternion(this.data.xquat, b, this.bodies[b].quaternion);
              this.bodies[b].updateWorldMatrix();
            }
          }
          let bodyID = dragged.bodyID;
          this.dragStateManager.update(); // Update the world-space force origin
          let force = toMujocoPos(this.dragStateManager.currentWorld.clone().sub(this.dragStateManager.worldHit).multiplyScalar(this.model.body_mass[bodyID] * 250));
          let point = toMujocoPos(this.dragStateManager.worldHit.clone());
          mujoco.mj_applyFT(this.model, this.data, [force.x, force.y, force.z], [0, 0, 0], [point.x, point.y, point.z], bodyID, this.data.qfrc_applied);

          // TODO: Apply pose perturbations (mocap bodies only).
        }

        mujoco.mj_step(this.model, this.data);

        this.mujoco_time += timestep * 1000.0;
      }

    } else if (this.params["paused"]) {
      this.dragStateManager.update(); // Update the world-space force origin
      let dragged = this.dragStateManager.physicsObject;
      if (dragged && dragged.bodyID) {
        let b = dragged.bodyID;
        getPosition  (this.data.xpos , b, this.tmpVec , false); // Get raw coordinate from MuJoCo
        getQuaternion(this.data.xquat, b, this.tmpQuat, false); // Get raw coordinate from MuJoCo

        let offset = toMujocoPos(this.dragStateManager.currentWorld.clone()
          .sub(this.dragStateManager.worldHit).multiplyScalar(0.3));
        if (this.model.body_mocapid[b] >= 0) {
          // Set the root body's mocap position...
          console.log("Trying to move mocap body", b);
          let addr = this.model.body_mocapid[b] * 3;
          let pos  = this.data.mocap_pos;
          pos[addr+0] += offset.x;
          pos[addr+1] += offset.y;
          pos[addr+2] += offset.z;
        } else {
          // Set the root body's position directly...
          let root = this.model.body_rootid[b];
          let addr = this.model.jnt_qposadr[this.model.body_jntadr[root]];
          let pos  = this.data.qpos;
          pos[addr+0] += offset.x;
          pos[addr+1] += offset.y;
          pos[addr+2] += offset.z;
        }
      }

      mujoco.mj_forward(this.model, this.data);
    } else if (holdForController) {
      this.mujoco_time = timeMS;
      mujoco.mj_forward(this.model, this.data);
    }

    // Update body transforms.
    for (let b = 0; b < this.model.nbody; b++) {
      if (this.bodies[b]) {
        getPosition  (this.data.xpos , b, this.bodies[b].position);
        getQuaternion(this.data.xquat, b, this.bodies[b].quaternion);
        this.bodies[b].updateWorldMatrix();
      }
    }

    // Update light transforms.
    for (let l = 0; l < this.model.nlight; l++) {
      if (this.lights[l]) {
        getPosition(this.data.light_xpos, l, this.lights[l].position);
        getPosition(this.data.light_xdir, l, this.tmpVec);
        this.lights[l].lookAt(this.tmpVec.add(this.lights[l].position));
      }
    }

    // Draw Tendons and Flex verts
    drawTendonsAndFlex(this.mujocoRoot, this.model, this.data);

    this.updateDebugOverlay();

    // Render!
    this.renderer.render( this.scene, this.camera );
  }
}

let demo = new MuJoCoDemo();
await demo.init();
