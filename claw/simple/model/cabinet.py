"""Fixed-size UFO10 envelope and native glass contacts for the DUMMY edition.

Published exterior: W1685 x D1050 x H1998 mm, including the control deck.
Window thickness and internal fittings are drawing-based approximations.
The original claw and moving parcel are never rescaled to fit the cabinet.
"""
from copy import deepcopy
import xml.etree.ElementTree as ET

WIDTH = 1.685
DEPTH = 1.050
HEIGHT = 1.998
BAY_PITCH = WIDTH / 2
GROUND_Z = -.720
ROOF_Z = GROUND_Z + HEIGHT
BODY_HALF_DEPTH = .435
DECK_FRONT_Y = BODY_HALF_DEPTH - DEPTH
CHUTE_HALF_X = .335
CHUTE_HALF_Y = .320
GLASS_THICKNESS = .006


def decorate_cabinet(root, config, geom, box, face, quad):
    world = root.find('worldbody')
    assets = root.find('asset')
    gantry = world.find("body[@name='gantry']")
    head = gantry.find("body[@name='claw_head']")
    prize = world.find("body[@name='prize']")
    left = -BAY_PITCH / 2
    right = left + WIDTH
    centre = BAY_PITCH / 2
    front, back = -BODY_HALF_DEPTH, BODY_HALF_DEPTH

    def material(name, rgba, **attrs):
        ET.SubElement(assets, 'material', name=name, rgba=rgba, **attrs)

    def solid(name, pos, size, material_name='ufo_glass'):
        # These geoms deliberately do not inherit the non-colliding decor class.
        return ET.SubElement(world, 'geom', name=name, type='box', pos=pos, size=size,
            material=material_name, contype='1', conaffinity='1', condim='3',
            friction='.20 .005 .0001', mass='0',
            solref=f'{config.box_contact_timeconst} 1',
            solimp=f'.90 .98 {config.box_contact_width}')

    for old in list(world.findall('geom')):
        if old.get('material') == 'frame':
            world.remove(old)
    world.find("geom[@name='floor']").set('rgba', '0 0 0 0')
    for old in world.findall('geom'):
        if old.get('name', '').startswith('tray_'):
            old.set('rgba', '.94 .95 .96 1')
    geom(world, 'arcade_floor', kind='plane', pos=f'0 0 {GROUND_Z}', size='5 5 .1', material='floor')
    material('showcase_light', '.94 .98 1 1', emission='.75')

    # The extremal cabinet faces are exactly W1685 x D1050 x H1998 mm.
    # Its deck projects 180 mm in front of the 870 mm-deep body.
    for i, x in enumerate((left + .014, centre, right - .014)):
        box(world, f'base_side_{i}', f'{x} 0 -.331', '.014 .435 .331')
    box(world, 'base_back', f'{centre} {back-.010} -.331', f'{WIDTH/2} .010 .331')
    box(world, 'base_bottom', f'{centre} 0 -.670', f'{WIDTH/2} .435 .010')
    box(world, 'front_base_upper', f'{centre} {front+.012} .013', f'{WIDTH/2} .012 .048')
    box(world, 'front_base_lower', f'{centre} {front+.012} -.627', f'{WIDTH/2} .012 .035')
    for i, x in enumerate((left + .016, centre, right - .016)):
        for label, y in (('front', front+.018), ('back', back-.018)):
            box(world, f'post_{label}_{i}', f'{x} {y} .631', '.016 .018 .571')
    # Physical roof and four external glass faces, plus the middle bay divider.
    solid('cabinet_roof', f'{centre} 0 {ROOF_Z-.028}', f'{WIDTH/2} .435 .028', 'ufo_white')
    half_t = GLASS_THICKNESS / 2
    z_min, z_max = .060, 1.222
    z_mid, z_half = (z_min+z_max)/2, (z_max-z_min)/2
    solid('glass_front', f'{centre} {front+.010} {z_mid}', f'{WIDTH/2-.014} {half_t} {z_half}')
    solid('glass_back', f'{centre} {back-.010} {z_mid}', f'{WIDTH/2-.014} {half_t} {z_half}')
    solid('glass_left', f'{left+.010} 0 {z_mid}', f'{half_t} .425 {z_half}')
    solid('glass_right', f'{right-.010} 0 {z_mid}', f'{half_t} .425 {z_half}')
    solid('glass_bay_divider', f'{centre} 0 {z_mid}', f'{half_t} .425 {z_half}')
    box(world, 'front_upper_rail', f'{centre} {front+.008} 1.207', f'{WIDTH/2} .008 .015', 'ufo_chrome')
    box(world, 'front_lower_rail', f'{centre} {front+.010} .068', f'{WIDTH/2} .010 .010', 'ufo_pearl')
    face(world, 'cabinet_title', centre, front-.0003, ROOF_Z-.028, 1.50, .043, 'marquee')

    for bay, x in enumerate((0., BAY_PITCH)):
        # The deck's front face is the D1050 extremum, not a scaled physics field.
        box(world, f'deck_{bay}', f'{x} {(front+DECK_FRONT_Y)/2} .092', f'{BAY_PITCH/2-.018} {(front-DECK_FRONT_Y)/2} .025', 'ufo_pearl')
        face(world, f'deck_screen_{bay}', x+.135, DECK_FRONT_Y-.0001, .094, .215, .052, 'touchscreen')
        for j in range(2):
            bx = x-.275+j*.105
            geom(world, f'button_base_{bay}_{j}', kind='cylinder', pos=f'{bx} {front-.075} .122', size='.030 .005', material='ufo_dark')
            geom(world, f'button_{bay}_{j}', kind='cylinder', pos=f'{bx} {front-.075} .129', size='.025 .004', material='ufo_white')
        # A real hollow chute remains open below the bars.
        for sign in (-1, 1):
            box(world, f'prize_out_post_{bay}_{sign}', f'{x+sign*.355} {front+.014} -.322', '.025 .014 .264')
            geom(world, f'caster_{bay}_{sign}', kind='cylinder', pos=f'{x+sign*.30} {front+.065} {GROUND_Z+.025}',
                 quat='.70710678 .70710678 0 0', size='.025 .015', material='ufo_dark')
        box(world, f'outlet_label_back_{bay}', f'{x} {front+.030} -.325', '.325 .005 .220', 'ufo_dark')
        face(world, f'outlet_label_{bay}', x, front+.024, -.325, .60, .34, 'prize_out')
        box(world, f'track_{bay}', f'{x} 0 1.194', '.365 .370 .012', 'ufo_pearl')
        for sign in (-1, 1):
            geom(world, f'ceiling_rail_{bay}_{sign}', kind='cylinder',
                 fromto=f'{x+sign*.335} -.38 1.174 {x+sign*.335} .38 1.174', size='.006', material='steel')
        box(world, f'white_light_{bay}', f'{x} {back-.025} 1.150', '.350 .006 .006', 'showcase_light')

        # All showcase objects are plain DUMMY boxes; no robot sculptures/posters.
        showcase = ET.SubElement(world, 'body', name=f'dummy_showcase_{bay}', pos=f'{x} 0 0')
        box(showcase, f'showcase_back_{bay}', '0 .408 .750', '.355 .006 .285')
        for level, shelf_z in enumerate((.460, .775)):
            box(showcase, f'shelf_{bay}_{level}', f'0 .355 {shelf_z-.005}', '.355 .055 .005')
            box(showcase, f'shelf_lip_{bay}_{level}', f'0 .300 {shelf_z-.008}', '.355 .003 .008', 'ufo_chrome')
            for j, bx in enumerate((-.235, 0., .235)):
                dummy = ET.SubElement(showcase, 'body', name=f'dummy_box_{bay}_{level}_{j}', pos=f'{bx} .355 {shelf_z+.098}')
                box(dummy, f'dummy_body_{bay}_{level}_{j}', '0 0 0', '.050 .027 .098', 'ufo_white')
                label = f'dummy_print_{bay}_{level}_{j}'
                face(dummy, label+'_front', 0, -.0273, 0, .100, .196, 'package_front')
                quad(dummy, label+'_right', [(.0503,-.027,-.098),(.0503,.027,-.098),(.0503,.027,.098),(.0503,-.027,.098)], 'package_long')
                quad(dummy, label+'_left', [(-.0503,.027,-.098),(-.0503,-.027,-.098),(-.0503,-.027,.098),(-.0503,.027,.098)], 'package_long')
                quad(dummy, label+'_top', [(-.05,-.027,.0983),(.05,-.027,.0983),(.05,.027,.0983),(-.05,.027,.0983)], 'package_short')
        ET.SubElement(world, 'light', name=f'showcase_light_{bay}', pos=f'{x} .30 1.13', dir='0 .1 -1', diffuse='.3 .3 .3', castshadow='false')

    # Fixed neighbouring booth, at the actual half-width bay pitch.
    display = ET.SubElement(world, 'body', name='display_station', pos=f'{BAY_PITCH} 0 0')
    for rod in range(1, 5):
        copied = deepcopy(world.find(f"geom[@name='rod_{rod}']"))
        copied.set('name', f'display_rod_{rod}'); copied.set('class', 'decor')
        copied.set('contype', '0'); copied.set('conaffinity', '0'); copied.set('mass', '0')
        display.append(copied)
    for name in ('tray_front', 'tray_back', 'tray_left', 'tray_right', 'chute_bottom'):
        copied = deepcopy(world.find(f"geom[@name='{name}']"))
        copied.set('name', 'display_'+name); copied.set('class', 'decor')
        copied.set('contype', '0'); copied.set('conaffinity', '0'); copied.set('mass', '0')
        display.append(copied)
    ghost = deepcopy(head); ghost.set('name', 'display_head'); ghost.set('pos', '0 0 .80')
    for element in ghost.iter():
        for child in list(element):
            if child.tag in ('joint', 'freejoint', 'inertial'):
                element.remove(child)
        if element is not ghost and element.get('name'):
            element.set('name', 'display_'+element.get('name'))
        if element.tag == 'geom':
            for key, value in {'class':'decor','contype':'0','conaffinity':'0','mass':'0'}.items():
                element.set(key, value)
    display.append(ghost)
    sample = deepcopy(prize); sample.set('name', 'display_parcel')
    for child in list(sample):
        if child.tag in ('freejoint', 'joint', 'inertial', 'site'):
            sample.remove(child)
        elif child.tag == 'geom':
            child.set('name', 'display_'+child.get('name', 'parcel'))
            for key, value in {'class':'decor','contype':'0','conaffinity':'0','mass':'0'}.items():
                child.set(key, value)
    display.append(sample)
    root.find('statistic').set('center', f'{centre} 0 {(GROUND_Z+ROOF_Z)/2}')
    root.find('statistic').set('extent', '2.2')
