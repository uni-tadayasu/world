import assert from 'node:assert/strict';
import test from 'node:test';
import {createGamepadManager} from '../dist/gamepad.js';

function environment(run){
  const originals=new Map(['navigator','localStorage','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const pads=[],storage=new Map(),events=new EventTarget();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:events});
  let manager;
  try{manager=createGamepadManager();run({manager,pads,storage,events});}
  finally{manager?.destroy();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
const pad=(index=0)=>({index,id:'Test pad '+index,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))});
const press=(device,index,value=1)=>{device.buttons[index]={pressed:value>.5,value};};

test('a D-pad-only controller walks and diagonal movement is normalized',()=>environment(({manager,pads})=>{
  const device=pad();device.axes=[];pads.push(device);
  assert.ok(manager.update().moveY===0);
  press(device,12);let value=manager.update();
  assert.equal(value.moveY,1);assert.ok(value.moveX===0);
  press(device,15);value=manager.update();
  assert.ok(Math.abs(value.moveX-Math.SQRT1_2)<1e-12);
  assert.ok(Math.abs(value.moveY-Math.SQRT1_2)<1e-12);
  assert.ok(Math.abs(Math.hypot(value.moveX,value.moveY)-1)<1e-12);
  press(device,12,0);press(device,15,0);press(device,13);press(device,14);value=manager.update();
  assert.ok(value.moveX<0&&value.moveY<0);
}));

test('nonstandard directional buttons can be remapped and unused axes disabled',()=>environment(({manager,pads,storage})=>{
  const device=pad();device.mapping='';device.axes=[0,0,1,1];pads.push(device);
  manager.setConfig({dpadUpButton:4,dpadDownButton:5,dpadLeftButton:6,dpadRightButton:7,lookXAxis:-1,lookYAxis:-1});
  press(device,4);let value=manager.update();
  assert.equal(value.moveY,1);assert.ok(value.lookX===0);assert.ok(value.lookY===0);
  press(device,4,0);press(device,12);value=manager.update();assert.ok(value.moveY===0);
  manager.setConfig({dpadUpButton:-1,dpadDownButton:-1,dpadLeftButton:-1,dpadRightButton:-1});
  press(device,7);value=manager.update();assert.ok(value.moveX===0);
  assert.equal(JSON.parse(storage.get('machi.gamepad.v1')).config.lookXAxis,-1);
}));

test('analog motion remains proportional with a deadzone and no D-pad press',()=>environment(({manager,pads})=>{
  const device=pad();pads.push(device);device.axes=[.1,.1,0,0];
  let value=manager.update();assert.ok(value.moveX===0);assert.ok(value.moveY===0);
  device.axes=[.59,0,0,0];value=manager.update();assert.ok(Math.abs(value.moveX-.5)<1e-12);
  press(device,12);value=manager.update();assert.ok(value.moveX===0);assert.equal(value.moveY,1);
  press(device,12,0);value=manager.update();assert.ok(Math.abs(value.moveX-.5)<1e-12);
}));

test('action buttons are consumed once and a held reconnect does not jump',()=>environment(({manager,pads})=>{
  const device=pad();press(device,0);pads.push(device);
  assert.equal(manager.update().jump,false);assert.equal(manager.update().jump,false);
  press(device,0,0);manager.update();press(device,0);assert.equal(manager.update().jump,true);
  assert.equal(manager.update().jump,false);
  device.connected=false;assert.equal(manager.update().jump,false);
  device.connected=true;assert.equal(manager.update().jump,false);
  press(device,0,0);manager.update();press(device,0);assert.equal(manager.update().jump,true);
}));

test('calibration ignores disabled axes and reset restores standard controls',()=>environment(({manager,pads})=>{
  const device=pad();device.axes=[.12,-.08,1,1];pads.push(device);
  manager.setConfig({lookXAxis:-1,lookYAxis:-1,dpadRightButton:7});
  assert.equal(manager.calibrate().ok,true);
  const value=manager.update();assert.ok(value.moveX===0);assert.ok(value.moveY===0);assert.ok(value.lookX===0);
  manager.resetConfig();assert.equal(manager.getConfig().dpadRightButton,15);assert.equal(manager.getConfig().lookXAxis,2);
}));
