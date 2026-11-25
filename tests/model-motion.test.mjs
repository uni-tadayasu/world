import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacterModel} from '../dist/model-loader.js';
import {humanoidGlb,rotation,vertexWorld,findMesh} from './model-motion-fixtures.mjs';

for(const naming of ['mixamo','blender','japanese','vrm']) test(`real ${naming} GLB: procedural locomotion changes bones and skinned vertices`,async()=>{
  const fixture=humanoidGlb({naming,rotatedJoints:true}),avatar=await loadCharacterModel(THREE,fixture.buffer);
  assert.equal(avatar.rigged,true);assert.equal(avatar.autoRigged,false);
  const mesh=findMesh(avatar),bone=mesh.skeleton.bones[4],rest=bone.quaternion.clone(),before=vertexWorld(mesh,fixture.partVertices.leftUpperLeg);
  for(let i=0;i<12;i++)avatar.update(1/60,{moving:true,speed:1.6,grounded:true});
  assert.ok(bone.quaternion.angleTo(rest)>.1,'The thigh is rotating');
  assert.ok(before.distanceTo(vertexWorld(mesh,fixture.partVertices.leftUpperLeg))>.025,'Actual skin vertices move');
  assert.equal(avatar.getMotionStatus().source,'procedural');assert.equal(avatar.getMotionStatus().role,'walk');
  avatar.update(.1,{moving:true,running:true,speed:4.2});assert.equal(avatar.getMotionStatus().role,'run');
  avatar.update(.1,{jumping:true,grounded:false,verticalVelocity:3});assert.equal(avatar.getMotionStatus().role,'jump');
  avatar.dispose();
});

for(const version of [0,1]) test(`VRM ${version} mappings work without bone-name conventions and use the correct forward axis`,async()=>{
  const fixture=humanoidGlb({naming:'numbered',vrm:version}),avatar=await loadCharacterModel(THREE,fixture.buffer);
  assert.equal(avatar.rigged,true);assert.equal(avatar.getMotionConfig().facing,version===0?0:180);
  avatar.update(.1,{moving:true});assert.equal(avatar.getMotionStatus().source,'procedural');avatar.dispose();
});

test('explicit approximate mode gives an unskinned humanoid GPU deformation without changing UVs or materials',async()=>{
  const fixture=humanoidGlb({skin:false,nested:true}),avatar=await loadCharacterModel(THREE,fixture.buffer,{motionConfig:{mode:'approximate'}});
  assert.equal(avatar.autoRigged,true);const mesh=findMesh(avatar);assert.ok(mesh.isSkinnedMesh);
  assert.equal(mesh.material.name,'FixtureFabric');assert.equal(mesh.material.roughness,.8);assert.equal(mesh.material.metalness,.1);
  assert.equal(mesh.geometry.attributes.uv.count,mesh.geometry.attributes.position.count);
  const before=vertexWorld(mesh,fixture.partVertices.leftLowerLeg);
  for(let i=0;i<15;i++)avatar.update(1/60,{moving:true,speed:1.6});
  assert.ok(before.distanceTo(vertexWorld(mesh,fixture.partVertices.leftLowerLeg))>.04);
  const beforeTeleport=vertexWorld(mesh,fixture.partVertices.leftLowerLeg);
  avatar.group.position.set(12,3,-4);avatar.update(0,{moving:true,speed:1.6});
  const displacement=vertexWorld(mesh,fixture.partVertices.leftLowerLeg).sub(beforeTeleport);
  assert.ok(displacement.distanceTo(new THREE.Vector3(12,3,-4))<1e-5,'Generated skin follows controller translation exactly once');
  const weights=mesh.geometry.attributes.skinWeight;
  for(let i=0;i<weights.count;i++)assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-6);
  avatar.dispose();
});

test('nonhumanoid static objects are not silently presented as fully rigged humans',async()=>{
  const avatar=await loadCharacterModel(THREE,humanoidGlb({skin:false,shape:'box'}).buffer);
  assert.equal(avatar.autoRigged,false);assert.equal(avatar.getMotionStatus().source,'static');
  assert.match(avatar.motionSummary,/元の形状を保持/);avatar.dispose();
});

test('missing authored locomotion falls back to bones, while root motion cannot displace the avatar',async()=>{
  const clips=[{name:'Idle',tracks:[{bone:'hips',path:'translation',times:[0,1],values:[[0,.91,0],[9,.95,12]]},{bone:'leftUpperArm',path:'rotation',times:[0,1],values:[rotation(),rotation(.4)]}]}];
  const avatar=await loadCharacterModel(THREE,humanoidGlb({clips}).buffer);
  avatar.group.position.set(31,4,-7);avatar.group.rotation.y=.7;
  for(let i=0;i<90;i++)avatar.update(1/60,{grounded:true});
  assert.equal(avatar.getMotionStatus().source,'authored');const mesh=findMesh(avatar);
  assert.ok(Math.abs(mesh.skeleton.bones[0].position.x)<1e-7);assert.ok(Math.abs(mesh.skeleton.bones[0].position.z)<1e-7);
  assert.deepEqual(avatar.group.position.toArray(),[31,4,-7]);
  avatar.update(.1,{moving:true,speed:1.6});assert.equal(avatar.getMotionStatus().source,'procedural');
  avatar.setMotionConfig({mode:'authored'});avatar.update(.1,{moving:true});assert.equal(avatar.getMotionStatus().source,'authored');avatar.dispose();
});

test('shared authored clip changes loop on role entry and a later jump restarts',async()=>{
  const clips=[{name:'Take 001',tracks:[{bone:'leftLowerLeg',path:'rotation',times:[0,.2],values:[rotation(),rotation(.9)]},
    {bone:'root',path:'translation',times:[0,.2],values:[[0,0,0],[1,6,2]]},
    {bone:'hips',path:'translation',times:[0,.2],values:[[0,.91,0],[0,4.91,0]]}]}];
  const avatar=await loadCharacterModel(THREE,humanoidGlb({clips}).buffer,{motionConfig:{mode:'authored'}});
  avatar.update(.1,{moving:true});assert.equal(avatar.getMotionStatus().role,'walk');
  avatar.update(.03,{jumping:true,grounded:false});assert.ok(avatar.getMotionStatus().time<.05);
  for(let i=0;i<5;i++)avatar.update(.1,{jumping:true,grounded:false});
  assert.equal(avatar.getMotionStatus().completed,true);
  assert.ok(Math.abs(findMesh(avatar).skeleton.bones[0].position.y-.91)<1e-6,'An authored jump must not add a second jump height');
  avatar.update(.1,{grounded:true});avatar.update(.02,{jumping:true,grounded:false});
  assert.ok(avatar.getMotionStatus().time<.04);assert.equal(avatar.getMotionStatus().completed,false);avatar.dispose();
});

test('terrain foot placement bends the leg to a raised step without translating the player',async()=>{
  const avatar=await loadCharacterModel(THREE,humanoidGlb().buffer),mesh=findMesh(avatar),foot=mesh.skeleton.bones[6];
  avatar.group.position.set(5,.3,8);avatar.group.rotation.y=.6;avatar.group.updateMatrixWorld(true);
  avatar.update(0,{grounded:true});const before=foot.getWorldPosition(new THREE.Vector3());
  avatar.update(.016,{grounded:true,groundHeight:.3,groundHeightAt:()=>.47});
  const after=foot.getWorldPosition(new THREE.Vector3());
  assert.ok(after.y>before.y+.10,`Ankle must lift toward the step: ${before.y} -> ${after.y}`);
  const hip=mesh.skeleton.bones[4].getWorldPosition(new THREE.Vector3()),knee=mesh.skeleton.bones[5].getWorldPosition(new THREE.Vector3());
  const legDirection=after.clone().sub(hip).normalize(),bend=knee.clone().sub(hip);bend.addScaledVector(legDirection,-bend.dot(legDirection));
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(avatar.group.quaternion);
  assert.ok(bend.dot(forward)>0,'The knee bends forward, including near-straight rest poses');
  assert.ok(avatar.getMotionStatus().footCorrections>0);assert.deepEqual(avatar.group.position.toArray(),[5,.3,8]);
  avatar.update(.016,{grounded:false,jumping:true,groundHeightAt:()=>.47});assert.equal(avatar.getMotionStatus().footCorrections,0);avatar.dispose();
});

test('invalid timing/terrain cannot create NaN transforms; owned GPU resources dispose exactly once',async()=>{
  const avatar=await loadCharacterModel(THREE,humanoidGlb({skin:false}).buffer,{motionConfig:{mode:'approximate'}}),mesh=findMesh(avatar);
  let geometries=0,materials=0,skeletons=0;mesh.geometry.addEventListener('dispose',()=>geometries++);mesh.material.addEventListener('dispose',()=>materials++);
  const originalDispose=mesh.skeleton.dispose.bind(mesh.skeleton);mesh.skeleton.dispose=()=>{skeletons++;originalDispose();};
  for(const dt of [NaN,Infinity,-1,0,.016])avatar.update(dt,{moving:true,speed:NaN,grounded:true,groundHeightAt:()=>NaN});
  avatar.group.traverse(node=>assert.ok([...node.position,...node.quaternion,...node.scale].every(Number.isFinite)));
  avatar.setMotionConfig({facing:90,mode:'approximate'});assert.deepEqual(avatar.getMotionConfig(),{mode:'approximate',facing:90});
  avatar.dispose();avatar.dispose();avatar.update(.1,{moving:true});
  assert.equal(geometries,1);assert.equal(materials,1);assert.equal(skeletons,1);assert.equal(avatar.group.children.length,0);
});

test('a root-translation-only Walk clip is completed with actual humanoid locomotion',async()=>{
  const clips=[{name:'Walk',tracks:[{bone:'root',path:'translation',times:[0,1],values:[[0,0,0],[0,0,4]]}]}];
  const avatar=await loadCharacterModel(THREE,humanoidGlb({clips}).buffer);
  avatar.update(.1,{moving:true});assert.equal(avatar.getMotionStatus().source,'procedural');avatar.dispose();
});

test('facing adjustments keep procedural steps along the controller forward axis',async()=>{
  const avatar=await loadCharacterModel(THREE,humanoidGlb().buffer,{motionConfig:{facing:90}}),mesh=findMesh(avatar);
  const before=mesh.skeleton.bones[5].getWorldPosition(new THREE.Vector3());
  avatar.update(.1,{moving:true,speed:1.6});
  const after=mesh.skeleton.bones[5].getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(after.x-before.x)<1e-6);assert.ok(Math.abs(after.z-before.z)>.05);avatar.dispose();
});

for(const skin of [true,false]) test(`${skin?'authored':'generated'} skeleton reaches a descending tread with bounded body compensation`,async()=>{
  const avatar=await loadCharacterModel(THREE,humanoidGlb({skin}).buffer,{motionConfig:{mode:skin?'auto':'approximate'}}),mesh=findMesh(avatar),foot=mesh.skeleton.bones[6];
  avatar.group.position.set(3,.4,7);avatar.group.rotation.y=.7;avatar.update(0,{grounded:true});
  const sole=foot.getWorldPosition(new THREE.Vector3()).y-.4;
  const groundHeightAt=(x,z)=>avatar.group.worldToLocal(new THREE.Vector3(x,.4,z)).x<0?.25:.4;
  for(let i=0;i<30;i++)avatar.update(1/60,{grounded:true,groundHeight:.4,groundHeightAt});
  const actual=foot.getWorldPosition(new THREE.Vector3()).y,expected=.25+sole;
  assert.ok(Math.abs(actual-expected)<.004,`Lower ankle should contact its tread: ${actual} vs ${expected}`);
  assert.deepEqual(avatar.group.position.toArray(),[3,.4,7]);
  assert.ok(avatar.getMotionStatus().bodyOffset<-.12 && avatar.getMotionStatus().bodyOffset>=-.20);
  avatar.update(.016,{grounded:false,jumping:true});assert.equal(avatar.getMotionStatus().bodyOffset,0);avatar.dispose();
});
