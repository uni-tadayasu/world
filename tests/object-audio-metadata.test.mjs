// Scene sound-source positions/lifecycle and successful local object interactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createInterior} from '../dist/interiors.js';
import {createPlayerHome} from '../dist/housing.js';
import {createPossessions} from '../dist/possessions.js';

const context=()=>new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),measureText:text=>({width:String(text).length*10}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(target,key)=>key in target?target[key]:()=>{}});
async function browser(run){
  const original=new Map(['document','location','localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),storage=new Map();
  for(const [key,value]of Object.entries({document:{querySelector:()=>({}),createElement:()=>({width:1,height:1,dataset:{},getContext:context}),head:{append(){}}},location:{origin:'http://localhost:3000'},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},fetch:()=>{throw new Error('local audio test must not call a service');}}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  try{await run(storage);}finally{for(const [key,value]of original)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
}
function validSources(sources){assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);for(const source of sources){assert.equal(typeof source.ambient,'boolean');assert.ok([source.x,source.y,source.z,source.radius].every(Number.isFinite));}}

test('room furniture registers silent sources while actual appliances provide ambience',()=>browser(async()=>{
  for(const type of ['home','cafe','market','office','gallery','bookstore']){
    const room=createInterior(THREE,type),sources=room.getAudioSources();validSources(sources);assert.ok(sources.length>=8);assert.ok(sources.length<100,'semantic furniture sources are bounded, not each mesh screw');assert.ok(!room.label.includes('ひかり'));
    assert.ok(sources.some(s=>s.kind==='vent'&&s.ambient));assert.equal(sources.filter(s=>s.ambient).length,type==='home'||type==='market'?2:1);
    for(const source of sources.filter(s=>!['vent','fridge'].includes(s.kind)))assert.equal(source.ambient,false,source.kind+' is quiet until used');
    for(const item of room.interactables){assert.equal(typeof item.soundKind,'string');assert.ok([item.soundPosition.x,item.soundPosition.y,item.soundPosition.z].every(Number.isFinite));}
    room.dispose();assert.equal(sources.length,0,'removed room does not leave sources behind');
  }
}));

test('home sounds follow moved furniture and emit only successful actions',()=>browser(async storage=>{
  storage.set('machi:home:v1:guest',JSON.stringify({layout:{version:1,floor:'#aaaaaa',wall:'#eeeeee',items:[]}}));
  const emitted=[],fields=new Map(),listeners={},buttons=['rotate','delete','confirm-clear'].map(hAction=>({dataset:{hAction}}));
  const canvas={width:600,height:680,getContext:context,addEventListener:(type,fn)=>{listeners[type]=fn;},getBoundingClientRect:()=>({left:0,top:0,width:600,height:680})};
  const editor={isConnected:true,innerHTML:'',querySelector:selector=>{if(selector==='canvas')return canvas;if(!fields.has(selector))fields.set(selector,{value:'',textContent:'',classList:{toggle(){}}});return fields.get(selector);},querySelectorAll:selector=>selector==='[data-h-action]'?buttons:[]};
  const home=await createPlayerHome(THREE,{openPanel:()=>editor,onSound:value=>emitted.push(value)});
  try{
    validSources(home.getAudioSources());assert.equal(home.getAudioSources().filter(s=>s.ambient).length,1);assert.equal(emitted.length,0,'loading a saved room is silent');
    assert.equal(home.addFurniture('plant',{id:'p1'}).ok,true);assert.equal(emitted.at(-1).action,'place');home.openEditor();fields.get('[data-h-select]').onchange({target:{value:'p1'}});
    const scale=Math.min((600-38)/15,(680-48)/17);listeners.pointerdown({preventDefault(){},clientX:300+scale*2,clientY:340+scale*2});
    const moved=home.getAudioSources().find(s=>s.id==='home:item:p1');assert.equal(moved.x,2);assert.equal(moved.z,2);assert.equal(emitted.at(-1).action,'move');assert.deepEqual(emitted.at(-1).position,{x:2,y:.8,z:2});
    assert.equal(home.handleAction('home:water:p1'),true);assert.equal(emitted.at(-1).action,'water');assert.deepEqual(emitted.at(-1).position,{x:2,y:.8,z:2});
    const count=emitted.length;assert.equal(home.handleAction('home:water:no-object'),false);assert.equal(home.addFurniture('not-a-type').ok,false);assert.equal(emitted.length,count,'failed changes stay silent');
    await buttons.find(b=>b.dataset.hAction==='delete').onclick();assert.equal(emitted.at(-1).action,'remove');assert.ok(!home.getAudioSources().some(s=>s.id==='home:item:p1'));
    home.addFurniture('lamp',{id:'l1'});home.handleAction('home:lamp:l1');assert.equal(emitted.at(-1).kind,'lamp');assert.equal(emitted.at(-1).action,'switch');assert.equal(home.getAudioSources().find(s=>s.id==='home:item:l1').ambient,false,'light does not become a continuous hum');validSources(home.getAudioSources());
  }finally{home.dispose();assert.deepEqual(home.getAudioSources(),[]);}
}));

test('street object sound follows terrain, relocation and storage without touching network',()=>browser(async storage=>{
  storage.set('machi.belongings.guest',JSON.stringify({items:[{id:'plant-1',type:'plant',name:'Plant',color:'#64875b',condition:70,stored:false}],dirty:false}));
  const emitted=[],life={state:{money:1000,energy:100,hunger:100,mood:50},save(){}},buttons=['care','repair','pickup'].map(own=>({dataset:{own}}));
  const possessions=createPossessions(THREE,{life,onSound:value=>emitted.push(value),openPanel:()=>({querySelectorAll:selector=>selector==='[data-own]'?buttons:[],querySelector:()=>null})});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    possessions.attachWorld({spawn:{x:10,z:20},sampleGround:()=>({height:7})});validSources(possessions.getAudioSources());assert.equal(possessions.getAudioSources().length,5);assert.ok(possessions.getAudioSources().every(s=>!s.ambient));
    const original=possessions.getAudioSources().find(s=>s.kind==='plant');assert.equal(original.y,7.81);possessions.interact('flea:plant');buttons[0].onclick();await settle();assert.equal(emitted.at(-1).action,'water');assert.deepEqual(emitted.at(-1).position,{x:original.x,y:original.y,z:original.z});
    const count=emitted.length;life.state.energy=0;buttons[0].onclick();await settle();assert.equal(emitted.length,count,'insufficient energy does not play a false success sound');
    possessions.attachWorld({spawn:{x:100,z:200},sampleGround:()=>({height:12})});const relocated=possessions.getAudioSources().find(s=>s.kind==='plant');assert.notEqual(relocated.x,original.x);assert.equal(relocated.y,12.81);
    possessions.interact('flea:plant');buttons[2].onclick();await settle();assert.equal(emitted.at(-1).action,'pickup');assert.deepEqual(emitted.at(-1).position,{x:relocated.x,y:relocated.y,z:relocated.z});assert.ok(!possessions.getAudioSources().some(s=>s.kind==='plant'));
  }finally{possessions.dispose();assert.deepEqual(possessions.getAudioSources(),[]);}
}));

test('unavailable audio callback cannot cancel a local furniture save',()=>browser(async()=>{
  const home=await createPlayerHome(THREE,{onSound:()=>{throw new Error('audio unavailable');}});try{assert.equal(home.addFurniture('plant',{id:'audio-off'}).ok,true);assert.ok(home.getLayout().items.some(i=>i.id==='audio-off'));assert.equal(home.handleAction('home:water:audio-off'),true);}finally{home.dispose();}
}));
