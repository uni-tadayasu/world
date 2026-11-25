import * as THREE from './vendor/three.module.js';
import {createWorld} from './world.js';
import {createInterior} from './interiors.js';
import {createLife} from './life.js';
import {createAvatar} from './avatar.js';
import {createGamepadManager} from './gamepad.js';
import {loadCharacterModel} from './model-loader.js';
import {saveCharacter,loadCharacter,deleteCharacter} from './persistence.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={person:'M20 21v-2a6 6 0 0 0-12 0v2M14 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 8v6M2 11h6',gamepad:'M7 8h10c3 0 5 8 4 10-.7 2-3 .2-5-2H8c-2 2.2-4.3 4-5 2C2 16 4 8 7 8ZM7 10v4M5 12h4M16 11h.01M18 14h.01',sound:'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',soundOff:'M11 5 6 9H3v6h3l5 4V5ZM16 9l5 6M21 9l-5 6',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',walk:'M14 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 11l4-4 4 2 3 4M11 7l-1 7 5 7M10 14l-4 7',run:'M16 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 8l5-1 4 4 4 1M11 7l-3 7 5 1-2 6M8 14l-4 4',jump:'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 9v6M6 7l6 4 6-4M12 15l-4 5M12 15l4 5',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',moon:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',hand:'M8 12V5a1.5 1.5 0 0 1 3 0v5-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v6c0 4-3 6-6 6h-2c-2 0-4-2-5-4l-3-4c-1-2 1-3 2-2l2 2Z',meal:'M5 3v6c0 3 6 3 6 0V3M8 3v18M18 3c-3 3-3 9 0 9h2M20 3v18',energy:'m13 2-8 12h6l-1 8 9-12h-7l1-8Z',smile:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 14c2 3 6 3 8 0M8 9h.01M16 9h.01',map:'m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16',bag:'M4 7h16l1 14H3L4 7ZM8 7V5a4 4 0 0 1 8 0v2',book:'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1ZM12 5v15',camera:'M3 7h4l2-3h6l2 3h4v14H3V7ZM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01',expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',close:'m6 6 12 12M18 6 6 18',coffee:'M3 7h13v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V7ZM16 8h2a3 3 0 0 1 0 6h-2M6 2v2M10 1v3M14 2v2',work:'M8 7V4h8v3M3 7h18v14H3V7ZM3 12c6 3 12 3 18 0M10 13h4v3h-4v-3Z',art:'M3 3h18v18H3V3ZM3 17l6-7 5 6 3-4 4 5M16 7h.01',leaf:'M20 3C8 3 2 8 5 15s15 5 15-12ZM5 20l10-12',drop:'M12 2S5 11 5 15a7 7 0 0 0 14 0c0-4-7-13-7-13Z',home:'m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',check:'m5 12 4 4L19 6',upload:'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z',chat:'M3 4h18v13H9l-6 4V4ZM7 8h10M7 12h7',music:'M9 18V5l11-2v13M9 7l11-2M9 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0ZM20 16a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z'};
function icon(name,size=21){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.spark}"/></svg>`;}
function fillIcons(root=document){root.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));}
fillIcons();
function toast(message){const n=document.createElement('div');n.className='toast';n.textContent=message;$('toasts').append(n);setTimeout(()=>n.remove(),5500);}
const life=createLife({onToast:toast});
const gamepad=createGamepadManager({onConnect:d=>{toast('コントローラーを接続しました');$('pad-connected').hidden=false;},onDisconnect:()=>{toast('コントローラーの接続が解除されました');$('pad-connected').hidden=true;},onToast:toast});
let renderer,scene,camera,world,active,avatar,sun,hemi,fillLight;
let started=false,busy=false,modalType='',activeBuilding=null,outdoorPose={...life.state.position},selectedDestination=null;
let yaw=life.state.position.yaw||0,pitch=.28,view='third',playerYaw=0,jumpY=0,jumpV=0,walkTime=0;
let pos={x:10,z:33},velocity={x:0,z:0},nearest=null,exteriorReal=false,lastFrame=performance.now(),lastUI=0,lastMap=0,autoQuality=1;
let photoViews={},photoFiles={},characterInfo={name:'街の住人',description:'標準キャラクター · 関節モーション'},selectedQuality='high',avatarRevision=0;
let social=null,possessions=null,previousFocus=null,sessionFrames=0,fpsEstimate=60,lastStream=0,streaming=false,geoController=null,realLocationName='現在地の街';
const keys=new Set(),touch={x:0,y:0,run:false},interiorCache=new Map();
const WORLD_URL='https://machi-life.hisa-0128-1996.chatgpt.site';
const poseTemp=new THREE.Vector3(),targetCamera=new THREE.Vector3(),lookAt=new THREE.Vector3();
const buildingIcons={home:'home',cafe:'coffee',market:'bag',office:'work',gallery:'art',bookstore:'book',park:'leaf'};
const descriptions={home:'料理をして、くつろいで、眠る。',cafe:'淹れたての一杯と、ちいさな仕事。',market:'今日のごはんを、ここで。',office:'働いて、この街での暮らしを育てる。',gallery:'気ままにアートを楽しむ。',bookstore:'次の一冊に出会う。',park:'緑のなかで、ひと休み。'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function boot(){
  try{
    $('load-progress').style.width='25%';
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
    renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer:coarse)').matches?1.3:1.65));
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.domElement.tabIndex=0;$('stage').append(renderer.domElement);
    scene=new THREE.Scene();scene.background=new THREE.Color('#bdd6db');scene.fog=new THREE.FogExp2('#bdd6db',.0031);
    camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.08,1800);
    hemi=new THREE.HemisphereLight('#e2f2ff','#73795d',2.25);scene.add(hemi);
    sun=new THREE.DirectionalLight('#fff1d0',3.2);sun.position.set(-40,65,30);sun.castShadow=true;sun.shadow.mapSize.set(1536,1536);sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60;sun.shadow.camera.near=.5;sun.shadow.camera.far=180;sun.shadow.bias=-.0004;sun.shadow.normalBias=.035;scene.add(sun);scene.add(sun.target);
    fillLight=new THREE.DirectionalLight('#dbe8ff',.55);fillLight.position.set(30,20,-30);scene.add(fillLight);
    await wait(20);$('load-label').textContent='街と暮らしを組み立てています';world=createWorld(THREE);scene.add(world.group);active=world;
    $('load-progress').style.width='65%';
    avatar=createAvatar(THREE);scene.add(avatar.group);
    pos={x:world.spawn.x,z:world.spawn.z};outdoorPose={...world.spawn};yaw=world.spawn.yaw;
    avatar.group.position.set(pos.x,.14,pos.z);playerYaw=0;
    updateCamera(1,true);applyQuality(life.state.settings.quality);
    setupControls();setupUI();updateHUD();drawMap($('minimap'));initPossessions();
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();busy=true;showPanel('描画を一時停止しました','GRAPHICS',`<p>端末の描画機能が一時停止しました。保存済みの暮らしは保持されています。</p><button class="primary-btn" data-cmd="reload">再読み込み</button>`);});
    window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
    window.addEventListener('pagehide',()=>{saveGame();audio.stop();});
    document.addEventListener('visibilitychange',()=>{keys.clear();touch.x=touch.y=0;velocity.x=velocity.z=0;if(document.hidden){saveGame();audio.stop();}else{lastFrame=performance.now();if(life.state.settings.sound&&started)audio.start();}});
    $('load-progress').style.width='100%';$('load-label').textContent='あなたの一日が、はじまります';
    setTimeout(()=>$('loading').classList.add('finished'),200);setTimeout(()=>$('loading').hidden=true,700);
    requestAnimationFrame(frame);
    restoreCharacter();
  }catch(error){console.error(error);$('load-label').textContent='3D画面を開始できませんでした。ブラウザのハードウェアアクセラレーションを有効にして、再読み込みしてください。';$('loading').insertAdjacentHTML('beforeend','<button class="primary-btn" onclick="location.reload()">再読み込み</button>');}
}

function saveGame(){if(!world)return;if(!activeBuilding&&!world.real){outdoorPose={x:pos.x,z:pos.z,yaw};}life.state.position={...outdoorPose};life.state.location=activeBuilding?active.label:(world.real?'現在地の街':'ひかり町');return life.save();}
function startGame(){started=true;closeModal();$('intro').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');$('start').textContent='暮らしを続ける';renderer.domElement.focus();if(life.state.settings.sound)audio.start();updateHUD();}
function startDemo(){if(activeBuilding){active.group.visible=false;activeBuilding=null;}if(world.real){scene.remove(world.group);world.dispose?.();world=createWorld(THREE);scene.add(world.group);}world.group.visible=true;active=world;activeBuilding=null;exteriorReal=false;const saved=life.state.position;pos={x:world.spawn.x,z:world.spawn.z};if(saved&&Number.isFinite(saved.x)&&!collides(saved.x,saved.z)){pos={x:saved.x,z:saved.z};}yaw=0;pitch=.28;selectedDestination=null;scene.fog.density=.0031;possessions?.attachWorld(world,(x,z,r)=>collides(x,z,r));if(possessions)possessions.group.visible=true;startGame();toast('ひかり町は、生活を体験するための架空の街です。');updateCamera(1,true);}
function showPanel(title,eyebrow,html,type='custom',wide=false){
  if(modalType==='social'&&type!=='social')social?.close?.();
  keys.clear();touch.x=touch.y=0;velocity.x=velocity.z=0;previousFocus=document.activeElement;
  modalType=type;$('modal-title').textContent=title;$('modal-eyebrow').textContent=eyebrow;$('modal-body').innerHTML=html;$('modal').classList.toggle('wide',wide);$('modal-layer').hidden=false;
  setTimeout(()=>$('close-modal').focus(),20);return $('modal-body');
}
function closeModal(){if(modalType==='social')social?.close?.();modalType='';$('modal-layer').hidden=true;keys.clear();touch.x=touch.y=0;$('joystick-knob').style.transform='';if(started)renderer?.domElement.focus();else previousFocus?.focus?.();}

function openLocation(){showPanel('今いる場所から、はじめる','THE REAL WORLD',`<p>端末の位置情報を使い、現在地を中心に半径約450mの道路・建物・地形を読み込みます。歩いてエリアの端へ近づくと、次のエリアを読み込みます。</p><div class="notice">位置情報を許可すると、周辺地図の取得のため緯度・経度が地図・標高データ提供元へ送られます。位置座標をほかのプレイヤーへ自動共有することはありません。</div><button class="primary-btn" data-cmd="locate">${icon('pin')} 現在地を取得して始める</button><p class="section-label">位置情報を使えないとき</p><p>任意の緯度・経度も指定できます。入力地点は現在地として扱いません。</p><div class="form-field"><input id="latitude-input" type="number" step="any" min="-85" max="85" placeholder="緯度 例 35.6812" aria-label="緯度"><input id="longitude-input" type="number" step="any" min="-180" max="180" placeholder="経度 例 139.7671" aria-label="経度"></div><div class="button-row"><button class="secondary-btn" data-cmd="coordinates">この座標を読み込む</button><button class="secondary-btn" data-cmd="demo">架空のひかり町で体験する</button></div><div class="notice">道路・建物の配置は実地図データに基づきます。記録のない高さ、建物の外観・室内、人物はゲーム用の表現です。写真のような現実世界の完全再現ではありません。標高は近似データです。</div><p class="legal-note"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">地図データ © OpenStreetMap contributors / ODbL</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">地形 © Mapzen / 各標高データ提供元</a></p>`,'location');}
async function locate(){
  if(!navigator.geolocation){toast('このブラウザは位置情報に対応していません。座標指定で開始できます。');return;}
  const b=$('modal-body').querySelector('[data-cmd="locate"]');if(b){b.disabled=true;b.textContent='端末の位置情報を確認しています…';}
  navigator.geolocation.getCurrentPosition(p=>loadReal(p.coords.latitude,p.coords.longitude,{accuracy:p.coords.accuracy}),e=>{if(b){b.disabled=false;b.textContent='現在地を取得して始める';}toast(e.code===1?'位置情報が許可されませんでした。ブラウザの位置情報設定を確認するか、座標を指定してください。':e.code===3?'位置情報の取得が時間切れになりました。もう一度お試しください。':'現在地を取得できませんでした。座標を指定して始めることもできます。');},{enableHighAccuracy:true,timeout:18000,maximumAge:60000});
}
async function loadReal(latitude,longitude,{accuracy=null,stream=false}={}){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180){toast('緯度は−85〜85、経度は−180〜180で入力してください。');return;}
  if(streaming)return;streaming=true;busy=true;geoController=new AbortController();
  if(!stream)showPanel('現在地の街を読み込んでいます','LOADING YOUR WORLD',`<p id="geo-progress">標高と地図を取得しています…</p><div class="notice">初回は数十秒かかる場合があります。画像やキャラクターファイルは送信されません。</div><button class="secondary-btn" data-cmd="cancel-geo">キャンセル</button>`,'geo-loading');
  try{
    const [{createRealWorld},{loadTerrain}]=await Promise.all([import('./realworld.js'),import('./terrain.js')]);
    let terrain=null,terrainWarning='';
    try{terrain=await loadTerrain({latitude,longitude,radius:450,signal:geoController.signal,onProgress:v=>{if($('geo-progress'))$('geo-progress').textContent=v.message||'地形を読み込んでいます';}});}catch(e){if(geoController.signal.aborted)throw e;terrainWarning='標高データを取得できなかったため、地形は平面で表示しています。';}
    const next=await createRealWorld(THREE,{latitude,longitude,radius:450,terrain,signal:geoController.signal,onProgress:v=>{if($('geo-progress'))$('geo-progress').textContent=typeof v==='string'?v:v.message||'道路と建物を読み込んでいます';}});
    if(geoController.signal.aborted){next.dispose?.();throw new Error('中止しました');}
    if(activeBuilding){active.group.visible=false;activeBuilding=null;}
    scene.remove(world.group);if(world.real)world.dispose?.();else disposeGroup(world.group);world=next;active=world;scene.add(world.group);world.group.visible=true;pos={x:world.spawn.x,z:world.spawn.z};yaw=stream?yaw:world.spawn.yaw||0;pitch=.28;selectedDestination=null;exteriorReal=true;scene.fog.density=.0018;scene.fog.color.set('#bdd6db');
    if(!stream)realLocationName=accuracy!==null?'現在地の街':'指定地点の街';
    possessions?.attachWorld(world,(x,z,r)=>collides(x,z,r));if(possessions)possessions.group.visible=true;
    startGame();updateCamera(1,true);$('location-label').textContent=realLocationName;
    if(terrainWarning)toast(terrainWarning);
    if(accuracy!==null)toast(`現在地を読み込みました（端末の測位精度：約${Math.round(accuracy)}m）。`);
    else if(!stream)toast('指定された座標の街を読み込みました。');
    if(world.sourceInfo?.note)toast(world.sourceInfo.note);
    lastStream=performance.now();
  }catch(e){console.warn(e);if(!geoController?.signal.aborted){toast('地図を読み込めませんでした。通信環境を確認して再度お試しください。');if(!stream)showPanel('現在地の読み込みに失敗しました','WORLD CONNECTION',`<p>${esc(e.message)}</p><p>現在地とは異なる架空の街へ自動的に切り替えることはありません。</p><div class="button-row"><button class="primary-btn" data-cmd="location">もう一度、場所を指定する</button><button class="secondary-btn" data-cmd="demo">ひかり町で体験する</button></div>`,'location-error');}}
  finally{busy=false;streaming=false;geoController=null;}
}

function activeGround(x=pos.x,z=pos.z){return activeBuilding?0:(world.terrainHeight?world.terrainHeight(x,z):.14);}
function pointInPolygon(x,z,p){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];const ax=a.x??a[0],az=a.z??a[1],bx=b.x??b[0],bz=b.z??b[1];if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;}return inside;}
function collides(x,z,r=.33){
  const b=active.bounds;if(x<b.minX+r||x>b.maxX-r||z<b.minZ+r||z>b.maxZ-r)return true;
  for(const c of [...active.colliders,...(!activeBuilding&&possessions?possessions.colliders:[])]){if(x+r<c.minX||x-r>c.maxX||z+r<c.minZ||z-r>c.maxZ)continue;
    if(c.holes?.some(h=>pointInPolygon(x,z,h)))continue;
    if(c.polygon?.length){if(pointInPolygon(x,z,c.polygon))return true;for(let i=0;i<c.polygon.length;i++){const a=c.polygon[i],b=c.polygon[(i+1)%c.polygon.length],ax=a.x??a[0],az=a.z??a[1],bx=b.x??b[0],bz=b.z??b[1],dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-ax-dx*t,z-az-dz*t)<r)return true;}}
    else{const nx=Math.max(c.minX,Math.min(x,c.maxX)),nz=Math.max(c.minZ,Math.min(z,c.maxZ));if(Math.hypot(x-nx,z-nz)<r)return true;}
  }return false;
}
function move(dx,dz){const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.22));for(let i=0;i<count;i++){if(!collides(pos.x+dx/count,pos.z))pos.x+=dx/count;if(!collides(pos.x,pos.z+dz/count))pos.z+=dz/count;}}
function doJump(){if(!started||modalType||busy||jumpY>.01)return;jumpV=4.5;}
function updateCamera(dt,instant=false){
  const ground=activeGround();
  if(view==='first'&&started){avatar.group.visible=false;camera.position.set(pos.x,ground+1.66+jumpY,pos.z);camera.rotation.order='YXZ';camera.rotation.set(-pitch+.22,yaw,0);return;}
  avatar.group.visible=true;const d=activeBuilding?3.6:5.2;let actual=d;
  // Keep the follow camera in front of solid walls and inside room bounds.
  for(let r=.45;r<d;r+=.22){if(collides(pos.x+Math.sin(yaw)*r,pos.z+Math.cos(yaw)*r,.12)){actual=Math.max(.5,r-.25);break;}}
  const elevation=1.8+Math.sin(pitch)*actual;targetCamera.set(pos.x+Math.sin(yaw)*actual,ground+elevation+jumpY*.5,pos.z+Math.cos(yaw)*actual);
  if(instant)camera.position.copy(targetCamera);else camera.position.lerp(targetCamera,1-Math.exp(-dt*12));
  lookAt.set(pos.x,ground+1.25+jumpY*.8,pos.z);camera.lookAt(lookAt);
}
function setView(){view=view==='third'?'first':'third';pitch=view==='first'?.22:.28;toast(view==='third'?'三人称視点：キャラクターを後ろから見ます。':'一人称視点：キャラクターの目線で歩きます。');updateCamera(1,true);}

function frame(now){
  requestAnimationFrame(frame);const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;if(document.hidden)return;
  social?.update?.();
  const pad=gamepad.update();handleGamepadMenu(pad,now);
  const playing=started&&!modalType&&!busy;
  let moving=false,running=false;
  if(playing){
    let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touch.x+pad.moveX;
    let f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+touch.y+pad.moveY;
    const len=Math.hypot(x,f);if(len>1){x/=len;f/=len;}
    if(Math.abs(pad.lookX)>.01)yaw-=pad.lookX*dt*2.2*life.state.settings.sensitivity;
    if(Math.abs(pad.lookY)>.01)pitch=THREE.MathUtils.clamp(pitch-pad.lookY*dt*1.5,-.12,1.05);
    running=(keys.has('ShiftLeft')||keys.has('ShiftRight')||touch.run||pad.run)&&life.state.energy>5;
    const speed=running?5.3:2.7;const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*x)*speed,dz=(-Math.cos(yaw)*f-Math.sin(yaw)*x)*speed;
    velocity.x=THREE.MathUtils.damp(velocity.x,dx,13,dt);velocity.z=THREE.MathUtils.damp(velocity.z,dz,13,dt);
    const beforeX=pos.x,beforeZ=pos.z;move(velocity.x*dt,velocity.z*dt);moving=Math.hypot(pos.x-beforeX,pos.z-beforeZ)>.001;
    if(moving){const target=Math.atan2(-(pos.x-beforeX),-(pos.z-beforeZ));playerYaw+=Math.atan2(Math.sin(target-playerYaw),Math.cos(target-playerYaw))*Math.min(1,dt*13);walkTime+=dt*(running?2:1);if(walkTime>.46){walkTime=0;if(jumpY<.02)audio.step();}}
    if(pad.jump)doJump();if(pad.interact)interact();if(pad.map)openPanel('map');if(pad.view)setView();if(pad.pause)openPanel('pause');
    const walkedBefore=life.state.stats.steps;life.tick(dt,moving,running);life.state.stats.steps=walkedBefore+Math.hypot(pos.x-beforeX,pos.z-beforeZ);
    if(!activeBuilding&&world.real&&!streaming&&Math.max(Math.abs(pos.x),Math.abs(pos.z))>320&&now-lastStream>60000){const g=world.toGeo(pos.x,pos.z);loadReal(g.latitude??g.lat,g.longitude??g.lon,{stream:true});lastStream=now;}
  }
  if(jumpY>0||jumpV>0){jumpV-=10.5*dt;jumpY=Math.max(0,jumpY+jumpV*dt);if(jumpY===0)jumpV=0;}
  avatar.group.position.set(pos.x,activeGround()+jumpY,pos.z);avatar.group.rotation.y=playerYaw;avatar.update(dt,{moving,running,jumping:jumpY>.04,speed:Math.hypot(velocity.x,velocity.z)});
  if(!document.hidden)world.update?.(dt,life.state.minutes/60);
  updateCamera(dt);updateLighting();
  if(now-lastUI>200){updateHUD();updateNearest();if(modalType==='controller')updateControllerReadout();lastUI=now;}
  if(now-lastMap>160){drawMap($('minimap'));lastMap=now;}
  renderer.render(scene,camera);
  if(++sessionFrames<400&&dt>.002){fpsEstimate=fpsEstimate*.96+(1/dt)*.04;if(sessionFrames===280&&life.state.settings.quality==='auto'&&fpsEstimate<34){autoQuality=.75;applyQuality('auto');}}
}
function updateLighting(){const h=life.state.minutes/60,day=Math.max(0,Math.sin((h-6)/12*Math.PI)),sunset=Math.max(0,1-Math.abs(h-18)/2);const indoor=!!activeBuilding;
  const color=new THREE.Color('#162d48').lerp(new THREE.Color('#bed8df'),day).lerp(new THREE.Color('#d9b598'),sunset*.38);scene.background.copy(color);scene.fog.color.copy(color);
  hemi.intensity=indoor?1.7:.55+day*1.8;sun.intensity=indoor?1.1:.18+day*3;fillLight.intensity=indoor?.4:.2+day*.35;
  const ground=activeGround();sun.color.set(sunset>.2?'#ffcf98':'#fff2d9');sun.position.set(pos.x-35,ground+55,pos.z+25);sun.target.position.set(pos.x,ground,pos.z);renderer.toneMappingExposure=indoor?1.1:1.1;
}
function updateNearest(){if(!started||modalType||busy){$('interaction').hidden=true;nearest=null;return;}let best=null,bestD=Infinity;
  for(const it of [...active.interactables,...(!activeBuilding&&possessions?possessions.interactables:[])]){const d=Math.hypot(it.position.x-pos.x,it.position.z-pos.z);if(d<(it.radius||2.8)&&d<bestD){best=it;bestD=d;}}
  nearest=best;$('interaction').hidden=!best;if(best){$('interact-title').textContent=best.title;$('interact-subtitle').textContent=best.subtitle||'近づいて、調べる';$('interact-key').textContent=gamepad.getDevices().length?'X':matchMedia('(pointer:coarse)').matches?'触':'E';}
}
async function interact(){if(!nearest||busy||modalType)return;const it=nearest;
  if(it.kind==='property'||it.kind==='possession'){possessions?.interact(it.propertyId||it.id);return;}
  if(it.action==='craft'){pos={x:active.spawn.x,z:active.spawn.z};velocity.x=velocity.z=0;updateCamera(1,true);active.openEditor?.();return;}
  if(active.handleAction&&active.handleAction(it.action))return;
  if(it.kind==='door'){enterBuilding(it);return;}if(it.kind==='exit'){leaveBuilding();return;}
  if(it.kind==='npc'){const r=life.talk(it.id);showPanel(it.title||'街の人','A SMALL CONVERSATION',`<p style="font-size:17px;line-height:2.1">「${esc(r.message)}」</p><button class="primary-btn" data-cmd="close">またね</button>`,'talk');return;}
  openActivities(it.action||(it.kind==='bench'?'bench':it.kind==='vending'?'vending':'relax'),it.title,it.subtitle);
}
async function enterBuilding(it){
  busy=true;outdoorPose={x:pos.x,z:pos.z,yaw};const b=world.buildings.find(b=>b.id===it.buildingId);const id=it.interiorId||b?.interiorId||b?.type||it.buildingId;
  const known=['home','cafe','market','office','gallery','bookstore'];const interiorId=known.includes(id)?id:'home';
  $('transition-label').textContent=b?.name||it.title;$('transition').classList.add('active');await wait(260);
  world.group.visible=false;if(possessions)possessions.group.visible=false;if(!interiorCache.has(interiorId)){let room;if(interiorId==='home'){try{const {createPlayerHome}=await import('./housing.js');room=await createPlayerHome(THREE,{toast,openPanel:(t,e,h)=>showPanel(t,e,h,'craft',true)});}catch(e){toast('クラフト用の部屋を読み込めませんでした。標準の部屋を開きます。');room=createInterior(THREE,interiorId);}}else room=createInterior(THREE,interiorId);interiorCache.set(interiorId,room);scene.add(room.group);room.group.visible=false;}
  active=interiorCache.get(interiorId);active.group.visible=true;activeBuilding={id:it.buildingId,type:interiorId,name:b?.name||active.label};pos={x:active.spawn.x,z:active.spawn.z};yaw=active.spawn.yaw;playerYaw=yaw;pitch=.24;velocity.x=velocity.z=0;life.visit(interiorId);life.state.location=active.label;saveGame();updateCamera(1,true);updateHUD();
  if(world.real)toast('室内はゲーム用の共通内装です。実際の建物内部とは異なります。');
  await wait(100);$('transition').classList.remove('active');busy=false;
}
async function leaveBuilding(){busy=true;$('transition-label').textContent=world.real?'街へ戻る':'ひかり町';$('transition').classList.add('active');await wait(260);active.group.visible=false;active=world;world.group.visible=true;activeBuilding=null;if(possessions)possessions.group.visible=true;pos={x:outdoorPose.x,z:outdoorPose.z};yaw=outdoorPose.yaw+Math.PI;playerYaw=yaw;pitch=.28;velocity.x=velocity.z=0;updateCamera(1,true);saveGame();updateHUD();await wait(100);$('transition').classList.remove('active');busy=false;}

function openActivities(station,title,subtitle){const acts=life.getActions(station);showPanel(title||'ひと息つく','EVERYDAY MOMENTS',`<p>${esc(subtitle||'今日は、何をして過ごしましょう。')}</p><div class="action-list">${acts.map(a=>`<button class="action-card" data-action="${esc(a.id)}" ${a.disabled?'disabled':''}><span class="action-icon">${icon(a.icon)}</span><span><strong>${esc(a.label)}</strong><small>${esc(a.reason||a.description)}</small></span><span class="action-meta ${a.reward?'positive':''}">${a.cost?'¥'+a.cost.toLocaleString('ja-JP'):a.reward?'+¥'+a.reward.toLocaleString('ja-JP'):'無料'}<small>${a.minutes}分</small></span></button>`).join('')}</div>`,'activity');}
async function performAction(id){const result=life.perform(id);if(!result.ok){toast(result.message);return;}closeModal();busy=true;$('transition-label').textContent=result.message;$('transition').classList.add('active');gamepad.vibrate?.({duration:60,strongMagnitude:.15,weakMagnitude:.3});await wait(700);$('transition').classList.remove('active');busy=false;updateHUD();saveGame();}

function updateHUD(){if(!life)return;$('clock').textContent=life.formatTime();$('day').textContent=life.getDayLabel();$('money').textContent='¥'+Math.floor(life.state.money).toLocaleString('ja-JP');$('weather-icon').innerHTML=icon(life.state.minutes>=360&&life.state.minutes<1080?'sun':'moon');
  $('location-label').textContent=activeBuilding?activeBuilding.name:(started?(world.real?realLocationName:'ひかり町'):'ひかり町 · プレビュー');
  for(const key of ['hunger','energy','mood']){$(`${key}-value`).textContent=Math.round(life.state[key]);$(`${key}-bar`).style.width=life.state[key]+'%';}
  const goals=life.getGoals(),done=goals.filter(g=>g.completed||g.done).length,next=goals.find(g=>!g.done&&!g.completed);$('goal-label').textContent=next?.title||'あなたらしい一日を、楽しもう';$('goal-counter').textContent=done+'/'+goals.length;
  const count=life.state.inventory.reduce((n,i)=>n+i.qty,0);$('bag-count').hidden=!count;$('bag-count').textContent=count;
  $('destination').hidden=!selectedDestination||!!activeBuilding;if(selectedDestination){$('destination-name').textContent=selectedDestination.name;$('destination-distance').textContent=Math.round(Math.hypot(selectedDestination.entrance.x-pos.x,selectedDestination.entrance.z-pos.z))+'m';}
  $('sound-toggle').innerHTML=icon(life.state.settings.sound?'sound':'soundOff');
  const attribution=$('attribution');if(attribution)attribution.hidden=!world?.real;
}

function drawMap(canvas,big=false){if(!canvas||!world)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#e9eddf';ctx.fillRect(0,0,w,h);const b=world.bounds,pad=big?20:8,rangeX=b.maxX-b.minX,rangeZ=b.maxZ-b.minZ,scale=Math.min((w-pad*2)/rangeX,(h-pad*2)/rangeZ),ox=w/2,oz=h/2;const mx=x=>ox+x*scale,mz=z=>oz+z*scale;
  const polygon=(points,color)=>{ctx.fillStyle=color;ctx.beginPath();points.forEach((p,i)=>{const x=p.x??p[0],z=p.z??p[1];i?ctx.lineTo(mx(x),mz(z)):ctx.moveTo(mx(x),mz(z));});ctx.closePath();ctx.fill();};
  if(world.real){for(const a of world.mapFeatures?.areas||[]){if(a.line){ctx.strokeStyle=a.color||'#7da4a1';ctx.lineWidth=Math.max(1.5,(a.width||2)*scale);ctx.beginPath();a.points.forEach((p,i)=>i?ctx.lineTo(mx(p.x),mz(p.z)):ctx.moveTo(mx(p.x),mz(p.z)));ctx.stroke();}else{polygon(a.points,a.color||'#cedcb8');for(const h of a.holes||[])polygon(h,'#e9eddf');}}ctx.lineCap='round';for(const r of world.mapFeatures?.roads||[]){ctx.strokeStyle='#fcfdf6';ctx.lineWidth=Math.max(1.5,r.width*scale);ctx.beginPath();r.points.forEach((p,i)=>i?ctx.lineTo(mx(p.x),mz(p.z)):ctx.moveTo(mx(p.x),mz(p.z)));ctx.stroke();}}
  else{ctx.fillStyle='#cddbbd';ctx.fillRect(mx(42),mz(-18),38*scale,53*scale);ctx.fillStyle='#fffef6';ctx.fillRect(mx(-10),mz(-100),20*scale,200*scale);for(const z of [-28,48])ctx.fillRect(mx(-87),mz(z-7),174*scale,14*scale);}
  for(const item of world.buildings){ctx.fillStyle=item.mapColor||'#bdc6b3';if(item.polygon)polygon(item.polygon,item.mapColor||'#bdc6b3');else ctx.fillRect(mx(item.x-item.w/2),mz(item.z-item.d/2),Math.max(2,item.w*scale),Math.max(2,item.d*scale));
    if(big&&(!world.real||item.name&&world.buildings.length<70)){ctx.fillStyle='#55704a';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(item.name.slice(0,10),mx(item.x),mz(item.z)+4);}}
  if(selectedDestination){ctx.beginPath();ctx.strokeStyle='#b59354';ctx.setLineDash([3,4]);ctx.lineWidth=1.4;ctx.moveTo(mx(outdoorPose.x),mz(outdoorPose.z));ctx.lineTo(mx(selectedDestination.entrance.x),mz(selectedDestination.entrance.z));ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.fillStyle='#bb934e';ctx.arc(mx(selectedDestination.entrance.x),mz(selectedDestination.entrance.z),4,0,Math.PI*2);ctx.fill();}
  if(world.real){ctx.beginPath();ctx.strokeStyle='#b48d44';ctx.lineWidth=2;ctx.arc(mx(0),mz(0),5,0,Math.PI*2);ctx.stroke();}
  const p=activeBuilding?outdoorPose:pos;ctx.save();ctx.translate(mx(p.x),mz(p.z));ctx.rotate(-yaw);ctx.fillStyle='#2b7150';ctx.strokeStyle='#fff';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,2);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

function openPanel(type){
  if(type==='map'){const list=world.buildings.filter(b=>b.entrance).slice().sort((a,b)=>Math.hypot(a.x-pos.x,a.z-pos.z)-Math.hypot(b.x-pos.x,b.z-pos.z)).slice(0,30);showPanel(world.real?'現在地の街':'ひかり町の地図','TAKE THE LONG WAY HOME',`<p>行き先を選ぶと、距離と目的地を表示します。キャラクターを動かして歩いていきましょう。</p><div class="map-layout"><canvas id="bigmap" class="bigmap" width="460" height="480"></canvas><div class="building-list">${list.map(b=>`<button class="building-button" data-destination="${esc(b.id)}"><span>${icon(buildingIcons[b.type]||'home')}</span><span><strong>${esc(b.name)}</strong><small>${esc(descriptions[b.type]||'地図に記録された建物')}</small></span><span class="distance">${Math.round(Math.hypot(b.entrance.x-pos.x,b.entrance.z-pos.z))}m</span></button>`).join('')}</div></div><div class="button-row"><button class="secondary-btn" data-cmd="location">${icon('globe',16)} 現在地・別の座標</button>${activeBuilding?'<button class="secondary-btn" data-cmd="exit">街へ出る</button>':''}</div>${world.real?'<p class="legal-note">建物の配置はOSM。外観・室内はゲーム用表現です。地形は取得できた標高データの近似です。</p>':''}`,'map',true);drawMap($('bigmap'),true);return;}
  if(type==='bag'){showPanel('いつもの持ち物','THINGS YOU CARRY',`<p>お店で買ったものを、好きなときに。食材は自宅のキッチンで使えます。</p>${life.state.inventory.length?`<div class="action-list">${life.state.inventory.map(i=>`<div class="action-card"><span class="action-icon">${icon(i.id==='book'?'book':i.id==='groceries'?'bag':i.id==='water'?'drop':'meal')}</span><span><strong>${esc(i.name)}</strong><small>${i.qty}個</small></span>${i.id==='groceries'?'<span class="action-meta"><small>自宅で調理</small></span>':`<button class="secondary-btn" style="margin-left:auto" data-action="${i.id==='book'?'read_book':'use:'+esc(i.id)}">${i.id==='book'?'読む':'使う'}</button>`}</div>`).join('')}</div>`:'<div class="empty-state">'+icon('bag',40)+'<p>まだ、持ち物はありません。<br>街のマーケットで、買い物をしてみましょう。</p></div>'}`,'bag');return;}
  if(type==='journal'){const g=life.getGoals();showPanel('この街での、あなたの記録','LITTLE MOMENTS, BIG MEMORIES',`<div class="stat-grid"><div><small>歩いた距離</small><strong>${Math.round(life.state.stats.steps)}<span style="font-size:12px"> m</span></strong></div><div><small>働いた回数</small><strong>${life.state.stats.shifts}<span style="font-size:12px"> 回</span></strong></div><div><small>訪れた場所</small><strong>${life.state.visited.length}<span style="font-size:12px"> か所</span></strong></div></div><p>きっかけは、ほんのちいさなこと。すべて自由な順番で楽しめます。</p>${g.map(i=>`<div class="goal-row ${i.done?'done':''}"><span class="goal-check">${i.done?icon('check',15):''}</span><span><strong>${esc(i.title)}</strong><p>${esc(i.description)}</p></span>${!i.done?`<button data-goal-place="${esc(i.buildingId)}">行き先</button>`:'<span class="action-meta positive">完了</span>'}</div>`).join('')}<p class="section-label">暮らしの記録</p>${life.state.journal.slice().reverse().map(e=>`<div class="journal-line"><time>${e.day}日目 ${esc(e.time)}</time><span>${esc(e.text)}</span></div>`).join('')||'<p>今日の思い出を、少しずつ。</p>'}`,'journal');return;}
  if(type==='settings'){showPanel('暮らしの設定','MAKE YOURSELF AT HOME',`<div class="form-row"><label for="player-name">呼び名<small>この端末での表示名</small></label><input id="player-name" maxlength="24" type="text" value="${esc(life.state.name)}"></div><div class="form-row"><label for="quality">描画品質<small>端末に合わせて変更できます</small></label><select id="quality">${[['auto','自動'],['high','高画質'],['medium','標準'],['low','軽量']].map(([v,t])=>`<option value="${v}" ${life.state.settings.quality===v?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-row"><label for="sensitivity">視点の感度</label><input id="sensitivity" type="range" min="0.25" max="3" step="0.05" value="${life.state.settings.sensitivity}"></div><div class="form-row"><label for="environment-sound">環境音<small>鳥の声と、足音</small></label><input id="environment-sound" type="checkbox" ${life.state.settings.sound?'checked':''}></div><div class="button-row"><button class="secondary-btn" data-cmd="save">今の暮らしを保存</button><button class="secondary-btn" data-cmd="export">セーブを書き出す</button><button class="secondary-btn" data-cmd="import">セーブを読み込む</button><button class="secondary-btn" data-cmd="fullscreen">全画面表示</button></div><div class="notice">暮らしとキャラクターは、このブラウザに保存されます。セーブJSONは暮らしの記録用で、写真・3Dモデルは含みません。別端末へは画像やモデルを再度読み込んでください。</div><div class="button-row"><button class="secondary-btn" data-cmd="location">現在地から始める</button><button class="secondary-btn" data-panel="help">操作方法</button></div><p class="legal-note">© KASAI SOLUTIONS INC. · Three.js (MIT)<br><a href="./about.html" target="_blank" rel="noopener">このゲームについて・データとプライバシー</a></p>`,'settings');return;}
  if(type==='character'){renderCharacter();return;}if(type==='controller'){renderController();return;}if(type==='help'){renderHelp();return;}if(type==='possessions'){possessions?.openInventory();return;}
  if(type==='pause'){showPanel('ひと休み、しませんか。','TAKE YOUR TIME',`<div class="pause-card">${icon('leaf',42)}<p>時間は止まっています。<br>準備ができたら、街へ戻りましょう。</p><div class="button-row" style="justify-content:center"><button class="primary-btn" data-cmd="close">街へ戻る</button><button class="secondary-btn" data-panel="settings">設定</button><button class="secondary-btn" data-panel="character">キャラクター</button></div></div>`,'pause');return;}
  if(type==='social'){openSocial();return;}if(type==='location'){openLocation();}
}

function renderCharacter(){showPanel('あなたのキャラクター','A CHARACTER OF YOUR OWN',`<div class="model-info"><span>${icon('person',31)}</span><span><strong>${esc(characterInfo.name)}</strong><small>${esc(characterInfo.description)}</small></span><button data-cmd="default-avatar">標準に戻す</button></div><p>正面・背面・左・右の写真を読み込み、輪郭から立体的なキャラクターを作ります。背景のない全身画像で、姿勢・大きさ・位置を4枚でそろえるときれいに反映されます。</p><div class="photo-slots">${[['front','前 · 必須'],['back','後ろ'],['left','左'],['right','右']].map(([v,t])=>`<label class="photo-slot">${photoViews[v]?`<img src="${esc(photoViews[v].src)}" alt="${t}の参照画像">`:icon('upload',29)}<span class="slot-label">${t}</span><input type="file" data-photo="${v}" accept="image/png,image/jpeg,image/webp" aria-label="${t}の写真を選択"></label>`).join('')}</div><div class="form-row"><label for="mesh-quality">3Dモデルの精細度<small>細分化を増やして、曲面を滑らかに</small></label><select id="mesh-quality"><option value="standard" ${selectedQuality==='standard'?'selected':''}>標準 · 約2.9万ポリゴン</option><option value="high" ${selectedQuality==='high'?'selected':''}>高精細 · 約8.8万ポリゴン</option><option value="ultra" ${selectedQuality==='ultra'?'selected':''}>最高 · 約17.7万ポリゴン</option></select></div><button class="primary-btn" data-cmd="generate-avatar" ${photoViews.front?'':'disabled'}>${icon('person',19)} 写真から簡易3Dを作成</button><div id="character-output"></div><div class="notice">写真からの形状近似です。4方向の画像を対応する面に貼り、側面の輪郭を奥行きに反映します。見えない面や関節は推定します。AIによる精密な3D復元・フォトグラメトリではありません。ポリゴン数を増やしても、写真にない形は復元されません。</div><p class="section-label">完成した3Dモデルを使う</p><label class="upload-model">${icon('upload',28)}<span><strong>GLB / VRM を読み込む</strong><small>50MB以内・200万ポリゴン以内。外部参照のない非圧縮モデル。<br>既存モーション、または対応する人型骨格から動作を付けます。</small></span><input id="model-upload" type="file" accept=".glb,.vrm" aria-label="3Dモデルを選択"></label><p class="section-label">標準キャラクターの服</p><div class="button-row">${[['ivory','アイボリー'],['navy','ネイビー'],['sage','セージ'],['black','ブラック']].map(([v,t])=>`<button class="secondary-btn" data-style="${v}">${t}</button>`).join('')}</div><p class="legal-note">写真と3Dモデルはこの端末内で処理・保存します。アップロード先のサーバーへ送信しません。</p>`,'character',true);}
async function readImage(file){if(file.size>20*1024*1024)throw new Error('画像は1枚20MB以内にしてください。');const src=URL.createObjectURL(file);try{const im=new Image();im.src=src;await im.decode();if(im.width*im.height>80000000)throw new Error('画像が大きすぎます。縦横を8000px以下に縮小してください。');return im;}catch(e){URL.revokeObjectURL(src);throw e;}}
async function generateAvatar(){if(!photoViews.front)return;const b=$('modal-body').querySelector('[data-cmd="generate-avatar"]');if(b){b.disabled=true;b.textContent='4方向の画像から立体化しています…';}let next=null;try{
  await wait(80);next=createAvatar(THREE);const result=await next.fromImage(photoViews,{quality:selectedQuality});replaceAvatar(next);next=null;characterInfo={name:result.views?.length>1?'写真から作成したキャラクター':'写真から作成したキャラクター',description:`${result.triangles.toLocaleString('ja-JP')}ポリゴン · 画像から簡易立体化`};
  let saved=true;try{await saveCharacter({type:'photos',views:photoFiles,quality:selectedQuality});}catch(e){saved=false;toast(e.message);}
  if(modalType==='character'){renderCharacter();const out=$('character-output');out.className='character-output';out.textContent=`${characterInfo.description}。待機・歩行・走行・ジャンプの動作を設定しました。${saved?'この端末に保存しました。':'このセッションでは使用できますが、再読み込み時の復元はできません。'}`;}toast('キャラクターを作成しました。街を歩いて確認できます。');
}catch(e){next?.dispose?.();toast('キャラクターを作成できませんでした：'+e.message);if(b){b.disabled=false;b.textContent='写真から簡易3Dを作成';}}}
function replaceAvatar(next){avatarRevision++;if(avatar){scene.remove(avatar.group);avatar.dispose?.();}avatar=next;scene.add(avatar.group);avatar.group.position.set(pos.x,activeGround()+jumpY,pos.z);avatar.group.rotation.y=playerYaw;}
async function importModel(file,persist=true,expectedRevision=null){busy=true;try{const next=await loadCharacterModel(THREE,file,{name:file.name||'3Dモデル'});if(expectedRevision!==null&&avatarRevision!==expectedRevision){next.dispose();return;}replaceAvatar(next);characterInfo={name:file.name||'読み込んだ3Dモデル',description:`${next.triangles.toLocaleString('ja-JP')}ポリゴン · ${next.animations.length?'付属モーション':next.rigged?'骨格モーション':'モデル全体の移動'}`};if(persist){try{await saveCharacter({type:'glb',blob:file,name:file.name});}catch(e){toast(e.message);}}if(modalType==='character'){renderCharacter();const out=$('character-output');out.className='character-output';out.textContent=next.limitations.join(' ');}if(persist)toast('3Dモデルをキャラクターに設定しました。');}catch(e){toast('モデルを読み込めませんでした：'+e.message);}finally{busy=false;}}
async function restoreCharacter(){const expectedRevision=avatarRevision;let next=null,restoredViews={};try{const r=await loadCharacter();if(!r||avatarRevision!==expectedRevision)return;if(r.type==='glb'){const f=new File([r.blob],r.name||'character.glb');await importModel(f,false,expectedRevision);}else if(r.type==='photos'&&r.views?.front){for(const [v,f] of Object.entries(r.views))restoredViews[v]=await readImage(f);const quality=r.quality||'high';next=createAvatar(THREE);const result=await next.fromImage(restoredViews,{quality});if(avatarRevision!==expectedRevision){next.dispose();next=null;return;}replaceAvatar(next);next=null;for(const previous of Object.values(photoViews))URL.revokeObjectURL(previous.src);photoViews=restoredViews;restoredViews=null;photoFiles={...r.views};selectedQuality=quality;characterInfo={name:'保存した写真キャラクター',description:`${result.triangles.toLocaleString('ja-JP')}ポリゴン · 画像から簡易立体化`};}}catch(e){next?.dispose?.();toast('キャラクターを復元できませんでした：'+e.message);}finally{for(const image of Object.values(restoredViews||{}))URL.revokeObjectURL(image.src);}}

function renderController(){const c=gamepad.getConfig(),devices=gamepad.getDevices(),opts=(max,val,label='ボタン')=>Array.from({length:max+1},(_,i)=>`<option value="${i}" ${Number(val)===i?'selected':''}>${label} ${i}</option>`).join('');
  showPanel('コントローラー','PLAY YOUR WAY',`<div class="controller-status">${icon('gamepad',35)}<span><strong id="controller-title">${devices.length?'コントローラーを検出しました':'コントローラーのボタンを押してください'}</strong><small id="controller-device">${devices.map(d=>esc(d.id)).join('<br>')||'USBまたはBluetoothで端末に接続すると、自動検出します。'}</small></span></div><p>標準レイアウトは自動設定。Xbox・PlayStation・Switch系など、ブラウザが認識するゲームパッドを使えます。認識しない機種・特殊機能には対応できません。</p><div class="form-row"><label for="pad-device">使用するコントローラー</label><select id="pad-device" data-pad-config="gamepadIndex"><option value="-1">自動選択</option>${devices.map(d=>`<option value="${d.index}" ${c.gamepadIndex===d.index?'selected':''}>${esc(d.id.slice(0,22))}</option>`).join('')}</select></div><div class="control-grid">${[['moveXAxis','移動・左右の軸'],['moveYAxis','移動・前後の軸'],['lookXAxis','視点・左右の軸'],['lookYAxis','視点・上下の軸']].map(([k,t])=>`<div class="form-row"><label>${t}</label><select data-pad-config="${k}" aria-label="${t}">${opts(9,c[k],'軸')}</select></div>`).join('')}${[['interactButton','調べる・建物に入る'],['jumpButton','ジャンプ・決定'],['runButton','走る（押している間）'],['mapButton','地図'],['pauseButton','一時停止'],['viewButton','視点切替']].map(([k,t])=>`<div class="form-row"><label>${t}</label><select data-pad-config="${k}" aria-label="${t}"><option value="-1" ${c[k]===-1?'selected':''}>割り当てなし</option>${opts(31,c[k])}</select></div>`).join('')}</div><div class="form-row"><label for="pad-deadzone">スティックの遊び</label><input id="pad-deadzone" data-pad-config="deadzone" type="range" min="0.05" max="0.5" step="0.01" value="${c.deadzone}"></div><div class="form-row"><label for="pad-invert">視点の上下を反転</label><input id="pad-invert" type="checkbox" data-pad-config="invertLookY" ${c.invertLookY?'checked':''}></div><div id="controller-readout" class="controller-readout">ボタンと軸の入力がここに表示されます。</div><div class="button-row"><button class="secondary-btn" data-cmd="calibrate">中心位置を調整</button><button class="secondary-btn" data-cmd="vibrate">振動テスト</button><button class="secondary-btn" data-cmd="reset-pad">標準に戻す</button></div><div class="notice">標準操作：左スティック＝移動、右スティック＝視点、下のボタン＝ジャンプ／決定、左のボタン＝調べる、右のボタン＝走る、上のボタン＝地図、START＝一時停止。メニュー内は十字キーで選択できます。</div>`,'controller');updateControllerReadout();}
function updateControllerReadout(){const r=gamepad.getRaw();if(!$('controller-readout'))return;$('controller-readout').textContent=r?`軸：${r.axes.map((v,i)=>`${i}:${v.toFixed(2)}`).join('  ')}\nボタン：${r.buttons.map((v,i)=>v>.3?i:null).filter(v=>v!==null).join(', ')||'なし'}`:'未接続。接続後に、コントローラーのボタンを一度押してください。';}
let menuPadLast=0,menuPadPrev=[];
function handleGamepadMenu(pad,now){if(!modalType){if(!started&&pad.jump)openLocation();return;}if(pad.pause){closeModal();return;}if(pad.jump&&modalType!=='controller')document.activeElement?.click?.();const raw=gamepad.getRaw();if(!raw)return;if(modalType==='controller')return;const down=(raw.buttons[13]||0)>.5,up=(raw.buttons[12]||0)>.5;if((down||up)&&now-menuPadLast>220){const els=[...$('modal').querySelectorAll('button:not(:disabled),a[href],select,input:not([type=file])')].filter(n=>n.offsetParent!==null),i=els.indexOf(document.activeElement);if(els.length)els[(i+(down?1:-1)+els.length)%els.length].focus();menuPadLast=now;}menuPadPrev=raw.buttons;}

function renderHelp(){showPanel('街での過ごし方','A SMALL GUIDE TO YOUR NEW LIFE',`<div class="help-grid"><div class="help-card"><h3>${icon('walk')} PC</h3><p><kbd>W A S D</kbd> / 矢印キー：移動</p><p>画面をドラッグ：視点を回す</p><p><kbd>Shift</kbd>：走る　<kbd>Space</kbd>：ジャンプ</p><p><kbd>E</kbd>：調べる・入る・話す</p><p><kbd>M</kbd>：地図　<kbd>Tab</kbd>：持ち物</p><p><kbd>V</kbd>：視点　<kbd>Esc</kbd>：一時停止</p></div><div class="help-card"><h3>${icon('hand')} スマホ・タブレット</h3><p>左下のスティックでキャラクターを移動。</p><p>画面右側をなぞって、視点を回します。</p><p>右下の手のボタンで、入口や家具を調べます。</p><p>走るボタンを押し続けると走ります。</p></div><div class="help-card"><h3>${icon('gamepad')} コントローラー</h3><p>USB / Bluetooth接続後、ボタンを押すと認識します。</p><p>左スティックで移動、右で視点。割り当ては設定で変更できます。</p></div><div class="help-card"><h3>${icon('home')} 暮らす</h3><p>入口の近くで「入る」を選ぶと、建物の中へ。</p><p>店内のカウンターや自宅の家具に近づいて、食事・仕事・料理・休息を選びます。</p></div></div><div class="notice">現在地モードは実地図に基づく配置です。建物の外観・内部は推定やゲーム用表現です。現実の通行規制や道路の安全を案内するナビゲーション用途には使えません。</div>`,'help');}

async function openSocial(){if(!social){try{const m=await import('./social.js');social=m.initSocial({openPanel:(t,e,h)=>showPanel(t,e,h,'social',true),toast,icon,escapeHTML:esc,baseUrl:WORLD_URL});}catch(e){showPanel('オンラインにつながる','WORLD COMMUNITY',`<p>オンライン機能を読み込めませんでした。通信を確認し、再読み込みしてください。</p><a class="primary-btn" href="${WORLD_URL}">オンライン版を開く</a>`,'social');return;}}await social.open();modalType='social';}

async function initPossessions(){try{const {createPossessions}=await import('./possessions.js');possessions=await createPossessions(THREE,{life,toast,openPanel:(t,e,h)=>showPanel(t,e,h,'possessions',true),onPlace:async(item)=>{if(!activeBuilding||activeBuilding.type!=='home'||!active.addFurniture){toast('自分の部屋に入ってから、所有した家具を配置してください。');return false;}const result=await active.addFurniture(item.type,{color:item.color,id:item.id});if(!result?.ok){toast(result?.message||'配置できる場所がありません。クラフト画面で空間を作ってください。');return false;}return true;}});scene.add(possessions.group);possessions.attachWorld(world,(x,z,r)=>collides(x,z,r));possessions.group.visible=!activeBuilding;}catch(e){console.warn('Personal objects are unavailable',e);}}
function disposeGroup(group){const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const mat of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(mat);for(const v of Object.values(mat))if(v?.isTexture)textures.add(v);}});for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}

function setupUI(){
  $('start').addEventListener('click',openLocation);$('demo-start')?.addEventListener('click',startDemo);$('close-modal').addEventListener('click',closeModal);$('modal-layer').addEventListener('click',e=>{if(e.target===$('modal-layer'))closeModal();});
  document.addEventListener('click',e=>{const el=e.target.closest('[data-panel]');if(el){e.preventDefault();openPanel(el.dataset.panel);}});
  $('sound-toggle').addEventListener('click',()=>{life.state.settings.sound=!life.state.settings.sound;if(life.state.settings.sound)audio.start();else audio.stop();saveGame();updateHUD();});
  $('view-toggle').addEventListener('click',setView);$('interact-btn').addEventListener('click',interact);$('touch-interact').addEventListener('click',interact);$('touch-jump').addEventListener('click',doJump);$('clear-destination').addEventListener('click',()=>{selectedDestination=null;updateHUD();});
  $('modal-body').addEventListener('click',async e=>{if(['social','craft','possessions'].includes(modalType))return;const btn=e.target.closest('button');if(!btn)return;
    if(btn.dataset.action){performAction(btn.dataset.action);return;}
    if(btn.dataset.destination){selectedDestination=world.buildings.find(b=>b.id===btn.dataset.destination);closeModal();toast('行き先を設定しました。キャラクターを操作して向かいましょう。');return;}
    if(btn.dataset.goalPlace){const b=world.buildings.filter(b=>b.type===btn.dataset.goalPlace||b.id===btn.dataset.goalPlace).sort((a,b)=>Math.hypot(a.x-pos.x,a.z-pos.z)-Math.hypot(b.x-pos.x,b.z-pos.z))[0];if(b){selectedDestination=b;closeModal();}else toast('読み込んだ周辺に対応する施設が見つかりません。別のエリアか、ひかり町で体験できます。');return;}
    if(btn.dataset.style){const n=createAvatar(THREE);n.setStyle(btn.dataset.style);replaceAvatar(n);characterInfo={name:'街の住人',description:'標準キャラクター · 関節モーション'};try{await deleteCharacter();}catch(e){toast(e.message);}renderCharacter();return;}
    switch(btn.dataset.cmd){case'close':closeModal();break;case'demo':startDemo();break;case'location':openLocation();break;case'locate':locate();break;case'coordinates':{const lat=$('latitude-input').value,lon=$('longitude-input').value;if(!lat.trim()||!lon.trim()){toast('緯度と経度を両方入力してください。');break;}loadReal(Number(lat),Number(lon));break;}case'cancel-geo':geoController?.abort();busy=false;closeModal();break;case'exit':closeModal();leaveBuilding();break;case'save':{const r=saveGame();toast(r?.ok?'暮らしを保存しました。':r?.message||'保存できませんでした。');break;}case'export':saveGame();downloadBlob(new Blob([life.exportSave()],{type:'application/json'}),'machi-life-save.json');break;case'import':$('save-upload').click();break;case'fullscreen':if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>toast('全画面表示には対応していません。'));else document.exitFullscreen?.();break;case'generate-avatar':generateAvatar();break;case'default-avatar':replaceAvatar(createAvatar(THREE));characterInfo={name:'街の住人',description:'標準キャラクター · 関節モーション'};try{await deleteCharacter();}catch(e){toast(e.message);}renderCharacter();break;case'calibrate':toast(gamepad.calibrate().message);break;case'vibrate':if(!await gamepad.vibrate({duration:150,strongMagnitude:.4,weakMagnitude:.5}))toast('このコントローラー・ブラウザでは振動を使用できません。');break;case'reset-pad':gamepad.resetConfig();renderController();break;case'reload':location.reload();break;}
  });
  $('modal-body').addEventListener('change',async e=>{const t=e.target;
    if(t.dataset.photo&&t.files?.[0]){try{const v=t.dataset.photo,file=t.files[0],nextImage=await readImage(file),previous=photoViews[v];photoViews[v]=nextImage;photoFiles[v]=file;if(previous)URL.revokeObjectURL(previous.src);if(modalType==='character')renderCharacter();}catch(err){toast(err.message);}return;}
    if(t.id==='model-upload'&&t.files?.[0]){await importModel(t.files[0]);return;}
    if(t.dataset.padConfig){gamepad.setConfig({[t.dataset.padConfig]:t.type==='checkbox'?t.checked:Number(t.value)});return;}
    if(t.id==='mesh-quality')selectedQuality=t.value;
    if(t.id==='player-name'){life.state.name=t.value.trim()||'あなた';saveGame();}
    if(t.id==='quality'){life.state.settings.quality=t.value;applyQuality(t.value);saveGame();}
    if(t.id==='sensitivity'){life.state.settings.sensitivity=Number(t.value);saveGame();}
    if(t.id==='environment-sound'){life.state.settings.sound=t.checked;t.checked?audio.start():audio.stop();saveGame();updateHUD();}
  });
  $('save-upload').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const r=life.importSave(await f.text());toast(r.message);if(r.ok){applyQuality(life.state.settings.quality);updateHUD();closeModal();}}catch(err){toast(err.message);}e.target.value='';});
}
function setupControls(){
  window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.code==='Escape'){if(modalType)closeModal();else if(started)openPanel('pause');return;}
    if(modalType){if(e.code==='Tab'){const elements=[...$('modal').querySelectorAll('button:not(:disabled),a[href],input,select,textarea')].filter(n=>n.offsetParent!==null),first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;
    if(e.code==='KeyE')interact();if(e.code==='Space')doJump();if(e.code==='KeyM'&&started)openPanel('map');if(e.code==='Tab'&&started)openPanel('bag');if(e.code==='KeyV'&&started)setView();
  });window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touch.x=touch.y=0;touch.run=false;});
  let dragging=null;renderer.domElement.addEventListener('pointerdown',e=>{if(!started||modalType||busy)return;dragging={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!dragging||dragging.id!==e.pointerId)return;const factor=.004*life.state.settings.sensitivity;yaw-=(e.clientX-dragging.x)*factor;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-dragging.y)*factor,-.12,1.05);dragging.x=e.clientX;dragging.y=e.clientY;});
  const stopDrag=()=>dragging=null;renderer.domElement.addEventListener('pointerup',stopDrag);renderer.domElement.addEventListener('pointercancel',stopDrag);renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
  const joy=$('joystick'),knob=$('joystick-knob');let joyId=null;
  const setJoy=e=>{const rect=joy.getBoundingClientRect(),max=rect.width*.34,dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2),d=Math.max(1,Math.hypot(dx,dy)/max);touch.x=dx/d/max;touch.y=-dy/d/max;knob.style.transform=`translate(${dx/d}px,${dy/d}px)`;};
  joy.addEventListener('pointerdown',e=>{if(joyId!==null)return;e.preventDefault();joyId=e.pointerId;joy.setPointerCapture(e.pointerId);setJoy(e);});joy.addEventListener('pointermove',e=>{if(e.pointerId===joyId)setJoy(e);});
  const endJoy=e=>{if(e.pointerId!==joyId)return;joyId=null;touch.x=touch.y=0;knob.style.transform='';};joy.addEventListener('pointerup',endJoy);joy.addEventListener('pointercancel',endJoy);joy.addEventListener('lostpointercapture',endJoy);
  $('touch-run').addEventListener('pointerdown',e=>{touch.run=true;e.currentTarget.setPointerCapture(e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])$('touch-run').addEventListener(event,()=>touch.run=false);
}
function applyQuality(level){if(!renderer)return;const ratio=level==='low'?.85:level==='medium'?1.1:level==='high'?Math.min(devicePixelRatio,2):Math.min(devicePixelRatio,matchMedia('(pointer:coarse)').matches?1.25:1.6)*autoQuality;renderer.setPixelRatio(ratio);renderer.shadowMap.enabled=level!=='low';if(sun){const size=level==='high'?2048:level==='low'?512:1024;if(sun.shadow.mapSize.x!==size){sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null;}}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}

const audio={ctx:null,gain:null,timer:null,noise:null,start(){if(!this.ctx){try{this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.gain=this.ctx.createGain();this.gain.gain.value=.06;this.gain.connect(this.ctx.destination);}catch{return;}}this.ctx.resume().catch(()=>{});if(!this.timer)this.timer=setInterval(()=>{if(started&&!activeBuilding&&!document.hidden&&life.state.settings.sound)this.bird();},4200);},stop(){clearInterval(this.timer);this.timer=null;this.ctx?.suspend().catch(()=>{});},bird(){if(!this.ctx||this.ctx.state!=='running')return;const t=this.ctx.currentTime;for(let i=0;i<2;i++){const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.setValueAtTime(1600+Math.random()*800,t+i*.13);o.frequency.exponentialRampToValueAtTime(2900,t+i*.13+.07);g.gain.setValueAtTime(0,t+i*.13);g.gain.linearRampToValueAtTime(.13,t+i*.13+.02);g.gain.exponentialRampToValueAtTime(.001,t+i*.13+.11);o.connect(g);g.connect(this.gain);o.start(t+i*.13);o.stop(t+i*.13+.12);}},step(){if(!life.state.settings.sound||!this.ctx||this.ctx.state!=='running')return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='triangle';o.frequency.setValueAtTime(80,t);o.frequency.exponentialRampToValueAtTime(30,t+.07);g.gain.setValueAtTime(.17,t);g.gain.exponentialRampToValueAtTime(.001,t+.09);o.connect(g);g.connect(this.gain);o.start(t);o.stop(t+.1);}};

boot();
