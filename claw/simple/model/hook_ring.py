"""Hanging ring and tip-up prize shelf for the hook game."""
import math
import xml.etree.ElementTree as ET

from model_author import model_xml as cabinet_xml


def segment(body, name, start, end, radius, color, mass):
    return ET.SubElement(body, 'geom', name=name, type='capsule',
                         fromto=' '.join(f'{v:.7f}' for v in (*start, *end)),
                         size=str(radius), rgba=color, mass=str(mass),
                         friction='.36 .002 .0001', condim='3', solref='.008 1')


def hang_ring(head, scale):
    parent = head
    link_length = .030
    for i in range(3):
        link = ET.SubElement(parent, 'body', name=f'ring_link_{i}',
                             pos=f'0 0 {-0.048 * scale if i == 0 else -link_length}')
        ET.SubElement(link, 'joint', type='ball', limited='false', damping='.00035', armature='.000015')
        segment(link, f'chain_{i}', (0, 0, 0), (0, 0, -link_length),
                .0026, '.30 .34 .40 1', .009)
        parent = link
    ring = ET.SubElement(parent, 'body', name='hanging_ring', pos=f'0 0 {-link_length}')
    ET.SubElement(ring, 'joint', type='ball', limited='false', damping='.0002', armature='.000012')
    radius, count = .037, 24
    # An open centre is essential. Each short capsule is a real contact surface.
    points = [(radius * math.sin(2*math.pi*i/count), 0,
               radius * (math.cos(2*math.pi*i/count) - 1)) for i in range(count)]
    for i, start in enumerate(points):
        segment(ring, f'ring_arc_{i}', start, points[(i+1) % count],
                .0038, '.95 .46 .09 1', .072/count)


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
    # The orange ring hangs in XZ. The curved hook crosses that plane in YZ,
    # leaving a downward-facing opening that the ring can slip under.
    x = .092
    profile = [(.183, .005), (.183, .081), (.180, .095), (.172, .106),
               (.160, .112), (.147, .112), (.136, .105), (.128, .090), (.123, .082)]
    for i, ((y, z), (ny, nz)) in enumerate(zip(profile, profile[1:])):
        segment(shelf, f'prize_hook_{i}', (x, y, z), (x, ny, nz),
                .005, '.31 .25 .54 1', .004)
    prize.set('pos', f'-.095 -.043 {hinge_z + .005 + config.box_height/2 + .001}')


def model_xml(config):
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
    hang_ring(head, config.claw_scale)
    add_shelf(world, world.find("body[@name='prize']"), config)
    return ET.tostring(root, encoding='unicode')
