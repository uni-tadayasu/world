import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createProfile} from '../dist/profile.js';
import {createPlayerHome} from '../dist/housing.js';
import {createPossessions} from '../dist/possessions.js';
import {PUBLIC_ORIGIN,NATIVE_ORIGIN,isOnlineHost} from '../dist/site-config.js';

const original=new Map(['location','localStorage','document','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const storage=new Map(),requests=[],posts=[],notices=[];
const oldRecords={
  'machi.profile.account.legacy.v1':'legacy profile, retained verbatim',
  'machi:home:v1:user:legacy':'legacy home, retained verbatim',
  'machi.belongings.legacy':'legacy belongings, retained verbatim',
  'machi.profile.guest.v1':JSON.stringify({format:1,accountId:null,profile:{name:'端末に残した旧プロフィール'},pending:null}),
  'machi:home:v1:guest':JSON.stringify({layout:{version:1,floor:'#888888',wall:'#eeeeee',items:[]},dirty:false}),
  'machi.belongings.guest':JSON.stringify({items:[],dirty:false})
};
for(const [key,value]of Object.entries(oldRecords))storage.set(key,value);
const layout=color=>({version:1,floor:color,wall:'#e7e6dc',items:[]});
const server={D1:{home:layout('#123456'),items:[]},D2:{home:layout('#654321'),items:[]}};
let identity='D1',offline=false,afterMe=null,home,profile,possessions;
const field={value:'',textContent:'',classList:{toggle(){}}},buttons=[{dataset:{hAction:'save'}},{dataset:{hAction:'sync'}}];
const canvas={width:600,height:680,getContext:()=>new Proxy({}, {get:(t,k)=>k in t?t[k]:()=>{}}),addEventListener(){}};
const editor={innerHTML:'',isConnected:true,querySelector:key=>key==='canvas'?canvas:field,querySelectorAll:key=>key==='[data-h-action]'?buttons:[]};
const profileShell={innerHTML:'',isConnected:true,addEventListener(){},querySelector:()=>null};
let inventoryHTML='';
const browser={
  location:{origin:PUBLIC_ORIGIN,href:PUBLIC_ORIGIN+'/'},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},
  document:{querySelector:()=>({}),createElement:()=>({dataset:{}}),head:{append(){}}},
  fetch:async(url,options={})=>{
    requests.push(url);assert.ok(url.startsWith('/api/social/'),'API stays on this page origin');assert.equal(options.credentials,'same-origin');
    if(url==='/api/social/me'){
      if(offline)throw new TypeError('fixture network unavailable');const id=identity;afterMe?.();
      return Response.json({connected:true,identityKind:'device',signedIn:true,user:{id,name:'旅人',version:0}});
    }
    const resource=url.endsWith('/home')?'home':'items';
    if(options.method==='POST'){
      const data=JSON.parse(options.body);posts.push({url,...data});
      if(data.expectedUserId!==identity)return Response.json({code:'identity_changed',error:'このブラウザの保存先が変わりました。'},{status:409});
      server[identity][resource]=data.layout||data.items;return Response.json({ok:true,userId:identity});
    }
    return Response.json({userId:identity,...(resource==='home'?{layout:server[identity].home}:{items:server[identity].items})});
  }
};
for(const [key,value]of Object.entries(browser))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
try{
  assert.equal(isOnlineHost(PUBLIC_ORIGIN),true);assert.equal(isOnlineHost(NATIVE_ORIGIN),true);assert.equal(isOnlineHost('https://www.omoji-z.com.example'),false);
  profile=createProfile({openPanel:()=>({querySelector:()=>profileShell})});
  possessions=createPossessions(THREE,{life:{state:{money:1000,energy:100,hunger:100,mood:50},save(){}},toast:value=>notices.push(value),openPanel:(title,eyebrow,html)=>{inventoryHTML=html;return {querySelectorAll:()=>[],querySelector:()=>field};}});
  const profileReady=profile.sync(),objectsReady=possessions.sync(),homeReady=createPlayerHome(THREE,{toast:value=>notices.push(value),openPanel:()=>editor});
  [,,home]=await Promise.all([profileReady,objectsReady,homeReady]);
  assert.equal(requests.filter(url=>url==='/api/social/me').length,1,'three client screens share first device connection');
  assert.equal(profile.getState().scope,'device');assert.equal(profile.getState().id,'D1');assert.equal(profile.getState().name,'旅人','old local name is never auto-published');
  assert.equal(home.getLayout().floor,'#123456');assert.ok(storage.has('machi.profile.device.D1.v1'));assert.ok(storage.has('machi:home:v2:device:D1'));assert.ok(storage.has('machi.belongings.device.D1'));
  home.openEditor();possessions.openInventory();profile.open();await profile.sync();
  for(const html of [editor.innerHTML,inventoryHTML,profileShell.innerHTML]){assert.ok(!/ログイン|アカウント|signin-with/.test(html),'no login/account UI remains');assert.ok(html.includes('ブラウザ'),'browser ownership is visible');}
  assert.ok(home.addFurniture('plant',{id:'D1-plant'}).ok);await buttons[0].onclick();
  assert.equal(posts.at(-1).expectedUserId,'D1');assert.equal(server.D1.home.items[0].id,'D1-plant');
  const saved=JSON.stringify(home.getLayout());offline=true;assert.equal((await home.sync()).error,true);assert.equal(JSON.stringify(home.getLayout()),saved,'failed reconnect retains the current home');offline=false;
  await home.sync();assert.ok(home.addFurniture('chair',{id:'D1-chair'}).ok);
  afterMe=()=>{identity='D2';};await buttons[0].onclick();afterMe=null;
  assert.equal(server.D2.home.items.length,0,'a changed browser identity cannot receive the previous home');
  assert.equal(JSON.parse(storage.get('machi:home:v2:device:D1')).dirty,true,'rejected changes stay with their original identity');
  await home.sync();assert.equal(home.getLayout().floor,'#654321');assert.equal(home.getLayout().items.length,0);
  for(const [key,value]of Object.entries(oldRecords))assert.equal(storage.get(key),value,`old storage preserved: ${key}`);
  console.log('PASS: custom-domain device saves, shared initial identity, old data isolation, guarded home saves and login-free UI.');
}finally{
  home?.dispose();profile?.dispose();possessions?.dispose();for(const [key,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
