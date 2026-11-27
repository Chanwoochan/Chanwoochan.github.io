// Orthographic cutaway of the active booth. Coordinates are the game model's
// X/right, Y/back and Z/up in millimetres. Only the editor owns this canvas.
const ink = '#293f45', teal = '#087967', amber = '#a95313', blue = '#365fa7';
const rad = Math.PI / 180;
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
const inside = (x, y, points) => {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
};
const roof = 1194, bridgeY = -128;

export class CabinetDrawing {
  constructor(canvas, hook, actions) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hook = hook;
    this.actions = actions; this.zoom = 1; this.hits = []; this.handles = [];
    const loc = e => { const b = canvas.getBoundingClientRect(); return [e.clientX-b.left,e.clientY-b.top]; };
    canvas.onpointerdown = event => {
      if (event.button !== 0 || this.drag) return;
      const [x,y] = loc(event), h = this.handleAt(x,y);
      if (h) {
        this.drag = {h,x,y,id:event.pointerId}; canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing'; event.preventDefault(); return;
      }
      const part = this.pick(x,y); if (part) actions.select(part);
    };
    canvas.onpointermove = event => {
      const [x,y] = loc(event), drag = this.drag;
      if (drag && event.pointerId === drag.id) {
        const {h} = drag;
        const delta = ((x-drag.x)*h.dx + (y-drag.y)*h.dy) / (h.dx*h.dx + h.dy*h.dy);
        actions.change(h.key, Math.round((h.value + delta*h.factor)/h.step)*h.step);
      } else canvas.style.cursor = this.handleAt(x,y) ? 'grab' : this.pick(x,y) ? 'pointer' : 'default';
    };
    canvas.onlostpointercapture = canvas.onpointercancel = canvas.onpointerup = () => { this.drag = null; canvas.style.cursor = ''; };
  }
  handleAt(x,y) {
    return this.handles.find(h => Math.hypot(x-h.p.x,y-h.p.y)<10 ||
      (x>=h.l && x<=h.r && y>=h.t && y<=h.b));
  }
  pick(x,y) {
    for (let i=this.hits.length-1; i>=0; i--) {
      const {points,part,radius} = this.hits[i];
      if (points.length > 2 && inside(x,y,points)) return part;
      if (points.length !== 2) continue;
      const [a,b] = points, dx=b.x-a.x, dy=b.y-a.y;
      const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
      if (Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<radius) return part;
    }
  }
  project([x,y,z]) {
    const bx=x*this.ca+y*this.sa, by=-x*this.sa+y*this.ca;
    return {x:this.ox+bx*this.scale,y:this.oy-(by*this.se+z*this.ce)*this.scale,
      depth:-by*this.ce+z*this.se};
  }
  frame(view) {
    const c=this.canvas, w=c.clientWidth, h=c.clientHeight;
    if (!w || !h) return false;
    const pixel=Math.min(window.devicePixelRatio||1,2);
    if (c.width!==Math.round(w*pixel)||c.height!==Math.round(h*pixel)) {
      c.width=Math.round(w*pixel); c.height=Math.round(h*pixel);
    }
    this.ctx.setTransform(c.width/w,0,0,c.height/h,0,0); this.ctx.clearRect(0,0,w,h);
    const [a,e]=({iso:[28,22],front:[0,0],side:[-90,0],top:[0,90]})[view];
    this.ca=Math.cos(a*rad); this.sa=Math.sin(a*rad); this.ce=Math.cos(e*rad); this.se=Math.sin(e*rad);
    this.scale=1; this.ox=0; this.oy=0;
    const bounds=[];
    for (const x of [-430,430]) for (const y of [-570,440]) for (const z of [-250,1220]) bounds.push(this.project([x,y,z]));
    const xs=bounds.map(p=>p.x), ys=bounds.map(p=>p.y);
    const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
    this.scale=Math.min((w-48)/(x1-x0),(h-36)/(y1-y0))*this.zoom;
    this.ox=w/2-(x0+x1)*this.scale/2; this.oy=h/2-(y0+y1)*this.scale/2;
    return true;
  }
  poly(points,color,stroke,part) {
    const ctx=this.ctx, pts=points.map(p=>this.project(p));
    ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath();
    if (color) {ctx.fillStyle=color;ctx.fill();}
    if (stroke) {ctx.strokeStyle=stroke;ctx.lineWidth=.9;ctx.stroke();}
    if (part) this.hits.push({part,points:pts});
  }
  line(a,b,color,width=1,part=null,dash=[]) {
    const ctx=this.ctx, p=this.project(a), q=this.project(b);
    ctx.beginPath();ctx.setLineDash(dash);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);
    if (part) this.hits.push({part,points:[p,q],radius:Math.max(7,width/2)});
  }
  block(center,size,colors,part=null) {
    const [x,y,z]=center,[w,d,h]=size.map(v=>Math.max(.3,v)/2);
    const v=[[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-w,-d,h],[w,-d,h],[w,d,h],[-w,d,h]]
      .map(([a,b,c])=>[x+a,y+b,z+c]);
    const faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
    for (const ids of faces) {
      const corners=ids.map(i=>v[i]), [a,b,c]=corners.map(p=>this.project(p));
      if ((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>=-.001) continue;
      const side=ids===faces[4]?0:ids===faces[0]||ids===faces[2]?1:2;
      this.poly(corners,colors[side],colors[3],part);
    }
  }
  text(pos,text,color,size=11) {
    const p=this.project(pos), ctx=this.ctx;
    ctx.fillStyle=color;ctx.font='700 '+size+'px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(text,p.x,p.y);
  }
  mark(key,point,axis,factor,label,offset,color=teal,step=1) {
    const p=this.project(point), q=this.project(point.map((n,i)=>n+axis[i]));
    const dx=q.x-p.x, dy=q.y-p.y;
    if (Math.hypot(dx,dy)<.05) return;
    this.marks.push({key,p,dx,dy,factor,label,offset,color,step,value:this.v[key]});
  }
  labels() {
    const ctx=this.ctx,w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    ctx.font='650 11px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    for (const m of this.marks) {
      const {p,label,color}=m;
      if (p.x<0||p.x>w||p.y<0||p.y>h) continue;
      const half=ctx.measureText(label).width/2+10;
      const x=clamp(p.x+m.offset[0],half+4,w-half-4);let y=clamp(p.y+m.offset[1],15,h-15);
      for (let i=0;i<8;i++) {
        const other=this.handles.find(h=>x+half>h.l-3&&x-half<h.r+3&&Math.abs(y-(h.t+h.b)/2)<24);
        if (!other) break;
        y=clamp(y+(m.offset[1]<0?-25:25),15,h-15);
      }
      ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(x,y);ctx.stroke();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x,p.y,4,0,2*Math.PI);ctx.fill();ctx.stroke();
      Object.assign(m,{l:x-half,r:x+half,t:y-10,b:y+10});
      ctx.beginPath();ctx.roundRect(m.l,m.t,half*2,20,6);ctx.fillStyle='#fffffff5';ctx.fill();ctx.stroke();
      ctx.fillStyle=color;ctx.fillText(label,x,y);this.handles.push(m);
    }
  }
  paint(v,part,view,pose,position) {
    if (!this.frame(view)) return;
    this.v=v;this.hits=[];this.handles=[];this.marks=[];
    const metal=['#f8faf7','#dbe2dc','#b1bfb8','#8d9e96'];
    const base=['#d3dfd9','#adbdb5','#8c9e97','#81958d'];
    const dark=['#536764','#344b48','#263c3c','#314b48'];
    const orange=['#ffe4ad','#ffc978','#df9d54',amber];
    const parcel=part==='box'?orange:['#fff4d9','#efd9b2','#dfc196','#948269'];
    const drawBox=(p,s,c,id)=>this.block(p,s,c,id);
    // The lower cabinet is cut away below the controls to keep the playing field large.
    drawBox([0,-14,-119],[824,834,235],metal);
    if (view!=='top') {
      drawBox([0,-434,-147],[480,8,118],dark);
      this.text([0,-446,-147],'PRIZE OUT','#e2ebe4',9);
    }
    drawBox([0,-481,4],[818,202,45],base);
    drawBox([96,-490,31],[139,70,9],dark);
    for (const x of [-226,-150]) drawBox([x,-496,32],[44,43,12],metal);
    for (const x of [-401,401]) {
      this.line([x,412,38],[x,412,roof],'#a0b3aa',Math.max(2,12*this.scale));
      this.line([x,-412,38],[x,-412,roof],'#9caca26b',1.3);
      this.line([x,-412,roof],[x,412,roof],'#94a99f',1.4);
    }
    this.line([-401,412,roof],[401,412,roof],'#a0aea5',2);
    this.line([-401,-412,roof],[401,-412,roof],'#adc2b7',1,null,[5,5]);
    drawBox([0,266,130],[750,296,235],metal);
    drawBox([0,368,272],[697,90,49],base);
    for (const x of [-240,-80,80,240]) drawBox([x,370,390],[129,65,183],['#e0e8e2','#d5dfd7','#bdccc1','#abbeb2']);
    drawBox([0,-128,7],[672,495,12],dark);
    for (const x of [-355,355]) drawBox([x,-128,73],[40,494,140],metal);
    drawBox([0,-395,73],[750,40,140],metal);
    const r=v.rod_radius||9, inner=(v.gap||0)/2+r;
    const ys=[bridgeY-inner-(v.gap_12||0)-2*r,bridgeY-inner,bridgeY+inner,bridgeY+inner+(v.gap_34||0)+2*r];
    const zh=this.hook?Math.min(155,291-v.box_height)+6:v.inner_height+r+1;
    const py=this.hook?-108:bridgeY;
    const box=()=>{
      drawBox([0,py,zh+v.box_height/2],[v.box_width,v.box_length,v.box_height],parcel,'box');
      if(view!=='top') this.text([0,py-v.box_length/2,zh+v.box_height/2],'DUMMY',ink,clamp(v.box_width*this.scale*.14,6,15));
    };
    if (this.hook) {
      drawBox([0,-108,zh-11],[500,220,10],dark,'hook');box();
      for(const y of [-53,57]) this.line([-352,y,315],[352,y,315],blue,Math.max(2,12*this.scale),'hook');
      drawBox([0,2,326],[Math.max(330,v.hook_type===2?v.hook_height*2:0),160,10],['#ec987b','#c86650','#95463b','#9c4d3e'],'hook');
      this.line([0,24,321],[0,-9,zh-6],'#8751a6',2,'hook');
      this.hookWire(v);
    } else {
      for(let i=3;i>=0;i--) {
        const z=i===1||i===2?v.inner_height:v.outer_height;
        this.line([-375,ys[i],z],[375,ys[i],z],i===1||i===2?'#4e8f82':'#85999d',Math.max(2,r*2*this.scale),'rods');
        this.line([-375,ys[i],z+r*.4],[375,ys[i],z+r*.4],'#d6e8df',Math.max(.7,r*.45*this.scale));
        if (part==='rods') this.text([-397,ys[i],z],String(i+1),ink,11);
        if(i===1) box();
      }
    }
    const travel=part==='travel', moving=travel&&pose!=='home', bottom=moving&&pose==='bottom';
    const release=travel && pose==='release';
    const [gx,gy,gz]=position ?? [release?v.release_x:moving?v.left_limit_x:v.start_x,
      release?v.release_y:moving?v.back_limit_y:v.start_y,bottom?v.lower_height:v.home_height];
    if(travel) {
      const plane=[[v.start_x,v.start_y,v.home_height],[v.left_limit_x,v.start_y,v.home_height],
        [v.left_limit_x,v.back_limit_y,v.home_height],[v.start_x,v.back_limit_y,v.home_height]];
      this.poly(plane,'#379c8620',teal,'travel');
      for (const [x,y,z] of plane) this.line([x,y,z],[x,y,v.lower_height],'#489481a8',1,null,[4,5]);
      this.poly(plane.map(([x,y])=>[x,y,v.lower_height]),'#468baf0c','#6b9ea9');
      this.line(plane[0],plane[1],teal,2);this.line(plane[1],plane[2],blue,2);
    }
    this.line([-335,gy,roof-20],[335,gy,roof-20],'#aabcd0',3);
    drawBox([gx,gy,roof-26],[117,85,35],base);
    this.line([gx,gy,roof-40],[gx,gy,(roof+gz)/2],'#71847d',Math.max(3,28*this.scale));
    this.line([gx,gy,(roof+gz)/2],[gx,gy,gz],'#aab9b1',Math.max(2,14*this.scale));
    const s=v.claw_scale/100, tool=this.hook?'hook':'claw';
    drawBox([gx,gy,gz],[224*s,135*s,94*s],metal,tool);
    if(view!=='top') this.text([gx,gy-69*s,gz],'UFO',ink,9);
    if(this.hook) {
      const z=gz-48*s-v.chain_length, radius=v.ring_width*.455;
      this.line([gx,gy,gz-48*s],[gx,gy,z],ink,2,'hook');
      const points=this.outline(v.ring_type,radius);
      for(let i=1;i<points.length;i++) this.line([gx+points[i-1][0],gy,z+points[i-1][1]],
        [gx+points[i][0],gy,z+points[i][1]],amber,Math.max(2,v.ring_width*.09*this.scale),'hook');
      if(part==='hook') {
        this.mark('chain_length',[gx,gy,z],[0,0,-1],1,'줄 '+v.chain_length,[47,-8]);
        this.mark('ring_width',[gx+radius,gy,z-radius],[1,0,0],2,'링 '+v.ring_width,[50,24]);
        this.mark('hook_height',[0,2,331+v.hook_height],[0,0,1],1,'후크 '+v.hook_height,[-55,-20]);
      }
    } else {
      const a=(pose==='open'||bottom||release||position&&gz<v.home_height?v.open_angle:v.closed_angle)*rad;
      const yaw=v.descent_yaw_deg*Math.min(1,(v.home_height-gz)/300)*rad;
      for(const sign of [-1,1]) {
        const points=[[0,0],[104,-95],[-36,-251],[-66,-257]].map(([x,z])=>{
          const lx=sign*(66+x*Math.cos(a)-z*Math.sin(a))*s;
          return [gx+lx*Math.cos(yaw),gy+lx*Math.sin(yaw),gz+(-35+x*Math.sin(a)+z*Math.cos(a))*s];
        });
        for(let i=1;i<points.length;i++) {
          this.line(points[i-1],points[i],ink,Math.max(2,(i===1?7:12)*s*this.scale),'claw');
          this.line(points[i-1],points[i],'#c7d9d2',Math.max(.8,4*s*this.scale));
        }
      }
      if(part==='claw') this.mark('claw_scale',[gx+112*s,gy,gz],[1,0,0],100/112,'크기 '+v.claw_scale+'%',[50,-30]);
    }
    if(part==='box') {
      this.mark('box_width',[v.box_width/2,py,zh+v.box_height/2],[1,0,0],2,'가로 '+v.box_width,[61,19],amber);
      this.mark('box_length',[0,py-v.box_length/2,zh+v.box_height/2],[0,-1,0],2,'길이 '+v.box_length,[-58,21],amber);
      this.mark('box_height',[0,py,zh+v.box_height],[0,0,1],1,'높이 '+v.box_height,[-50,-32],amber);
    }
    if(part==='rods') {
      for(const [idx,key,dir,mult] of [[0,'gap_12',-1,1],[2,'gap',1,2],[3,'gap_34',1,1]]) {
        const z=idx===2?v.inner_height:v.outer_height;
        this.mark(key,[245,ys[idx],z],[0,dir,0],mult,['1–2 ','','2–3 ','3–4 '][idx]+v[key],[53,idx===0?30:idx===2?0:-28]);
      }
      this.mark('outer_height',[-280,ys[0],v.outer_height],[0,0,1],1,'바깥 높이 '+v.outer_height,[-35,30]);
      this.mark('inner_height',[-280,ys[2],v.inner_height],[0,0,1],1,'안쪽 높이 '+v.inner_height,[-30,-26]);
    }
    if(travel) {
      this.mark('left_limit_x',[v.left_limit_x,v.start_y,v.home_height],[1,0,0],1,'좌 '+(v.start_x-v.left_limit_x),[-30,26]);
      this.mark('back_limit_y',[v.left_limit_x,v.back_limit_y,v.home_height],[0,1,0],1,'상 '+(v.back_limit_y-v.start_y),[-26,-22],blue);
      this.mark('home_height',[v.start_x,v.start_y,v.home_height],[0,0,1],1,'시작 '+v.home_height,[46,-26]);
      this.mark('lower_height',[v.left_limit_x,v.back_limit_y,v.lower_height],[0,0,1],1,'하한 '+v.lower_height,[48,18],blue);
      if(release) this.text([gx,gy,gz+65],'놓기 위치',amber,12);
    }
    this.labels();
  }
  outline(type,r) {
    if(type===2) return [[0,0],[0,-.65],[-.2,-1.1],[-.8,-1.5],[-1,-2],[-.77,-2.55],[0,-2.7],[.68,-2.48],[1,-1.9]].map(([x,z])=>[x*r,z*r]);
    return Array.from({length:33},(_,i)=>[Math.sin(i*Math.PI/16)*r,(Math.cos(i*Math.PI/16)-1)*r*(type===1?1.4:1)]);
  }
  hookWire(v) {
    const h=v.hook_height;
    const points=v.hook_type===2?Array.from({length:25},(_,i)=>[Math.cos(i*Math.PI/24)*h,2,331+Math.sin(i*Math.PI/24)*h]):
      (v.hook_type===1?[[0,0],[0,.25],[.13,.41],[.44,.64],[.47,.8],[.26,.96],[0,1],[-.36,.91],[-.5,.7]]:
        [[0,0],[0,.72],[-.1,.91],[-.28,1],[-.44,.93],[-.56,.72]]).map(([y,z])=>[0,2+y*h,331+z*h]);
    for(let i=1;i<points.length;i++) this.line(points[i-1],points[i],teal,Math.max(2,h*.07*this.scale),'hook');
  }
}
