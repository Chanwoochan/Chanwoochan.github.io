"""Four-bar bridge catcher. Only MuJoCo contact forces move the prize."""
from __future__ import annotations
from dataclasses import asdict, dataclass
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from appearance import decorate_scene

@dataclass
class Config:
    gap: float = 0.12
    gap_12: float = 0.08
    gap_34: float = 0.08
    rod_radius: float = 0.009
    inner_height: float = 0.22
    outer_height: float = 0.26
    box_width: float = 0.18
    box_length: float = 0.25
    box_height: float = 0.1
    box_mass: float = 0.35
    box_contact_timeconst: float = 0.015
    box_contact_width: float = 0.002
    com_x: float = 0.0
    com_y: float = -0.01
    tip_friction: float = 0.3
    arm_friction: float = 0.2
    rail_friction: float = 0.35
    inner_rail_friction: float = 2.0
    grip_torque: float = 0.6
    grip_kp: float = 1.3
    z_force_limit: float = 40.0
    head_stiffness: float = 15.0
    head_damping: float = 1.0
    head_limit_deg: float = 8.0
    claw_scale: float = 1.0
    timestep: float = 0.00025
    rod_bending_rigidity: float = 5.0
    rod_bending_damping: float = 0.02
    rod_tension: float = 2000.0
    rod_axial_rigidity: float = 60000.0
    rod_axial_damping: float = 5.0

    @property
    def chute_half_y(self):
        return 0.247

    def validate(self):
        bounds = {'gap_12': (0.02, 0.35), 'gap_34': (0.02, 0.35), 'rod_radius': (0.004, 0.02), 'box_mass': (0.05, 2), 'box_contact_timeconst': (0.004, 0.1), 'box_contact_width': (0.0001, 0.01), 'tip_friction': (0, 2), 'arm_friction': (0, 2), 'rail_friction': (0, 2), 'inner_rail_friction': (0, 5), 'grip_torque': (0.005, 0.8), 'grip_kp': (0, 100), 'timestep': (0.00025, 0.002), 'z_force_limit': (20, 150), 'head_stiffness': (0, 30), 'head_damping': (0, 3), 'head_limit_deg': (1, 25), 'claw_scale': (0.65, 1.1), 'rod_bending_rigidity': (0.0, 5.0), 'rod_bending_damping': (0.0, 0.02), 'rod_tension': (0.0, 2000.0), 'rod_axial_rigidity': (1.0, 60000.0), 'rod_axial_damping': (0.0, 5.0)}
        for name, (lo, hi) in bounds.items():
            value = getattr(self, name)
            if not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError(f'{name} must be between {lo} and {hi}')
        if not math.isfinite(self.gap) or self.gap <= 0:
            raise ValueError('2·3번 봉 간격은 0보다 큰 유한한 값이어야 합니다. 최대 제한은 없습니다.')
        for name, label in [('box_width', '가로'), ('box_length', '세로'), ('box_height', '높이')]:
            if not math.isfinite(getattr(self, name)) or getattr(self, name) <= 0:
                raise ValueError(f'박스 {label}는 0보다 큰 유한한 값이어야 합니다.')
        if not all(map(math.isfinite, [self.com_x, self.com_y])) or abs(self.com_x) > self.box_width * 0.4 or abs(self.com_y) > self.box_length * 0.4:
            raise ValueError('Centre of mass must stay inside the box (80% of its width/length).')
        if not all(map(math.isfinite, [self.inner_height, self.outer_height])):
            raise ValueError('봉 높이는 유한한 숫자로 입력해 주세요.')
        if self.rod_tension >= self.rod_axial_rigidity:
            raise ValueError('봉의 초기 장력은 인장 강성보다 작아야 합니다.')

def scale_claw_xml(xml: str, scale: float) -> str:
    """Scale actual collision geometry and mass, preserving carriage travel."""
    root = ET.fromstring(xml)
    gantry = root.find("./worldbody/body[@name='gantry']")
    head = gantry.find("./body[@name='claw_head']")
    for element in head.iter():
        for attribute in ('pos', 'size', 'fromto'):
            if attribute in element.attrib:
                element.set(attribute, ' '.join((f'{float(x) * scale:.12g}' for x in element.get(attribute).split())))
        if 'mass' in element.attrib:
            element.set('mass', f"{float(element.get('mass')) * scale ** 3:.12g}")
        if 'diaginertia' in element.attrib:
            element.set('diaginertia', ' '.join((f'{float(x) * scale ** 5:.12g}' for x in element.get('diaginertia').split())))
    for element in (gantry.find('inertial'), gantry.find("./geom[@name='head_mount']")):
        if element is not None:
            element.set('pos', f'0 0 {0.19 * scale:.12g}')
            if element.tag == 'geom':
                element.set('size', f'{0.024 * scale:.12g}')
    return ET.tostring(root, encoding='unicode')

def model_xml(c: Config) -> str:
    c.validate()
    inner_y = c.gap / 2 + c.rod_radius
    front_y = -inner_y - c.gap_12 - 2 * c.rod_radius
    back_y = inner_y + c.gap_34 + 2 * c.rod_radius
    outer_extent = max(abs(front_y), abs(back_y))
    hole_half_y = c.chute_half_y
    tray_half_y = 0.415
    tray_bank_half_y = (tray_half_y - hole_half_y) / 2
    tray_bank_y = (tray_half_y + hole_half_y) / 2
    frame_half_y = 0.415
    z0 = c.inner_height + c.rod_radius + c.box_height / 2 + 0.001
    ix = c.box_mass * (c.box_length ** 2 + c.box_height ** 2) / 12
    iy = c.box_mass * (c.box_width ** 2 + c.box_height ** 2) / 12
    iz = c.box_mass * (c.box_width ** 2 + c.box_length ** 2) / 12
    rods = []
    pairs = []
    for i, (y, z) in enumerate([(front_y, c.outer_height), (-inner_y, c.inner_height), (inner_y, c.inner_height), (back_y, c.outer_height)], 1):
        coated = i in (2, 3)
        mu = c.inner_rail_friction if coated else c.rail_friction
        material = 'silicone' if coated else 'steel'
        rods.append(f'<geom name="rod_{i}" type="cylinder" fromto="-.375 {y} {z} .375 {y} {z}" size="{c.rod_radius}" material="{material}" friction="{mu} 0 0"/>')
        pairs.append(f'<pair geom1="prize_geom" geom2="rod_{i}" condim="3" friction="{mu} {mu} 0 0 0"/>')
    fingers = []
    for side, sign in [('left', -1), ('right', 1)]:
        dx, dz = (-sign * 0.152, -0.17)
        length = math.hypot(dx, dz)
        angle = math.atan2(dx, dz)
        quat = f'{math.cos(angle / 2)} 0 {math.sin(angle / 2)} 0'
        lower_length = length - 0.018
        middle_x = sign * 0.104 + dx / length * lower_length / 2
        middle_z = -0.095 + dz / length * lower_length / 2
        tip_x, tip_z = (-sign * 0.048, -0.265)
        lower_end_x = sign * 0.104 + dx / length * lower_length
        lower_end_z = -0.095 + dz / length * lower_length
        neck_z = (lower_end_z + tip_z) / 2
        neck_half_height = (lower_end_z - tip_z) / 2 + 0.00075
        tip_bridge_x = (lower_end_x + tip_x) / 2
        tip_bridge_half_x = abs(lower_end_x - tip_x) / 2 + 0.001
        fingers.append(f'\n        <body name="{side}_finger" pos="{sign * 0.066} 0 -.035">\n          <joint name="{side}_hinge" type="hinge" axis="0 {-sign} 0" range="0 .80" damping=".008" armature=".00008"/>\n          <geom name="{side}_upper_front" type="capsule" fromto="0 -.005 0 {sign * 0.104} -.005 -.095" size=".0025" mass=".010" material="steel"/>\n          <geom name="{side}_upper_back" type="capsule" fromto="0 .005 0 {sign * 0.104} .005 -.095" size=".0025" mass=".010" material="steel"/>\n          <geom name="{side}_elbow" type="sphere" pos="{sign * 0.104} 0 -.095" size=".005" mass=".004" material="steel"/>\n          <geom name="{side}_lower" type="box" pos="{middle_x} 0 {middle_z}" quat="{quat}" size=".006 .0075 {lower_length / 2}" mass=".03375" material="acrylic"/>\n          <!-- Bent metal neck and a thin circular plate. At zero shoulder\n               angle the disk is horizontal and points inward under the box. -->\n          <geom name="{side}_tip_neck" type="box" pos="{lower_end_x} 0 {neck_z}" size=".0018 .0075 {neck_half_height}" mass=".001875" material="steel"/>\n          <geom name="{side}_tip_bridge" type="box" pos="{tip_bridge_x} 0 {tip_z}" size="{tip_bridge_half_x} .0075 .00075" mass=".0024375" material="steel"/>\n          <geom name="{side}_tip" type="cylinder" pos="{tip_x} 0 {tip_z}" size=".0075 .00075" mass=".002109375" material="steel"/>\n        </body>')
        for part in ['upper_front', 'upper_back', 'elbow', 'lower', 'tip_neck', 'tip_bridge', 'tip']:
            mu = c.tip_friction if part in ('tip', 'tip_neck', 'tip_bridge') else c.arm_friction
            pairs.append(f'<pair name="{side}_{part}_contact" geom1="prize_geom" geom2="{side}_{part}" condim="3" friction="{mu} {mu} 0 0 0"/>')
    xml = f'''<mujoco model="UFO catcher DUMMY / real-size UFO10 cabinet">\n  <compiler angle="radian" autolimits="true"/>\n  <option timestep="{c.timestep}" gravity="0 0 -9.81" integrator="implicitfast" solver="Newton" cone="elliptic" iterations="100" tolerance="1e-10" impratio="5"/>\n  <size nconmax="300" njmax="1500"/>\n  <statistic center="0 0 .38" extent="1.15"/>\n  <visual><global offwidth="1280" offheight="900"/><headlight ambient=".35 .35 .35" diffuse=".6 .6 .6"/><quality shadowsize="2048"/><rgba haze=".08 .10 .16 1"/></visual>\n  <default>\n    <joint limited="true"/>\n    <geom friction=".35 0 0" condim="3" solref=".006 1" solimp=".95 .99 .001" margin="0"/>\n    <pair solref="{c.box_contact_timeconst} 1" solimp=".90 .98 {c.box_contact_width}"/>\n    <default class="decor"><geom contype="0" conaffinity="0" group="2" mass="0"/></default>\n  </default>\n  <asset>\n    <texture name="floor_tex" type="2d" builtin="checker" rgb1=".11 .14 .20" rgb2=".14 .18 .25" width="128" height="128"/>\n    <material name="floor" texture="floor_tex" texrepeat="8 8" reflectance=".06"/>\n    <material name="steel" rgba=".68 .77 .87 1" specular=".8" shininess=".7"/>\n    <material name="silicone" rgba=".75 .83 .84 1" specular=".08" shininess=".05"/>\n    <material name="acrylic" rgba=".70 .88 .98 .42" specular=".8" shininess=".8"/>\n    <material name="carton" rgba=".91 .52 .17 1" specular=".1"/>\n    <material name="frame" rgba=".16 .23 .32 1"/>\n  </asset>\n  <worldbody>\n    <light pos="-.4 -.5 1.5" dir=".2 .3 -1" diffuse=".9 .88 .82"/>\n    <light pos=".6 .4 1.1" dir="-.4 -.2 -1" diffuse=".45 .60 .80" castshadow="false"/>\n    <camera name="overview" pos="1.02 -1.22 .96" xyaxes=".767 .642 0 -.257 .308 .916"/>\n    <camera name="front" pos="0 -1.4 .67" xyaxes="1 0 0 0 .20 .98"/>\n    <camera name="top" pos="0 0 1.55" xyaxes="1 0 0 0 1 0"/>\n    <geom name="floor" type="plane" pos="0 0 -.72" size="2 2 .1" material="floor"/>\n    <!-- Four physical banks leave the central prize chute genuinely open. -->\n    <geom name="tray_front" type="box" pos="0 {-tray_bank_y} .04" size=".375 {tray_bank_half_y} .025" rgba=".91 .93 .95 1"/>\n    <geom name="tray_back" type="box" pos="0 {tray_bank_y} .04" size=".375 {tray_bank_half_y} .025" rgba=".91 .93 .95 1"/>\n    <geom name="tray_left" type="box" pos="-.355 0 .04" size=".020 {hole_half_y} .025" rgba=".91 .93 .95 1"/>\n    <geom name="tray_right" type="box" pos=".355 0 .04" size=".020 {hole_half_y} .025" rgba=".91 .93 .95 1"/>\n    <geom name="chute_bottom" type="box" pos="0 0 -.62" size=".375 {tray_half_y} .025" rgba=".22 .26 .30 1"/>\n    <geom class="decor" type="box" pos="-.47 0 .22" size=".018 {frame_half_y} .22" material="frame"/>\n    <geom class="decor" type="box" pos=".47 0 .22" size=".018 {frame_half_y} .22" material="frame"/>\n    {''.join(rods)}\n    <body name="gantry" pos="0 0 .80" gravcomp="1">\n      <joint name="gantry_x" type="slide" axis="1 0 0" range="-.24 .24" damping="4"/>\n      <joint name="gantry_y" type="slide" axis="0 1 0" range="-0.345 .27" damping="4"/>\n      <joint name="gantry_z" type="slide" axis="0 0 1" range="-.60 .18" damping="6"/>\n      <joint name="gantry_yaw" type="hinge" axis="0 0 1" range="-3.142 3.142" damping=".2"/>\n      <inertial pos="0 0 .19" mass=".25" diaginertia=".001 .001 .001"/>\n      <geom name="head_mount" class="decor" type="sphere" pos="0 0 .19" size=".024" rgba=".16 .40 .49 1"/>\n      <body name="claw_head">\n      <!-- All head/shaft/arm geometry hangs from the shaft's top endpoint.\n           The ball joint is passive: spring, damping and limits only. -->\n      <joint name="head_pivot" type="ball" pos="0 0 .19" range="0 {math.radians(c.head_limit_deg)}" stiffness="{c.head_stiffness}" damping="{c.head_damping}" armature=".0001"/>\n      <geom name="housing" type="ellipsoid" size=".112 .070 .045" mass="1.4" rgba=".79 .82 .86 1"/>\n      <geom class="decor" type="ellipsoid" pos="0 -.057 0" size=".083 .016 .030" rgba=".19 .25 .31 1"/>\n      <geom class="decor" type="sphere" pos="-.032 -.071 .004" size=".007" rgba=".95 .28 .43 1"/>\n      <geom class="decor" type="sphere" pos="0 -.073 .004" size=".007" rgba=".98 .78 .16 1"/>\n      <geom class="decor" type="sphere" pos=".032 -.071 .004" size=".007" rgba=".18 .69 .91 1"/>\n      <geom name="head_shaft" type="cylinder" pos="0 0 .115" size=".018 .075" mass=".12" material="steel"/>\n      {''.join(fingers)}\n      </body>\n    </body>\n    <body name="prize" pos="0 0 {z0}">\n      <freejoint name="prize_free"/>\n      <inertial pos="{c.com_x} {c.com_y} 0" mass="{c.box_mass}" diaginertia="{ix} {iy} {iz}"/>\n      <geom name="prize_geom" type="box" size="{c.box_width / 2} {c.box_length / 2} {c.box_height / 2}" material="carton" priority="1" solref="{c.box_contact_timeconst} 1" solimp=".90 .98 {c.box_contact_width}"/>\n      <geom class="decor" type="box" pos="0 0 {c.box_height / 2 + 0.0003}" size="{c.box_width / 2 * 0.9} {c.box_length / 2 * 0.9} .0003" rgba=".96 .78 .38 1"/>\n      <geom class="decor" type="box" pos="0 0 {c.box_height / 2 + 0.0009}" size=".009 {c.box_length / 2 * 0.98} .0003" rgba=".98 .90 .66 1"/>\n      <site name="centre_of_mass" pos="{c.com_x} {c.com_y} 0" size=".005" rgba="1 .15 .15 .7" group="3"/>\n    </body>\n  </worldbody>\n  <contact>{''.join(pairs)}</contact>\n  <actuator>\n    <position name="x_motor" joint="gantry_x" kp="5000" kv="100" ctrlrange="-.24 .24" forcerange="-100 100"/>\n    <position name="y_motor" joint="gantry_y" kp="5000" kv="100" ctrlrange="-0.345 .27" forcerange="-100 100"/>\n    <position name="z_motor" joint="gantry_z" kp="12000" kv="180" ctrlrange="-.60 .18" forcerange="-{c.z_force_limit} {c.z_force_limit}"/>\n    <position name="yaw_motor" joint="gantry_yaw" kp="25" kv="2" ctrlrange="-3.142 3.142" forcerange="-2 2"/>\n    <position name="left_motor" joint="left_hinge" kp="{c.grip_kp}" kv=".16" ctrlrange="0 .80" forcerange="-{c.grip_torque} {c.grip_torque}"/>\n    <position name="right_motor" joint="right_hinge" kp="{c.grip_kp}" kv=".16" ctrlrange="0 .80" forcerange="-{c.grip_torque} {c.grip_torque}"/>\n  </actuator>\n</mujoco>'''
    return decorate_scene(scale_claw_xml(xml, c.claw_scale), c)