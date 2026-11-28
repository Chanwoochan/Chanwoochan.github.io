import {cloud,canPublish} from './cloud.js';
import {retrySync} from './records.js?v=ranks1';
import {formatTag,playerNumber,getNickname,rename} from './profile.js';
import {dailyAt} from '../daily/catalog.js';

const menu=document.querySelector('.account-menu'), action=menu.querySelector('[data-login]');
const status=menu.querySelector('[role=status]'), panel=document.querySelector('.management');
let api, generation=0;
let profile=null;
const edit=document.createElement('button');
edit.type='button';edit.textContent='닉네임 설정';edit.hidden=true;action.before(edit);
const dialog=document.createElement('dialog');
dialog.className='nickname-dialog';
dialog.setAttribute('aria-labelledby','nickname-title');
dialog.innerHTML=`<form><h2 id="nickname-title">닉네임 설정</h2>
  <p>닉네임은 중복해서 쓸 수 있어요. 랭킹에는 고유 번호와 함께 표시됩니다.</p>
  <label for="nickname-input">닉네임</label><div class="nick-field"><input id="nickname-input" required autocomplete="off"><strong></strong></div>
  <small role="status" aria-live="polite"></small><div class="nick-actions"><button type="button">취소</button><button type="submit">저장</button></div></form>`;
document.body.append(dialog);
const input=dialog.querySelector('input'), message=dialog.querySelector('[role=status]'), save=dialog.querySelector('[type=submit]');
function announce(value) {
  profile=value;
  window.dispatchEvent(new CustomEvent('claw-profile',{detail:value}));
}
async function showProfile(uid,current) {
  const number=await playerNumber(uid),nickname=await getNickname(number);
  if(current!==generation || api.auth.currentUser?.uid!==uid) return;
  announce({number,nickname});statusText(nickname+' '+formatTag(number));
}
edit.onclick=async()=>{
  const current=generation,uid=api?.auth.currentUser?.uid;
  if(!uid)return;
  try {
    if(!profile)await showProfile(uid,current);
    if(current!==generation || !profile)return;
    input.value=profile.nickname;dialog.querySelector('strong').textContent=formatTag(profile.number);
    message.textContent='1~16자';save.disabled=false;dialog.showModal();input.select();
  }catch{statusText('프로필을 열지 못했습니다. 다시 시도해 주세요.');}
};
dialog.querySelector('[type=button]').onclick=()=>dialog.close();
dialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault();
  if(!profile||save.disabled)return;
  const current=generation, number=profile.number;save.disabled=true;message.textContent='저장 중…';
  try {
    const nickname=await rename(number,input.value);
    if(current!==generation)return;
    announce({number,nickname});statusText(nickname+' '+formatTag(number));dialog.close();
  }catch(error){if(current===generation)message.textContent=error.code?'저장하지 못했습니다. 연결을 확인해 주세요.':error.message;}
  finally{if(current===generation)save.disabled=false;}
};
function statusText(message) { status.textContent=message; status.title=message; }
async function changed(user) {
  const current=++generation;
  if(dialog.open)dialog.close();announce(null);edit.hidden=!user;
  if (panel) panel.hidden=true;
  action.disabled=false;
  action.textContent=user?'로그아웃':'Google로 로그인';
  statusText(user ? '프로필 연결 중…' : '게스트');
  if (user) {
    retrySync().catch(() => { if(current===generation) action.title='기록 동기화 대기 중'; });
    showProfile(user.uid,current).catch(()=>{if(current===generation)statusText('프로필 연결 대기');});
    if (panel && await canPublish().catch(() => false) && current===generation) panel.hidden=false;
  }
  window.dispatchEvent(new Event('claw-account'));
}
action.addEventListener('click',async () => {
  action.disabled=true;
  try {
    api ||= await cloud();
    if (api.auth.currentUser) await api.account.signOut(api.auth);
    else await api.account.signInWithPopup(api.auth,new api.account.GoogleAuthProvider());
  } catch(error) {
    if(error.code!=='auth/popup-closed-by-user') statusText(error.code==='auth/popup-blocked'?'팝업을 허용하고 다시 눌러주세요.':'로그인에 연결하지 못했습니다. 다시 시도해 주세요.');
  } finally { action.disabled=false; }
});
cloud().then(value => {
  api=value;
  api.account.onAuthStateChanged(api.auth,changed);
}).catch(() => { statusText('계정 연결 대기'); action.disabled=false; });
if (panel) {
  const form=panel.querySelector('form'), date=form.querySelector('input');
  date.value=dailyAt().date;
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(date.reportValidity()) location.href=new URL('../daily/?manage=1&date='+date.value,import.meta.url);
  });
}
