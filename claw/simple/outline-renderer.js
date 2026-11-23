import * as THREE from '../vendor/three/three.module.js';
import {DualRenderer as SceneRenderer} from './renderer.js?v=20261123-white-room';
import {RodMesh, rodOutlineMaterial} from './rod-mesh.js';
import {TelescopicLift} from './telescopic-lift.js';

function outlined(name) {
  const part = name.replace(/^display_/, '');
  return /^(?:rod_\d+$|prize_geom$|dummy_box_.*_body$|left_|right_|head_(?:chrome_shell|white_cover|shaft)$|shaft_collar$)/.test(part)
    || /^(?:field_(?:base|riser|side_frame|frame_front)_|cabinet_roof$|post_(?:front|back)_|deck_front_fascia_|button_\d|prize_out_post_|outlet_(?:upper|lower)_lintel_|chute_(?:front_inside|back_liner|side_liner)_)/.test(part);
}

// Weld by position so UV splits and duplicated triangle vertices share an edge.
function collectEdges(geometry) {
  const positions = geometry.getAttribute('position');
  const vertices = new Map(), edges = new Map();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  function vertex(index) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, index);
    const key = [p.x, p.y, p.z].map(v => Math.round(v * 1e6)).join(',');
    if (!vertices.has(key)) vertices.set(key, {id: vertices.size, p});
    return vertices.get(key);
  }
  for (let i = 0; i < positions.count; i += 3) {
    const triangle = [vertex(i), vertex(i + 1), vertex(i + 2)];
    const [a, b, c] = triangle;
    const normal = ab.subVectors(b.p, a.p).cross(ac.subVectors(c.p, a.p)).clone();
    if (normal.lengthSq() < 1e-24) continue;
    normal.normalize();
    for (let j = 0; j < 3; j++) {
      const start = triangle[j], end = triangle[(j + 1) % 3];
      const key = Math.min(start.id, end.id) + '/' + Math.max(start.id, end.id);
      const edge = edges.get(key);
      if (edge) edge.otherNormal = normal;
      else edges.set(key, {start: start.p, end: end.p, normal});
    }
  }
  return edges.values();
}

function outlineGeometry(items) {
  const position = [], opposite = [], faceA = [], faceB = [], corner = [], indices = [];
  for (const item of items) {
    if (!outlined(item.name)) continue;
    for (const {start, end, normal, otherNormal} of collectEdges(item)) {
      if (otherNormal && normal.dot(otherNormal) > .999999) continue;
      const second = otherNormal ?? normal.clone().negate();
      const base = position.length / 3;
      for (const atStart of [true, false]) {
        const p = atStart ? start : end, q = atStart ? end : start;
        for (const side of [-1, 1]) {
          position.push(p.x, p.y, p.z); opposite.push(q.x, q.y, q.z);
          faceA.push(normal.x, normal.y, normal.z); faceB.push(second.x, second.y, second.z);
          corner.push(atStart ? 1 : -1, side);
        }
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [key, data] of Object.entries({position, opposite, faceA, faceB, corner})) {
    geometry.setAttribute(key, new THREE.Float32BufferAttribute(data, key === 'corner' ? 2 : 3));
  }
  geometry.setIndex(indices);
  return geometry;
}

function outlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {viewport: {value: new THREE.Vector4()}},
    transparent: true, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    vertexShader: `
      uniform vec4 viewport;
      attribute vec3 opposite, faceA, faceB;
      attribute vec2 corner;
      varying float lateral;
      void main() {
        vec3 p = (modelViewMatrix * vec4(position, 1.)).xyz;
        vec3 q = (modelViewMatrix * vec4(opposite, 1.)).xyz;
        vec3 eye = -(p + q);
        float a = dot(normalMatrix * faceA, eye), b = dot(normalMatrix * faceB, eye);
        bool silhouette = (a >= 0.) != (b >= 0.);
        bool crease = max(a, b) > 0. && dot(faceA, faceB) < 0.78;
        lateral = corner.y;
        if ((!silhouette && !crease) || max(p.z, q.z) >= -0.01) {
          gl_Position = vec4(2., 2., 2., 1.);
          return;
        }
        vec4 clipP = projectionMatrix * vec4(p * (1. - .00055 / -p.z), 1.);
        vec4 clipQ = projectionMatrix * vec4(q, 1.);
        vec2 dir = (clipQ.xy / clipQ.w - clipP.xy / clipP.w) * viewport.zw * corner.x;
        vec2 perp = vec2(-dir.y, dir.x) / max(length(dir), .0001);
        clipP.xy += perp * corner.y * 2.2 / viewport.zw * clipP.w;
        gl_Position = clipP;
      }`,
    fragmentShader: `
      varying float lateral;
      void main() {
        float alpha = 0.93 * (1. - smoothstep(.45, 1., abs(lateral)));
        gl_FragColor = vec4(.014, .021, .032, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

export class DualRenderer extends SceneRenderer {
  constructor(canvas, panes) {
    super(canvas, panes);
    this.ink = outlineMaterial();
    this.rodInk = rodOutlineMaterial();
    this.rods = [];
    this.lifts = [];
  }
  async load(description, revision) {
    await super.load(description, revision);
    if (revision !== this.revision) return;
    this.rods = description.rods.map(spec => new RodMesh(spec, this.rodInk));
    for (const rod of this.rods) this.scene.add(rod.group);
    this.lifts = [0, 1].map(bay => new TelescopicLift(description.geoms, bay));
    for (const lift of this.lifts) this.scene.add(lift.root);
  }
  update(frame) {
    super.update(frame);
    if (frame.revision === this.revision) {
      for (const rod of this.rods) rod.update(frame.rodPoints);
      for (const lift of this.lifts) lift.update(frame.transforms);
    }
  }
  clearGeometry() {
    for (const rod of this.rods) rod.dispose();
    this.rods = [];
    for (const lift of this.lifts) lift.dispose();
    this.lifts = [];
    super.clearGeometry();
  }
  addMerged(group, items, material) {
    const edges = outlineGeometry(items);
    super.addMerged(group, items, material);
    if (!edges) return;
    const lines = new THREE.Mesh(edges, this.ink);
    lines.onBeforeRender = renderer => renderer.getViewport(this.ink.uniforms.viewport.value);
    group.add(lines);
    this.meshes.push(lines);
  }
}
