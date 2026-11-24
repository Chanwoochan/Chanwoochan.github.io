"""Hanging ring and tip-up prize shelf for the hook game."""
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from cycle_settings import CycleSettings as BridgeCycleSettings
from model_author import Config as BridgeConfig, model_xml as cabinet_xml


@dataclass
class Config(BridgeConfig):
    hook_height: float = .112
    ring_width: float = .0816
    chain_length: float = .090
    hook_type: int = 0
    ring_type: int = 0

    def validate(self):
        super().validate()
        for label, value, lo, hi in (
            ('후크 높이', self.hook_height, .020, .220),
            ('링 바깥 너비', self.ring_width, .020, .200),
            ('줄 길이', self.chain_length, .010, .400),
        ):
            if not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError(f'{label}: {lo*1000:g} ~ {hi*1000:g} mm')
        if self.hook_type not in (0, 1, 2) or self.ring_type not in (0, 1, 2):
            raise ValueError('후크와 링 종류를 목록에서 선택해 주세요.')


@dataclass
class CycleSettings(BridgeCycleSettings):
    bottom_wait: float = 0.

    def validate(self):
        super().validate()
        if not math.isfinite(self.bottom_wait) or self.bottom_wait < 0:
            raise ValueError('하강 후 대기 시간은 0초 이상이어야 합니다.')


def segment(body, name, start, end, radius, color, mass):
    return ET.SubElement(body, 'geom', name=name, type='capsule',
                         fromto=' '.join(f'{v:.7f}' for v in (*start, *end)),
                         size=str(radius), rgba=color, mass=str(mass),
                         friction='.36 .002 .0001', condim='3', solref='.008 1')


# Continuous wire from the mounted stem to the free lip of a question mark.
# Its centreline has unit width and height. The two mounts use opposite ends up.
QUESTION_PROFILE = (
    (0, 0), (0, .25), (.02, .33), (.09, .40), (.23, .47), (.36, .53),
    (.45, .60), (.50, .69), (.50, .77), (.46, .85), (.39, .92),
    (.27, .97), (.14, 1), (0, 1), (-.16, .98), (-.30, .94),
    (-.41, .87), (-.48, .79), (-.50, .70),
)


def hanging_outline(kind):
    if kind == 2:
        return [(-2*x, -2.7*z) for x, z in QUESTION_PROFILE]
    circle = [(math.sin(i*math.tau/24), math.cos(i*math.tau/24)-1) for i in range(24)]
    if kind == 1:
        circle = [(x, 1.4*z) for x, z in circle]
    return circle + circle[:1]


def hang_ring(head, config):
    parent = head
    link_count = math.ceil(config.chain_length / .035)
    link_length = config.chain_length / link_count
    for i in range(link_count):
        link = ET.SubElement(parent, 'body', name=f'ring_link_{i}',
                             pos=f'0 0 {-0.048 * config.claw_scale if i == 0 else -link_length}')
        ET.SubElement(link, 'joint', type='ball', limited='false', damping='.00035', armature='.000015')
        segment(link, f'chain_{i}', (0, 0, 0), (0, 0, -link_length),
                .0026, '.30 .34 .40 1', .30*link_length)
        parent = link
    ring = ET.SubElement(parent, 'body', name='hanging_ring', pos=f'0 0 {-link_length}')
    ET.SubElement(ring, 'joint', type='ball', limited='false', damping='.0002', armature='.000012')
    scale = config.ring_width / .0816
    wire_radius = .0038 * scale
    radius = config.ring_width/2 - wire_radius
    points = [(radius*x, 0, radius*z) for x, z in hanging_outline(config.ring_type)]
    reference_perimeter = 48 * .037 * math.sin(math.pi/24)
    mass_per_metre = .072 / reference_perimeter * scale**2
    for i, (start, end) in enumerate(zip(points, points[1:])):
        segment(ring, f'ring_arc_{i}', start, end, wire_radius,
                '.95 .46 .09 1', mass_per_metre * math.dist(start, end))


def shelf_outline(kind):
    if kind == 1:
        return [(0, .072*x, .107*z) for x, z in QUESTION_PROFILE]
    return [(0, 0, 0), (0, 0, .076), (0, -.003, .090), (0, -.011, .101),
            (0, -.023, .107), (0, -.036, .107), (0, -.047, .100),
            (0, -.055, .085), (0, -.060, .077)]


def add_d_ring(shelf, height):
    foot_thickness = .032 * height
    band_half_width = .065 * height
    band_half_thickness = .016 * height
    outer_radius = height - foot_thickness
    foot_half_length = outer_radius + band_half_thickness
    # Keep both ends on the tray, including at the largest allowed size.
    center_x = min(.092, .265 - foot_half_length)
    mount = ET.SubElement(shelf, 'body', name='shelf_d_ring',
                          pos=f'{center_x} .217 .005')
    plastic = dict(type='box', rgba='.83 .075 .055 1', density='1150',
                   friction='.36 .002 .0001', condim='3', solref='.008 1')
    ET.SubElement(mount, 'geom', name='d_ring_foot', pos=f'0 0 {foot_thickness/2}',
                  size=f'{foot_half_length} {band_half_width} {foot_thickness/2}', **plastic)

    # Short tangent boxes form the curved strip. Outer corners meet and inner
    # corners overlap slightly, leaving a continuous rim and an open aperture.
    count = 32
    half_step = math.pi / (2 * count)
    outer_apothem = outer_radius * math.cos(half_step)
    center_radius = outer_apothem - band_half_thickness
    half_length = outer_radius * math.sin(half_step)
    for i in range(count):
        angle = (2*i + 1)*half_step
        x = center_radius * math.cos(angle)
        z = foot_thickness + center_radius * math.sin(angle)
        ET.SubElement(mount, 'geom', name=f'd_ring_band_{i}', pos=f'{x} 0 {z}',
                      euler=f'0 {math.pi/2 - angle} 0',
                      size=f'{half_length} {band_half_width} {band_half_thickness}', **plastic)

    for i, sign in enumerate((-1, 1)):
        cap_half_height = .005*height
        ET.SubElement(mount, 'geom', name=f'd_ring_fastener_{i}', type='cylinder',
                      pos=f'{sign*.78*outer_radius} 0 {foot_thickness + cap_half_height}',
                      size=f'{.025*height} {cap_half_height}', material='steel',
                      density='7850', friction='.36 .002 .0001', solref='.008 1')


def add_hooks(shelf, config):
    if config.hook_type == 2:
        add_d_ring(shelf, config.hook_height)
        return
    scale = config.hook_height / .112
    points = [(.092 + x*scale, .183 + y*scale, .005 + z*scale)
              for x, y, z in shelf_outline(config.hook_type)]
    basic = shelf_outline(0)
    mass_per_metre = .032 * scale**2 / sum(math.dist(a, b) for a, b in zip(basic, basic[1:]))
    for i, (start, end) in enumerate(zip(points, points[1:])):
        mass = .004 * scale**3 if config.hook_type == 0 else mass_per_metre * math.dist(start, end)
        segment(shelf, f'prize_hook_0_{i}', start, end, .005*scale, '.31 .25 .54 1', mass)


def add_shelf(world, prize, config):
    hinge_y, hinge_z = -.165, .210
    shelf = ET.SubElement(world, 'body', name='hook_shelf', pos=f'0 {hinge_y} {hinge_z}')
    ET.SubElement(shelf, 'joint', name='shelf_hinge', type='hinge', axis='1 0 0',
                  limited='true', range=f'0 {math.radians(72)}', damping='.022',
                  armature='.0005', solreflimit='.005 1')
    ET.SubElement(shelf, 'geom', name='tilting_plate', type='box', pos='0 .123 0',
                  size='.265 .133 .005', rgba='.62 .78 .78 1', mass='.22',
                  priority='2', friction='.22 .002 .0001', solref='.008 1')
    for sign in (-1, 1):
        ET.SubElement(world, 'geom', name=f'tray_bracket_{sign}', type='box',
                      pos=f'{sign*.332} {hinge_y} .173', size='.014 .018 .041',
                      material='ufo_pearl', mass='0')
    # The stationary axle passes through the hinge. It cannot collide with the
    # rotating plate or hold up a falling prize in the chute.
    axle = segment(world, 'tray_axle', (-.342, hinge_y, hinge_z), (.342, hinge_y, hinge_z),
                   .006, '.33 .39 .44 1', 0)
    axle.attrib.update(contype='0', conaffinity='0')
    add_hooks(shelf, config)
    prize.set('pos', f'-.095 -.043 {hinge_z + .005 + config.box_height/2 + .001}')


def model_xml(config):
    if not isinstance(config, Config):
        config = Config(**vars(config))
    root = ET.fromstring(cabinet_xml(config))
    world = root.find('worldbody')
    head = world.find(".//body[@name='claw_head']")
    contacts, actuators = root.find('contact'), root.find('actuator')
    for side in ('left', 'right'):
        head.remove(head.find(f"body[@name='{side}_finger']"))
        actuators.remove(actuators.find(f"position[@name='{side}_motor']"))
    for pair in contacts.findall('pair'):
        if pair.get('geom2', '').startswith(('left_', 'right_')):
            contacts.remove(pair)
    world.remove(world.find("body[@name='bridge_rods']"))
    root.remove(root.find('deformable'))
    tendon = root.find('tendon')
    for spring in tendon.findall('spatial'):
        if any(s.get('site', '').startswith('rod_') for s in spring.findall('site')):
            tendon.remove(spring)
    hang_ring(head, config)
    add_shelf(world, world.find("body[@name='prize']"), config)
    return ET.tostring(root, encoding='unicode')
