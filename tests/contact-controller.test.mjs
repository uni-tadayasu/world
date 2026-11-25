import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterController} from '../dist/character-controller.js';
import {createObjectCollisionIndex,createBoxCollider} from '../dist/object-collisions.js';

function scene(objects){
  const index=createObjectCollisionIndex({colliders:objects});
  const controller=createCharacterController({
    sampleGround:(x,z,y=0)=>index.sampleSupport(x,z,y,.35,.32)||{height:0,normal:{x:0,y:1,z:0},kind:'floor'},
    isBlocked:(x,z,r,y,h)=>index.isBlocked(x,z,r,y,h),sweepVertical:query=>index.sweepVertical(query)
  });controller.reset();return {controller,index};
}
function frames(controller,count,options={}){for(let i=0;i<count;i++)controller.step(1/60,typeof options==='function'?options(i):options);}

test('solid object step-up uses raised body height while a higher object stops movement',()=>{
  const {controller,index}=scene([createBoxCollider({x:1.5,z:0,width:1,depth:2,minY:0,maxY:.25})]);
  frames(controller,35,{dx:2.7/60});assert.ok(controller.state.x>1);assert.equal(controller.state.y,.25);assert.equal(controller.state.grounded,true);
  index.replaceStatic([createBoxCollider({x:1.5,z:0,width:1,depth:2,minY:0,maxY:.6})]);controller.reset();frames(controller,60,{dx:2.7/60});
  assert.ok(controller.state.x<.69);assert.equal(controller.state.y,0);index.dispose();
});

test('jumping hits the underside of an overhead solid and falls without penetrating',()=>{
  const {controller,index}=scene([createBoxCollider({x:0,z:0,width:4,depth:4,minY:2.1,maxY:2.3})]);
  let highest=0;for(let i=0;i<100;i++){controller.step(1/60,{jump:i===0});highest=Math.max(highest,controller.state.y);assert.ok(controller.state.y+1.75<=2.1+.002);}
  assert.ok(highest>.32&&highest<=.35+.002);assert.equal(controller.state.y,0);assert.equal(controller.state.grounded,true);index.dispose();
});

test('jumping onto an object lands on its top and walking off returns to the floor',()=>{
  const {controller,index}=scene([createBoxCollider({x:1.5,z:0,width:1.6,depth:2,minY:0,maxY:.5})]);
  frames(controller,30,i=>({jump:i===0,dx:2.7/60}));frames(controller,40);
  assert.ok(controller.state.x>1);assert.equal(controller.state.y,.5);assert.equal(controller.state.grounded,true);
  frames(controller,55,{dx:2.7/60});assert.ok(controller.state.x>3);frames(controller,45);
  assert.equal(controller.state.y,0);assert.equal(controller.state.grounded,true);index.dispose();
});

test('descending fast still contacts a thin object top and finite overhead objects leave space below',()=>{
  const {controller,index}=scene([createBoxCollider({x:0,z:0,width:3,depth:3,minY:1,maxY:1.05})]);
  controller.reset({x:0,z:0,y:5});controller.state.verticalVelocity=-20;let landed=false;
  for(let i=0;i<45;i++){controller.step(.05);landed||=controller.state.landed;}
  assert.equal(landed,true);assert.equal(controller.state.y,1.05);assert.equal(controller.state.grounded,true);
  index.replaceStatic([createBoxCollider({x:1.5,z:0,width:1,depth:3,minY:3,maxY:3.2})]);controller.reset();frames(controller,60,{dx:2.7/60});
  assert.ok(controller.state.x>2.6,'walks underneath an elevated object');assert.equal(controller.state.y,0);index.dispose();
});
