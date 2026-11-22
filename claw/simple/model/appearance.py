"""UFO CATCHER 10 inspired cabinet and printed parcel surfaces.

Head and printed surfaces are visual only. cabinet.py adds native enclosure contacts.
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
    mat('ufo_glass', '.78 .92 1 .10', specular='.85', shininess='.9')
    for name, file in [('head_badge', 'head_badge.png'), ('marquee', 'marquee.png'),
                       ('prize_out', 'prize_out.png'), ('touchscreen', 'touchscreen.png'),
                       ('package_front', 'dummy_front.png'),
                       ('package_long', 'dummy_long.png'),
                       ('package_short', 'dummy_short.png'),
                       ('dummy_label', 'dummy_label.png')]:
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

    from cabinet import decorate_cabinet
    decorate_cabinet(root, config, geom, box, face, quad)
    return ET.tostring(root, encoding='unicode')
