// Exercise the actual frame/menu and async map-install code with deterministic
// browser/renderer adapters. No GPU, real user account or network is required.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCharacterController} from '../dist/character-controller.js';
import {rebaseLocation} from '../dist/navigation.js';
const source=readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function frameHarness(pad,modalType=''){
  const ground={height:.135,normal:{y:1}},updates=[],opened=[];
  const c={THREE,requestAnimationFrame(){},document:{hidden:false,activeElement:{click(){c.closeModal();}}},lastFrame:1000,lastUI:1000,lastMap:1000,sessionFrames:500,
    started:true,busy:false,modalType,life:{syncClock(){},state:{minutes:600,settings:{sensitivity:1},energy:100,stats:{steps:0}},tick(){}},music:{update(){}},social:null,
    renderer:{render(){}},camera:{},scene:{},gamepad:{update:()=>pad,getRaw:()=>({buttons:[]})},keys:new Set(),touch:{x:0,y:0,run:false},yaw:0,pitch:.28,playerYaw:0,
    velocity:{x:0,z:0},pos:{x:0,z:0},walkTime:0,tripMetres:0,jumpQueued:false,activeBuilding:null,world:{real:false,update(){}},streaming:false,
    avatar:{group:new THREE.Group(),update:(dt,state)=>updates.push(state)},audio:{step(){}},sampleActiveGround:()=>ground,
    updateCamera(){},updateLighting(){},updateNameplate(){},updateHUD(){},updateNearest(){},drawMap(){},applyQuality(){},updateControllerReadout(){},
    openPanel:type=>opened.push(type),closeModal:()=>{c.modalType='';},openLocation(){},interact(){},setView(){},menuPadLast:0,menuPadPrev:[]};
  c.locomotion=createCharacterController({sampleGround:()=>ground});c.locomotion.reset(c.pos);
  vm.createContext(c);vm.runInContext(section('function frame(now)','function updateLighting')+'\n'+section('function handleGamepadMenu','function renderHelp'),c);
  return {c,updates,opened};
}
const pad=extra=>({moveX:0,moveY:0,lookX:0,lookY:0,run:false,jump:false,pause:false,...extra});
test('closing a menu with START consumes that frame and does not reopen pause',()=>{
  const {c,opened}=frameHarness(pad({pause:true}),'pause');c.frame(1016);
  assert.equal(c.modalType,'');assert.deepEqual(opened,[]);assert.equal(c.locomotion.state.y,.135);
});
test('confirming a menu action cannot leak into a jump or movement',()=>{
  const {c,updates}=frameHarness(pad({jump:true,moveY:1}),'help');c.frame(1016);
  assert.equal(c.modalType,'');assert.equal(c.pos.z,0);assert.equal(c.locomotion.state.grounded,true);assert.equal(updates.at(-1).jumping,false);
});
test('frame passes actual displacement and rendered ground into avatar motion',()=>{
  const {c,updates}=frameHarness(pad({moveY:1}));c.frame(1016);
  assert.ok(c.pos.z<0);assert.equal(c.avatar.group.position.y,.135);assert.equal(updates.at(-1).grounded,true);assert.equal(updates.at(-1).groundHeightAt(0,0),.135);assert.ok(updates.at(-1).speed>0);
  c.locomotion=createCharacterController({sampleGround:()=>({height:.135,normal:{y:1}}),isBlocked:()=>true});c.locomotion.reset(c.pos);c.frame(1032);
  assert.equal(updates.at(-1).speed,0);assert.equal(updates.at(-1).moving,false,'requested input at a wall is not walking');
});
function mapWorld(originX){return {real:true,radius:150,spawn:{x:0,z:0,yaw:0},group:{visible:true},bounds:{minX:-150,maxX:150,minZ:-150,maxZ:150},buildings:[],sourceInfo:{},
  toGeo:(x,z)=>({latitude:35-z/100000,longitude:139+(x+originX)/100000}),toLocal:(lat,lon)=>({x:(lon-139)*100000-originX,z:(35-lat)*100000}),dispose(){this.disposed=true;}};}
async function streamHarness({initial=false}={}){
  let release,called;const pending=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>called=resolve),old=mapWorld(0),next=mapWorld(100),node={textContent:''};
  const c={Number,AbortController,DOMException,Promise,console,performance,THREE,rebaseLocation,renderer:{},world:initial?null:old,active:initial?null:old,activeBuilding:null,selectedWorldRadius:150,streaming:false,busy:false,
    realLocationName:'テストの街',pos:{x:100,z:0},yaw:.7,pitch:.4,playerYaw:.7,selectedDestination:{id:'target',name:'目的地',entrance:{x:140,z:0}},scene:{remove(){},add(){},fog:{}},camera:{position:new THREE.Vector3(105,4,3)},
    getWorldModule:async()=>({createRealWorld:()=>{called();return pending;}}),getTerrainModule:async()=>({loadTerrain:async()=>null}),geoController:null,streamMessage:'',lastStream:0,
    collides:()=>false,activeGround:()=>.135,locomotion:createCharacterController({sampleGround:()=>({height:.135,normal:{y:1}})}),possessions:null,initPossessions(){},exteriorReal:true,
    life:{state:{settings:{quality:'high'}}},applyQuality(){},updateHUD(){},updateCamera(){},startGame(){if(!initial)throw new Error('stream must not restart the game');c.started=true;},showPanel(){},resetLocomotion(){c.locomotion.reset(c.pos);},tripMetres:0,gpsAccuracy:null,gpsTrail:[],toast(){},$:()=>node};
  c.locomotion.reset(c.pos);vm.createContext(c);
  const code=section('async function loadReal','function sampleActiveGround').replace("import('./realworld.js')",'getWorldModule()').replace("import('./terrain.js')",'getTerrainModule()');vm.runInContext(code,c);
  const result=c.loadReal(35,139.001,{stream:!initial,radius:150});await requested;
  return {c,old,next,release,result};
}
test('background streaming preserves movement made during fetch and keeps the camera frame',async()=>{
  const {c,old,next,release,result}=await streamHarness();assert.equal(c.busy,false,'fetching a neighbour must not block controls');
  c.pos.x=136;c.pos.z=-12;c.locomotion.reset(c.pos);c.camera.position.set(141,4,-9);release(next);await result;
  assert.equal(c.world,next);assert.ok(Math.abs(c.pos.x-36)<1e-6);assert.ok(Math.abs(c.pos.z+12)<1e-6);assert.ok(Math.abs(c.camera.position.x-41)<1e-6);
  assert.ok(Math.abs(c.selectedDestination.entrance.x-40)<1e-6);assert.equal(c.pitch,.4);assert.equal(c.yaw,.7);assert.equal(old.disposed,true);assert.equal(c.streaming,false);assert.equal(c.streamMessage,'');
});
test('a chunk completed after entering a room is discarded without pulling the player outside',async()=>{
  const {c,old,next,release,result}=await streamHarness();c.activeBuilding={id:'home'};c.active={group:{visible:true}};c.busy=true;
  release(next);await result;assert.equal(c.world,old);assert.equal(old.disposed,undefined);assert.equal(next.disposed,true);assert.equal(c.busy,true,'the room transition owns its busy state');
});

test('the first real-world load starts without a preloaded fictional town',async()=>{
  const {c,next,release,result}=await streamHarness({initial:true});assert.equal(c.world,null);assert.equal(c.busy,true);
  release(next);await result;assert.equal(c.world,next);assert.equal(c.active,next);assert.equal(c.started,true);assert.equal(c.busy,false);assert.equal(c.pos.x,0);assert.equal(c.pos.z,0);assert.equal(c.locomotion.state.grounded,true);
});
