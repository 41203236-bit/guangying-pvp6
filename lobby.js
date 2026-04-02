import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, get, set, update, onValue, remove, off } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const CLASS_META = {
  knight: {
    name: '騎士',
    short: '穩定壓制型',
    skill: '被動：一次保留最舊棋。主動：推進，將自己一顆棋移到相鄰空格。',
    image: './knight.png'
  },
  assassin: {
    name: '刺客',
    short: '擾亂拆節奏',
    skill: '被動：使敵方最舊棋脆弱 1 回合。主動：突襲，交換相鄰敵我棋位置。',
    image: './assassin.png'
  },
  mage: {
    name: '法師',
    short: '控制封鎖型',
    skill: '被動：留下殘影格。主動：封格，使對手下回合不能下在指定格。',
    image: './mage.png'
  }
};
const ROLE_NAME = { O: '光 / O', X: '影 / X' };

const tapStart = document.getElementById('tapStart');
const bgmVolume = document.getElementById('bgmVolume');
const sfxVolume = document.getElementById('sfxVolume');
const bgmOut = document.getElementById('bgmOut');
const sfxOut = document.getElementById('sfxOut');
const STORAGE = { bgm:'gy_bgm_volume', sfx:'gy_sfx_volume', unlocked:'gy_audio_unlocked' };
const menuBgm = new Audio('./bgm/menu.mp3');
menuBgm.loop = true;
menuBgm.preload = 'auto';
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function getStoredVolume(key, fallback){ const raw = localStorage.getItem(key); const n = raw===null?fallback:Number(raw); return Number.isFinite(n)?clamp01(n):fallback; }
function setStoredVolume(key, value){ localStorage.setItem(key, String(clamp01(value))); }
function applyAudioPrefs(){
  const bgm = getStoredVolume(STORAGE.bgm, 0.65);
  const sfx = getStoredVolume(STORAGE.sfx, 0.75);
  if(bgmVolume){ bgmVolume.value = String(Math.round(bgm*100)); if(bgmOut) bgmOut.textContent = `${Math.round(bgm*100)}%`; }
  if(sfxVolume){ sfxVolume.value = String(Math.round(sfx*100)); if(sfxOut) sfxOut.textContent = `${Math.round(sfx*100)}%`; }
  menuBgm.volume = bgm;
}
function tryPlayMenuBgm(){ menuBgm.volume = getStoredVolume(STORAGE.bgm, 0.65); menuBgm.play().then(()=>localStorage.setItem(STORAGE.unlocked,'1')).catch(()=>{}); }
function unlockAndEnter(){ localStorage.setItem(STORAGE.unlocked,'1'); if(tapStart) tapStart.classList.add('hide'); tryPlayMenuBgm(); }
applyAudioPrefs();
if(bgmVolume){ bgmVolume.addEventListener('input', ()=>{ const v = Number(bgmVolume.value)/100; setStoredVolume(STORAGE.bgm,v); menuBgm.volume=v; if(bgmOut) bgmOut.textContent=`${bgmVolume.value}%`; }); }
if(sfxVolume){ sfxVolume.addEventListener('input', ()=>{ const v = Number(sfxVolume.value)/100; setStoredVolume(STORAGE.sfx,v); if(sfxOut) sfxOut.textContent=`${sfxVolume.value}%`; }); }
if(tapStart){ tapStart.addEventListener('click', unlockAndEnter); }
window.addEventListener('beforeunload', ()=>{ menuBgm.pause(); menuBgm.currentTime = 0; });

const roleSelect = document.getElementById('roleSelect');
const factionO = document.getElementById('factionO');
const factionX = document.getElementById('factionX');
const createBtn = document.getElementById('createBtn');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const copyBtn = document.getElementById('copyBtn');
const roomCodeEl = document.getElementById('roomCode');
const myRoleText = document.getElementById('myRoleText');
const statusO = document.getElementById('statusO');
const statusX = document.getElementById('statusX');
const readyBtn = document.getElementById('readyBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusText = document.getElementById('statusText');
const countdownText = document.getElementById('countdownText');
const classCards = [...document.querySelectorAll('.class-card')];

const myPortraitWrap = document.getElementById('myPortraitWrap');
const myPortraitEmpty = document.getElementById('myPortraitEmpty');
const myPortrait = document.getElementById('myPortrait');
const myCharacterFull = document.getElementById('myCharacterFull');
const myCharacterType = document.getElementById('myCharacterType');
const myCharacterSkill = document.getElementById('myCharacterSkill');
const enemyPortraitWrap = document.getElementById('enemyPortraitWrap');
const enemyPortraitEmpty = document.getElementById('enemyPortraitEmpty');
const enemyPortrait = document.getElementById('enemyPortrait');
const enemyCharacterFull = document.getElementById('enemyCharacterFull');
const enemyCharacterType = document.getElementById('enemyCharacterType');
const enemyCharacterSkill = document.getElementById('enemyCharacterSkill');

let roomCode = null;
let myRole = null;
let selectedClass = null;
let unsub = null;
let roomCache = null;
let navTimer = null;
let countdownInterval = null;

function codeGen(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function roomRef(code){ return ref(db, `rooms/${code}`); }
function statusLine(p){
  if(!p?.joined) return '<span class="bad">未加入</span>';
  const cls = p.classKey ? `・${CLASS_META[p.classKey]?.name || ''}` : '';
  if(p.ready) return `<span class="ok">已準備${cls}</span>`;
  return `<span class="warn">未準備${cls}</span>`;
}
function setStatus(msg){ statusText.textContent = msg; }
function initBattleState(host){
  return {
    turn: host || 'O',
    grid: Array(9).fill(null),
    queues: { O: [], X: [] },
    data: {
      O:{hp:100, sp:0, skillUsed:0, stunned:false, defending:false},
      X:{hp:100, sp:0, skillUsed:0, stunned:false, defending:false}
    },
    timeLeft: 30,
    turnEndsAt: Date.now() + 30000
  };
}
function normalizePlayers(players = {}){
  return {
    O: { joined:false, ready:false, classKey:null, ...(players.O||{}) },
    X: { joined:false, ready:false, classKey:null, ...(players.X||{}) }
  };
}
function getEnemyRole(){ return myRole === 'O' ? 'X' : myRole === 'X' ? 'O' : null; }
function getClassMeta(key){ return key ? CLASS_META[key] : null; }
function updateFactionButtons(){
  factionO.classList.toggle('active', roleSelect.value === 'O');
  factionX.classList.toggle('active', roleSelect.value === 'X');
}
function setPortrait(which, role, classKey, joined){
  const isMe = which === 'me';
  const wrap = isMe ? myPortraitWrap : enemyPortraitWrap;
  const empty = isMe ? myPortraitEmpty : enemyPortraitEmpty;
  const img = isMe ? myPortrait : enemyPortrait;
  const full = isMe ? myCharacterFull : enemyCharacterFull;
  const type = isMe ? myCharacterType : enemyCharacterType;
  const skill = isMe ? myCharacterSkill : enemyCharacterSkill;
  const meta = getClassMeta(classKey);
  if(joined && meta){
    img.src = meta.image;
    img.style.display = 'block';
    empty.style.display = 'none';
    wrap.classList.remove('locked');
    full.textContent = `${ROLE_NAME[role]}・${meta.name}`;
    type.textContent = meta.short;
    skill.textContent = meta.skill;
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'flex';
    wrap.classList.add('locked');
    if(isMe){
      full.textContent = joined ? '尚未選擇職業' : '等待選擇';
      type.textContent = joined ? `${ROLE_NAME[role]} 已加入` : '未加入房間';
      skill.textContent = joined ? '請從中央三張職業卡中選擇騎士、刺客或法師，選好後才能按準備。' : '進房後先選擇光 / 影，再選擇騎士、刺客、法師，最後按下準備。';
    } else {
      full.textContent = joined ? '對手尚未選擇職業' : '等待對手';
      type.textContent = joined ? `${ROLE_NAME[role]} 已加入` : '尚未加入房間';
      skill.textContent = joined ? '對手已進房，等待對手完成職業選擇。' : '敵方完成陣營與職業選擇後，這裡會顯示角色名稱、定位與技能簡述。';
    }
  }
}
function syncClassSelection(room){
  const players = normalizePlayers(room?.players);
  selectedClass = myRole ? players[myRole]?.classKey || null : null;
  classCards.forEach(card => {
    const enabled = !!roomCode && room?.phase === 'lobby' && !!myRole && players[myRole]?.joined && !players[myRole]?.ready;
    card.disabled = !enabled;
    card.classList.toggle('locked', !enabled);
    card.classList.toggle('active', selectedClass === card.dataset.class);
  });
  const factionEnabled = !roomCode;
  factionO.disabled = !factionEnabled;
  factionX.disabled = !factionEnabled;
  updateFactionButtons();
}
function render(room){
  roomCache = room;
  const players = normalizePlayers(room?.players);
  roomCodeEl.textContent = roomCode || '未建立';
  myRoleText.textContent = myRole ? `你是 ${ROLE_NAME[myRole]}` : '未加入';
  statusO.innerHTML = statusLine(players.O);
  statusX.innerHTML = statusLine(players.X);
  const canReady = !!(roomCode && myRole && room && room.phase === 'lobby' && players[myRole]?.joined && players[myRole]?.classKey);
  readyBtn.disabled = !canReady;
  leaveBtn.disabled = !roomCode;
  readyBtn.textContent = players[myRole]?.ready ? '取消準備' : '準備就緒';

  setPortrait('me', myRole, players[myRole]?.classKey || null, !!players[myRole]?.joined);
  const enemyRole = getEnemyRole();
  setPortrait('enemy', enemyRole, players[enemyRole]?.classKey || null, !!players[enemyRole]?.joined);
  syncClassSelection(room);

  if(!roomCode){ setStatus('尚未加入房間'); countdownText.style.display='none'; return; }
  if(room.phase === 'lobby'){
    countdownText.style.display='none';
    if(!(players.O.joined && players.X.joined)) setStatus('等待另一位玩家加入');
    else if(!(players.O.classKey && players.X.classKey)) setStatus('雙方都要完成選角才能準備');
    else if(!(players.O.ready && players.X.ready)) setStatus('雙方都要按準備才會開始');
  }
  if(room.phase === 'countdown'){
    startCountdown(room.startAt);
    setStatus('雙方已準備，倒數進入戰鬥');
  } else {
    stopCountdown();
  }
  if(room.phase === 'playing'){
    setStatus('正在進入戰鬥…');
    countdownText.style.display='none';
    if(navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(()=>{
      location.href = `battle.html?room=${encodeURIComponent(roomCode)}&role=${encodeURIComponent(myRole)}`;
    }, 250);
  }
}
function stopCountdown(){ if(countdownInterval){ clearInterval(countdownInterval); countdownInterval=null; } }
function startCountdown(startAt){
  stopCountdown();
  countdownText.style.display='block';
  const tick = ()=>{
    const diff = (startAt || Date.now()) - Date.now();
    let remain = Math.max(0, Math.ceil(diff/1000));
    countdownText.textContent = diff <= -200 ? '開始！' : String(Math.max(1, remain));
  };
  tick();
  countdownInterval = setInterval(tick, 100);
}
async function maybeAdvance(room){
  if(!roomCode || !myRole || !room) return;
  const players = normalizePlayers(room.players);
  const bothJoined = players.O?.joined && players.X?.joined;
  const bothChosen = players.O?.classKey && players.X?.classKey;
  const bothReady = players.O?.ready && players.X?.ready;
  if(myRole === room.host && room.phase === 'lobby' && bothJoined && bothChosen && bothReady){
    const startAt = Date.now() + 3000;
    await update(roomRef(roomCode), { phase:'countdown', startAt, state:initBattleState(room.host) });
  } else if(myRole === room.host && room.phase === 'countdown' && room.startAt && Date.now() >= room.startAt){
    await update(roomRef(roomCode), { phase:'playing' });
  }
}
function subscribe(code){
  if(unsub) off(roomRef(code), 'value', unsub);
  unsub = onValue(roomRef(code), async snap => {
    const room = snap.val();
    if(!room){ setStatus('房間不存在或已被刪除'); return; }
    render(room);
    await maybeAdvance(room);
  });
}
async function createRoom(){
  myRole = roleSelect.value;
  roomCode = codeGen();
  selectedClass = null;
  const room = {
    phase:'lobby',
    host: myRole,
    startAt: null,
    players: {
      O:{joined: myRole==='O', ready:false, classKey:null},
      X:{joined: myRole==='X', ready:false, classKey:null}
    }
  };
  await set(roomRef(roomCode), room);
  subscribe(roomCode);
  render(room);
}
async function joinRoom(){
  const code = roomInput.value.trim().toUpperCase();
  if(!code){ setStatus('先輸入房號'); return; }
  const snap = await get(roomRef(code));
  if(!snap.exists()){ setStatus('找不到這個房間'); return; }
  const room = snap.val();
  myRole = roleSelect.value;
  if(room.phase !== 'lobby'){ setStatus('這個房間已經開始戰鬥'); return; }
  const players = normalizePlayers(room.players);
  if(players?.[myRole]?.joined){ setStatus('這個陣營已被佔用，請換另一邊'); return; }
  roomCode = code;
  selectedClass = null;
  await update(roomRef(roomCode), { [`players/${myRole}`]: { joined:true, ready:false, classKey:null } });
  subscribe(roomCode);
  render({ ...room, players:{ ...players, [myRole]: { joined:true, ready:false, classKey:null } } });
}
async function chooseClass(classKey){
  if(!roomCode || !myRole || !roomCache) return;
  const players = normalizePlayers(roomCache.players);
  if(roomCache.phase !== 'lobby' || !players[myRole]?.joined || players[myRole]?.ready) return;
  selectedClass = classKey;
  await update(roomRef(roomCode), { [`players/${myRole}/classKey`]: classKey, [`players/${myRole}/ready`]: false });
}
async function toggleReady(){
  if(!roomCode || !myRole || !roomCache) return;
  const players = normalizePlayers(roomCache.players);
  if(!players[myRole]?.classKey){ setStatus('請先選擇職業'); return; }
  const current = !!players[myRole]?.ready;
  await update(roomRef(roomCode), { [`players/${myRole}/ready`]: !current });
}
async function leaveRoom(){
  if(!roomCode || !myRole) return;
  const code = roomCode;
  const role = myRole;
  const host = roomCache?.host;
  if(unsub) off(roomRef(code), 'value', unsub);
  unsub = null;
  if(role === host){
    await remove(roomRef(code));
  } else {
    await update(roomRef(code), { [`players/${role}`]: { joined:false, ready:false, classKey:null } });
  }
  roomCode = null; myRole = null; selectedClass = null; roomCache = null;
  roomCodeEl.textContent='未建立'; myRoleText.textContent='未加入'; statusO.innerHTML='未加入'; statusX.innerHTML='未加入'; readyBtn.disabled=true; leaveBtn.disabled=true; countdownText.style.display='none'; setStatus('已離開房間');
  syncClassSelection(null);
  setPortrait('me', null, null, false);
  setPortrait('enemy', null, null, false);
}

roleSelect.addEventListener('change', ()=>{ updateFactionButtons(); });
factionO.addEventListener('click', ()=>{ if(!factionO.disabled){ roleSelect.value = 'O'; updateFactionButtons(); } });
factionX.addEventListener('click', ()=>{ if(!factionX.disabled){ roleSelect.value = 'X'; updateFactionButtons(); } });
classCards.forEach(card => card.addEventListener('click', ()=> chooseClass(card.dataset.class)));
createBtn.addEventListener('click', createRoom);
joinBtn.addEventListener('click', joinRoom);
readyBtn.addEventListener('click', toggleReady);
leaveBtn.addEventListener('click', leaveRoom);
copyBtn.addEventListener('click', async ()=>{ if(roomCode){ await navigator.clipboard.writeText(roomCode); setStatus('房號已複製'); }});
setInterval(async ()=>{ if(roomCache) await maybeAdvance(roomCache); }, 500);
updateFactionButtons();
syncClassSelection(null);
setPortrait('me', null, null, false);
setPortrait('enemy', null, null, false);
