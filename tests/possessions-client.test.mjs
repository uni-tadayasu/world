import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../dist/vendor/three.module.js';
import {createPossessions} from '../dist/possessions.js';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const item=(id,name)=>({id,type:'plant',name,color:'#64875b',condition:70,stored:false});
async function scenario(run){
  const originals=new Map(['localStorage','location','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const storage=new Map(),posts=[],notices=[],server={A:[item('a','Aの植物')],B:[item('b','Bの植物')]};
  let session='A',getIdentity=null,afterMe=null,careButton=null;
  const fetch=async(url,options={})=>{
    if(url==='/api/social/me'){const id=session;afterMe?.();return response({connected:true,identityKind:'device',signedIn:true,user:{id}});}
    assert.equal(url,'/api/social/belongings');
    if(options.method==='POST'){
      const data=JSON.parse(options.body);posts.push(data);
      if(data.expectedUserId!==session)return response({error:'アカウントが変わりました。',code:'belongings_identity_changed'},409);
      server[session]=data.items;return response({ok:true,items:data.items});
    }
    const id=getIdentity||session;return response({userId:id,items:server[id]});
  };
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  for(const [key,value]of Object.entries({localStorage,location:{origin:'https://machi-life.hisa-0128-1996.chatgpt.site'},fetch}))Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});
  const possessions=createPossessions(THREE,{life:{state:{money:1000,energy:100,hunger:100,mood:50},save(){}},toast:value=>notices.push(value),openPanel(){
    careButton={dataset:{own:'care'}};
    return {querySelectorAll:selector=>selector==='[data-own]'?[careButton]:[],querySelector:()=>null};
  }});
  try{await run({possessions,storage,server,posts,notices,setSession:id=>{session=id;},setGetIdentity:id=>{getIdentity=id;},setAfterMe:fn=>{afterMe=fn;},care:()=>careButton.onclick()});}
  finally{possessions.dispose();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('dirty belongings keep their original owner during a session change',()=>scenario(async({possessions,storage,server,posts,setAfterMe,setSession})=>{
  const pending=[item('a','Aの未同期の植物')];
  storage.set('machi.belongings.device.A',JSON.stringify({items:pending,dirty:true}));
  setAfterMe(()=>setSession('B'));
  assert.equal((await possessions.sync()).error,true);
  assert.equal(posts[0].expectedUserId,'A');assert.equal(server.B[0].name,'Bの植物');
  assert.deepEqual(JSON.parse(storage.get('machi.belongings.device.A')),{items:pending,dirty:true});
  setAfterMe(null);await possessions.sync();
  assert.equal(JSON.parse(storage.get('machi.belongings.device.B')).items[0].name,'Bの植物');
  assert.equal(JSON.parse(storage.get('machi.belongings.device.A')).dirty,true);
}));

test('a response from another account never overwrites the current owner cache',()=>scenario(async({possessions,storage,setGetIdentity})=>{
  const original=JSON.stringify({items:[item('a','Aの保存済み植物')],dirty:false});
  storage.set('machi.belongings.device.A',original);setGetIdentity('B');
  assert.equal((await possessions.sync()).error,true);
  assert.equal(storage.get('machi.belongings.device.A'),original);
  assert.equal(storage.has('machi.belongings.device.B'),false);
}));

test('editing an object includes the account guard and preserves a rejected save locally',()=>scenario(async({possessions,storage,server,posts,setSession,care})=>{
  await possessions.sync();possessions.interact('a');setSession('B');care();
  for(let i=0;i<20&&!posts.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(posts.length,1);assert.equal(posts[0].expectedUserId,'A');
  assert.equal(server.B[0].name,'Bの植物');
  const cached=JSON.parse(storage.get('machi.belongings.device.A'));
  assert.equal(cached.dirty,true);assert.equal(cached.items[0].condition,82);
}));

test('street objects stand on the rendered walking surface above the DEM',()=>scenario(async({possessions})=>{
  const count=possessions.attachWorld({spawn:{x:0,z:0},bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},sampleGround:()=>({height:.6}),terrainHeight:()=>0});
  assert.equal(count,5);
  for(const object of possessions.group.children)assert.ok(Math.abs(object.position.y-.61)<1e-12);
}));
