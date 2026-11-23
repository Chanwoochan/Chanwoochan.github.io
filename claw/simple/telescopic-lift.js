import * as THREE from '../vendor/three/three.module.js';

// The two guide shoes travel along Y. The motor carriage travels along X
// on their crossbeam. The inner rod ends at the physical head pivot.
const OUTLET_Z = -.049; // Relative to the fixed ceiling rails, in metres.
const OVERLAP = .008;

export class TelescopicLift {
  constructor(geoms, bay) {
    const left = geoms.find(g => g.name === `ceiling_rail_${bay}_-1`);
    const right = geoms.find(g => g.name === `ceiling_rail_${bay}_1`);
    const mount = geoms.find(g => g.name === (bay === 0 ? 'head_mount' : 'display_head_mount'));
    this.body = mount.body;
    this.mount = new THREE.Vector3(...mount.pos);
    this.pivot = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.root = new THREE.Group();
    this.root.position.set((left.pos[0] + right.pos[0]) / 2, 0, left.pos[2]);
    this.root.visible = false;
    this.carriage = new THREE.Group();
    this.root.add(this.carriage);

    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.tube = new THREE.CylinderGeometry(1, 1, 1, 32).rotateX(Math.PI / 2);
    const finish = (color, metalness, roughness) =>
      new THREE.MeshStandardMaterial({color, metalness, roughness});
    const enamel = finish(0xe5eaed, .22, .40), alloy = finish(0xa0acb5, .45, .38);
    const chrome = finish(0xd8e3eb, .52, .24), seal = finish(0x48525b, .15, .55);
    this.finishes = [enamel, alloy, chrome, seal];
    const part = (parent, geometry, material, sx, sy, sz, x, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, 0, z);
      parent.add(mesh);
      return mesh;
    };
    const span = right.pos[0] - left.pos[0];
    for (const x of [-span / 2, span / 2]) {
      part(this.root, this.box, enamel, .035, .064, .025, x, -.005);
    }
    part(this.root, this.box, alloy, span, .028, .019, 0, -.014);
    part(this.carriage, this.box, enamel, .109, .079, .033, 0, -.024);
    part(this.carriage, this.tube, alloy, .038, .038, .012, 0, -.043);
    part(this.carriage, this.tube, seal, .031, .031, .004, 0, OUTLET_Z);
    this.sleeve = part(this.carriage, this.tube, alloy, .026, .026, 1, 0, 0);
    this.wiper = part(this.carriage, this.tube, seal, .027, .027, .005, 0, 0);
    this.rod = part(this.carriage, this.tube, chrome, .016, .016, 1, 0, 0);
  }

  update(transforms) {
    const i = 7 * this.body;
    this.rotation.set(transforms[i + 4], transforms[i + 5], transforms[i + 6], transforms[i + 3]);
    const p = this.pivot.copy(this.mount).applyQuaternion(this.rotation);
    p.x += transforms[i]; p.y += transforms[i + 1]; p.z += transforms[i + 2];
    this.root.position.y = p.y;
    this.carriage.position.x = p.x - this.root.position.x;
    this.root.visible = true;

    // Draw only the exposed sections plus the overlap inside each guide.
    // At high home settings the pivot can retract inside the motor housing.
    const end = Math.min(OUTLET_Z, p.z - this.root.position.z);
    const seam = (OUTLET_Z + end) / 2;
    this.sleeve.position.z = (OUTLET_Z + OVERLAP + seam) / 2;
    this.sleeve.scale.z = OUTLET_Z + OVERLAP - seam;
    this.wiper.position.z = seam;
    this.rod.position.z = (seam + OVERLAP + end) / 2;
    this.rod.scale.z = seam + OVERLAP - end;
    this.wiper.visible = OUTLET_Z - seam > this.wiper.scale.z;
  }

  dispose() {
    this.root.removeFromParent();
    this.box.dispose();
    this.tube.dispose();
    this.finishes.forEach(material => material.dispose());
  }
}
