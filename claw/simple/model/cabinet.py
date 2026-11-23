"""Fixed-size UFO10 envelope and native glass contacts for the DUMMY edition.

Published exterior: W1685 x D1050 x H1998 mm, including the control deck.
Window thickness and internal fittings are drawing-based approximations.
The original claw and moving parcel are never rescaled to fit the cabinet.
"""
from copy import deepcopy
import math
import xml.etree.ElementTree as ET

WIDTH = 1.685
DEPTH = 1.050
HEIGHT = 1.998
BAY_PITCH = WIDTH / 2
GROUND_Z = -.720
ROOF_Z = GROUND_Z + HEIGHT
BODY_HALF_DEPTH = .435
DECK_FRONT_Y = BODY_HALF_DEPTH - DEPTH
GLASS_THICKNESS = .006
FIELD_REAR_Y = .415
FIELD_FRONT_Y = -FIELD_REAR_Y
DISPLAY_DEPTH = .296
DISPLAY_FRONT_Y = round(FIELD_REAR_Y - DISPLAY_DEPTH, 3)
MOUTH_FRONT_Y = -.375
MOUTH_BACK_Y = DISPLAY_FRONT_Y
CHUTE_HALF_X = .335
CHUTE_HALF_Y = (MOUTH_BACK_Y - MOUTH_FRONT_Y) / 2
MOUTH_CENTER_Y = (MOUTH_FRONT_Y + MOUTH_BACK_Y) / 2
HOME_Y = -.330
GANTRY_MIN_Y = -.345


def configure_head_mount(root, gantry, head, config):
    # All three rotations share the scaled shaft-top pivot. Intrinsic Z-Y-X
    # makes the first hinge the head's yaw in the cabinet frame.
    old_pivot = head.find("joint[@name='head_pivot']")
    pivot = old_pivot.get('pos')
    head.remove(old_pivot)
    gantry.remove(gantry.find("joint[@name='gantry_yaw']"))
    yaw_limit = math.radians(5)
    yaw_range = f'{-yaw_limit} {yaw_limit}'
    ET.SubElement(head, 'joint', name='head_swivel_yaw', type='hinge', axis='0 0 1',
                  pos=pivot, limited='true', range=yaw_range, solreflimit='.004 1',
                  solimplimit='.99 .999 .001', armature='.0001')
    for name, axis in (('head_pitch', '0 1 0'), ('head_roll', '1 0 0')):
        ET.SubElement(head, 'joint', name=name, type='hinge', axis=axis, pos=pivot,
                      limited='false', stiffness=str(config.head_stiffness),
                      damping=str(config.head_damping), armature='.0001')
    motor = root.find("./actuator/position[@name='yaw_motor']")
    motor.attrib.update(joint='head_swivel_yaw', ctrlrange=yaw_range,
                        kp='36', kv='2.4', forcerange='-4 4')
    mount = gantry.find("geom[@name='head_mount']")
    gantry.remove(mount)
    mount.set('mass', str(.030 * config.claw_scale**3))
    head.append(mount)

    # Retain the circular tilt stop even when both pitch and roll are active.
    # The separation of two axial sites depends on total tilt, independent of yaw.
    pivot_z = float(pivot.split()[2])
    a = pivot_z / 2
    b = a + .001
    separation = math.hypot(b-a, 2*math.sqrt(a*b)*math.sin(math.radians(config.head_limit_deg)/2))
    tendon = ET.SubElement(root, 'tendon')
    stop = ET.SubElement(tendon, 'spatial', name='head_tilt_stop', limited='true',
                         range=f'0 {separation}', rgba='0 0 0 0', solreflimit='.004 1')
    for body, name, radius in ((gantry, 'tilt_anchor', a), (head, 'tilt_tip', b)):
        ET.SubElement(body, 'site', name=name, pos=f'0 0 {pivot_z-radius}', size='.001', rgba='0 0 0 0')
        ET.SubElement(stop, 'site', site=name)


def add_elastic_rod(bridge, deformable, tendons, rod, config):
    # Small-deflection string with bending stiffness. The intermediate nodes can
    # move sideways and vertically; the support nodes have no joint at all.
    segments = 10
    tension = 72.0          # N at the straight reference length
    axial_rigidity = 1500.0 # EA, N
    bending_rigidity = .12  # EI, N m^2
    line_mass = .20         # kg/m
    name = rod.get('name')
    left_x, y, z, right_x, _, _ = map(float, rod.get('fromto').split())
    dx = (right_x-left_x) / segments
    mass = line_mass * dx
    radius = float(rod.get('size'))
    nodes = []
    for i in range(segments + 1):
        node = f'{name}_node_{i}'
        body = ET.SubElement(bridge, 'body', name=node, pos=f'{left_x+i*dx} {y} {z}')
        if 0 < i < segments:
            for axis in ('0 1 0', '0 0 1'):
                ET.SubElement(body, 'joint', type='slide', axis=axis, limited='false', damping='.20')
            inertia = mass*dx**2/12
            ET.SubElement(body, 'inertial', pos='0 0 0', mass=str(mass),
                          diaginertia=f'{inertia} {inertia} {inertia}')
        ET.SubElement(body, 'site', name=node+'_end', size='.001', rgba='0 0 0 0')
        if nodes:
            stiffness = axial_rigidity / dx
            spring = ET.SubElement(tendons, 'spatial', stiffness=str(stiffness), damping='.25',
                                   springlength=str(dx-tension/stiffness), rgba='0 0 0 0')
            ET.SubElement(spring, 'site', site=nodes[-1]+'_end')
            ET.SubElement(spring, 'site', site=node+'_end')
        nodes.append(node)
    flex = ET.SubElement(deformable, 'flex', name=name, dim='1', radius=str(radius),
                         material=rod.get('material'), body=' '.join(nodes),
                         element=' '.join(f'{i} {i+1}' for i in range(segments)))
    ET.SubElement(flex, 'contact', selfcollide='none', priority='2', condim='3',
                  friction=rod.get('friction'), solref=f'{config.box_contact_timeconst} 1',
                  solimp=f'.90 .98 {config.box_contact_width}')
    ET.SubElement(flex, 'elasticity', young=str(bending_rigidity / (math.pi*radius**4/4)))


def decorate_cabinet(root, config, geom, box, face, quad):
    world = root.find('worldbody')
    assets = root.find('asset')
    gantry = world.find("body[@name='gantry']")
    head = gantry.find("body[@name='claw_head']")
    configure_head_mount(root, gantry, head, config)
    prize = world.find("body[@name='prize']")
    left = -BAY_PITCH / 2
    right = left + WIDTH
    centre = BAY_PITCH / 2
    front, back = -BODY_HALF_DEPTH, BODY_HALF_DEPTH

    def material(name, rgba, **attrs):
        ET.SubElement(assets, 'material', name=name, rgba=rgba, **attrs)

    def collider(name, kind='box', material_name='ufo_white', **attrs):
        # These geoms deliberately do not inherit the non-colliding decor class.
        return ET.SubElement(world, 'geom', name=name, type=kind, **attrs,
            material=material_name, contype='1', conaffinity='1', condim='3',
            friction='.20 .005 .0001', mass='0',
            solref=f'{config.box_contact_timeconst} 1',
            solimp=f'.90 .98 {config.box_contact_width}')

    def solid(name, pos, size, material_name='ufo_glass', **attrs):
        return collider(name, pos=pos, size=size, material_name=material_name, **attrs)

    def field_block(name, x, half_width, y0, y1, z0, z1):
        return solid(name, f'{x} {(y0+y1)/2} {(z0+z1)/2}',
                     f'{half_width} {(y1-y0)/2} {(z1-z0)/2}', 'ufo_white')

    def plate(name, vertices, thickness=.006, material_name='ufo_white'):
        # A finite, convex plate is both the visible liner and its real collider.
        a = [vertices[1][i]-vertices[0][i] for i in range(3)]
        b = [vertices[2][i]-vertices[0][i] for i in range(3)]
        normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
        norm = math.sqrt(sum(v*v for v in normal))
        behind = [tuple(p[i]-thickness*normal[i]/norm for i in range(3)) for p in vertices]
        ET.SubElement(assets, 'mesh', name=name+'_mesh',
            vertex=' '.join(str(v) for p in vertices+behind for v in p),
            face='0 1 2 0 2 3 4 6 5 4 7 6 0 4 5 0 5 1 1 5 6 1 6 2 2 6 7 2 7 3 3 7 4 3 4 0')
        return collider(name, kind='mesh', mesh=name+'_mesh', material_name=material_name)

    def dummy(parent, name, x, y, z):
        body = ET.SubElement(parent, 'body', name=name, pos=f'{x} {y} {z+.100}')
        box(body, name+'_body', '0 0 0', '.065 .032 .100', 'ufo_white')
        face(body, name+'_front', 0, -.0323, 0, .130, .200, 'package_front')
        quad(body, name+'_right', [(.0653,-.032,-.100),(.0653,.032,-.100),(.0653,.032,.100),(.0653,-.032,.100)], 'package_long')
        quad(body, name+'_left', [(-.0653,.032,-.100),(-.0653,-.032,-.100),(-.0653,-.032,.100),(-.0653,.032,.100)], 'package_long')
        quad(body, name+'_top', [(-.065,-.032,.1003),(.065,-.032,.1003),(.065,.032,.1003),(-.065,.032,.1003)], 'package_short')

    for old in list(world.findall('geom')):
        if old.get('material') == 'frame' or old.get('name', '').startswith('tray_'):
            world.remove(old)
    world.find("geom[@name='floor']").set('rgba', '0 0 0 0')
    # Keep the physical rod spacing local to one fixed bridge. The free parcel
    # starts over its inner pair, so resetData restores the same offset as well.
    bridge = ET.SubElement(world, 'body', name='bridge_rods', pos=f'0 {MOUTH_CENTER_Y} 0')
    deformable = ET.SubElement(root, 'deformable')
    contacts = root.find('contact')
    rod_templates = []
    for i in range(1, 5):
        rod = world.find(f"geom[@name='rod_{i}']")
        world.remove(rod)
        contacts.remove(contacts.find(f"pair[@geom2='rod_{i}']"))
        rod_templates.append(rod)
        add_elastic_rod(bridge, deformable, root.find('tendon'), rod, config)
    prize_z = prize.get('pos').split()[2]
    prize.set('pos', f'0 {MOUTH_CENTER_Y} {prize_z}')
    geom(world, 'arcade_floor', kind='plane', pos=f'0 0 {GROUND_Z}', size='5 5 .1', material='floor')
    material('showcase_light', '.94 .98 1 1', emission='.75')
    material('outlet_glass', '.86 .94 1 .085', specular='.75', shininess='.9')
    material('field_lamp', '.66 .90 1 1', emission='.7')
    # The marking is RGBA text/tint on a clear flap, not an opaque fake opening.
    assets.find("material[@name='prize_out']").set('rgba', '1 1 1 .98')
    receiving_floor = world.find("geom[@name='chute_bottom']")
    receiving_floor.set('pos', '0 -.140 -.585')
    receiving_floor.set('size', '.315 .275 .010')
    receiving_floor.set('rgba', '.94 .95 .96 1')

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

    # Narrow central service doors between the two wide recessed retrieval bays.
    box(world, 'centre_service_panel', f'{centre} {front+.010} -.330', '.100 .010 .300')
    for i, (z, height) in enumerate(((-.205, .115), (-.485, .140))):
        for sign in (-1, 1):
            box(world, f'service_edge_v_{i}_{sign}', f'{centre+sign*.094} {front-.0005} {z}', '.0007 .0007 '+str(height), 'ufo_dark')
            box(world, f'service_edge_h_{i}_{sign}', f'{centre} {front-.0005} {z+sign*height}', '.094 .0007 .0007', 'ufo_dark')
        geom(world, f'service_lock_{i}', kind='cylinder', pos=f'{centre-.075} {front-.002} {z+.065}',
             quat='.70710678 .70710678 0 0', size='.006 .002', material='ufo_chrome')

    for bay, x in enumerate((0., BAY_PITCH)):
        # A sloping CP lid, with both touchscreens facing upward beside the centre.
        deck_half = BAY_PITCH/2-.018
        def deck_z(y):
            return .074+(y-DECK_FRONT_Y)*(.054/(front-DECK_FRONT_Y))
        quad(world, f'deck_top_{bay}', [(x-deck_half,DECK_FRONT_Y,.074), (x+deck_half,DECK_FRONT_Y,.074),
             (x+deck_half,front,.128), (x-deck_half,front,.128)], 'ufo_pearl')
        for sign in (-1, 1):
            px = x+sign*deck_half
            quad(world, f'deck_side_{bay}_{sign}', [(px,DECK_FRONT_Y,.040),(px,front,.040),
                 (px,front,.128),(px,DECK_FRONT_Y,.074)], 'ufo_white')
        box(world, f'deck_underside_{bay}', f'{x} {(front+DECK_FRONT_Y)/2} .040', f'{deck_half} {(front-DECK_FRONT_Y)/2} .001')
        box(world, f'deck_front_fascia_{bay}', f'{x} {DECK_FRONT_Y+.002} .052', f'{deck_half} .002 .012')
        box(world, f'deck_front_edge_{bay}', f'{x} {DECK_FRONT_Y+.002} .064', f'{deck_half} .002 .010', 'ufo_chrome')
        sx = x+(.145 if bay == 0 else -.145)
        sy0, sy1 = DECK_FRONT_Y+.038, front-.035
        quad(world, f'deck_screen_{bay}', [(sx-.105,sy0,deck_z(sy0)+.0004),(sx+.105,sy0,deck_z(sy0)+.0004),
             (sx+.105,sy1,deck_z(sy1)+.0004),(sx-.105,sy1,deck_z(sy1)+.0004)], 'touchscreen')
        for j in range(2):
            bx = x+(-.285+j*.105 if bay == 0 else .180+j*.105)
            by = front-.083
            tilt = math.atan2(.054, front-DECK_FRONT_Y)/2
            orientation = f'{math.cos(tilt)} {math.sin(tilt)} 0 0'
            geom(world, f'button_base_{bay}_{j}', kind='cylinder', pos=f'{bx} {by} {deck_z(by)+.005}',
                 quat=orientation, size='.030 .005', material='ufo_dark')
            geom(world, f'button_{bay}_{j}', kind='cylinder', pos=f'{bx} {by} {deck_z(by)+.012}',
                 quat=orientation, size='.025 .004', material='ufo_white')

        # Raised, open-centre field frame and the lower light bar seen on UFO10.
        field_block(f'field_frame_front_{bay}', x, .375, FIELD_FRONT_Y, MOUTH_FRONT_Y, .015, .145)
        for sign in (-1, 1):
            field_block(f'field_side_frame_{bay}_{sign}', x+sign*.355, .020, MOUTH_FRONT_Y, MOUTH_BACK_Y, .015, .145)
            box(world, f'field_top_side_{bay}_{sign}', f'{x+sign*.355} {MOUTH_CENTER_Y} .146',
                f'.018 {CHUTE_HALF_Y-.002} .001', 'ufo_pearl')
        box(world, f'lower_light_{bay}', f'{x} -.416 .109', '.330 .002 .004', 'field_lamp')
        box(world, f'lower_light_cover_{bay}', f'{x} -.419 .109', '.343 .001 .012', 'ufo_glass')
        for side in (-1, 1):
            for y in (MOUTH_FRONT_Y+.012, MOUTH_BACK_Y-.012):
                geom(world, f'field_fastener_{bay}_{side}_{y}', kind='cylinder', pos=f'{x+side*.349} {y} .147',
                     size='.004 .001', material='ufo_chrome')

        # Deep white prize chute: real fixed liner plates, rather than a black sign.
        rear_tray_y = -.055
        plate(f'chute_back_liner_{bay}', [(x+CHUTE_HALF_X,MOUTH_BACK_Y,.015),(x-CHUTE_HALF_X,MOUTH_BACK_Y,.015),
              (x-.315,rear_tray_y,-.575),(x+.315,rear_tray_y,-.575)])
        for sign in (-1, 1):
            side_vertices = [(x+sign*CHUTE_HALF_X,MOUTH_FRONT_Y,.015),(x+sign*CHUTE_HALF_X,MOUTH_BACK_Y,.015),
                             (x+sign*.315,rear_tray_y,-.575),(x+sign*.315,-.415,-.575)]
            plate(f'chute_side_liner_{bay}_{sign}', side_vertices if sign > 0 else side_vertices[::-1])
        plate(f'chute_front_inside_{bay}', [(x-CHUTE_HALF_X,MOUTH_FRONT_Y,.015),(x+CHUTE_HALF_X,MOUTH_FRONT_Y,.015),
              (x+.330,-.315,-.160),(x-.330,-.315,-.160)])
        # The receiving tray is open to the clear flap; front and side lips are low.
        solid(f'receiving_tray_lip_{bay}', f'{x} {front+.018} -.565', '.315 .008 .012', 'ufo_white')
        for sign in (-1, 1):
            solid(f'receiving_side_lip_{bay}_{sign}', f'{x+sign*.320} -.140 -.548', '.006 .275 .028', 'ufo_white')

        # Wide, recessed retrieval door. The RGB marking has transparent pixels.
        for sign in (-1, 1):
            box(world, f'prize_out_post_{bay}_{sign}', f'{x+sign*.345} {front+.014} -.330', '.025 .014 .270')
            box(world, f'outlet_inner_edge_{bay}_{sign}', f'{x+sign*.317} {front+.025} -.343', '.003 .024 .231', 'ufo_pearl')
            geom(world, f'caster_{bay}_{sign}', kind='cylinder', pos=f'{x+sign*.30} {front+.065} {GROUND_Z+.025}',
                 quat='.70710678 .70710678 0 0', size='.025 .015', material='ufo_dark')
        box(world, f'outlet_upper_lintel_{bay}', f'{x} {front+.013} -.073', '.320 .013 .040')
        box(world, f'outlet_lower_lintel_{bay}', f'{x} {front+.014} -.607', '.320 .014 .033')
        solid(f'outlet_clear_flap_{bay}', f'{x} {front+.018} -.343', '.312 .002 .229', 'outlet_glass')
        face(world, f'outlet_marking_{bay}', x, front+.0155, -.343, .620, .452, 'prize_out')
        geom(world, f'outlet_hinge_{bay}', kind='cylinder', fromto=f'{x-.31} {front+.018} -.111 {x+.31} {front+.018} -.111',
             size='.003', material='ufo_chrome')
        box(world, f'outlet_lower_trim_{bay}', f'{x} {front+.011} -.573', '.313 .010 .004', 'ufo_pearl')
        box(world, f'track_{bay}', f'{x} 0 1.194', '.365 .370 .012', 'ufo_pearl')
        for sign in (-1, 1):
            geom(world, f'ceiling_rail_{bay}_{sign}', kind='cylinder',
                 fromto=f'{x+sign*.335} -.38 1.174 {x+sign*.335} .38 1.174', size='.006', material='steel')
        box(world, f'white_light_{bay}', f'{x} {back-.025} 1.150', '.350 .006 .006', 'showcase_light')

        # The rear platform itself forms the back edge of the playable opening.
        showcase = ET.SubElement(world, 'body', name=f'dummy_showcase_{bay}', pos=f'{x} 0 0')
        field_block(f'display_field_base_{bay}', x, .375, DISPLAY_FRONT_Y, FIELD_REAR_Y, .015, .250)
        riser_front_y = FIELD_REAR_Y - .090
        field_block(f'display_field_riser_{bay}', x, .350, riser_front_y, FIELD_REAR_Y, .250, .300)
        box(showcase, f'display_front_lip_{bay}', f'0 {DISPLAY_FRONT_Y+.002} .255', '.350 .002 .005', 'ufo_pearl')
        for column, bx in enumerate((-.240, -.080, .080, .240)):
            dummy(showcase, f'dummy_box_{bay}_{column}', bx, FIELD_REAR_Y-.045, .300)
        for sign in (-1, 1):
            box(showcase, f'display_mount_rail_{bay}_{sign}', f'{sign*.353} .413 .665', '.008 .004 .495', 'ufo_pearl')
            for index in range(19):
                box(showcase, f'display_mount_slot_{bay}_{sign}_{index}', f'{sign*.353} .4085 {.195+index*.050}',
                    '.002 .0005 .003', 'ufo_dark')
        ET.SubElement(world, 'light', name=f'showcase_light_{bay}', pos=f'{x} .30 1.13', dir='0 .1 -1', diffuse='.3 .3 .3', castshadow='false')

    # Fixed neighbouring booth, at the actual half-width bay pitch.
    display = ET.SubElement(world, 'body', name='display_station', pos=f'{BAY_PITCH} 0 0')
    display_bridge = ET.SubElement(display, 'body', name='display_bridge', pos=bridge.get('pos'))
    for original in rod_templates:
        copied = deepcopy(original)
        copied.set('name', 'display_'+original.get('name')); copied.set('class', 'decor')
        copied.set('contype', '0'); copied.set('conaffinity', '0'); copied.set('mass', '0')
        display_bridge.append(copied)
    copied_floor = deepcopy(receiving_floor)
    copied_floor.set('name', 'display_chute_bottom')
    display.append(copied_floor)
    ghost = deepcopy(head); ghost.set('name', 'display_head'); ghost.set('pos', f'0 {MOUTH_CENTER_Y} .80')
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
