import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBoxCollider,createCylinderCollider,colliderIntersects,createObjectCollisionIndex,colliderFromObject} from '../dist/object-collisions.js';
import {createInterior} from '../dist/interiors.js';
import {createPlayerHome} from '../dist/housing.js';
import {createPossessions} from '../dist/possessions.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('rotated object footprint blocks its body without filling the surrounding AABB',()=>{
  const box=createBoxCollider({id:'bench',x:0,z:0,width:4,depth:.5,yaw:Math.PI/4,minY:0,maxY:1});
  assert.ok(box.maxX>1.5);assert.equal(colliderIntersects(box,{x:1,z:-1,y:0,radius:.15,height:1.75}),true);
  assert.equal(colliderIntersects(box,{x:1.35,z:1.35,y:0,radius:.15,height:1.75}),false,'diagonal gap beside the rotated bench stays open');
  const trunk=createCylinderCollider({x:5,z:2,radius:.2,minY:0,maxY:4});assert.equal(colliderIntersects(trunk,{x:5.5,z:2,y:0,radius:.32}),true);assert.equal(colliderIntersects(trunk,{x:5.55,z:2,y:0,radius:.32}),false);
});

test('finite vertical extents preserve overhead clearance and contact after jumping',()=>{
  const roof=createBoxCollider({x:0,z:0,width:4,depth:4,minY:2.2,maxY:2.5}),index=createObjectCollisionIndex({colliders:[roof]});
  assert.equal(index.isBlocked(0,0,.32,0,1.75),false);assert.equal(index.isBlocked(0,0,.32,.6,1.75),true);assert.equal(index.isBlocked(0,0,.32,2.5,1.75),false);
  const ceiling=index.sweepVertical({x:0,z:0,fromY:0,toY:1,height:1.75});assert.equal(ceiling.ceiling,true);near(ceiling.y,.45);assert.equal(ceiling.grounded,false);index.dispose();
});

test('polygon holes stay open only when the full body clears the courtyard edge',()=>{
  const polygon=[[-4,-4],[4,-4],[4,4],[-4,4]],holes=[[[-2,-2],[2,-2],[2,2],[-2,2]]],index=createObjectCollisionIndex({colliders:[{id:'courtyard',polygon,holes,minY:0,maxY:8}]});
  assert.equal(index.isBlocked(0,0,.32,0),false);assert.equal(index.isBlocked(1.8,0,.32,0),true);assert.equal(index.isBlocked(3,0,.32,0),true);assert.equal(index.isBlocked(4.2,0,.32,0),true);assert.equal(index.isBlocked(5,0,.32,0),false);index.dispose();
});

test('vertical sweep lands on the first solid and retains only reachable support tops',()=>{
  const table=createBoxCollider({id:'table',width:2,depth:2,minY:.7,maxY:.82}),shelf=createBoxCollider({id:'shelf',width:2,depth:2,minY:1.1,maxY:1.2});
  const index=createObjectCollisionIndex({colliders:[table,shelf]});assert.equal(index.sampleSupport(0,0,0,.35),null);
  const first=index.sweepVertical({x:0,z:0,fromY:1.5,toY:.1});assert.equal(first.hit,true);assert.equal(first.grounded,true);near(first.y,1.2);assert.equal(first.object.id,'shelf');
  const supported=index.sampleSupport(0,0,1.2,0);assert.equal(supported.id,'shelf');near(supported.height,1.2);
  const low=index.sampleSupport(0,0,.7,.2);assert.equal(low.id,'table');assert.equal(index.sampleSupport(5,0,4,.35),null);
  index.replaceStatic([{...shelf,support:false}]);assert.equal(index.sampleSupport(0,0,2,.35),null);index.dispose();
});

test('moving and hidden actors update immediately without duplicating render LODs',()=>{
  let actors=[createCylinderCollider({id:'person',x:0,z:0,radius:.28,minY:0,maxY:1.75})];const index=createObjectCollisionIndex({getDynamic:()=>actors});
  assert.equal(index.isBlocked(.4,0,.32,0),true);actors=[createCylinderCollider({id:'person',x:10,z:0,radius:.28,minY:0,maxY:1.75})];assert.equal(index.isBlocked(.4,0,.32,0),false);assert.equal(index.isBlocked(10,0,.32,0),true);
  actors[0].visible=false;assert.equal(index.isBlocked(10,0,.32,0),false);index.dispose();assert.equal(index.isBlocked(0,0,.32,0),false);
});

test('semantic object hull uses actual scaled dimensions, rotation and visible parts',()=>{
  const parent=new THREE.Group(),object=new THREE.Group();parent.position.set(10,3,20);parent.add(object);object.position.set(2,0,-2);object.rotation.y=Math.PI/4;
  const a=new THREE.Mesh(new THREE.BoxGeometry(4,1,.5)),hidden=new THREE.Mesh(new THREE.BoxGeometry(30,30,30));a.position.y=.5;hidden.visible=false;object.add(a,hidden);const before=a.geometry.attributes.position.array.slice();
  const c=colliderFromObject(THREE,object,{id:'visible-object'});near(c.x,12);near(c.z,18);near(c.width,4);near(c.depth,.5);near(c.yaw,Math.PI/4);near(c.minY,3);near(c.maxY,4);assert.deepEqual(a.geometry.attributes.position.array,before);
  for(const mesh of [a,hidden]){mesh.geometry.dispose();mesh.material.dispose();}
});

const context=()=>new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),measureText:text=>({width:String(text).length*10}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(target,key)=>key in target?target[key]:()=>{}});
async function browser(run){const old=new Map(['document','location','localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),storage=new Map();
  for(const [key,value]of Object.entries({document:{querySelector:()=>({}),createElement:()=>({width:1,height:1,dataset:{},getContext:context}),head:{append(){}}},location:{origin:'http://localhost:3000'},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},fetch:()=>{throw new Error('no network in geometry tests');}}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  try{await run(storage);}finally{for(const [key,value]of old)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
}

test('production interiors register chairs and plants while the entrance and rugs remain walkable',()=>browser(async()=>{
  const room=createInterior(THREE,'home');try{const index=room.collisionIndex;
    assert.equal(index.isBlocked(4.6,3.7,.32,0),true,'chair is solid');assert.equal(index.isBlocked(6.8,6.7,.32,0),true,'plant is solid');assert.equal(index.isBlocked(-6.9,-5.5,.32,0),true,'fridge is solid');
    assert.equal(index.isBlocked(0,7,.32,0),false,'spawn is clear');assert.equal(index.isBlocked(0,8,.32,0),false,'entrance approach is open');assert.equal(index.isBlocked(2.2,-1.8,.32,.0275),false,'floor rug does not become a wall');
    assert.ok(room.colliders.every(c=>Number.isFinite(c.minY)&&Number.isFinite(c.maxY)));const sourceCount=index.size;room.setQuality('low');assert.equal(index.size,sourceCount,'visual LOD updates do not duplicate physical objects');
  }finally{room.dispose();assert.equal(room.collisionIndex.size,0);}
}));

test('home rebuild and stored street objects replace their contact hulls',()=>browser(async storage=>{
  storage.set('machi:home:v1:guest',JSON.stringify({layout:{version:1,floor:'#aaaaaa',wall:'#eeeeee',items:[]}}));const home=await createPlayerHome(THREE);
  try{assert.equal(home.collisionIndex.isBlocked(0,7,.32,0),false);const result=home.addFurniture('chair',{id:'solid-chair'});assert.equal(result.ok,true);const item=home.getLayout().items.find(i=>i.id==='solid-chair'),collider=home.colliders.find(c=>c.itemId===item.id);assert.equal(home.collisionIndex.isBlocked(item.x,item.z,.32,0),true);assert.ok(collider.maxY>.9&&collider.maxY<1.2);assert.equal(home.collisionIndex.isBlocked(item.x,item.z,.32,1.25),false,'furniture is not an infinite column');}finally{home.dispose();}
  storage.set('machi.belongings.guest',JSON.stringify({items:[{id:'p',type:'plant',name:'Plant',color:'#64875b',condition:70,stored:false}],dirty:false}));const button={dataset:{own:'pickup'}};
  const possessions=createPossessions(THREE,{life:{state:{money:1000,energy:100,hunger:100,mood:50},save(){}},openPanel:()=>({querySelectorAll:selector=>selector==='[data-own]'?[button]:[],querySelector:()=>null})});
  try{possessions.attachWorld({spawn:{x:10,z:20},sampleGround:()=>({height:7})});const c=possessions.colliders.find(c=>c.type==='plant');assert.ok(c.minY>=7);assert.equal(possessions.collisionIndex.isBlocked(c.x,c.z,.32,7),true);assert.equal(possessions.collisionIndex.isBlocked(c.x,c.z,.32,0),false,'distant vertical level stays open');possessions.interact('flea:plant');button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(possessions.collisionIndex.isBlocked(c.x,c.z,.32,7),false,'storage removes the old contact');}finally{possessions.dispose();}
}));
