import * as THREE from '../vendor/three/three.module.js';

const up = new THREE.Vector3(0, 1, 0);

// MuJoCo supplies the anchor poses and the maximum length. The bend only
// depicts slack in the ideal tendon and feeds no forces back into the game.
export class TrayCord {
  constructor(spec) {
    this.length = spec.length;
    this.anchors = spec.anchors.map(({body, pos}) => ({body, local: new THREE.Vector3(...pos)}));
    this.group = new THREE.Group();
    this.group.visible = false;
    this.material = new THREE.MeshStandardMaterial({color: new THREE.Color(...spec.color), roughness: .9});
    this.tube = new THREE.CylinderGeometry(spec.radius, spec.radius, 1, 10);
    this.joint = new THREE.SphereGeometry(spec.radius, 10, 6);
    this.halves = [new THREE.Mesh(this.tube, this.material), new THREE.Mesh(this.tube, this.material)];
    this.bend = new THREE.Mesh(this.joint, this.material);
    this.group.add(...this.halves, this.bend);
    this.points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.direction = new THREE.Vector3();
    this.sag = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
  }

  update(transforms) {
    const [a, mid, b] = this.points;
    this.anchors.forEach(({body, local}, k) => {
      const i = 7*body;
      this.rotation.set(transforms[i+4], transforms[i+5], transforms[i+6], transforms[i+3]);
      const end = k === 0 ? a : b;
      end.copy(local).applyQuaternion(this.rotation);
      end.x += transforms[i]; end.y += transforms[i+1]; end.z += transforms[i+2];
    });
    const distance = a.distanceTo(b);
    this.direction.subVectors(b, a).normalize();
    this.sag.set(0, 0, -1).addScaledVector(this.direction, this.direction.z);
    if (this.sag.lengthSq() < 1e-10) this.sag.set(0, 1, 0);
    const offset = .5 * Math.sqrt(Math.max(0, this.length**2 - distance**2));
    mid.lerpVectors(a, b, .5).addScaledVector(this.sag.normalize(), offset);
    this.bend.position.copy(mid);
    this.halves.forEach((mesh, i) => {
      const start = this.points[i], end = this.points[i+1];
      this.direction.subVectors(end, start);
      mesh.scale.y = this.direction.length();
      mesh.position.lerpVectors(start, end, .5);
      mesh.quaternion.setFromUnitVectors(up, this.direction.normalize());
    });
    this.group.visible = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.tube.dispose();
    this.joint.dispose();
    this.material.dispose();
  }
}
