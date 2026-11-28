import {cloud,canPublish} from './cloud.js';
import {retrySync} from './records.js';
import {dailyAt} from '../daily/catalog.js';

const menu=document.querySelector('.account-menu'), action=menu.querySelector('[data-login]');
const status=menu.querySelector('[role=status]'), panel=document.querySelector('.management');
let api, generation=0;
function statusText(message) { status.textContent=message; status.title=message; }
async function changed(user) {
  const current=++generation;
  if (panel) panel.hidden=true;
  action.disabled=false;
  action.textContent=user?'로그아웃':'Google로 로그인';
  statusText(user ? user.displayName || user.email : '게스트');
  if (user) {
    retrySync().catch(() => { if(current===generation) statusText('기록 동기화 대기 중'); });
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
