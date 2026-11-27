import {CabinetDrawing} from './studio-drawing.js';

const byId = id => document.getElementById(id);
const parts = {
  box: {name: '박스', title: '경품 박스', help: '세 방향의 치수와 박스 무게를 조절하세요.',
    keys: ['box_width', 'box_length', 'box_height', 'box_mass']},
  rods: {name: '봉', title: '봉 배치', help: '1번은 앞쪽, 4번은 뒤쪽입니다. 간격은 봉의 표면 사이 거리입니다.',
    keys: ['gap_12', 'gap', 'gap_34', 'inner_height', 'outer_height', 'rod_radius']},
  claw: {name: '집게', title: '집게', help: '벌린 모습과 닫힌 모습을 번갈아 보며 크기와 각도를 맞추세요.',
    keys: ['claw_scale', 'open_angle', 'closed_angle', 'grip_kp', 'grip_torque']},
  hook: {name: '후크·링', title: '후크와 링', help: '받침판의 후크와 줄 끝에 매달린 링을 조절하세요.',
    keys: ['hook_type', 'hook_height', 'ring_type', 'ring_width', 'chain_length', 'bottom_wait', 'claw_scale']},
  travel: {name: '이동 범위', title: '집게 이동 범위', help: '원점에서 갈 수 있는 왼쪽 끝, 뒤쪽 끝과 하강 한계를 정하세요.',
    keys: ['start_x', 'left_limit_x', 'start_y', 'back_limit_y', 'home_height', 'lower_height', 'move_speed']},
  physics: {name: '물리', title: '물리와 동작', help: '접촉 하중, 복원력과 동작 시간을 조정하세요.',
    keys: ['z_load_threshold', 'contact_hold_time', 'z_force_limit', 'descent_yaw_deg']},
};
const softRanges = {
  box_width: [20, 420], box_length: [20, 450], box_height: [10, 350], gap: [1, 400],
  inner_height: [50, 480], outer_height: [50, 480], bottom_wait: [0, 12], grip_kp: [0, 8],
};
const captions = {start_x: '원점 X · 좌우', start_y: '원점 Y · 앞뒤', left_limit_x: '왼쪽 끝 X', back_limit_y: '뒤쪽 끝 Y',
  home_height: '시작 높이', lower_height: '하강 한계 높이', box_width: '가로', box_length: '앞뒤 길이', box_height: '높이',
  box_mass: '포장 포함 무게', open_angle: '벌림 각도', closed_angle: '닫힘 각도'};
const icons = {box: '◇', rods: '≡', claw: '⋈', hook: '∩', travel: '↔', physics: '≈'};
function button(parent, text, action) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.addEventListener('click', action); parent.append(b);
  return b;
}
function owner(key, hook) {
  for (const [id, p] of Object.entries(parts)) if (id !== (hook ? 'claw' : 'hook') && p.keys.includes(key)) return id;
  if (key.startsWith('box_') || key.startsWith('com_')) return 'box';
  if (key.startsWith('rod_') || key.includes('rail_friction')) return 'rods';
  if (key === 'tip_friction' || key === 'arm_friction') return 'claw';
  if (key === 'release_x' || key === 'release_y') return 'travel';
  return 'physics';
}

// Position targets for an unloaded travel demonstration at the game's XY rate
// and Z motor slew limit. Real play can stop earlier on contact.
function travelPose(v, elapsed, hook) {
  const stages = [
    ['좌 이동', (v.start_x-v.left_limit_x)/v.move_speed, [v.left_limit_x,v.start_y,v.home_height]],
    ['상 이동', (v.back_limit_y-v.start_y)/v.move_speed, [v.left_limit_x,v.back_limit_y,v.home_height]],
    ['하강', (v.home_height-v.lower_height)/100, [v.left_limit_x,v.back_limit_y,v.lower_height]],
    ['하강 끝', hook ? v.bottom_wait : v.close_duration, [v.left_limit_x,v.back_limit_y,v.lower_height]],
    ['상승', (v.home_height-v.lower_height)/100, [v.left_limit_x,v.back_limit_y,v.home_height]],
  ];
  let start = [v.start_x,v.start_y,v.home_height];
  for (const [name,time,end] of stages) {
    if (Number.isFinite(time) && time > 0 && elapsed < time) {
      return {name, xyz:start.map((n,i)=>n+(end[i]-n)*elapsed/time)};
    }
    elapsed -= Math.max(0,time)||0; start=end;
  }
  return null;
}

export class MachineStudio {
  constructor(fields, hook) {
    this.fields = fields; this.hook = hook; this.active = 'box';
    this.pose = 'closed'; this.view = 'iso'; this.open = false;
    this.nodes = new Map(); this.sections = new Map();
    byId('studio-mode').textContent = '프리게임  /  ' + (hook ? '후크&링' : '하시와타시');
    this.drawing = new CabinetDrawing(byId('studio-canvas'), hook, {
      select: part => this.select(part),
      change: (key, val) => this.setValue(key, val),
    });
    const host = byId('settings-fields');
    const ids = ['box', hook ? 'hook' : 'rods', ...(hook ? [] : ['claw']), 'travel', 'physics'];
    for (const id of ids) {
      const tab = button(byId('studio-parts'), parts[id].name, () => this.select(id));
      const icon = document.createElement('span'); icon.textContent = icons[id]; icon.setAttribute('aria-hidden', 'true'); tab.prepend(icon);
      const section = document.createElement('div'), main = document.createElement('div'), extra = document.createElement('details');
      extra.className = 'studio-more'; const summary = document.createElement('summary'); summary.textContent = '세부 설정'; extra.append(summary);
      section.append(main, extra); this.sections.set(id, {tab, section, main, extra});
    }
    for (const [key, {input}] of fields) {
      const id = owner(key, hook), group = this.sections.get(id);
      const basic = parts[id].keys.includes(key), row = input.closest('label');
      const unitMatch = row.querySelector('.field-name').textContent.match(/\(([^()]*)\)$/);
      const label = row.querySelector('.field-name');
      label.textContent = captions[key] ?? label.textContent.replace(/\s*\([^()]*\)$/, '');
      if (unitMatch) {
        const unit = document.createElement('small'); unit.textContent = unitMatch[1]; label.append(' ', unit);
      }
      const wrap = document.createElement('div'); wrap.className = 'studio-control'; wrap.append(row);
      const range = basic && input.type === 'number' ? document.createElement('input') : null;
      if (range) {
        range.type = 'range'; range.className = 'studio-slider'; range.setAttribute('aria-label', label.textContent);
        range.step = input.dataset.increment || (key === 'bottom_wait' ? .1 : 1);
        wrap.append(range);
        range.addEventListener('input', () => this.setValue(key, range.valueAsNumber));
      }
      (basic ? group.main : group.extra).append(wrap);
      this.nodes.set(key, {wrap, range, id, basic});
      input.addEventListener('input', () => {
        if (key === 'open_angle' || key === 'closed_angle') this.pose = key === 'open_angle' ? 'open' : 'closed';
        if (key === 'lower_height') this.pose = 'bottom';
        if (key === 'home_height' || key === 'start_x' || key === 'start_y') this.pose = 'home';
        if (key === 'release_x' || key === 'release_y') this.pose = 'release';
        this.playTime = undefined;
        this.sync();
      });
    }
    // Preserve the original numeric inputs, form names, tune handlers and storage.
    host.replaceChildren(...Array.from(this.sections.values(), item => item.section));
    for (const [id, group] of this.sections) {
      for (const key of parts[id].keys) if (this.nodes.has(key)) group.main.append(this.nodes.get(key).wrap);
      group.extra.hidden = group.extra.children.length === 1;
    }
    const views = {iso: '입체', front: '정면', side: '측면', top: '위'};
    this.views = new Map(Object.entries(views).map(([id, name]) => [id,
      button(byId('studio-views'), name, () => { this.view = id; this.drawing.zoom = 1; this.sync(); })]));
    for (const [id, factor] of [['in', 1.22], ['out', 1 / 1.22]]) {
      byId('studio-zoom-' + id).onclick = () => {
        this.drawing.zoom = Math.min(2.25, Math.max(.65, this.drawing.zoom * factor)); this.draw();
      };
    }
    byId('settings-form').addEventListener('invalid', event => {
      const n = this.nodes.get(event.target.name);
      if (n) { this.select(n.id); if (!n.basic) this.sections.get(n.id).extra.open = true; }
    }, true);
    this.select('box');
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(byId('studio-canvas'));
  }
  setOpen(open) { this.open = open; this.playTime = undefined; if (open) this.sync(); }
  setBusy(busy) { document.querySelector('.studio-layout').inert = busy; }
  checkFields() {
    this.validate();
    for (const [key,{input}] of this.fields) if (!input.validity.valid) {
      const n=this.nodes.get(key); this.select(n.id);
      if (!n.basic) this.sections.get(n.id).extra.open=true;
      input.reportValidity(); return false;
    }
    return true;
  }
  setValue(key, value) {
    const input = this.fields.get(key)?.input;
    if (!input || !Number.isFinite(value)) return;
    const bounded = Math.min(input.max === '' ? Infinity : Number(input.max), Math.max(input.min === '' ? -Infinity : Number(input.min), value));
    input.value = String(Number(bounded.toFixed(3))); input.dispatchEvent(new Event('input', {bubbles: true}));
  }
  select(id) {
    if (!this.sections.has(id)) return;
    this.playTime = undefined;
    if (id !== this.active) this.pose = id === 'travel' ? 'home' : 'closed';
    this.active = id;
    for (const [key, group] of this.sections) {
      group.section.hidden = key !== id; group.tab.setAttribute('aria-pressed', String(key === id));
    }
    byId('studio-title').textContent = parts[id].title;
    byId('studio-description').textContent = parts[id].help;
    const control = byId('studio-pose'); control.replaceChildren();
    const poses = id === 'claw' ? [['closed','닫힘'], ['open','벌림']] :
      id === 'travel' ? [['home','원점'], ['end','이동 끝'], ['bottom','하강 끝'], ...(this.hook ? [] : [['release','놓기']])] : [];
    control.hidden = !poses.length;
    for (const [key, label] of poses) button(control, label, () => { this.playTime=undefined; this.pose = key; this.sync(); }).dataset.pose = key;
    if (id==='travel') {
      this.demo = button(control,'▶ 이동 시연',()=>{
        this.playTime=this.playTime===undefined?performance.now():undefined;
        this.draw();
      });
    }
    this.sync();
  }
  validate() {
    const v = key => Number(this.fields.get(key)?.input.value);
    for (const [key, other, invalid, message] of [
      ['left_limit_x','start_x',(a,b) => a > b,'왼쪽 끝은 원점 X 이하로 설정하세요.'],
      ['back_limit_y','start_y',(a,b) => a < b,'뒤쪽 끝은 원점 Y 이상으로 설정하세요.'],
      ['lower_height','home_height',(a,b) => a >= b,'하강 한계는 시작 높이보다 낮아야 합니다.'],
      ['closed_angle','open_angle',(a,b) => a >= b,'닫힘 각도는 벌림 각도보다 작아야 합니다.'],
    ]) this.fields.get(key)?.input.setCustomValidity(invalid(v(key), v(other)) ? message : '');
  }
  sync() {
    this.validate();
    for (const [key, {range}] of this.nodes) {
      if (!range) continue;
      const input = this.fields.get(key).input, value = input.valueAsNumber;
      if (!Number.isFinite(value)) continue;
      const bounds = softRanges[key] || [Number(input.min), Number(input.max)];
      range.min = Math.min(value, bounds[0]); range.max = Math.max(value, bounds[1]);
      range.value = value;
      const pct = 100 * (value - range.min) / (range.max - range.min || 1);
      range.style.setProperty('--fill', Math.min(100, Math.max(0, pct)) + '%');
    }
    for (const [id, el] of this.views) el.setAttribute('aria-pressed', String(id === this.view));
    for (const el of byId('studio-pose').children) el.setAttribute('aria-pressed', String(this.pose === el.dataset.pose));
    this.draw();
  }
  draw() {
    if (!this.open || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0; if (!this.open) return;
      this.values ??= {};
      for (const [key, {input}] of this.fields) {
        if (input.value !== '' && Number.isFinite(Number(input.value))) this.values[key] = Number(input.value);
      }
      const v = this.values;
      const angle=this.pose==='open'?v.open_angle:v.closed_angle;
      const a=angle*Math.PI/180;
      const tipGap=Math.round(2*v.claw_scale/100*(66-66*Math.cos(a)+257*Math.sin(a)));
      const summaries = {box: `${v.box_width} × ${v.box_length} × ${v.box_height} mm  ·  ${v.box_mass} g`,
        rods: `봉 사이  ${v.gap_12} / ${v.gap} / ${v.gap_34} mm`,
        travel: `좌 ${v.start_x-v.left_limit_x}  ·  상 ${v.back_limit_y-v.start_y}  ·  하강 ${v.home_height-v.lower_height} mm`,
        claw: `크기 ${v.claw_scale}%  ·  ${this.pose === 'open' ? '벌림' : '닫힘'} ${Number(angle?.toFixed(1))}°  ·  팁 사이 약 ${tipGap} mm`,
        hook: `후크 ${v.hook_height}  ·  링 ${v.ring_width}  ·  줄 ${v.chain_length} mm`,
        physics: `하강 정지 ${v.z_load_threshold} N  ·  모터 한계 ${v.z_force_limit} N`};
      const motion=this.playTime===undefined?null:travelPose(v,(performance.now()-this.playTime)/1000,this.hook);
      if (!motion) this.playTime=undefined;
      if(this.demo) this.demo.textContent=motion?'■ 시연 정지':'▶ 이동 시연';
      byId('studio-readout').textContent = (motion ? motion.name+'  ·  ' : '')+summaries[this.active];
      byId('studio-guidance').textContent = motion ? '접촉이 없는 상태의 이동 경로입니다.' :
        this.active === 'physics' ? '접촉과 힘의 결과는 게임에서 확인하세요.' : '부품을 누르거나 치수 손잡이를 끌어 조절하세요.';
      this.drawing.paint(v, this.active, this.view, this.pose, motion?.xyz);
      if (motion) this.draw();
    });
  }
}
