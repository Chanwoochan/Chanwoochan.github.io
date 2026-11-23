import {createRoomScene, readRoomViews, frameRoomCamera, checkerColor} from './room-view.js';
import * as THREE from '../vendor/three/three.module.js';

const numbers = (value, fallback = []) => value ? value.trim().split(/\s+/).map(Number) : fallback;
const quat = q => new THREE.Quaternion(q[1], q[2], q[3], q[0]);
const compose = (position, quaternion) => new THREE.Matrix4().compose(
  new THREE.Vector3(...position), quat(quaternion), new THREE.Vector3(1, 1, 1));

function mergeGeometries(items) {
  const result = new THREE.BufferGeometry();
  for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const length = items.reduce((n, g) => n + g.getAttribute('position').count * size, 0);
    const values = new Float32Array(length); let offset = 0;
    for (const g of items) {
      const attribute = g.getAttribute(key), count = g.getAttribute('position').count * size;
      if (attribute) values.set(attribute.array, offset);
      offset += count;
    }
    result.setAttribute(key, new THREE.BufferAttribute(values, size));
  }
  result.computeBoundingSphere();
  return result;
}

function makeGeometry(g, meshes) {
  const s = g.size; let shape;
  switch (g.type) {
    case 0: shape = new THREE.PlaneGeometry(Math.max(2 * s[0], 8), Math.max(2 * s[1], 8)); break;
    case 2: shape = new THREE.SphereGeometry(s[0], 16, 12); break;
    case 3: shape = new THREE.CapsuleGeometry(s[0], 2 * s[1], 5, 12); shape.rotateX(Math.PI / 2); break;
    case 4: shape = new THREE.SphereGeometry(1, 20, 12); shape.scale(...s); break;
    case 5: shape = new THREE.CylinderGeometry(s[0], s[0], 2 * s[1], 24); shape.rotateX(Math.PI / 2); break;
    case 6: shape = new THREE.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2]); break;
    case 7: {
      const source = meshes[g.mesh], vertices = [], uvs = [];
      if (!source) return null;
      source.face.forEach((index, corner) => {
        vertices.push(...source.vertex.slice(index * 3, index * 3 + 3));
        const uvIndex = source.faceUV[corner];
        uvs.push(...(uvIndex >= 0 && source.uv.length ? source.uv.slice(uvIndex * 2, uvIndex * 2 + 2) : [0, 0]));
      });
      shape = new THREE.BufferGeometry();
      shape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      shape.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      shape.computeVertexNormals(); break;
    }
    default: return null;
  }
  if (shape.index) { const full = shape.toNonIndexed(); shape.dispose(); shape = full; }
  return shape;
}

export class DualRenderer {
  constructor(canvas, panes) {
    this.canvas = canvas; this.panes = panes; this.groups = new Map(); this.meshes = [];
    this.textures = new Map(); this.materials = new Map(); this.mode = 'play'; this.revision = -1;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.scene = createRoomScene(this.renderer);
    this.cameras = panes.map(() => { const c = new THREE.PerspectiveCamera(38, 1, .01, 40); c.up.set(0, 0, 1); return c; });
    this.views = panes.map(() => ({zoom: 1, panX: 0, panZ: 0}));
    panes.forEach((pane, i) => this.bindCamera(pane, i));
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
    this.resize();
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (r.width && r.height) this.renderer.setSize(r.width, r.height, false);
  }
  bindCamera(pane, index) {
    let drag = null;
    pane.addEventListener('wheel', event => {
      event.preventDefault(); const v = this.views[index]; v.zoom = Math.max(.4, Math.min(3, v.zoom * Math.exp(event.deltaY * .001)));
    }, {passive: false});
    pane.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY}; pane.setPointerCapture(event.pointerId);
    });
    pane.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const v = this.views[index], scale = .002 * v.zoom;
      v.panX -= (event.clientX - drag.x) * scale; v.panZ += (event.clientY - drag.y) * scale;
      drag.x = event.clientX; drag.y = event.clientY;
    });
    const stop = () => { drag = null; };
    pane.addEventListener('pointerup', stop); pane.addEventListener('pointercancel', stop); pane.addEventListener('lostpointercapture', stop);
    pane.addEventListener('dblclick', () => { this.views[index] = {zoom: 1, panX: 0, panZ: 0}; });
  }
  setMode(mode) { this.mode = mode; this.views.forEach(v => Object.assign(v, {zoom: 1, panX: 0, panZ: 0})); }
  async texture(name, node) {
    if (this.textures.has(name)) return this.textures.get(name);
    let texture;
    const file = node?.getAttribute('file');
    if (file) {
      texture = await new THREE.TextureLoader().loadAsync('./assets/' + file.split('/').pop());
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    } else {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d');
      context.fillStyle = checkerColor(node, 'rgb1'); context.fillRect(0, 0, 128, 128);
      context.fillStyle = checkerColor(node, 'rgb2'); context.fillRect(0, 0, 64, 64); context.fillRect(64, 64, 64, 64);
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    this.textures.set(name, texture); return texture;
  }
  async load(description, revision) {
    this.revision = revision; this.description = description;
    this.clearGeometry();
    const doc = new DOMParser().parseFromString(description.xml, 'application/xml');
    this.roomViews = readRoomViews(doc);
    const asset = doc.querySelector('asset'), materials = new Map(), textures = new Map(), xmlGeoms = new Map();
    asset.querySelectorAll('material').forEach(n => materials.set(n.getAttribute('name'), n));
    asset.querySelectorAll('texture:not([type="skybox"])').forEach(n => textures.set(n.getAttribute('name'), n));
    doc.querySelectorAll('worldbody geom[name]').forEach(n => xmlGeoms.set(n.getAttribute('name'), n));
    await Promise.all([...textures].map(([name, node]) => this.texture(name, node)));
    if (revision !== this.revision) return;
    const dynamic = new Set(description.dynamicBodies), batches = new Map();
    for (const g of description.geoms) {
      const node = materials.get(g.material), override = xmlGeoms.get(g.name)?.getAttribute('rgba');
      const rgba = numbers(override, numbers(node?.getAttribute('rgba'), g.rgba));
      if (rgba[3] <= 0) continue;
      const key = `${g.material}:${rgba.join(',')}`;
      let material = this.materials.get(key);
      if (!material) {
        const specular = Number(node?.getAttribute('specular') || .25);
        const emission = Number(node?.getAttribute('emission') || 0);
        const color = new THREE.Color(rgba[0], rgba[1], rgba[2]);
        material = new THREE.MeshStandardMaterial({color, opacity: rgba[3], transparent: rgba[3] < 1,
          depthWrite: rgba[3] >= 1, side: THREE.DoubleSide,
          metalness: /chrome|steel|metal/.test(g.material) ? .62 : .04,
          roughness: Math.max(.2, .8 - specular * .5), emissive: color, emissiveIntensity: emission * .55});
        const textureName = node?.getAttribute('texture');
        if (textureName) {
          material.map = this.textures.get(textureName);
          const repeat = numbers(node.getAttribute('texrepeat'), [1, 1]);
          // All shared printed maps use the same repeat; checker has its own map.
          material.map?.repeat.set(...repeat);
        }
        this.materials.set(key, material);
      }
      let geometry = makeGeometry(g, description.meshes);
      if (!geometry) continue;
      geometry.name = g.name;
      geometry.applyMatrix4(compose(g.pos, g.quat));
      const body = dynamic.has(g.body) ? g.body : 0;
      // Bake fixed-body poses when the first coherent snapshot arrives.
      const batchKey = `${body}:${key}:${body === 0 ? g.body : ''}`;
      let batch = batches.get(batchKey);
      if (!batch) { batch = {body, originalBody: g.body, material, geometries: []}; batches.set(batchKey, batch); }
      batch.geometries.push(geometry);
    }
    this.pendingBatches = [...batches.values()];
    this.needsFirstFrame = true;
  }
  buildBatches(transforms) {
    const fixed = new Map();
    for (const batch of this.pendingBatches || []) {
      if (batch.body === 0) {
        const offset = batch.originalBody * 7;
        const matrix = compose(Array.from(transforms.subarray(offset, offset + 3)), Array.from(transforms.subarray(offset + 3, offset + 7)));
        for (const g of batch.geometries) g.applyMatrix4(matrix);
        let combined = fixed.get(batch.material);
        if (!combined) { combined = []; fixed.set(batch.material, combined); }
        combined.push(...batch.geometries);
      } else {
        let group = this.groups.get(batch.body);
        if (!group) { group = new THREE.Group(); this.groups.set(batch.body, group); this.scene.add(group); }
        this.addMerged(group, batch.geometries, batch.material);
      }
    }
    for (const [material, geometries] of fixed) this.addMerged(this.scene, geometries, material);
    this.renderer.shadowMap.needsUpdate = true;
    this.pendingBatches = []; this.needsFirstFrame = false;
  }
  addMerged(group, items, material) {
    const room = items.some(g => g.name === 'arcade_floor' || g.name.startsWith('room_'));
    const geometry = mergeGeometries(items); items.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = room;
    mesh.castShadow = group === this.scene && !room && !material.transparent;
    group.add(mesh); this.meshes.push(mesh);
  }
  update(frame) {
    if (frame.revision !== this.revision || !this.description || !this.pendingBatches) return;
    if (this.needsFirstFrame) this.buildBatches(frame.transforms);
    for (const [body, group] of this.groups) {
      const a = body * 7, t = frame.transforms;
      group.position.set(t[a], t[a + 1], t[a + 2]);
      group.quaternion.set(t[a + 4], t[a + 5], t[a + 6], t[a + 3]);
    }
  }
  draw() {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setScissorTest(false); this.renderer.clear(); this.renderer.setScissorTest(true);
    this.panes.forEach((pane, index) => {
      const r = pane.getBoundingClientRect(), width = r.width, height = r.height;
      if (!width || !height) return;
      const camera = this.cameras[index], view = this.views[index], full = this.mode === 'cabinet';
      if (!this.roomViews) return;
      frameRoomCamera(camera, this.roomViews[(full ? 2 : 0) + index], view, index, width / height);
      this.renderer.setViewport(r.left - rect.left, rect.bottom - r.bottom, width, height);
      this.renderer.setScissor(r.left - rect.left, rect.bottom - r.bottom, width, height);
      this.renderer.render(this.scene, camera);
    });
    this.renderer.setScissorTest(false);
  }
  clearGeometry() {
    this.meshes.forEach(mesh => { mesh.parent?.remove(mesh); mesh.geometry.dispose(); }); this.meshes = [];
    this.groups.forEach(group => this.scene.remove(group)); this.groups.clear();
    for (const batch of this.pendingBatches || []) batch.geometries.forEach(g => g.dispose());
    this.pendingBatches = null;
    this.materials.forEach(material => material.dispose()); this.materials.clear();
  }
}
