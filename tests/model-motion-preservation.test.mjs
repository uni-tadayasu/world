import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from '../dist/vendor/loaders/GLTFLoader.js';
import {loadCharacterModel} from '../dist/model-loader.js';
import {humanoidGlb,rewriteGlb,rotation} from './model-motion-fixtures.mjs';

const meshes=root=>{const result=[];root.traverse(node=>{if(node.isMesh)result.push(node);});return result;};
async function reference(buffer) {
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(buffer,'',resolve,reject));
  const source=gltf.scene;source.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(source),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=1.75/size.y;
  const group=new THREE.Group(),facing=new THREE.Group(),normalizer=new THREE.Group();
  facing.rotation.y=Math.PI;normalizer.scale.setScalar(scale);normalizer.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);
  normalizer.add(source);facing.add(normalizer);group.add(facing);group.updateMatrixWorld(true);
  return {group,gltf};
}
function assertSameShape(actual,expected,tolerance=.00001) {
  actual.updateMatrixWorld(true);expected.updateMatrixWorld(true);
  const a=meshes(actual),b=meshes(expected);assert.equal(a.length,b.length);
  let max=0;
  for(let k=0;k<a.length;k++) {
    const mesh=a[k],original=b[k];assert.equal(mesh.geometry.attributes.position.count,original.geometry.attributes.position.count);
    for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
      const p=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),q=original.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(original.matrixWorld);
      assert.ok([...p,...q].every(Number.isFinite));max=Math.max(max,p.distanceTo(q));
    }
  }
  assert.ok(max<tolerance,`Original shape changed by ${max} metres (allowed ${tolerance})`);
}
function assertSourceData(actual,expected) {
  const a=meshes(actual),b=meshes(expected);assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++) {
    assert.deepEqual(Object.keys(a[i].geometry.attributes),Object.keys(b[i].geometry.attributes));
    for(const key of Object.keys(b[i].geometry.attributes))assert.deepEqual(a[i].geometry.attributes[key].array,b[i].geometry.attributes[key].array,`Attribute ${key} must be preserved`);
    assert.deepEqual(Object.keys(a[i].geometry.morphAttributes),Object.keys(b[i].geometry.morphAttributes));
    for(const key of Object.keys(b[i].geometry.morphAttributes))assert.deepEqual(a[i].geometry.morphAttributes[key].map(attribute=>attribute.array),b[i].geometry.morphAttributes[key].map(attribute=>attribute.array));
    if(b[i].skeleton) {
      assert.ok(a[i].skeleton);assert.deepEqual(a[i].bindMatrix.elements,b[i].bindMatrix.elements);
      assert.deepEqual(a[i].skeleton.boneInverses.map(m=>m.toArray()),b[i].skeleton.boneInverses.map(m=>m.toArray()));
    }
    for(const key of ['name','metalness','roughness','side','transparent','opacity'])assert.equal(a[i].material[key],b[i].material[key]);
    assert.equal(a[i].material.color.getHex(),b[i].material.color.getHex());
  }
}
function offsetBindOrigin() {
  return rewriteGlb(humanoidGlb({rotatedJoints:true,details:true}).buffer,(json,{values})=>{
    const index=json.meshes[0].primitives[0].attributes.POSITION,positions=values(index),offset=[17,-3,9];
    for(let i=0;i<positions.length;i++)positions[i]+=offset[i%3];
    for(const key of ['min','max'])json.accessors[index][key]=json.accessors[index][key].map((v,i)=>v+offset[i]);
    const inverse=values(json.skins[0].inverseBindMatrices),adjust=new THREE.Matrix4().makeTranslation(...offset.map(v=>-v));
    for(let i=0;i<inverse.length;i+=16)new THREE.Matrix4().fromArray(inverse,i).multiply(adjust).toArray(inverse,i);
  });
}
const cases=[
  ['unskinned clothing and long hair',()=>humanoidGlb({skin:false,details:true}).buffer],
  ['named humanoid with rotated rest axes',()=>humanoidGlb({rotatedJoints:true,details:true}).buffer],
  ['numbered joints with no humanoid definition',()=>humanoidGlb({naming:'numbered',details:true}).buffer],
  ['large origin and centimetre scale',()=>rewriteGlb(humanoidGlb({nested:true}).buffer,json=>{json.nodes.at(-1).translation=[2400,-1200,600];json.nodes.at(-1).scale=[100,100,100];})],
  ['nonuniform ancestor scale',()=>rewriteGlb(humanoidGlb({nested:true}).buffer,json=>{json.nodes.at(-1).scale=[.6,2,1.3];})],
  ['mirrored ancestor scale',()=>rewriteGlb(humanoidGlb({nested:true}).buffer,json=>{json.nodes.at(-1).scale=[-2,2,2];})],
  ['offset geometry with compensating inverse bind matrices',offsetBindOrigin],
  ['separate clothing skin with different inverse bind matrices',()=>humanoidGlb({extraSkin:true,details:true}).buffer]
];
for(const [label,fixture]of cases)test(`default import preserves ${label} before any player action`,async()=>{
  const buffer=fixture(),original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  assert.equal(avatar.autoRigged,false);assertSameShape(avatar.group,original.group);assertSourceData(avatar.group,original.group);avatar.dispose();
});

for(const [label,fixture]of [cases[0],cases[2],cases[4],cases[5]])test(`unsupported ${label} keeps its shape while controlled`,async()=>{
  const buffer=fixture(),original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  assert.equal(avatar.rigged,false);
  avatar.group.position.set(8,2,-3);avatar.group.rotation.y=.8;original.group.position.copy(avatar.group.position);original.group.rotation.copy(avatar.group.rotation);
  for(let i=0;i<30;i++)avatar.update(1/60,{moving:true,running:true,speed:4.2,grounded:true,groundHeight:2,groundHeightAt:()=>2.17});
  avatar.update(.1,{jumping:true,grounded:false,verticalVelocity:3});
  assert.equal(avatar.getMotionStatus().source,'static');assertSameShape(avatar.group,original.group);assertSourceData(avatar.group,original.group);avatar.dispose();
});

for(const pose of ['seated','lying'])test(`a ${pose} named humanoid is not forcibly changed into standing pose`,async()=>{
  const fixture=humanoidGlb({details:true}),buffer=rewriteGlb(fixture.buffer,json=>{
    if(pose==='lying')json.nodes[0].rotation=rotation(Math.PI/2);
    else for(const side of ['left','right']) {json.nodes[fixture.jointNodes[side+'UpperLeg']].rotation=rotation(-Math.PI/2);json.nodes[fixture.jointNodes[side+'LowerLeg']].rotation=rotation(Math.PI/2);}
  });
  const original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  assert.equal(avatar.rigged,false);avatar.update(.1,{moving:true,groundHeightAt:()=>.2});
  assertSameShape(avatar.group,original.group);assert.equal(avatar.getMotionStatus().source,'static');avatar.dispose();
});

test('independent skeletons are not mixed into a guessed humanoid',async()=>{
  const buffer=rewriteGlb(humanoidGlb().buffer,json=>{
    const count=json.nodes.length,copy=structuredClone(json.nodes);
    for(const node of copy){if(node.children)node.children=node.children.map(i=>i+count);if(node.skin!==undefined)node.skin=1;}
    copy[0].translation=[1.5,0,0];json.nodes.push(...copy);json.scenes[0].nodes.push(count);
    json.skins.push({...json.skins[0],joints:json.skins[0].joints.map(i=>i+count),skeleton:json.skins[0].skeleton+count});
  });
  const original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);assert.equal(avatar.rigged,false);
  avatar.update(.1,{moving:true,groundHeightAt:()=>.2});assertSameShape(avatar.group,original.group);assertSourceData(avatar.group,original.group);avatar.dispose();
});

test('approximate mode is explicit and Original restores original objects, vertices, materials, morphs and pose',async()=>{
  const buffer=rewriteGlb(humanoidGlb({skin:false,details:true,nested:true,morph:true}).buffer,json=>{
    const parent=json.nodes.find(node=>node.name==='BodyMesh');parent.children=[json.nodes.length];json.nodes.push({name:'NestedAccessory',mesh:0,translation:[0,1.35,0],scale:[.1,.1,.1]});
  }),referenceModel=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  const originals=meshes(avatar.group),geometry=originals.map(m=>m.geometry),material=originals.map(m=>m.material);
  let originalDisposals=0;geometry.forEach(g=>g.addEventListener('dispose',()=>originalDisposals++));
  avatar.setMotionConfig({mode:'procedural'});assert.equal(avatar.autoRigged,false);avatar.update(.1,{moving:true});assertSameShape(avatar.group,referenceModel.group);
  for(let trial=0;trial<2;trial++) {
    avatar.setMotionConfig({mode:'approximate'});assert.equal(avatar.autoRigged,true);assert.ok(meshes(avatar.group).every(m=>m.isSkinnedMesh));
    for(let i=0;i<30;i++)avatar.update(1/60,{moving:true,speed:1.6,grounded:true,groundHeight:0,groundHeightAt:()=>-.15});
    assert.equal(originalDisposals,0,'Undo source geometries must stay alive');
    avatar.setMotionConfig({mode:'original'});assert.equal(avatar.autoRigged,false);
    const restored=meshes(avatar.group);assert.deepEqual(restored,originals);
    restored.forEach((m,i)=>{assert.equal(m.geometry,geometry[i]);assert.equal(m.material,material[i]);assert.equal(m.geometry.attributes.skinWeight,undefined);assert.deepEqual(m.morphTargetInfluences,[.35]);});
    avatar.update(.1,{moving:true,grounded:true,groundHeightAt:()=>.2});assertSameShape(avatar.group,referenceModel.group);assertSourceData(avatar.group,referenceModel.group);
  }
  avatar.dispose();assert.equal(originalDisposals,geometry.length);
});

test('unclassified authored clips keep working without human remapping or terrain IK',async()=>{
  const clips=[{name:'ArmatureAction',tracks:[{bone:'leftUpperLeg',path:'rotation',times:[0,1],values:[rotation(),rotation(.6)]},{bone:'hips',path:'translation',times:[0,1],values:[[0,.91,0],[.1,1.04,.2]]}]}];
  const buffer=humanoidGlb({naming:'numbered',extraSkin:true,clips}).buffer,original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  const mixer=new THREE.AnimationMixer(original.gltf.scene);mixer.clipAction(original.gltf.animations[0]).play();
  for(let i=0;i<10;i++){mixer.update(.016);avatar.update(.016,{moving:true,speed:1.6,grounded:true,groundHeightAt:()=>.2});}
  assert.equal(avatar.getMotionStatus().source,'authored');assert.equal(avatar.getMotionStatus().footCorrections,0);assert.equal(avatar.getMotionStatus().bodyOffset,0);
  assertSameShape(avatar.group,original.group);assertSourceData(avatar.group,original.group);avatar.dispose();
});

test('Original mode stops authored animation and restores the glTF rest pose',async()=>{
  const clips=[{name:'Idle',tracks:[{bone:'leftUpperArm',path:'rotation',times:[0,1],values:[rotation(),rotation(.9)]},{bone:'mesh',path:'weights',times:[0,1],values:[.35,1]}]}];
  const buffer=humanoidGlb({clips,extraSkin:true,morph:true}).buffer,original=await reference(buffer),avatar=await loadCharacterModel(THREE,buffer);
  for(let i=0;i<15;i++)avatar.update(1/60,{grounded:true,groundHeightAt:()=>.2});
  assert.equal(avatar.getMotionStatus().source,'authored');assert.equal(avatar.getMotionStatus().footCorrections,0);
  assert.ok(meshes(avatar.group)[0].morphTargetInfluences[0]>.45);
  avatar.setMotionConfig({mode:'original'});avatar.update(.1,{moving:true,jumping:true,grounded:false});
  assertSameShape(avatar.group,original.group);assertSourceData(avatar.group,original.group);assert.deepEqual(meshes(avatar.group)[0].morphTargetInfluences,[.35]);avatar.dispose();
});
