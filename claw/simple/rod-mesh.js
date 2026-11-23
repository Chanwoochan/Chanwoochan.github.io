import * as THREE from '../vendor/three/three.module.js';

const capRows = 4;
const sides = 20;
const up = new THREE.Vector3(0, 1, 0);

// One continuous outline follows the deformed tube, without rings at flex nodes.
export function rodOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {viewport: {value: new THREE.Vector4()}},
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `
      uniform vec4 viewport;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        vec4 delta = projectionMatrix * vec4(normalMatrix * normal, 0.);
        vec2 dir = (delta.xy * clip.w - clip.xy * delta.w) * viewport.zw;
        clip.xy += dir / max(length(dir), .00001) * 2.0 / viewport.zw * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: `
      void main() {
        gl_FragColor = vec4(.014, .021, .032, 1.);
        #include <colorspace_fragment>
      }`,
  });
}

export class RodMesh {
  constructor(spec, ink) {
    this.spec = spec;
    this.geometry = new THREE.CapsuleGeometry(spec.radius, 1, capRows, sides, spec.count - 1);
    this.restNormals = this.geometry.attributes.normal.clone();
    this.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...spec.color), metalness: spec.metal ? .62 : .04,
      roughness: spec.metal ? .38 : .72,
    });
    this.group = new THREE.Group();
    const surface = new THREE.Mesh(this.geometry, this.material);
    const outline = new THREE.Mesh(this.geometry, ink);
    outline.onBeforeRender = renderer => renderer.getViewport(ink.uniforms.viewport.value);
    outline.renderOrder = 1;
    surface.frustumCulled = outline.frustumCulled = false;
    this.group.add(surface, outline);
    this.group.visible = false;
    this.tangent = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.normal = new THREE.Vector3();
  }

  update(points) {
    const {first, count, radius} = this.spec;
    const {position, normal} = this.geometry.attributes;
    for (let row = 0; row < count + 2 * capRows; row++) {
      const node = Math.max(0, Math.min(count - 1, row - capRows));
      const current = 3 * (first + node);
      const before = 3 * (first + Math.max(0, node - 1));
      const after = 3 * (first + Math.min(count - 1, node + 1));
      this.tangent.set(points[after] - points[before], points[after+1] - points[before+1],
                       points[after+2] - points[before+2]).normalize();
      this.rotation.setFromUnitVectors(up, this.tangent);
      for (let side = 0; side <= sides; side++) {
        const index = row * (sides + 1) + side;
        const n = this.normal.fromBufferAttribute(this.restNormals, index).applyQuaternion(this.rotation);
        normal.setXYZ(index, n.x, n.y, n.z);
        position.setXYZ(index, points[current] + radius*n.x, points[current+1] + radius*n.y,
                        points[current+2] + radius*n.z);
      }
    }
    normal.needsUpdate = position.needsUpdate = true;
    this.group.visible = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
