import * as THREE from '../vendor/three/three.module.js';

export function createRoomScene(renderer) {
  const scene = new THREE.Scene();
  const daylight = '#f7f8f6';
  renderer.setClearColor(daylight);
  scene.fog = new THREE.Fog(daylight, 6, 15);
  scene.add(new THREE.HemisphereLight('#fffdf8', '#c4cbca', 1.55));

  const key = new THREE.DirectionalLight('#fff7ec', 2.15);
  key.position.set(-2.2, -3.1, 3.8);
  key.target.position.set(.42, .2, .25);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {left: -2.0, right: 2.0, top: 2.1, bottom: -2.1, near: .5, far: 9});
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = .004;
  key.shadow.bias = -.00025;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#ecf3ff', .65);
  fill.position.set(2, -1, 2);
  scene.add(fill);

  // Only fixed cabinet parts cast the room shadow. Reuse it for both views
  // and all gameplay frames until a new model is loaded.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  return scene;
}

function positionOf(node) {
  return new THREE.Vector3(...node.getAttribute('pos').trim().split(/\s+/).map(Number));
}

export function readRoomViews(doc) {
  const world = doc.querySelector('worldbody');
  return ['front', 'left', 'cabinet_front', 'cabinet_left'].map(name => {
    const camera = world.querySelector(`camera[name="${name}"]`);
    const pivot = positionOf(world.querySelector(`body[name="${camera.getAttribute('target')}"]`));
    return {pivot, offset: positionOf(camera).sub(pivot), fov: Number(camera.getAttribute('fovy'))};
  });
}

export function frameRoomCamera(camera, pose, view, index, aspect) {
  // Preserve the horizontal view of the bridge in narrow split-screen panes.
  const halfAngle = THREE.MathUtils.degToRad(pose.fov / 2);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfAngle) * Math.max(1, 1 / aspect)));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const x = pose.pivot.x + (index === 0 ? view.panX : 0);
  const y = pose.pivot.y - (index === 1 ? view.panX : 0);
  const z = pose.pivot.z + view.panZ;
  camera.position.set(x, y, z).addScaledVector(pose.offset, view.zoom);
  camera.lookAt(x, y, z);
}

export function checkerColor(node, attribute) {
  const channels = node.getAttribute(attribute).trim().split(/\s+/).map(v => Math.round(Number(v) * 255));
  return `rgb(${channels.join(',')})`;
}
