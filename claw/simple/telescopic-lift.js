import * as THREE from '../vendor/three/three.module.js';

// The two guide shoes travel along Y. The motor carriage travels along X
// on their crossbeam. Tubes telescope along the ceiling bearing's local Z.
const GUIDE_Z = -.016; // Exit of the rotating guide, relative to its bearing.
const OVERLAP = .008;

function worldPoint(transforms, body, point, out, rotation) {
  const i = body * 7;
  rotation.set(transforms[i + 4], transforms[i + 5], transforms[i + 6], transforms[i + 3]);
  out.copy(point).applyQuaternion(rotation);
  out.x += transforms[i]; out.y += transforms[i + 1]; out.z += transforms[i + 2];
}

export class TelescopicLift {
  constructor(geoms, bay) {
    const left = geoms.find(g => g.name === `ceiling_rail_${bay}_-1`);
    const right = geoms.find(g => g.name === `ceiling_rail_${bay}_1`);
    const prefix = bay === 0 ? '' : 'display_';
    const bearing = geoms.find(g => g.name === prefix + 'ceiling_bearing');
    const stem = geoms.find(g => g.name === prefix + 'head_shaft');
    this.bearingBody = bearing.body;
    this.bearingCentre = new THREE.Vector3(...bearing.pos);
    this.stemBody = stem.body;
    this.stemTop = new THREE.Vector3(...stem.pos);
    this.stemTop.z += stem.size[1];
    this.pivot = new THREE.Vector3();
    this.endPoint = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.root = new THREE.Group();
    this.root.position.set((left.pos[0] + right.pos[0]) / 2, 0, left.pos[2]);
    this.root.visible = false;
    this.carriage = new THREE.Group();
    this.root.add(this.carriage);
    this.swivel = new THREE.Group();
    this.carriage.add(this.swivel);

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
    part(this.swivel, this.tube, alloy, .034, .034, .013, 0, -.009);
    part(this.swivel, this.box, seal, .004, .008, .009, .033, -.009);
    part(this.swivel, this.tube, seal, .031, .031, .004, 0, GUIDE_Z);
    this.sleeve = part(this.swivel, this.tube, alloy, .026, .026, 1, 0, 0);
    this.wiper = part(this.swivel, this.tube, seal, .027, .027, .005, 0, 0);
    this.rod = part(this.swivel, this.tube, chrome, .016, .016, 1, 0, 0);
  }

  update(transforms) {
    worldPoint(transforms, this.bearingBody, this.bearingCentre, this.pivot, this.swivel.quaternion);
    worldPoint(transforms, this.stemBody, this.stemTop, this.endPoint, this.rotation);
    this.root.position.y = this.pivot.y;
    this.carriage.position.x = this.pivot.x - this.root.position.x;
    this.swivel.position.z = this.pivot.z - this.root.position.z;
    this.root.visible = true;

    // Draw only the exposed sections plus the overlap inside each guide.
    this.axis.set(0, 0, 1).applyQuaternion(this.swivel.quaternion);
    const end = Math.min(GUIDE_Z, this.endPoint.sub(this.pivot).dot(this.axis));
    const seam = (GUIDE_Z + end) / 2;
    this.sleeve.position.z = (GUIDE_Z + OVERLAP + seam) / 2;
    this.sleeve.scale.z = GUIDE_Z + OVERLAP - seam;
    this.wiper.position.z = seam;
    this.rod.position.z = (seam + OVERLAP + end) / 2;
    this.rod.scale.z = seam + OVERLAP - end;
    this.wiper.visible = GUIDE_Z - seam > this.wiper.scale.z;
  }

  dispose() {
    this.root.removeFromParent();
    this.box.dispose();
    this.tube.dispose();
    this.finishes.forEach(material => material.dispose());
  }
}
