import {readDeviceSession} from './device-session.js';
import {isOnlineHost} from './site-config.js';
const CATALOG=[{type:'plant',name:'小さな観葉植物',price:300,color:'#64875b',w:.8,d:.8},{type:'chair',name:'木とスチールの椅子',price:500,color:'#a88764',w:.75,d:.8},{type:'lamp',name:'真鍮のフロアライト',price:850,color:'#c4aa72',w:.65,d:.65},{type:'table',name:'丸いサイドテーブル',price:1200,color:'#957856',w:1.3,d:1.3},{type:'shelf',name:'暮らしの小さな本棚',price:1500,color:'#8e785e',w:1.3,d:.55}];
const TYPES=new Set(['sofa','table','chair','bed','desk','shelf','plant','lamp','rug','cabinet']);
const PALETTE=['#64875b','#9d7b59','#d1c6ae','#647e8b','#a67365','#3c5149'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'¥'+value.toLocaleString('ja-JP');
function valid(items){return Array.isArray(items)?items.slice(0,100).filter(item=>item&&typeof item.id==='string'&&item.id.length<=80&&TYPES.has(item.type)&&typeof item.name==='string'&&item.name.length<=50&&/^#[a-f\d]{6}$/i.test(item.color)&&Number.isFinite(item.condition)&&typeof item.stored==='boolean').map(item=>({id:item.id,type:item.type,name:item.name,color:item.color,condition:Math.max(0,Math.min(100,item.condition)),stored:item.stored})):[];}

export function createPossessions(THREE,{life,toast=()=>{},openPanel,onPlace=async()=>false}={}){
  const group=new THREE.Group(),colliders=[],interactables=[];group.name='個人用ゲーム内フリーマーケット';
  let items=[],profileId=null,cacheDirty=false,cacheLocked=false,memoryDirty=false,placements=[],busy=false,disposed=false,syncPromise=null,syncing=false;
  const geometries={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,32),sphere:new THREE.SphereGeometry(1,20,14)};
  const canonical=isOnlineHost();
  const controllers=new Set();
  const cacheKey=()=>profileId?`machi.belongings.device.${profileId}`:'machi.belongings.guest';
  function readCache(){items=[];cacheDirty=false;cacheLocked=false;try{const saved=JSON.parse(localStorage.getItem(cacheKey())||'null');if(saved&&!Array.isArray(saved.items))throw new Error('invalid cache');items=valid(saved?.items);cacheDirty=saved?.dirty===true;}catch(_){cacheLocked=true;toast('持ち物の保存データを読み込めませんでした。元のデータを保護しています。');}}
  function writeCache(dirty){cacheDirty=dirty;if(cacheLocked)return false;try{localStorage.setItem(cacheKey(),JSON.stringify({items,dirty}));return true;}catch(_){toast('持ち物をこのブラウザに保存できませんでした。');return false;}}
  async function api(route,method='GET',data){
    const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),10000);
    try{const response=await fetch('/api/social'+route,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});let result;try{result=await response.json();}catch(_){throw new Error('持ち物の保存サービスに接続できません。通信を確認して再試行してください。');}if(!response.ok){const error=new Error(result.error||'持ち物を保存できませんでした。');error.code=result.code;error.status=response.status;throw error;}return result;}finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function persist(){
    memoryDirty=true;const cached=writeCache(!!profileId);
    if(!canonical||!profileId){if(cached)memoryDirty=false;return;}
    try{await api('/belongings','POST',{items,expectedUserId:profileId});writeCache(false);memoryDirty=false;}catch(error){toast((error.name==='AbortError'?'保存の接続がタイムアウトしました。':error.message)+' 現在のプレイには変更を反映しています。持ち物画面から再同期できます。');}
  }
  function clearModels(){const materials=new Set();group.traverse(object=>{if(object.isMesh)materials.add(object.material);});group.clear();for(const material of materials)material.dispose();colliders.length=0;interactables.length=0;}
  function model(type,color,condition){
    const root=new THREE.Group();const tint=new THREE.Color(color).lerp(new THREE.Color('#8c897e'),(100-condition)/230);
    const paint=new THREE.MeshStandardMaterial({color:tint,roughness:.45+(100-condition)/220}),metal=new THREE.MeshStandardMaterial({color:'#384741',roughness:.38,metalness:.65}),wood=new THREE.MeshStandardMaterial({color:'#b58a65',roughness:.8});
    const add=(geometry,material,x,y,z,w,h,d)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;};
    const B=(x,y,z,w,h,d,material=paint)=>add(geometries.box,material,x,y,z,w,h,d);
    const C=(x,y,z,r,h,material=paint)=>add(geometries.cylinder,material,x,y,z,r,h,r);
    if(type==='plant'){C(0,.2,0,.23,.4,wood);C(0,.42,0,.2,.025,metal);C(0,.78,0,.025,.8,metal);for(let i=0;i<9;i++){const angle=i*2.4;const leaf=add(geometries.sphere,paint,Math.cos(angle)*.18,.72+i*.055,Math.sin(angle)*.18,.18,.07,.28);leaf.rotation.set(.3,angle,.25);}}
    else if(type==='chair'){C(0,.48,0,.32,.075);B(0,.79,.28,.59,.55,.065);for(const x of [-.24,.24])for(const z of [-.23,.23])C(x,.24,z,.025,.48,metal);}
    else if(type==='lamp'){C(0,.04,0,.27,.08,metal);C(0,.85,0,.035,1.65);C(0,1.58,0,.29,.36);C(0,1.39,0,.25,.02,new THREE.MeshStandardMaterial({color:'#fff4cf',emissive:'#eac78b',emissiveIntensity:.35}));}
    else if(type==='table'){C(0,.75,0,.65,.085);C(0,.36,0,.045,.7,metal);C(0,.045,0,.31,.07,metal);}
    else{B(0,.8,.2,1.25,1.6,.06);for(const x of [-.61,.61])B(x,.8,0,.07,1.6,.5);for(let i=0;i<4;i++)B(0,.08+i*.5,0,1.25,.065,.5);for(let i=0;i<5;i++)B(-.4+i*.2,.8,.06,.12,.35,.3,i%2?wood:metal);}
    return root;
  }
  function refresh(){
    if(disposed)return;clearModels();
    for(const placement of placements){const offer=placement.offer,owned=items.find(item=>item.type===offer.type);if(owned?.stored)continue;
      const object=model(offer.type,owned?.color||offer.color,owned?.condition??70);object.position.set(placement.x,placement.y,placement.z);object.rotation.y=placement.rotation;group.add(object);
      const halfW=Math.abs(Math.cos(placement.rotation))*offer.w/2+Math.abs(Math.sin(placement.rotation))*offer.d/2,halfD=Math.abs(Math.sin(placement.rotation))*offer.w/2+Math.abs(Math.cos(placement.rotation))*offer.d/2;
      colliders.push({minX:placement.x-halfW,maxX:placement.x+halfW,minZ:placement.z-halfD,maxZ:placement.z+halfD});
      interactables.push({id:'flea:'+offer.type,kind:'possession',title:owned?'あなたの'+owned.name:'ゲーム内フリーマーケット',subtitle:owned?'手入れ・色替え・保管':offer.name+' · '+money(offer.price),position:new THREE.Vector3(placement.x,placement.y,placement.z),radius:2.6});
    }
  }
  function attachWorld(world,isBlocked=()=>false){
    const spawn=world.spawn||{x:0,z:0},bounds=world.bounds;placements=[];clearModels();
    const offsets=[[2,-5],[2,-1],[2,3],[2,7],[-2,7],[5,0],[-5,0],[0,-7],[0,8],[7,-5],[-7,5]];
    for(const offer of CATALOG){const padding=Math.max(offer.w,offer.d)/2+.4;
      for(const [dx,dz] of offsets){const x=spawn.x+dx,z=spawn.z+dz;if(bounds&&(x-padding<bounds.minX||x+padding>bounds.maxX||z-padding<bounds.minZ||z+padding>bounds.maxZ))continue;if(placements.some(p=>Math.hypot(p.x-x,p.z-z)<2.1))continue;
        let blocked=false;for(const ox of [-padding,0,padding])for(const oz of [-padding,0,padding])if(isBlocked(x+ox,z+oz))blocked=true;if(blocked)continue;
        const ground=world.sampleGround?.(x,z)?.height??(typeof world.terrainHeight==='function'?world.terrainHeight(x,z):.14);
        placements.push({offer,x,z,y:(Number.isFinite(ground)?ground:0)+.01,rotation:Math.atan2(spawn.x-x,spawn.z-z)});break;
      }
    }
    refresh();return placements.length;
  }
  function panel(title,html){const element=openPanel(title,'YOUR EVERYDAY OBJECTS',html);if(!element)throw new Error('持ち物画面を開けませんでした。');return element;}
  function canSpend(price){if(life.state.money<price){toast('所持金が足りません。');return false;}return true;}
  async function mutate(operation,reopen){if(busy||syncing)return;busy=true;try{await operation();life.save();refresh();await persist();if(reopen)reopen();}catch(error){toast(error.message||'操作を完了できませんでした。');}finally{busy=false;}}
  function openItem(id){
    const offer=id.startsWith('flea:')?CATALOG.find(entry=>entry.type===id.slice(5)):null;const owned=offer?items.find(item=>item.type===offer.type):items.find(item=>item.id===id);if(!offer&&!owned)return;
    const name=owned?.name||offer.name;const state=owned?`状態 ${Math.round(owned.condition)} / 100 · ${owned.stored?'保管中':'街に置いています'}`:`購入価格 ${money(offer.price)} · 状態 70 / 100`;
    const html=`<p>街に並ぶ、あなた専用のゲームオブジェクトです。実際の店舗・所有物とは関係ありません。</p><div class="model-info"><div><strong>${esc(name)}</strong><small>${state}</small></div></div>${owned?`<div class="form-row"><label for="object-name">名前</label><input id="object-name" type="text" maxlength="50" value="${esc(name)}"></div><div class="button-row"><button class="secondary-btn" data-own="rename">名前を変える</button><button class="secondary-btn" data-own="care">${owned.type==='plant'?'水やりと手入れ':'掃除する'} · 体力 −2</button><button class="secondary-btn" data-own="repair" ${owned.condition>=100?'disabled':''}>修理する · ¥150</button></div><p class="section-label">色を替える · ¥50</p><div class="button-row">${PALETTE.map(color=>`<button class="secondary-btn" data-paint="${color}" aria-label="${color}に色を替える" style="background:${color};width:40px;min-width:40px;padding:10px;border:3px solid ${color===owned.color?'#193e37':'white'}"></button>`).join('')}</div><div class="button-row"><button class="secondary-btn" data-own="pickup" ${owned.stored?'disabled':''}>持ち物に保管する</button><button class="primary-btn" data-own="place">自宅に置く</button></div>`:`<p>購入すると、色替え・手入れ・保管ができます。自宅に持ち帰って配置することもできます。</p><button class="primary-btn" data-own="buy" ${syncing?'disabled':''}>${money(offer.price)}で購入する</button>`}<p class="legal-note">${profileId?'このブラウザに紐づく、あなたの持ち物として保存します。':'通信がつながるまでは、このブラウザに保存します。持ち物画面から通信を再確認できます。'}</p>`;
    const element=panel(owned?'あなたの持ち物':'ゲーム内フリーマーケット',html);
    element.querySelectorAll('[data-paint]').forEach(button=>button.onclick=()=>{if(!owned||!canSpend(50))return;mutate(()=>{owned.color=button.dataset.paint;life.state.money-=50;toast('色を替えました。');},()=>openItem(owned.id));});
    element.querySelectorAll('[data-own]').forEach(button=>button.onclick=()=>{
      const action=button.dataset.own;if(action==='buy'){if(!canSpend(offer.price))return;if(items.length>=100){toast('持ち物は100点までです。自宅に配置して整理できます。');return;}mutate(()=>{const item={id:crypto.randomUUID(),type:offer.type,name:offer.name,color:offer.color,condition:70,stored:false};items.push(item);life.state.money-=offer.price;toast(name+'を購入しました。');},()=>openItem('flea:'+offer.type));return;}
      if(!owned)return;
      if(action==='rename'){const nameInput=element.querySelector('#object-name').value.trim().slice(0,50);if(!nameInput){toast('名前を入力してください。');return;}mutate(()=>{owned.name=nameInput;},()=>openItem(owned.id));}
      if(action==='care'){if(life.state.energy<2){toast('少し休んでから手入れしましょう。');return;}mutate(()=>{owned.condition=Math.min(100,owned.condition+12);life.state.energy=Math.max(0,life.state.energy-2);life.state.hunger=Math.max(0,life.state.hunger-1);life.state.mood=Math.min(100,life.state.mood+(owned.type==='plant'?5:3));toast('手入れをして、気分もすっきりしました。');},()=>openItem(owned.id));}
      if(action==='repair'&&canSpend(150))mutate(()=>{owned.condition=100;life.state.money-=150;toast('修理して、きれいになりました。');},()=>openItem(owned.id));
      if(action==='pickup')mutate(()=>{owned.stored=true;toast('持ち物に保管しました。');},()=>openItem(owned.id));
      if(action==='place')mutate(async()=>{if(!await onPlace({...owned})){toast('自宅に入ってから、持ち物画面で配置してください。');return;}items=items.filter(item=>item.id!==owned.id);toast('自宅に置きました。部屋づくりで移動や色替えができます。');},openInventory);
    });
  }
  function openInventory(){
    const element=panel('あなたの暮らしの道具',`<p>買った道具を手入れして、あなたらしい暮らしに。自宅にいるときは家具として配置できます。</p><div class="action-list">${items.length?items.map(item=>`<button class="action-card" data-object-id="${esc(item.id)}"><span style="width:26px;height:26px;border-radius:8px;background:${item.color};flex-shrink:0"></span><span><strong>${esc(item.name)}</strong><small>状態 ${Math.round(item.condition)} / 100 · ${item.stored?'保管中':'街の個人オブジェクト'}</small></span></button>`).join(''):'<div class="empty-state">まだ暮らしの道具はありません。<p>出発地点の近くにある「ゲーム内フリーマーケット」で購入できます。</p></div>'}</div><div class="button-row"><button id="objects-sync" class="secondary-btn">通信を再確認する</button></div><p class="legal-note">${profileId?(cacheDirty?'この端末に未同期の変更があります。':'このブラウザに紐づく、あなたの持ち物です。ブラウザのデータを消去すると、別の利用者として開始します。'):'このブラウザ内に保存しています。通信を再確認するとオンラインの保存先を確認できます。'}</p>`);
    element.querySelectorAll('[data-object-id]').forEach(button=>button.onclick=()=>openItem(button.dataset.objectId));element.querySelector('#objects-sync').onclick=async()=>{await sync();openInventory();};
  }
  async function sync(){
    if(syncPromise)return syncPromise;if(busy)return;syncing=true;
    const pending=(async()=>{try{if(!canonical){if(memoryDirty)await persist();refresh();return {local:true};}const me=await readDeviceSession(),nextId=me.signedIn?me.user.id:null;if(nextId!==profileId){profileId=nextId;readCache();memoryDirty=false;}else if(!memoryDirty)readCache();if(profileId){if(cacheDirty||memoryDirty){await api('/belongings','POST',{items,expectedUserId:profileId});writeCache(false);memoryDirty=false;}else{const saved=await api('/belongings');if(saved.userId!==profileId)throw new Error('このブラウザの保存先が変わりました。もう一度、通信を再確認してください。');items=valid(saved.items);writeCache(false);}}else if(memoryDirty)await persist();refresh();return {signedIn:!!profileId};}catch(error){toast((error.name==='AbortError'?'持ち物の同期がタイムアウトしました。':error.message)+' 現在のプレイで続けます。');refresh();return {error:true};}})();syncPromise=pending;
    try{return await pending;}finally{syncing=false;if(syncPromise===pending)syncPromise=null;}
  }
  function dispose(){disposed=true;for(const controller of controllers)controller.abort();clearModels();for(const geometry of Object.values(geometries))geometry.dispose();group.removeFromParent();}
  readCache();
  return {group,colliders,interactables,attachWorld,interact:openItem,openInventory,sync,dispose};
}
