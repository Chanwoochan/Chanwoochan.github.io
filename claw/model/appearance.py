"""UFO CATCHER 10 inspired cabinet and printed parcel surfaces.

All added geometry is visual only. Existing collision geometry is preserved.
"""
from __future__ import annotations

from copy import deepcopy
import math
from pathlib import Path
import xml.etree.ElementTree as ET


ASSETS = Path(__file__).resolve().parent/'assets'


def decorate_scene(xml, config):
    root = ET.fromstring(xml)
    assets = root.find('asset')
    world = root.find('worldbody')
    gantry = world.find("body[@name='gantry']")
    head = gantry.find("body[@name='claw_head']")
    prize = world.find("body[@name='prize']")
    existing_head_geoms = set(head.iter('geom'))

    def mat(name, rgba, **kwargs):
        ET.SubElement(assets, 'material', name=name, rgba=rgba, **kwargs)

    def texture(name, file):
        ET.SubElement(assets, 'texture', name=name+'_tex', type='2d', file=(ASSETS/file).as_posix(), vflip='true')
        mat(name, '1 1 1 1', texture=name+'_tex', texrepeat='1 1', specular='.1', shininess='.1')

    mat('ufo_white', '.95 .96 .97 1', specular='.5', shininess='.55')
    mat('ufo_pearl', '.82 .86 .90 1', specular='.65', shininess='.65')
    mat('ufo_chrome', '.72 .79 .86 1', specular='1', shininess='1', reflectance='.35')
    mat('ufo_dark', '.035 .045 .06 1', specular='.35')
    mat('ufo_glass', '.78 .92 1 .045', specular='.85', shininess='.9')
    for name, file in [('head_badge', 'head_badge.png'), ('marquee', 'marquee.png'),
                       ('prize_out', 'prize_out.png'), ('touchscreen', 'touchscreen.png'),
                       ('package_front', 'cygnus_box_front_v1.png'),
                       ('package_long', 'cygnus_package_long_v1.png'),
                       ('package_short', 'cygnus_package_short_v1.png'),
                       ('cygnus_label', 'cygnus_label_v1.png')]:
        texture(name, file)

    def geom(parent, name, kind='box', **attrs):
        return ET.SubElement(parent, 'geom', name=name, type=kind, **{'class':'decor'}, **attrs)

    def box(parent, name, pos, size, material='ufo_white', **attrs):
        return geom(parent, name, pos=pos, size=size, material=material, **attrs)

    def quad(parent, name, vertices, material):
        # Give printed faces finite thickness for MuJoCo's mesh compiler.
        a=[vertices[1][i]-vertices[0][i] for i in range(3)]
        b=[vertices[2][i]-vertices[0][i] for i in range(3)]
        normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
        norm=math.sqrt(sum(v*v for v in normal))
        behind=[tuple(p[i]-.0001*normal[i]/norm for i in range(3)) for p in vertices]
        ET.SubElement(assets, 'mesh', name=name+'_mesh', vertex=' '.join(str(v) for p in vertices+behind for v in p),
                      face='0 1 2 0 2 3 4 6 5 4 7 6 0 4 5 0 5 1 1 5 6 1 6 2 2 6 7 2 7 3 3 7 4 3 4 0',
                      texcoord='0 0 1 0 1 1 0 1 0 0 1 0 1 1 0 1')
        return geom(parent, name, kind='mesh', mesh=name+'_mesh', material=material)

    def face(parent, name, cx, y, cz, width, height, material):
        return quad(parent, name, [(cx-width/2,y,cz-height/2), (cx+width/2,y,cz-height/2),
                                  (cx+width/2,y,cz+height/2), (cx-width/2,y,cz+height/2)], material)

    def rounded_profile(width, height, radius):
        points=[]
        for cx, cz, start in [(width-radius,height-radius,0),(-width+radius,height-radius,90),
                              (-width+radius,-height+radius,180),(width-radius,-height+radius,270)]:
            for j in range(9):
                a=math.radians(start+j*90/8)
                points.append((cx+radius*math.cos(a),cz+radius*math.sin(a)))
        return points

    def rounded_shell(parent, name, width, height, radius, front, back, material):
        profile=rounded_profile(width,height,radius)
        n=len(profile)
        vertices=[(x,y,z) for y in (front,back) for x,z in profile]
        vertices.extend([(0,front,0),(0,back,0)])
        triangles=[]
        for i in range(n):
            j=(i+1)%n
            triangles.extend([(2*n,i,j),(2*n+1,n+j,n+i),(i,n+i,n+j),(i,n+j,j)])
        ET.SubElement(assets,'mesh',name=name+'_mesh',vertex=' '.join(str(v) for p in vertices for v in p),
                      face=' '.join(str(v) for t in triangles for v in t))
        return geom(parent,name,kind='mesh',mesh=name+'_mesh',material=material)

    # Keep the ellipsoid as the same physical collider, and replace its drawing.
    head.find("geom[@name='housing']").set('rgba','0 0 0 0')
    for old in list(head.findall('geom')):
        if old.get('class')=='decor':
            head.remove(old)
    rounded_shell(head,'head_chrome_shell',.112,.048,.029,-.067,.059,'ufo_chrome')
    rounded_shell(head,'head_white_cover',.106,.043,.026,-.070,.053,'ufo_white')
    rounded_shell(head,'head_face_rim',.091,.034,.018,-.073,-.0705,'ufo_pearl')
    face(head,'head_logo',0,-.0735,0,.160,.057,'head_badge')
    # Rear cover seams, shaft collar, and flexible coiled cable.
    box(head,'head_lower_seam','0 0 -.039','.082 .041 .002','ufo_chrome')
    geom(head,'shaft_collar',kind='cylinder',pos='0 0 .048',size='.025 .006',material='ufo_pearl')
    for i in range(14):
        a=i*2*math.pi/5
        b=(i+1)*2*math.pi/5
        geom(head,f'cable_{i}',kind='capsule',fromto=f'{.026+.007*math.cos(a)} .014 {.051+i*.006} {.026+.007*math.cos(b)} .014 {.057+i*.006}',size='.0025',material='ufo_white')
    for side,sign in [('left',-1),('right',1)]:
        arm=head.find(f"body[@name='{side}_finger']")
        geom(arm,f'{side}_shoulder_cover',kind='cylinder',pos='0 0 0',quat='.70710678 .70710678 0 0',size='.010 .012',material='ufo_white')
        geom(arm,f'{side}_elbow_pin',kind='cylinder',pos=f'{sign*.104} 0 -.095',quat='.70710678 .70710678 0 0',size='.003 .006',material='ufo_chrome')

    # Physics was already scaled. Scale only the newly authored head visuals.
    for visual in head.iter('geom'):
        if visual in existing_head_geoms:
            continue
        for attribute in ('pos','size','fromto'):
            if attribute in visual.attrib:
                visual.set(attribute,' '.join(str(float(v)*config.claw_scale) for v in visual.get(attribute).split()))
        if visual.get('mesh'):
            assets.find(f"mesh[@name='{visual.get('mesh')}']").set('scale',' '.join([str(config.claw_scale)]*3))

    # Printed faces lie just outside the unchanged box collision surface.
    for old in list(prize.findall('geom')):
        if old.get('class')=='decor':
            prize.remove(old)
    prize.find("geom[@name='prize_geom']").set('rgba','.91 .91 .89 1')
    x,y,z=config.box_width/2,config.box_length/2,config.box_height/2
    e=.00025
    quad(prize,'package_top',[(-x,-y,z+e),(x,-y,z+e),(x,y,z+e),(-x,y,z+e)],'package_front')
    quad(prize,'package_bottom',[(x,-y,-z-e),(-x,-y,-z-e),(-x,y,-z-e),(x,y,-z-e)],'package_front')
    face(prize,'package_front_edge',0,-y-e,0,2*x,2*z,'package_short')
    quad(prize,'package_back_edge',[(x,y+e,-z),(-x,y+e,-z),(-x,y+e,z),(x,y+e,z)],'package_short')
    quad(prize,'package_left_edge',[(-x-e,y,-z),(-x-e,-y,-z),(-x-e,-y,z),(-x-e,y,z)],'package_long')
    quad(prize,'package_right_edge',[(x+e,-y,-z),(x+e,y,-z),(x+e,y,z),(x+e,-y,z)],'package_long')

    # Full two-bay cabinet. The current simulation occupies the left bay.
    for old in list(world.findall('geom')):
        if old.get('material')=='frame':
            world.remove(old)
    world.find("geom[@name='floor']").set('rgba','0 0 0 0')
    for bank in world.findall('geom'):
        if bank.get('name','').startswith('tray_'):
            bank.set('rgba','.91 .93 .95 1')
    geom(world,'arcade_floor',kind='plane',pos='0 0 -.72',size='5 5 .1',material='floor')
    # Reserve real visual room behind rod 4 for the sample-prize showcase.
    depth=max(.58, config.chute_half_y+.08, config.gap/2+config.rod_radius+max(config.gap_12,config.gap_34)+2*config.rod_radius+.24)
    front=-depth
    back=depth
    # Hollow cabinet panels: no solid visual block across the prize chute.
    for i,xpos in enumerate([-.52,.50,1.52]):
        box(world,f'cabinet_base_side_{i}',f'{xpos} 0 -.32',f'.018 {depth} .36')
    box(world,'cabinet_base_rear',f'.5 {back-.012} -.32','1.025 .012 .36')
    box(world,'cabinet_base_bottom','.5 0 -.665',f'1.025 {depth} .015')
    box(world,'cabinet_base_front_top',f'.5 {front} .005','1.025 .016 .06')
    box(world,'cabinet_base_front_bottom',f'.5 {front} -.63','1.025 .016 .035')
    box(world,'cabinet_bottom_rim','.5 0 -.67',f'1.045 {depth+.012} .018','ufo_pearl')
    box(world,'cabinet_roof','.5 0 1.13',f'1.045 {depth+.018} .055')
    for i,xpos in enumerate([-.52,.50,1.52]):
        for side,ypos in [('front',front),('back',back)]:
            box(world,f'pillar_{side}_{i}',f'{xpos} {ypos} .64','.016 .018 .46')
    for i,xpos in enumerate([-.525,1.525]):
        box(world,f'side_glass_{i}',f'{xpos} 0 .64',f'.002 {depth} .44','ufo_glass')
    box(world,'rear_glass',f'.5 {back} .64','1.0 .002 .44','ufo_glass')
    box(world,'front_glass',f'.5 {front+.006} .68','1.0 .001 .40','ufo_glass')
    box(world,'top_chrome_rail',f'.5 {front-.004} 1.067','1.0 .006 .015','ufo_chrome')
    box(world,'field_front_sill',f'.5 {front} .17','1.02 .025 .018')
    box(world,'rear_light_panel',f'.5 {back-.015} 1.01','1.0 .006 .040','ufo_pearl')
    for i in range(40):
        # A native emissive LED segment; no light-force or collision effects.
        hue=(i/40)
        import colorsys
        rgb=colorsys.hsv_to_rgb(hue,.58,1)
        mat(f'led_{i}',' '.join(map(str,(*rgb,1))),emission='.75')
        box(world,f'header_led_{i}',f'{-.50+(i+.5)*.05} {front-.023} 1.167','.025 .003 .003',f'led_{i}')
        for j,xpos in enumerate([-.535,1.535]):
            box(world,f'post_led_{j}_{i}',f'{xpos} {front-.022} {.20+(i+.5)*.0225}','.003 .003 .01125',f'led_{i}')
    face(world,'cabinet_marquee',.5,front-.020,1.126,1.98,.070,'marquee')
    # Two slim touch displays and round physical left/up buttons.
    for bay,xpos in enumerate([0,1.]):
        box(world,f'control_deck_{bay}',f'{xpos} {front-.080} .105','.49 .105 .025','ufo_pearl',quat='.9961947 .0871557 0 0')
        face(world,f'deck_screen_{bay}',xpos+(.20 if bay==0 else -.20),front-.187,.105,.205,.066,'touchscreen')
        for j in range(2):
            bx=xpos+(-.34+j*.10 if bay==0 else .24+j*.10)
            geom(world,f'button_ring_{bay}_{j}',kind='cylinder',pos=f'{bx} {front-.085} .145',size='.032 .009',material='ufo_dark')
            geom(world,f'button_cap_{bay}_{j}',kind='cylinder',pos=f'{bx} {front-.085} .155',size='.026 .005',material='ufo_white')
        box(world,f'prize_out_frame_{bay}',f'{xpos} {front-.006} -.32','.385 .016 .235','ufo_pearl')
        box(world,f'prize_out_dark_{bay}',f'{xpos} {front-.025} -.32','.355 .003 .205','ufo_dark')
        face(world,f'prize_out_label_{bay}',xpos,front-.030,-.32,.70,.40,'prize_out')
        for sign in (-1,1):
            geom(world,f'wheel_{bay}_{sign}',kind='cylinder',pos=f'{xpos+sign*.35} {front+.09} -.690',quat='.70710678 .70710678 0 0',size='.028 .018',material='ufo_dark')
        box(world,f'ceiling_track_{bay}',f'{xpos} 0 1.027',f'.42 {depth-.07} .012','ufo_pearl')
        for sign in (-1,1):
            geom(world,f'gantry_rail_{bay}_{sign}',kind='cylinder',fromto=f'{xpos+sign*.40} {-depth+.04} 1.01 {xpos+sign*.40} {depth-.04} 1.01',size='.007',material='steel')
    box(world,'centre_lock_panel',f'.5 {front-.015} -.32','.07 .014 .30','ufo_white')
    geom(world,'door_lock',kind='cylinder',pos=f'.5 {front-.035} -.15',quat='.70710678 .70710678 0 0',size='.008 .003',material='ufo_chrome')

    # Sample-prize cabinet behind the four play bars, one in each booth.
    # These are static display sculptures, not extra physics prizes.
    mat('cygnus_shell','.94 .95 .96 1',specular='.5',shininess='.6')
    mat('cygnus_joint','.025 .03 .04 1',specular='.45',shininess='.4')
    mat('cygnus_metal','.32 .36 .40 1',specular='.7',shininess='.65')
    mat('cygnus_actuator','.88 .69 .12 1',specular='.45',shininess='.4')
    mat('cygnus_eye','1 1 1 1',emission='.7')
    mat('showcase_light','.94 .98 1 1',emission='.85')

    def display_figure(parent,name,xpos,ypos,base_z,pose=0):
        # Reference-based SWAN humanoid sculpture, approximately 210 mm tall.
        # All pieces inherit decor: no joints, mass, or contact with the game.
        body=ET.SubElement(parent,'body',name=name,pos=f'{xpos} {ypos} {base_z}')
        def part(label,kind='ellipsoid',material='cygnus_shell',**attrs):
            return geom(body,name+'_'+label,kind=kind,material=material,**attrs)
        def limb(label,start,end,radius,material):
            part(label,'capsule',material,fromto=' '.join(map(str,(*start,*end))),size=str(radius))
        part('base','cylinder','ufo_dark',pos='0 0 .004',size='.052 .004')
        face(body,name+'_base_label',0,-.048,.009,.038,.010,'cygnus_label')
        for side,sign in [('left',-1),('right',1)]:
            x=sign*.0135
            part(side+'_foot','box','cygnus_joint',pos=f'{x} -.006 .012',size='.011 .020 .004')
            part(side+'_ankle','cylinder','cygnus_metal',pos=f'{x} .001 .024',
                 quat='.70710678 0 .70710678 0',size='.005 .008')
            limb(side+'_shin_core',(x,.003,.024),(x,.003,.067),.005,'cygnus_joint')
            part(side+'_shin_shell',pos=f'{x} -.001 .046',size='.009 .010 .020')
            limb(side+'_shin_slot',(x,-.0105,.035),(x,-.0105,.056),.002,'cygnus_joint')
            part(side+'_knee','cylinder','cygnus_joint',pos=f'{x} 0 .071',
                 quat='.70710678 0 .70710678 0',size='.007 .011')
            part(side+'_knee_cap',pos=f'{x} -.007 .071',size='.007 .004 .006')
            limb(side+'_thigh_core',(x,0,.077),(x,0,.115),.006,'cygnus_joint')
            part(side+'_thigh_shell',pos=f'{x} -.001 .097',size='.011 .012 .019')
            limb(side+'_thigh_slot',(x,-.0123,.087),(x,-.0123,.105),.0022,'cygnus_joint')
            part(side+'_hip','cylinder','cygnus_joint',pos=f'{x} 0 .119',
                 quat='.70710678 0 .70710678 0',size='.008 .010')
            part(side+'_hip_actuator','box','cygnus_actuator',pos=f'{sign*.019} -.006 .121',size='.003 .003 .005')
        part('pelvis','box','cygnus_joint',pos='0 0 .123',size='.020 .010 .008')
        part('abdomen','box','cygnus_metal',pos='0 0 .135',size='.017 .011 .010')
        part('abdomen_panel','box','cygnus_joint',pos='0 -.0113 .135',size='.010 .001 .009')
        part('chest_shell',pos='0 0 .153',size='.026 .014 .023')
        part('chest_lower_cutout','box','cygnus_joint',pos='0 -.010 .135',size='.012 .003 .004')
        face(body,name+'_chest_label',0,-.0143,.158,.023,.008,'cygnus_label')
        for i,(x,z) in enumerate([(-.019,.163),(.019,.163),(-.014,.142),(.014,.142)]):
            part(f'chest_fastener_{i}','sphere','cygnus_joint',pos=f'{x} -.0105 {z}',size='.0013')
        limb('neck',(0,0,.171),(0,0,.180),.006,'cygnus_joint')
        robot_head=ET.SubElement(body,'body',name=name+'_head',pos='0 0 .192')
        rounded_shell(robot_head,name+'_head_shell',.0175,.016,.005,-.012,.010,'cygnus_joint')
        geom(robot_head,name+'_forehead_sensor',pos='0 -.0124 .010',size='.010 .0007 .002',material='cygnus_metal')
        for side,sign in [('left',-1),('right',1)]:
            geom(robot_head,name+'_'+side+'_eye',kind='capsule',
                 fromto=f'{sign*.0065} -.0132 -.004 {sign*.0065} -.0132 .0035',
                 size='.0018',material='cygnus_eye')
        left_elbow=(-.039,0,.133)
        left_hand=(-.042,-.006,.109)
        right_elbow=(.039,0,.133)
        right_hand=(.042,-.006,.109)
        if pose==1:
            left_elbow=(-.050,0,.164)
            left_hand=(-.053,-.008,.190)
        elif pose==2:
            right_elbow=(.046,-.003,.146)
            right_hand=(.060,-.012,.162)
        for side,sign,elbow,hand in [('left',-1,left_elbow,left_hand),('right',1,right_elbow,right_hand)]:
            shoulder=(sign*.030,0,.159)
            part(side+'_shoulder_motor','cylinder','cygnus_joint',pos=' '.join(map(str,shoulder)),
                 quat='.70710678 0 .70710678 0',size='.009 .009')
            part(side+'_shoulder_shell',pos=f'{sign*.032} -.001 .162',size='.009 .011 .009')
            limb(side+'_upper_arm',shoulder,elbow,.0065,'cygnus_shell')
            part(side+'_elbow','sphere','cygnus_joint',pos=' '.join(map(str,elbow)),size='.0065')
            # Leave the elbow and wrist mechanisms exposed around the white cover.
            forearm_start=tuple(elbow[i]*.78+hand[i]*.22 for i in range(3))
            forearm_end=tuple(elbow[i]*.20+hand[i]*.80 for i in range(3))
            limb(side+'_forearm_core',elbow,hand,.0045,'cygnus_joint')
            limb(side+'_forearm_cover',forearm_start,forearm_end,.007,'cygnus_shell')
            part(side+'_wrist','sphere','cygnus_metal',pos=' '.join(map(str,hand)),size='.004')
            direction=tuple(hand[i]-elbow[i] for i in range(3))
            length=math.sqrt(sum(v*v for v in direction))
            direction=tuple(v/length for v in direction)
            palm=tuple(hand[i]+direction[i]*.005 for i in range(3))
            part(side+'_palm','ellipsoid','cygnus_joint',pos=' '.join(map(str,palm)),size='.005 .003 .006')
            for finger in range(4):
                start=tuple(palm[i]+(finger-1.5)*.0024*(i==0) for i in range(3))
                end=tuple(start[i]+direction[i]*(.007 if finger in (1,2) else .0055) for i in range(3))
                limb(f'{side}_finger_{finger}',start,end,.0009,'cygnus_metal')
            thumb=tuple(palm[i]+sign*.006*(i==0)+direction[i]*.002 for i in range(3))
            limb(side+'_thumb',palm,thumb,.0012,'cygnus_metal')

    def upright_package(parent,name,xpos,ypos,base_z):
        box(parent,name+'_body',f'{xpos} {ypos} {base_z+.108}', '.051 .028 .108','ufo_white')
        face(parent,name+'_art',xpos,ypos-.0283,base_z+.108,.102,.216,'package_front')
        quad(parent,name+'_side',[(xpos+.0513,ypos-.028,base_z),
             (xpos+.0513,ypos+.028,base_z),(xpos+.0513,ypos+.028,base_z+.216),
             (xpos+.0513,ypos-.028,base_z+.216)],'package_long')

    shelf_y=back-.092
    for bay,xpos in enumerate([0.,1.]):
        showcase=ET.SubElement(world,'body',name=f'prize_showcase_{bay}',pos=f'{xpos} 0 0')
        box(showcase,f'showcase_back_{bay}',f'0 {back-.018} .730','.465 .007 .305','ufo_white')
        for sign in (-1,1):
            box(showcase,f'showcase_side_{bay}_{sign}',f'{sign*.46} {shelf_y} .730','.008 .078 .305','ufo_pearl')
        for level,zs in enumerate([.425,.745]):
            box(showcase,f'showcase_shelf_{bay}_{level}',f'0 {shelf_y} {zs-.006}','.46 .080 .006','ufo_white')
            box(showcase,f'showcase_shelf_lip_{bay}_{level}',f'0 {shelf_y-.080} {zs-.008}','.46 .003 .013','ufo_chrome')
            box(showcase,f'showcase_led_{bay}_{level}',f'0 {shelf_y-.072} {zs+.270}','.43 .003 .002','showcase_light')
            face(showcase,f'showcase_label_{bay}_{level}',0,shelf_y-.083,zs-.009,.23,.022,'package_long')
        face(showcase,f'showcase_poster_{bay}',0,back-.025,.735,.20,.43,'package_front')
        box(showcase,f'showcase_top_{bay}',f'0 {shelf_y} 1.038','.47 .085 .010','ufo_white')
        box(showcase,f'showcase_glass_{bay}',f'0 {shelf_y-.081} .735','.45 .001 .293','ufo_glass')
        display_figure(showcase,f'sample_cygnus_wave_{bay}',-.29,shelf_y-.024,.425,1)
        display_figure(showcase,f'sample_cygnus_gesture_{bay}',.015,shelf_y-.024,.425,2)
        upright_package(showcase,f'sample_lower_box_{bay}',.30,shelf_y+.018,.425)
        display_figure(showcase,f'sample_cygnus_standing_{bay}',0,shelf_y-.024,.745,0)
        upright_package(showcase,f'sample_upper_box_left_{bay}',-.29,shelf_y+.018,.745)
        upright_package(showcase,f'sample_upper_box_right_{bay}',.29,shelf_y+.018,.745)
        ET.SubElement(world,'light',name=f'showcase_lamp_{bay}',pos=f'{xpos} {shelf_y-.08} 1.01',
                      dir='0 .3 -1',diffuse='.25 .27 .3',castshadow='false')

    # A fixed visual neighbouring station recreates the twin-bay silhouette.
    display=ET.SubElement(world,'body',name='display_station',pos='1 0 0')
    for i in range(1,5):
        source=world.find(f"geom[@name='rod_{i}']")
        copied=deepcopy(source)
        copied.set('name',f'display_rod_{i}')
        copied.set('class','decor')
        display.append(copied)
    for name in ['tray_front','tray_back','tray_left','tray_right','chute_bottom']:
        bank=deepcopy(world.find(f"geom[@name='{name}']"))
        bank.set('name','display_'+name)
        bank.set('class','decor')
        bank.set('contype','0')
        bank.set('conaffinity','0')
        display.append(bank)
    ghost=deepcopy(head)
    ghost.set('name','display_head')
    ghost.set('pos','0 0 .80')
    for parent in list(ghost.iter()):
        for child in list(parent):
            if child.tag in ('joint','freejoint','inertial'):
                parent.remove(child)
        if parent is not ghost and parent.get('name'):
            parent.set('name','display_'+parent.get('name'))
        if parent.tag=='geom':
            parent.set('class','decor')
            parent.set('contype','0')
            parent.set('conaffinity','0')
            parent.set('mass','0')
    display.append(ghost)
    # Decorative display parcel has no collision or joint.
    display_prize=deepcopy(prize)
    display_prize.set('name','display_parcel')
    for child in list(display_prize):
        if child.tag in ('freejoint','joint','inertial','site'):
            display_prize.remove(child)
        elif child.tag=='geom':
            child.set('name','display_'+child.get('name','parcel'))
            child.set('class','decor')
            child.set('contype','0')
            child.set('conaffinity','0')
            child.set('mass','0')
    display.append(display_prize)
    root.find('statistic').set('center','.5 0 .25')
    root.find('statistic').set('extent','2.6')
    return ET.tostring(root,encoding='unicode')
