/** A browser-owned home with a layout editor and anonymous device saves. */
import {readDeviceSession} from './device-session.js';
import {isOnlineHost} from './site-config.js';
const TYPES={
  sofa:{name:'ソファ',w:2.7,d:1.1,color:'#7c9585'},table:{name:'テーブル',w:1.7,d:1,color:'#a17e55'},
  chair:{name:'チェア',w:.65,d:.7,color:'#b69d75'},bed:{name:'ベッド',w:1.65,d:2.3,color:'#d7d5bd'},
  desk:{name:'デスク',w:1.7,d:.8,color:'#a28a66'},shelf:{name:'本棚',w:1.2,d:.4,color:'#8d7253'},
  plant:{name:'観葉植物',w:.7,d:.7,color:'#9a9e85'},lamp:{name:'フロアライト',w:.5,d:.5,color:'#dfd5b3'},
  rug:{name:'ラグ',w:3.2,d:2.3,color:'#8f9d8d'},cabinet:{name:'キャビネット',w:1.6,d:.55,color:'#b39870'}
};
const PALETTE=['#7c9585','#d7d5bd','#a17e55','#486a63','#a98975','#667d91','#353d3c','#c3b18d'];
const FIXED=[{minX:-7.4,maxX:-5.1,minZ:-8.15,maxZ:-3.75}];
const RESERVE=[...FIXED,{minX:-5.1,maxX:-4,minZ:-8,maxZ:-3.7},{minX:-1,maxX:1,minZ:5.35,maxZ:8.5},{minX:2,maxX:3.5,minZ:6.4,maxZ:8.4}];
const hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=x=>JSON.parse(JSON.stringify(x));
const snap=x=>Math.round(x*2)/2;
const quarter=r=>((Math.round(r/(Math.PI/2))%4)+4)%4*Math.PI/2;
const defaultLayout=()=>({version:1,floor:'#b7a58a',wall:'#e7e6dc',items:[
  ['sofa',-3,0,0],['table',-3,2,0],['chair',-5,2,Math.PI/2],['bed',4.5,-5.5,0],
  ['desk',4.5,2,0],['chair',4.5,3.5,Math.PI],['shelf',1.5,-7.5,0],['plant',6,0,0],
  ['lamp',-5.5,0,0],['rug',-3,1.5,0],['cabinet',-1.5,-7.5,0],['plant',1.5,4.5,0]
].map(([type,x,z,rotation],i)=>({id:'default-'+i,type,x,z,rotation,color:TYPES[type].color}))});
function footprint(item,pad=0){const t=TYPES[item.type],odd=Math.round(item.rotation/(Math.PI/2))%2,w=odd?t.d:t.w,d=odd?t.w:t.d;return {minX:item.x-w/2-pad,maxX:item.x+w/2+pad,minZ:item.z-d/2-pad,maxZ:item.z+d/2+pad};}
function overlap(a,b){return a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;}
function placementError(item,items){
  if(!TYPES[item.type])return 'この家具の種類には対応していません。';
  if(!Number.isFinite(item.x)||!Number.isFinite(item.z)||Math.abs(item.x)>6.5||Math.abs(item.z)>7.5)return '家具の中心を部屋の中に置いてください。';
  const b=footprint(item,.08);if(b.minX< -7.3||b.maxX>7.3||b.minZ< -8.2||b.maxZ>8.2)return '壁に重ならない位置を選んでください。';
  if(RESERVE.some(r=>overlap(b,r)))return '玄関・キッチン・クラフト台の通り道は空けてください。';
  for(const other of items){if(other.id===item.id)continue;if(item.type==='rug'||other.type==='rug'){if(item.type!==other.type)continue;}if(overlap(b,footprint(other,.04)))return 'ほかの家具と重なっています。空いている位置を選んでください。';}
  return '';
}
function sanitize(layout){
  const result={version:1,floor:hex(layout?.floor)?layout.floor:'#b7a58a',wall:hex(layout?.wall)?layout.wall:'#e7e6dc',items:[]};
  const ids=new Set();for(const raw of Array.isArray(layout?.items)?layout.items.slice(0,80):[]){
    if(!TYPES[raw.type]||typeof raw.id!=='string'||!raw.id.length||raw.id.length>60||ids.has(raw.id))continue;
    const item={id:raw.id,type:raw.type,x:Number(raw.x),z:Number(raw.z),rotation:quarter(Number(raw.rotation)||0),color:hex(raw.color)?raw.color:TYPES[raw.type].color};
    if(placementError(item,result.items))continue;ids.add(item.id);result.items.push(item);
  }return result;
}

export async function createPlayerHome(THREE,{toast=()=>{},openPanel}={}){
  const group=new THREE.Group();group.name='自分の住まい';
  const shell=new THREE.Group(),furnishings=new THREE.Group();group.add(shell,furnishings);
  const colliders=[],interactables=[],bounds={minX:-7.5,maxX:7.5,minZ:-8.5,maxZ:8.5},spawn={x:0,z:7,yaw:0};
  const geometryCache=new Map(),baseMaterials=new Set(),itemMaterials=new Set();
  const mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.78,...extra});baseMaterials.add(m);return m;};
  const wood=mat('#9a7953'),dark=mat('#3f514a',{metalness:.28,roughness:.52}),ivory=mat('#e8e6d8'),metal=mat('#858f87',{metalness:.65,roughness:.35}),glass=mat('#a6c5bd',{emissive:'#a4c2bb',emissiveIntensity:.22,roughness:.35}),sinkMat=mat('#a8b4ac',{metalness:.7,roughness:.23});
  const floorMat=mat('#b7a58a'),wallMat=mat('#e7e6dc');
  let layout=defaultLayout(),identity=null,scope='guest',readyForCloud=false,status='この端末に保存',statusError=false,dirty=false,revision=0,saveTimer=null,saving=null,syncPromise=null,disposed=false,initialized=false;
  let editor=null,canvas=null,selectedId=null,pendingType='sofa',mode='select',preview=null,confirmClear=false;
  let care={cleanliness:100,water:{},lamps:{}};
  const getKey=()=>scope==='guest'?'machi:home:v1:guest':`machi:home:v2:${scope}`;
  function geometry(key,build){if(!geometryCache.has(key))geometryCache.set(key,build());return geometryCache.get(key);}
  function rounded(w,h,d,r=.05){
    r=Math.min(r,w/5,h/5,d/5);const key=`r:${w},${h},${d},${r}`;
    return geometry(key,()=>{
      const iw=w-2*r,ih=h-2*r,c=Math.min(r,iw/3,ih/3),s=new THREE.Shape();
      s.moveTo(c,0);s.lineTo(iw-c,0);s.quadraticCurveTo(iw,0,iw,c);s.lineTo(iw,ih-c);s.quadraticCurveTo(iw,ih,iw-c,ih);s.lineTo(c,ih);s.quadraticCurveTo(0,ih,0,ih-c);s.lineTo(0,c);s.quadraticCurveTo(0,0,c,0);
      const g=new THREE.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:2,steps:1,curveSegments:3});g.translate(-w/2+r,-h/2+r,-d/2+r);return g;
    });
  }
  function mesh(parent,geo,material,x,y,z,ry=0){const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);o.rotation.y=ry;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  const box=(parent,x,y,z,w,h,d,m,r=.03)=>mesh(parent,rounded(w,h,d,r),m,x,y,z);
  const cyl=(parent,x,y,z,r,h,m)=>mesh(parent,geometry(`c:${r}:${h}`,()=>new THREE.CylinderGeometry(r,r,h,20)),m,x,y,z);
  const sphere=(parent,x,y,z,sx,sy,sz,m)=>{const o=mesh(parent,geometry('sphere',()=>new THREE.SphereGeometry(1,18,12)),m,x,y,z);o.scale.set(sx,sy,sz);return o;};
  // Fixed room shell, softly framed windows, a usable entrance and an equipped kitchen.
  box(shell,0,-.1,0,15,.2,17,floorMat,.01);
  for(let x=-7.2;x<7.4;x+=.56)box(shell,x,.006,0,.008,.008,16.9,wood,.001);
  box(shell,0,2.15,-8.55,15.2,4.3,.2,wallMat);box(shell,-7.55,2.15,0,.2,4.3,17.2,wallMat);box(shell,7.55,2.15,0,.2,4.3,17.2,wallMat);
  box(shell,-4.35,2.15,8.55,6.5,4.3,.2,wallMat);box(shell,4.35,2.15,8.55,6.5,4.3,.2,wallMat);box(shell,0,3.65,8.55,2.2,1.3,.2,wallMat);
  for(const x of [-7.4,7.4])box(shell,x,.13,0,.09,.22,17,ivory);box(shell,0,.13,-8.4,15,.22,.09,ivory);
  box(shell,-1.05,1.45,8.35,.13,2.9,.3,wood);box(shell,1.05,1.45,8.35,.13,2.9,.3,wood);box(shell,0,2.9,8.35,2.2,.12,.3,wood);
  box(shell,0,1.4,8.58,1.94,2.8,.08,wood);box(shell,.7,1.26,8.49,.1,.12,.12,metal);
  box(shell,7.4,2.35,-.5,.045,2.3,4.7,glass);
  for(const z of [-2.95,-.5,1.95])box(shell,7.32,2.35,z,.1,2.55,.09,wood);
  for(const y of [1.1,2.35,3.6])box(shell,7.32,y,-.5,.13,.08,4.95,wood);
  box(shell,7.16,1.02,-.5,.5,.12,5.05,ivory);
  box(shell,0,2.25,-8.4,3.3,2.25,.045,glass);for(const x of [-1.7,0,1.7])box(shell,x,2.25,-8.3,.09,2.4,.12,wood);for(const y of [1.05,3.45])box(shell,0,y,-8.3,3.5,.1,.12,wood);
  // Kitchen: cabinet fronts, worktop, sink, faucet, hob and refrigerator.
  box(shell,-6.35,.48,-5.7,2,.95,3.8,wood);box(shell,-6.35,.99,-5.7,2.12,.12,3.95,ivory);
  for(const z of [-7.08,-6.15,-5.22,-4.3]){box(shell,-5.32,.48,z,.06,.8,.82,ivory);box(shell,-5.26,.75,z,.05,.045,.32,metal);}
  box(shell,-6.3,1.07,-4.75,1.35,.04,.96,sinkMat);box(shell,-6.3,1.09,-4.75,1.05,.05,.68,dark);cyl(shell,-6.8,1.27,-4.75,.035,.38,metal);const tap=cyl(shell,-6.65,1.43,-4.75,.03,.3,metal);tap.rotation.z=Math.PI/2;
  box(shell,-6.3,1.07,-6.6,1.45,.035,1.15,dark);for(const x of [-6.65,-5.98])for(const z of [-6.88,-6.32])cyl(shell,x,1.1,z,.19,.025,metal);
  box(shell,-6.32,1.25,-7.88,1.95,2.5,.58,ivory);box(shell,-5.3,1.6,-7.88,.07,.53,.08,metal);box(shell,-5.3,.65,-7.88,.07,.5,.08,metal);
  box(shell,-7.28,2.6,-5.7,.22,1,3.7,wood);for(const z of [-6.9,-5.7,-4.5])box(shell,-7.14,2.6,z,.08,.88,1.08,ivory);
  box(shell,2.8,.9,7.95,1,.1,.7,wood);for(const x of [2.42,3.18])box(shell,x,.45,7.95,.06,.85,.06,dark);box(shell,2.8,1.2,8.05,.72,.48,.035,dark);box(shell,2.8,1.2,8.02,.62,.36,.015,glass);
  function itemMaterial(color,extra={}){const m=new THREE.MeshStandardMaterial({color,roughness:.82,...extra});itemMaterials.add(m);return m;}
  function buildItem(item){
    const g=new THREE.Group();g.position.set(item.x,0,item.z);g.rotation.y=item.rotation;g.userData.itemId=item.id;furnishings.add(g);
    const c=itemMaterial(item.color),textile=itemMaterial(item.color,{roughness:.96});
    const leg=(x,z,h=.65)=>cyl(g,x,h/2,z,.038,h,dark);
    if(item.type==='sofa'){
      box(g,0,.26,0,2.55,.35,1,c,.1);box(g,0,.64,-.43,2.65,.65,.23,textile,.085);
      for(const x of [-1.2,1.2])box(g,x,.55,0,.24,.55,1.04,textile,.09);
      for(const x of [-.57,.57]){box(g,x,.5,.08,1.08,.2,.78,textile,.075);box(g,x,.77,-.27,1.06,.43,.18,textile,.065);}
      for(const x of [-1.04,1.04])for(const z of [-.34,.34])leg(x,z,.14);
    }else if(item.type==='table'||item.type==='desk'){
      const t=TYPES[item.type],h=item.type==='desk'?.77:.58;box(g,0,h,0,t.w,.1,t.d,c,.05);for(const x of [-t.w/2+.12,t.w/2-.12])for(const z of [-t.d/2+.12,t.d/2-.12])leg(x,z,h-.05);
      if(item.type==='desk'){box(g,-.48,.59,-.02,.5,.22,.6,wood);box(g,-.48,.59,.3,.45,.16,.035,c);box(g,-.48,.59,.33,.13,.02,.02,metal);box(g,.22,.84,-.05,.6,.035,.42,ivory);box(g,.22,1.04,-.2,.6,.38,.035,dark);box(g,.22,1.04,-.226,.53,.3,.01,glass);}
      else{box(g,-.4,h+.085,.08,.43,.06,.3,ivory);box(g,-.36,h+.13,.08,.45,.035,.32,wood);cyl(g,.42,h+.12,-.04,.12,.15,ivory);}
    }else if(item.type==='chair'){
      box(g,0,.47,0,.62,.12,.6,textile,.06);box(g,0,.78,-.28,.62,.55,.12,c,.06);for(const x of [-.23,.23])for(const z of [-.22,.22])leg(x,z,.43);
    }else if(item.type==='bed'){
      box(g,0,.22,0,1.65,.35,2.3,wood,.04);box(g,0,.49,.02,1.58,.27,2.2,ivory,.1);box(g,0,.64,.34,1.6,.12,1.56,textile,.06);box(g,0,.77,-1.1,1.74,1.17,.12,c,.06);
      for(const x of [-.4,.4])box(g,x,.67,-.68,.64,.17,.43,ivory,.075);box(g,0,.72,.9,1.62,.07,.32,c,.025);
    }else if(item.type==='shelf'){
      for(const x of [-.57,.57])box(g,x,1.01,0,.07,2,.39,c);box(g,0,1.01,-.19,1.2,2,.045,c);
      for(const y of [.08,.56,1.04,1.52,2])box(g,0,y,0,1.2,.055,.4,c);
      for(let row=0;row<4;row++)for(let n=0;n<6;n++){const book=itemMaterial(['#7d8c77','#d5ccb3','#aa8670','#71858b'][(row+n)%4]);box(g,-.44+n*.17,.28+row*.48,-.01,.11,.28+(n%3)*.04,.24,book,.008);}
    }else if(item.type==='plant'){
      cyl(g,0,.24,0,.26,.45,c);cyl(g,0,.74,0,.025,.85,wood);
      const last=care.water[item.id]||Date.now(),dry=Date.now()-last>7*86400000,leaf=itemMaterial(dry?'#8f8c61':'#64815a',{roughness:.95});
      for(let i=0;i<7;i++){const a=i*2.4,y=.55+i*.1;const l=sphere(g,Math.cos(a)*.2,y,Math.sin(a)*.2,.22,.12,.13,leaf);l.rotation.set(.2,a,.3);}
      sphere(g,0,1.23,0,.17,.27,.16,leaf);
    }else if(item.type==='lamp'){
      cyl(g,0,.035,0,.25,.07,dark);cyl(g,0,.79,0,.025,1.5,metal);
      const on=care.lamps[item.id]!==false,shade=itemMaterial(item.color,{emissive:on?'#ffd89d':'#000000',emissiveIntensity:on?.48:0});
      const geo=geometry('shade',()=>new THREE.CylinderGeometry(.22,.32,.42,32,1,true));mesh(g,geo,shade,0,1.55,0);sphere(g,0,1.48,0,.09,.1,.09,shade);
    }else if(item.type==='rug'){
      box(g,0,.018,0,3.2,.027,2.3,textile,.009);for(const z of [-1.02,1.02])box(g,0,.036,z,3.02,.007,.035,ivory,.002);
    }else if(item.type==='cabinet'){
      box(g,0,.52,0,1.6,.92,.55,c,.045);for(const x of [-.38,.38]){box(g,x,.52,.29,.73,.8,.035,c);box(g,x+.24,.62,.32,.025,.18,.035,metal);}for(const x of [-.65,.65])for(const z of [-.18,.18])leg(x,z,.1);cyl(g,-.4,1.06,0,.12,.12,ivory);sphere(g,-.4,1.22,0,.15,.19,.14,itemMaterial('#698565'));
    }
  }
  function makeAction(item,action,title){const t=TYPES[item.type],d=t.d/2+.65;interactables.push({id:'home-'+item.id,kind:'action',action,title,subtitle:TYPES[item.type].name,position:new THREE.Vector3(item.x+Math.sin(item.rotation)*d,0,item.z+Math.cos(item.rotation)*d),radius:2.3});}
  function rebuild(){
    furnishings.clear();for(const material of itemMaterials)material.dispose();itemMaterials.clear();floorMat.color.set(layout.floor);wallMat.color.set(layout.wall);colliders.splice(0,colliders.length,...FIXED.map(x=>({...x})));
    interactables.splice(0,interactables.length,{id:'exit',kind:'exit',title:'街へ出る',subtitle:'玄関を開ける',position:new THREE.Vector3(0,0,8),radius:2.1},{id:'home-craft',kind:'action',action:'craft',title:'自分の部屋をクラフト',subtitle:'家具・壁・床を自由に整える',position:new THREE.Vector3(2.8,0,7),radius:2.5},{id:'home-kitchen',kind:'action',action:'cook',title:'料理をする',subtitle:'固定キッチンで食材を調理',position:new THREE.Vector3(-4.4,0,-5.7),radius:2.4});
    for(const item of layout.items){buildItem(item);if(item.type!=='rug')colliders.push({...footprint(item),itemId:item.id});
      if(item.type==='bed')makeAction(item,'sleep','ベッドで休む');else if(['sofa','chair','desk'].includes(item.type))makeAction(item,'relax','自分の家具でくつろぐ');
      else if(item.type==='plant')makeAction(item,'home:water:'+item.id,'植物に水をあげる');else if(item.type==='lamp')makeAction(item,'home:lamp:'+item.id,care.lamps[item.id]===false?'ライトをつける':'ライトを消す');else if(item.type==='cabinet')makeAction(item,'home:clean','部屋を片づける');
    }
  }
  function localEnvelope(){try{return JSON.parse(localStorage.getItem(getKey())||'null');}catch{return null;}}
  function saveLocal(){try{localStorage.setItem(getKey(),JSON.stringify({layout,updatedAt:Date.now(),dirty,care}));return true;}catch{status='端末の保存容量が足りません。変更はこの画面を開いている間だけ保持されます。';statusError=true;return false;}}
  function updateStatus(){if(!editor?.isConnected)return;const el=editor.querySelector('[data-home-status]');if(el){el.textContent=status;el.classList.toggle('error',statusError);}const clean=editor.querySelector('[data-home-cleanliness]');if(clean)clean.textContent=`部屋の整い具合 ${care.cleanliness}%`;}
  async function api(path,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);try{const response=await fetch('/api/social'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});let value;try{value=await response.json();}catch{throw new Error('オンライン版の応答を確認できません。');}if(!response.ok){const error=new Error(value.error||'オンライン保存を完了できませんでした。通信を確認して再試行してください。');error.code=value.code;error.status=response.status;throw error;}return value;}finally{clearTimeout(timer);}}
  function sync(){
    if(syncPromise)return syncPromise;
    const work=syncHome();const pending=work.finally(()=>{if(syncPromise===pending)syncPromise=null;});syncPromise=pending;return pending;
  }
  async function syncHome(){
    if(saving)await saving;
    if(disposed)return;clearTimeout(saveTimer);
    const hosted=isOnlineHost();let me=null,authError='';
    if(hosted){try{me=await readDeviceSession();}catch(e){authError=e.message;}}
    if(disposed)return;
    if(authError&&initialized){readyForCloud=false;status='通信を確認できませんでした。表示中の部屋と端末の保存を保持しています。通信を再確認してください。';statusError=true;updateStatus();return {signedIn:Boolean(identity),scope,cloudReady:false,error:true};}
    const newIdentity=me?.signedIn&&me.user?.id?me.user:null,newScope=newIdentity?`device:${newIdentity.id}`:'guest';
    if(initialized&&scope!==newScope)saveLocal();scope=newScope;identity=newIdentity;readyForCloud=false;
    const local=localEnvelope();layout=sanitize(local?.layout||defaultLayout());dirty=Boolean(local?.dirty);care=local?.care&&typeof local.care==='object'?{cleanliness:Math.max(0,Math.min(100,Number(local.care.cleanliness)||100)),water:local.care.water||{},lamps:local.care.lamps||{}}:{cleanliness:100,water:{},lamps:{}};
    if(identity){
      try{const remote=await api('/home');if(disposed)return;if(remote.userId!==identity.id)throw new Error('このブラウザの保存先が変わりました。通信を再確認してください。');readyForCloud=true;if(remote.layout&&!dirty)layout=sanitize(remote.layout);status=dirty?'端末に変更があります。保存するとオンラインへ同期します。':remote.layout?'このブラウザの部屋を読み込みました。':'新しい自宅です。変更すると、このブラウザ用の保存先へ同期します。';statusError=false;}
      catch(e){status='部屋を読み込めませんでした。この端末の配置を表示しています。通信を再確認してください。';statusError=true;}
    }else{status=authError?'接続を確認できないため、この端末に保存した部屋を表示しています。':'このブラウザ内に保存';statusError=Boolean(authError);}
    if(disposed)return;selectedId=null;initialized=true;saveLocal();rebuild();renderEditor();return {signedIn:Boolean(identity),scope,cloudReady:readyForCloud};
  }
  async function flushSave(){
    if(disposed||saving)return saving;if(!saveLocal()){updateStatus();return {ok:false};}
    if(!identity){status='自宅をこのブラウザに保存しました。';statusError=false;dirty=false;saveLocal();updateStatus();return {ok:true,local:true};}
    if(!readyForCloud){status='端末には保存済みです。「通信を再確認」でオンライン保存を再試行できます。';statusError=true;updateStatus();return {ok:false,local:true};}
    const savedRevision=revision,savedScope=scope,savedUserId=identity.id,snapshot=copy(layout);status='部屋を保存しています…';statusError=false;updateStatus();
    saving=(async()=>{try{
      const me=await readDeviceSession();if(!me.signedIn||me.user?.id!==savedUserId||scope!==savedScope||identity?.id!==savedUserId){readyForCloud=false;throw new Error('このブラウザの保存先が変わりました。「通信を再確認」で現在の部屋を読み込んでください。');}
      await api('/home',{layout:snapshot,expectedUserId:savedUserId});if(savedScope!==scope)return {ok:false};
      if(savedRevision===revision)dirty=false;status=dirty?'新しい変更を保存しています…':'このブラウザの部屋を保存しました。';statusError=false;saveLocal();return {ok:true};
    }catch(e){status='端末には保存済みです。オンライン保存未完了：'+(e.name==='AbortError'?'応答が時間切れになりました。':e.message);statusError=true;return {ok:false,local:true};}
    finally{saving=null;updateStatus();if(!disposed&&savedScope===scope&&revision!==savedRevision)saveTimer=setTimeout(()=>void flushSave(),1000);}})();return saving;
  }
  function changed(){revision++;dirty=true;care.cleanliness=Math.max(35,care.cleanliness-1);saveLocal();rebuild();clearTimeout(saveTimer);saveTimer=setTimeout(()=>void flushSave(),1000);renderEditor();}
  function ensureStyle(){if(document.querySelector('link[data-machi-housing]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./housing.css',import.meta.url).href;link.dataset.machiHousing='';document.head.append(link);}
  function renderEditor(){
    if(!editor?.isConnected)return;const item=layout.items.find(x=>x.id===selectedId);if(!item)selectedId=null;
    editor.innerHTML=`<div class="housing-shell"><div class="housing-heading"><p>${identity?'このブラウザに紐づく、あなたの部屋です。':'通信がつながるまでは、このブラウザだけに保存されます。'}家具を選んで間取り図に配置します。</p><span class="housing-count">${layout.items.length} / 80</span></div><div class="housing-layout"><div class="housing-plan-wrap"><canvas class="housing-plan" width="600" height="680" tabindex="0" aria-label="自宅の間取り。家具を押して選択し、空いたマスを押すと移動します。"></canvas><p class="housing-hint">${mode==='add'?`${TYPES[pendingType].name}を追加：空いているマスを押してください。`:item?`${TYPES[item.type].name}を選択中：空いているマスを押すと移動します。`:'家具を押して選択。追加する家具は右のカタログから選べます。'}</p><p class="housing-scale">1マス 0.5m · 玄関とキッチン前は通路です</p></div><div class="housing-controls"><div class="housing-tabs"><button type="button" data-h-action="select" class="${mode==='select'?'active':''}">選択・移動</button><button type="button" data-h-action="rotate" ${!item&&mode!=='add'?'disabled':''}>90°回転</button></div><label class="housing-label">置いてある家具<select data-h-select><option value="">家具を選ぶ</option>${layout.items.map(i=>`<option value="${esc(i.id)}" ${i.id===selectedId?'selected':''}>${TYPES[i.type].name} · ${i.x.toFixed(1)}, ${i.z.toFixed(1)}m</option>`).join('')}</select></label><div class="housing-catalog">${Object.entries(TYPES).map(([type,t])=>`<button type="button" data-h-type="${type}" class="${mode==='add'&&pendingType===type?'active':''}"><span style="background:${t.color}"></span>${t.name}</button>`).join('')}</div><label class="housing-label">${item?'選んだ家具の色':'追加する家具の色'}<input type="color" data-h-color value="${item?.color||TYPES[pendingType].color}"></label><div class="housing-swatches">${PALETTE.map(color=>`<button type="button" data-h-swatch="${color}" style="background:${color}" aria-label="家具の色 ${color}"></button>`).join('')}</div><div class="housing-two"><label class="housing-label">床の色<input type="color" data-h-floor value="${layout.floor}"></label><label class="housing-label">壁の色<input type="color" data-h-wall value="${layout.wall}"></label></div><div class="housing-tools"><button type="button" data-h-action="duplicate" ${!item?'disabled':''}>複製</button><button type="button" data-h-action="delete" ${!item?'disabled':''}>選んだ家具を取り除く</button><button type="button" data-h-action="clean">部屋を片づける</button></div><span class="housing-care" data-home-cleanliness>部屋の整い具合 ${care.cleanliness}%</span></div></div><div class="housing-save"><span data-home-status class="${statusError?'error':''}">${esc(status)}</span><button type="button" data-h-action="save">今すぐ保存</button><button type="button" data-h-action="sync">通信を再確認</button></div><details class="housing-details"><summary>部屋を整理する</summary><p>家具を全部片づけても、固定キッチンと部屋は残ります。</p>${confirmClear?'<div class="housing-confirm">家具をすべて片づけますか？<button type="button" data-h-action="confirm-clear">すべて片づける</button><button type="button" data-h-action="cancel-clear">戻る</button></div>':'<button type="button" data-h-action="clear">家具をすべて片づける</button>'}<button type="button" data-h-action="defaults">初期家具を空き場所に追加</button></details><p class="housing-footnote">配置は3D室内へ反映されます。ベッド・ソファ・キッチンは生活に使えます。照明の点灯や植物の手入れは、この端末に記録します。ブラウザのデータを消去すると、別の利用者として開始します。</p></div>`;
    canvas=editor.querySelector('canvas');drawPlan();bindEditor();
  }
  let pendingRotation=0,pendingColor=null;
  function drawPlan(){
    if(!canvas)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,s=Math.min((w-38)/15,(h-48)/17),cx=w/2,cz=h/2;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#eff0e6';ctx.fillRect(0,0,w,h);ctx.fillStyle=layout.floor;ctx.fillRect(cx-7.5*s,cz-8.5*s,15*s,17*s);
    ctx.strokeStyle='rgba(62,74,55,.12)';ctx.lineWidth=1;for(let x=-7.5;x<=7.5;x+=.5){ctx.beginPath();ctx.moveTo(cx+x*s,cz-8.5*s);ctx.lineTo(cx+x*s,cz+8.5*s);ctx.stroke();}for(let z=-8.5;z<=8.5;z+=.5){ctx.beginPath();ctx.moveTo(cx-7.5*s,cz+z*s);ctx.lineTo(cx+7.5*s,cz+z*s);ctx.stroke();}
    ctx.strokeStyle='#5c6b59';ctx.lineWidth=8;ctx.strokeRect(cx-7.5*s,cz-8.5*s,15*s,17*s);ctx.fillStyle='#dfe8d4';ctx.fillRect(cx-1*s,cz+8.35*s,2*s,.3*s);
    for(const r of RESERVE.slice(1)){ctx.fillStyle='rgba(228,239,213,.35)';ctx.fillRect(cx+r.minX*s,cz+r.minZ*s,(r.maxX-r.minX)*s,(r.maxZ-r.minZ)*s);}
    ctx.fillStyle='#e8e6d7';const k=FIXED[0];ctx.fillRect(cx+k.minX*s,cz+k.minZ*s,(k.maxX-k.minX)*s,(k.maxZ-k.minZ)*s);ctx.fillStyle='#4f6454';ctx.font='18px sans-serif';ctx.textAlign='center';ctx.fillText('キッチン',cx-6.2*s,cz-5.8*s);ctx.fillText('玄関',cx,cz+8.1*s);ctx.fillText('クラフト',cx+2.8*s,cz+7.8*s);
    for(const item of [...layout.items].sort((a,b)=>(a.type==='rug'?-1:0)-(b.type==='rug'?-1:0))){const t=TYPES[item.type];ctx.save();ctx.translate(cx+item.x*s,cz+item.z*s);ctx.rotate(-item.rotation);ctx.fillStyle=item.color;ctx.strokeStyle=item.id===selectedId?'#1b7159':'rgba(40,60,44,.5)';ctx.lineWidth=item.id===selectedId?5:1.4;ctx.fillRect(-t.w*s/2,-t.d*s/2,t.w*s,t.d*s);ctx.strokeRect(-t.w*s/2,-t.d*s/2,t.w*s,t.d*s);ctx.fillStyle='rgba(255,255,245,.8)';ctx.fillRect(-t.w*s/2+3,-t.d*s/2+3,t.w*s-6,5);ctx.restore();if(t.w*s>40&&t.d*s>26){ctx.fillStyle='#263d31';ctx.font='16px sans-serif';ctx.fillText(t.name,cx+item.x*s,cz+item.z*s+5);}}
    ctx.beginPath();ctx.fillStyle='#1f7155';ctx.arc(cx,cz+7*s,5,0,Math.PI*2);ctx.fill();
  }
  function canvasPoint(event){const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.width/rect.width,z=(event.clientY-rect.top)*canvas.height/rect.height,s=Math.min((canvas.width-38)/15,(canvas.height-48)/17);return {x:snap((x-canvas.width/2)/s),z:snap((z-canvas.height/2)/s)};}
  function chooseColor(color){const item=layout.items.find(i=>i.id===selectedId);if(item){item.color=color;changed();}else{pendingColor=color;const input=editor?.querySelector('[data-h-color]');if(input)input.value=color;}}
  function bindEditor(){
    canvas.addEventListener('pointerdown',event=>{event.preventDefault();const p=canvasPoint(event);
      if(mode==='add'){const item={id:uniqueId(),type:pendingType,...p,rotation:pendingRotation,color:pendingColor||TYPES[pendingType].color};const error=layout.items.length>=80?'家具は80個までです。':placementError(item,layout.items);if(error){toast(error);return;}layout.items.push(item);selectedId=item.id;mode='select';changed();return;}
      const hit=[...layout.items].reverse().filter(i=>i.type!=='rug').find(i=>{const b=footprint(i);return p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;})||[...layout.items].reverse().find(i=>{const b=footprint(i);return p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;});
      if(hit){selectedId=hit.id;renderEditor();return;}
      const item=layout.items.find(i=>i.id===selectedId);if(item){const candidate={...item,...p},error=placementError(candidate,layout.items);if(error){toast(error);return;}Object.assign(item,p);changed();}
    });
    editor.querySelector('[data-h-select]').onchange=e=>{selectedId=e.target.value||null;mode='select';renderEditor();};
    for(const b of editor.querySelectorAll('[data-h-type]'))b.onclick=()=>{pendingType=b.dataset.hType;pendingColor=null;selectedId=null;pendingRotation=0;mode='add';renderEditor();};
    for(const b of editor.querySelectorAll('[data-h-swatch]'))b.onclick=()=>chooseColor(b.dataset.hSwatch);
    editor.querySelector('[data-h-color]').onchange=e=>chooseColor(e.target.value);
    for(const key of ['floor','wall'])editor.querySelector(`[data-h-${key}]`).onchange=e=>{layout[key]=e.target.value;changed();};
    for(const b of editor.querySelectorAll('[data-h-action]'))b.onclick=async()=>{
      const action=b.dataset.hAction,item=layout.items.find(i=>i.id===selectedId);
      if(action==='select'){mode='select';renderEditor();}
      else if(action==='rotate'){if(item){const candidate={...item,rotation:quarter(item.rotation+Math.PI/2)},error=placementError(candidate,layout.items);if(error)toast(error);else{item.rotation=candidate.rotation;changed();}}else{pendingRotation=quarter(pendingRotation+Math.PI/2);toast('追加する家具を90°回しました。');}}
      else if(action==='delete'&&item){layout.items=layout.items.filter(i=>i.id!==item.id);selectedId=null;changed();toast('家具を部屋から取り除きました。');}
      else if(action==='duplicate'&&item){const result=addFurniture(item.type,{color:item.color});toast(result.message);}
      else if(action==='save')await flushSave();else if(action==='sync'){b.disabled=true;await sync();}
      else if(action==='clean'){handleAction('home:clean');renderEditor();}
      else if(action==='clear'||action==='cancel-clear'){confirmClear=action==='clear';renderEditor();}
      else if(action==='confirm-clear'){layout.items=[];selectedId=null;confirmClear=false;changed();toast('家具をすべて片づけました。');}
      else if(action==='defaults'){let added=0;for(const item of defaultLayout().items){if(layout.items.length>=80)break;if(!layout.items.some(i=>i.id===item.id)&&!placementError(item,layout.items)){layout.items.push(item);added++;}}if(added)changed();toast(added?`${added}個の初期家具を追加しました。`:'空き場所に追加できる初期家具はありません。');}
    };
  }
  function openEditor(){if(typeof openPanel!=='function'){toast('部屋の編集画面を開けませんでした。');return;}ensureStyle();mode='select';selectedId=null;confirmClear=false;editor=openPanel('自分の住まいをつくる','YOUR OWN SPACE','');renderEditor();}
  function addFurniture(type,{color,id}={}){
    if(!TYPES[type])return {ok:false,message:'この家具の種類には対応していません。'};
    if(layout.items.length>=80)return {ok:false,message:'家具は80個までです。先に部屋を整理してください。'};
    const item={id:typeof id==='string'&&id.length>0&&id.length<=60?id:uniqueId(),type,x:0,z:0,rotation:0,color:hex(color)?color:TYPES[type].color};
    if(layout.items.some(i=>i.id===item.id))return {ok:false,message:'この家具はすでに部屋にあります。'};
    const places=[];for(let z=-7.5;z<=7.5;z+=.5)for(let x=-6.5;x<=6.5;x+=.5)places.push({x,z});places.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));
    for(const place of places){Object.assign(item,place);if(!placementError(item,layout.items)){layout.items.push(item);selectedId=item.id;mode='select';changed();return {ok:true,id:item.id,message:`${TYPES[type].name}を自分の部屋に置きました。`};}}
    return {ok:false,message:'この家具を置ける空き場所がありません。部屋を整理してください。'};
  }
  function handleAction(action){
    if(action==='home:clean'){care.cleanliness=100;saveLocal();updateStatus();toast('床や家具を整えて、気持ちのよい部屋になりました。');return true;}
    if(typeof action==='string'&&action.startsWith('home:water:')){const id=action.slice(11);if(!layout.items.some(i=>i.id===id&&i.type==='plant'))return false;care.water[id]=Date.now();saveLocal();rebuild();toast('植物に水をあげました。葉がいきいきしています。');return true;}
    if(typeof action==='string'&&action.startsWith('home:lamp:')){const id=action.slice(10);if(!layout.items.some(i=>i.id===id&&i.type==='lamp'))return false;care.lamps[id]=care.lamps[id]===false;saveLocal();rebuild();toast(care.lamps[id]?'ライトをつけました。':'ライトを消しました。');return true;}return false;
  }
  function dispose(){if(disposed)return;saveLocal();disposed=true;clearTimeout(saveTimer);group.removeFromParent();group.clear();for(const g of geometryCache.values())g.dispose();for(const m of [...baseMaterials,...itemMaterials])m.dispose();editor=null;}
  rebuild();await sync();
  function sampleGround(x,z,{minHeight=-Infinity,maxHeight=Infinity}={}){
    if(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)return null;
    let height=0,kind='floor',id='home-floor';
    for(const item of layout.items){if(item.type!=='rug')continue;const dx=x-item.x,dz=z-item.z,c=Math.cos(item.rotation),n=Math.sin(item.rotation);
      if(Math.abs(dx*c-dz*n)<=1.6&&Math.abs(dx*n+dz*c)<=1.15&&.0315<=maxHeight){height=.0315;kind='rug';id=item.id;}}
    return height>=minHeight&&height<=maxHeight?{height,normal:{x:0,y:1,z:0},kind,id}:null;
  }
  return {group,colliders,interactables,spawn,bounds,sampleGround,label:'自分の住まい',openEditor,sync,dispose,addFurniture,handleAction,getLayout:()=>copy(layout),update:()=>{}};
}
function uniqueId(){return 'f-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10));}
