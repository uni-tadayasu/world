import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterController} from '../dist/character-controller.js';
const flat=height=>({height,normal:{x:0,y:1,z:0},kind:'test'});
function walk(controller,seconds=1,vx=2,vz=0){for(let t=0;t<seconds-1e-6;t+=1/60)controller.step(1/60,{dx:vx/60,dz:vz/60});return controller.state;}

test('walks up a curb and down the rendered surface without floating',()=>{
  const c=createCharacterController({sampleGround:x=>flat(x>=1&&x<2?.2:0)});c.reset({x:0,z:0});
  walk(c,.75);assert.equal(c.state.y,.2);assert.equal(c.state.grounded,true);
  walk(c,.75);assert.equal(c.state.y,0);assert.equal(c.state.grounded,true);
});
test('a high step blocks motion and reports the actual distance',()=>{
  const c=createCharacterController({sampleGround:x=>flat(x>=1?.8:0)});c.reset();walk(c);
  assert.ok(c.state.x<1);walk(c);assert.equal(c.state.speed,0);assert.equal(c.state.y,0);
});
test('gentle slopes follow height while steep ground is blocked',()=>{
  const gentle=createCharacterController({sampleGround:x=>({height:x*.3,normal:{y:1/Math.sqrt(1.09)}})});gentle.reset();walk(gentle);
  assert.ok(Math.abs(gentle.state.y-gentle.state.x*.3)<1e-8);
  const steep=createCharacterController({sampleGround:x=>x<1?flat(0):{height:(x-1)*3,normal:{y:1/Math.sqrt(10)}}});steep.reset();walk(steep);
  assert.ok(steep.state.x<1);
});
test('walking off a drop falls under gravity rather than snapping down',()=>{
  const c=createCharacterController({sampleGround:x=>flat(x<.5?1:0)});c.reset();walk(c,.3);
  assert.ok(c.state.y>.5&&c.state.y<1);assert.equal(c.state.grounded,false);
  walk(c,.7);assert.equal(c.state.y,0);assert.equal(c.state.grounded,true);
});
test('jump height is independent of terrain below and lands on a raised surface',()=>{
  const c=createCharacterController({sampleGround:x=>flat(x<.5?0:.5)});c.reset();
  c.step(1/60,{jump:true});assert.equal(c.state.jumped,true);
  walk(c,.22,3);assert.ok(c.state.x>.5);assert.ok(c.state.y>.5);assert.equal(c.state.grounded,false);
  walk(c,.7,0);assert.equal(c.state.y,.5);assert.equal(c.state.grounded,true);
});
test('jump cannot be retriggered in the air and resets cleanly on teleport',()=>{
  const a=createCharacterController({sampleGround:()=>flat(0)}),b=createCharacterController({sampleGround:()=>flat(0)});a.reset();b.reset();
  for(let i=0;i<10;i++){a.step(1/60,{jump:true});b.step(1/60,{jump:i===0});}
  assert.equal(a.state.y,b.state.y);assert.equal(a.state.verticalVelocity,b.state.verticalVelocity);
  a.reset({x:4,z:5});assert.equal(a.state.y,0);assert.equal(a.state.grounded,true);assert.equal(a.state.verticalVelocity,0);
});
test('collision substeps prevent wall tunnelling and allow sliding',()=>{
  const c=createCharacterController({sampleGround:()=>flat(0),isBlocked:(x,z,r)=>x+r>=1});c.reset();walk(c,1,3,2);
  assert.ok(c.state.x<=.68);assert.ok(c.state.z>1.9);assert.ok(Number.isFinite(c.state.speed));
});
test('invalid input never corrupts the player pose',()=>{
  const c=createCharacterController({sampleGround:()=>flat(0)});c.reset();c.step(NaN,{dx:Infinity,dz:NaN});c.step(.02,{dx:Infinity,dz:NaN});
  assert.ok(Object.values(c.state).filter(v=>typeof v==='number').every(Number.isFinite));
});
