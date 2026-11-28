import {cloud} from '../account/cloud.js';
import {formatTag,getNickname} from '../account/profile.js';
import {dailyAt} from '../daily/catalog.js';

const byId=id=>document.getElementById(id);
const table=document.querySelector('.board table'), body=table.tBodies[0];
let entries=[], cursor=null, generation=0, dateKey, timer, mine=null, hasMore=false;
function render() {
  const fragment=document.createDocumentFragment();
  let previous, place=0;
  entries.forEach(({number,nickname,count},index)=>{
    if (previous!==count) place=index+1;
    previous=count;
    const row=document.createElement('tr');
    row.insertCell().textContent=place+'위';
    const name=row.insertCell(), tag=document.createElement('small');
    name.append(nickname); tag.textContent=formatTag(number); name.append(tag);
    if (number===mine) {
      row.className='mine';
      const label=document.createElement('small'); label.className='own-label'; label.textContent='나'; name.append(label);
    }
    row.insertCell().textContent=count.toLocaleString('ko-KR')+'개'; fragment.append(row);
  });
  body.replaceChildren(fragment); table.hidden=!entries.length;
}
async function loadPage(append=false) {
  const token=++generation, today=dailyAt();
  if (dateKey!==today.day) { entries=[];cursor=null;hasMore=false;render();append=false; }
  dateKey=today.day; byId('rank-date').textContent=today.date+' · 한국 시간';
  clearTimeout(timer);timer=setTimeout(()=>loadPage(),Math.max(1,today.next-Date.now()+30));
  byId('refresh').disabled=byId('more').disabled=true;byId('rank-state').textContent='순위를 불러오는 중…';
  try {
    const {db,store}=await cloud();
    const sorted=[store.orderBy('count','desc')];
    if (append && cursor) sorted.push(store.startAfter(cursor));
    const snapshot=await store.getDocs(store.query(store.collection(db,'boards',String(today.day),'scores'),...sorted,store.limit(51)));
    const docs=snapshot.docs.slice(0,50);
    const rows=await Promise.all(docs.map(async doc=>({number:Number(doc.id),count:doc.data().count,nickname:await getNickname(doc.id)})));
    if (token!==generation) return;
    const merged=new Map((append?entries:[]).map(row=>[row.number,row]));
    rows.forEach(row=>merged.set(row.number,row));
    entries=[...merged.values()].sort((a,b)=>b.count-a.count||a.number-b.number);
    cursor=docs.at(-1);hasMore=snapshot.size>50;render();
    byId('rank-state').textContent=snapshot.metadata.fromCache?'오프라인 · 이 기기에 저장된 순위입니다.':entries.length?'':'오늘은 아직 등록된 획득 기록이 없습니다.';
  } catch {
    if(token===generation) byId('rank-state').textContent='순위를 불러오지 못했습니다. 새로고침해 주세요.';
  } finally {
    if(token===generation) {
      byId('more').hidden=!hasMore; byId('refresh').disabled=byId('more').disabled=false;
    }
  }
}
window.addEventListener('claw-profile',event=>{
  mine=event.detail?.number??null;
  if(mine) {const row=entries.find(r=>r.number===mine);if(row)row.nickname=event.detail.nickname;}
  render();
});
byId('refresh').onclick=()=>loadPage();
byId('more').onclick=()=>loadPage(true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPage();});
window.addEventListener('online',()=>loadPage());
window.addEventListener('claw-rank-synced',()=>loadPage());
loadPage();
