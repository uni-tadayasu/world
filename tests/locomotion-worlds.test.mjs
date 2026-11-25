// node tests/locomotion-worlds.test.mjs — integrated world/controller/avatar, CPU only.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRealWorldFromData} from '../dist/realworld.js';
import {createCharacterController} from '../dist/character-controller.js';
import {createAvatar} from '../dist/avatar.js';

const originalDocument=globalThis.document;
globalThis.document={createElement:()=>({width:1,height:1,getContext(){return new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),measureText:text=>({width:String(text).length*10}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(target,key)=>key in target?target[key]:()=>{}});}})};
const near=(actual,expected,tolerance=1e-5,message='position')=>assert.ok(Math.abs(actual-expected)<tolerance,`${message}: ${actual} != ${expected}`);
let world,avatar;
try{
  const latitude=35,longitude=139,earth=6378137,cos=Math.cos(latitude*Math.PI/180);
  const geo=(x,z)=>({lat:latitude-z/earth*180/Math.PI,lon:longitude+x/(earth*cos)*180/Math.PI});
  const data={elements:[
    {type:'way',id:1,tags:{highway:'steps',width:'2'},geometry:[geo(0,0),geo(0,10)]},
    {type:'way',id:2,tags:{highway:'footway',width:'2'},geometry:[geo(6,0),geo(6,10)]}
  ]};
  // The production OSM/DEM renderer receives deterministic input. These are
  // test fixtures only, not a playable fallback town or a claim about this GPS.
  const terrain={heightAt:(x,z)=>3+Math.max(0,Math.min(1.2,z*.12))+(x>20?3:0)};
  world=buildRealWorldFromData(THREE,data,{latitude,longitude,radius:100,terrain});
  const isBlocked=(x,z,r)=>{
    const b=world.bounds;if(x<b.minX+r||x>b.maxX-r||z<b.minZ+r||z>b.maxZ-r)return true;
    return world.colliders.some(c=>Math.hypot(x-Math.max(c.minX,Math.min(x,c.maxX)),z-Math.max(c.minZ,Math.min(z,c.maxZ)))<r);
  };
  const controller=createCharacterController({sampleGround:world.sampleGround,isBlocked});
  const heights=[];
  function walkTo(x,z,{requireGrounded=true}={}){
    const dx=x-controller.state.x,dz=z-controller.state.z,n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/(2.7/60)));
    for(let i=0;i<n;i++){
      const state=controller.step(1/60,{dx:dx/n,dz:dz/n});heights.push(state.y);
      assert.ok(Number.isFinite(state.y));
      if(requireGrounded){assert.equal(state.grounded,true,'rendered treads and slope retain contact');near(state.y,world.sampleGround(state.x,state.z).height,1e-5,'feet match registered rendered support');}
    }
    near(controller.state.x,x);near(controller.state.z,z);
  }

  assert.equal(world.sourceInfo.renderedTreadCount,8);
  controller.reset({x:0,z:-.5});near(controller.state.y,world.sampleGround(0,-.5).height);
  walkTo(0,10.5);
  for(let i=1;i<=8;i++){const height=3+i*.15+.049;assert.ok(heights.some(y=>Math.abs(y-height)<1e-5),`crossed rendered ${height}m tread`);}
  walkTo(0,-.5);near(controller.state.y,world.sampleGround(0,-.5).height);
  controller.reset({x:6,z:-.5});heights.length=0;walkTo(6,10.5);
  assert.ok(heights.some(y=>y>3.31&&y<3.34),'DEM footpath gives continuous slope support');
  walkTo(6,-.5);near(controller.state.y,world.sampleGround(6,-.5).height);
  controller.reset({x:17,z:-20});
  for(let i=0;i<90;i++)controller.step(1/60,{dx:2.7/60});
  assert.ok(controller.state.x<18.76,'steep rendered DEM face blocks motion');near(controller.state.y,2.985);

  avatar=createAvatar(THREE);avatar.group.position.set(4,2,-3);avatar.group.rotation.y=.7;
  const body=avatar.group.children[0].children[0],legs=body.children.filter(o=>o.isGroup&&Math.abs(o.position.y-.81)<1e-6).sort((a,b)=>a.position.x-b.position.x);
  assert.equal(legs.length,2,'actual built-in rig exposes two leg pivots');
  const footFor=upper=>upper.children.find(o=>o.isGroup&&Math.abs(o.position.y+.38)<1e-6).children.find(o=>o.isGroup&&Math.abs(o.position.y+.33)<1e-6);
  const feet=legs.map(footFor);let samples=0;
  const groundHeightAt=x=>{samples++;return x<4?2.15:2;};
  for(let i=0;i<30;i++)avatar.update(1/60,{grounded:true,groundHeightAt});
  assert.equal(samples,60,'both feet sample their own world-space positions');
  const ankle=feet.map(foot=>foot.getWorldPosition(new THREE.Vector3()));
  near(ankle[0].y,2.25,.006,'left ankle responds to raised support');near(ankle[1].y,2.1,.006,'right ankle stays on lower support');
  assert.ok(legs[0].quaternion.angleTo(legs[1].quaternion)>.1,'leg articulation follows the different foot heights');
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(avatar.group.getWorldQuaternion(new THREE.Quaternion()));
  function assertForwardKnee(upper,label){const knee=upper.children.find(o=>o.isGroup&&Math.abs(o.position.y+.38)<1e-6);const bend=knee.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3()));assert.ok(bend.dot(forward)>.04,`${label} knee bends toward the character's front on the raised step`);}
  assertForwardKnee(legs[0],'built-in');
  near(avatar.group.position.y,2,1e-8,'IK never moves the controller root');
  for(let i=0;i<90;i++)avatar.update(1/60,{grounded:true,groundHeightAt:x=>x<4?1.85:2});
  near(feet[0].getWorldPosition(new THREE.Vector3()).y,1.95,.006,'lower tread stays within reach by lowering the body');near(feet[1].getWorldPosition(new THREE.Vector3()).y,2.1,.006,'other foot remains on upper tread');
  const settledY=body.position.y;for(let i=0;i<300;i++)avatar.update(1/60,{grounded:true,groundHeightAt:x=>x<4?1.85:2});
  near(body.position.y,settledY,.02,'terrain body offset does not accumulate');near(avatar.group.position.y,2,1e-8,'lower tread never moves the controller root');
  const beforeAir=samples;avatar.update(1/60,{jumping:true,grounded:false,moving:true,speed:2.7,groundHeightAt});assert.equal(samples,beforeAir,'airborne legs are not pinned to ground');
  // The four-image code path uses the same pivot rig; synthetic image dimensions
  // verify articulation without pretending to validate a user's unseen photos.
  const photo={width:64,height:128};
  const imported=await avatar.fromImage({front:photo,back:photo,left:photo,right:photo},{quality:'standard'});
  assert.equal(imported.views.length,4);
  for(let i=0;i<30;i++)avatar.update(1/60,{grounded:true,groundHeightAt});
  const photoBody=avatar.group.children[0].children[0],photoLegs=photoBody.children.filter(o=>o.isGroup&&Math.abs(o.position.y-.81)<1e-6).sort((a,b)=>a.position.x-b.position.x);
  near(footFor(photoLegs[0]).getWorldPosition(new THREE.Vector3()).y,2.25,.006,'photo avatar left foot responds');near(footFor(photoLegs[1]).getWorldPosition(new THREE.Vector3()).y,2.1,.006,'photo avatar right foot responds');
  assertForwardKnee(photoLegs[0],'photo');
  for(let i=0;i<60;i++)avatar.update(1/60,{grounded:true,groundHeightAt:x=>x<4?1.85:2});
  near(footFor(photoLegs[0]).getWorldPosition(new THREE.Vector3()).y,1.95,.006,'photo lower tread contact');near(footFor(photoLegs[1]).getWorldPosition(new THREE.Vector3()).y,2.1,.006,'photo upper tread contact');
  avatar.group.traverse(o=>assert.ok([...o.position.toArray(),...o.quaternion.toArray()].every(Number.isFinite),'avatar pose stays finite'));
  console.log('PASS: production OSM/DEM stairs and slopes, steep-face blocking, and built-in/photo avatar foot IK in a translated/rotated frame.');
}finally{
  avatar?.dispose();world?.dispose();if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
}
