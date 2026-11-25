// Procedural PBR and vegetation regressions; actual Three.js geometry, no GPU/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMaterialLibrary,createVegetationDetail,surfaceMeters} from '../dist/materials.js';
import {generateSurfaceData,surfaceSeed} from '../dist/surface-textures.js';
import {treeLayout,buildTreeGeometry} from '../dist/vegetation.js';

const unique=(bytes,channel=0)=>new Set(Array.from({length:bytes.length/4},(_,i)=>bytes[i*4+channel])).size;
const averageNormalSlope=bytes=>{let sum=0;for(let i=0;i<bytes.length;i+=4)sum+=Math.hypot(bytes[i]-128,bytes[i+1]-128);return sum/(bytes.length/4);};

test('surfaces have distinct physical patterns, roughness and repeatable RGB',()=>{
  const types=['asphalt','concrete','plaster','brick','paving','tile','wood','bark','grass','stone'];
  const values=new Map();
  for(const type of types){const data=generateSurfaceData(type,128);values.set(type,data);assert.equal(data.albedo.length,128*128*4);assert.deepEqual(data,generateSurfaceData(type,128),`${type} is deterministic`);assert.ok(unique(data.albedo)>8,`${type} visible pattern`);assert.ok(unique(data.roughness,1)>8,`${type} spatial roughness`);assert.ok(unique(data.normal,0)>1||unique(data.normal,1)>1,`${type} relief`);assert.notDeepEqual(data.albedo,data.roughness,`${type} roughness is not copied albedo`);}
  for(const [a,b]of [['concrete','stone'],['plaster','concrete'],['brick','tile'],['paving','brick']])assert.notDeepEqual(values.get(a).albedo,values.get(b).albedo);
  const grass=values.get('grass').albedo;assert.ok(Array.from({length:128*128},(_,i)=>grass[i*4+1]>grass[i*4+2]).filter(Boolean).length>15000,'grass is colored vegetation, not uniform grey grain');
  assert.deepEqual(surfaceMeters('brick'),{x:1.04,y:.52});assert.deepEqual(surfaceMeters('paving'),{x:2.4,y:2.4});assert.deepEqual(surfaceMeters('asphalt'),{x:4,y:4});
});

test('physical normal depth remains stable when texture resolution changes',()=>{
  const low=averageNormalSlope(generateSurfaceData('tile',128).normal),high=averageNormalSlope(generateSurfaceData('tile',512).normal);
  assert.ok(high/low>.65&&high/low<1.55,`normal slope scales with metres, not pixels: ${low}, ${high}`);
});

test('foliage atlas retains cut-out gaps and opaque leaf sprays',()=>{
  const data=generateSurfaceData('foliage',256);let clear=0,opaque=0;for(let i=3;i<data.albedo.length;i+=4){if(data.albedo[i]===0)clear++;if(data.albedo[i]>210)opaque++;}
  assert.ok(clear>256*256*.35,'leaf silhouette has negative space');assert.ok(opaque>256*256*.12,'leaves remain visible at alpha test threshold');
  const library=createMaterialLibrary(THREE,{quality:'low'}),material=library.material('foliage','#c5d5ad');
  assert.equal(material.transparent,false);assert.equal(material.side,THREE.DoubleSide);assert.ok(material.alphaTest>=.4);assert.equal(material.depthWrite,true);library.dispose();
});

test('authored maps and normal scale survive material reapplication and quality change',()=>{
  const library=createMaterialLibrary(THREE,{quality:'low',maxTextureSize:128}),map=new THREE.Texture(),normalMap=new THREE.Texture(),roughnessMap=new THREE.Texture();
  map.repeat.set(3,4);const material=new THREE.MeshStandardMaterial({map,normalMap,roughnessMap,normalScale:new THREE.Vector2(.25,.4)});
  let disposed=0;for(const t of [map,normalMap,roughnessMap])t.addEventListener('dispose',()=>disposed++);
  library.apply(material,'brick');library.apply(material,'paving');library.setQuality('cinematic');
  assert.equal(material.map,map);assert.equal(material.normalMap,normalMap);assert.equal(material.roughnessMap,roughnessMap);assert.deepEqual(material.normalScale,new THREE.Vector2(.25,.4));assert.equal(library.ownsTexture(map),false);assert.deepEqual(surfaceMeters(material),{x:2.4,y:2.4});
  library.dispose();assert.equal(disposed,0,'authored textures belong to their owner');material.dispose();
});

test('reapplying repeat settings releases old clones and does not grow bindings',()=>{
  const library=createMaterialLibrary(THREE,{quality:'low',maxTextureSize:64}),material=library.material('paving','#eeeeee');
  library.apply(material,'paving',{repeat:new THREE.Vector2(4,5)});const first=material.map;let disposed=0;first.addEventListener('dispose',()=>disposed++);
  for(let i=0;i<20;i++)library.apply(material,'paving',{repeat:new THREE.Vector2(6,7)});
  assert.equal(disposed,1);assert.equal(library.resourceStats.textureClones,3);assert.deepEqual(material.map.repeat,new THREE.Vector2(6,7));assert.equal(library.ownsTexture(material.map),true);
  material.dispose();assert.equal(library.resourceStats.textureClones,0);library.dispose();
});

test('surface packs are shared safely across libraries and last owner releases once',()=>{
  const a=createMaterialLibrary(THREE,{quality:'low',maxTextureSize:64}),b=createMaterialLibrary(THREE,{quality:'low',maxTextureSize:64}),ma=a.material('asphalt','#888888'),mb=b.material('asphalt','#777777');
  assert.equal(ma.map,mb.map);let released=0;mb.map.addEventListener('dispose',()=>released++);a.dispose();assert.equal(released,0,'leaving one room must not invalidate the outdoor pack');
  assert.equal(mb.map.image.width,64);b.dispose();assert.equal(released,1);b.dispose();assert.equal(released,1);
});

test('coarse pointer texture cap bounds cinematic surfaces and data maps keep linear channels',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:true})});
  try{const library=createMaterialLibrary(THREE,{quality:'cinematic'}),material=library.material('concrete','#dddddd');assert.equal(material.map.image.width,256);assert.equal(library.resourceStats.textureBytes,256*256*4*3);assert.equal(material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(material.normalMap.colorSpace,THREE.NoColorSpace);assert.equal(material.roughnessMap.colorSpace,THREE.NoColorSpace);library.dispose();}
  finally{if(descriptor)Object.defineProperty(globalThis,'matchMedia',descriptor);else delete globalThis.matchMedia;}
});

test('three tree silhouettes expose tapered branches, finite UVs and bounded LOD geometry',()=>{
  const bounds=[];
  for(let variant=0;variant<3;variant++){
    const hi=buildTreeGeometry(THREE,{variant,quality:'high'}),lo=buildTreeGeometry(THREE,{variant,quality:'low'});bounds.push(hi.canopy.boundingBox.getSize(new THREE.Vector3()).toArray());
    for(const geometry of Object.values(hi)){assert.ok(geometry.attributes.position.count<6000);for(const attr of Object.values(geometry.attributes))assert.ok(attr.array.every(Number.isFinite));}
    assert.ok(hi.branches.boundingBox.min.y>-.02&&hi.branches.boundingBox.min.y<=0);assert.ok(hi.canopy.boundingBox.min.y>2);assert.ok(hi.canopy.boundingBox.max.y>5&&hi.canopy.boundingBox.max.y<6.6);assert.ok(lo.canopy.attributes.position.count<hi.canopy.attributes.position.count);assert.ok(lo.branches.attributes.position.count<hi.branches.attributes.position.count);
    for(const geometry of [...Object.values(hi),...Object.values(lo)])geometry.dispose();
  }
  assert.notDeepEqual(bounds[0],bounds[1]);assert.notDeepEqual(bounds[0],bounds[2]);assert.equal(treeLayout(-1).variant,2);assert.notEqual(surfaceSeed('tree-a'),surfaceSeed('tree-b'));
  const library=createMaterialLibrary(THREE,{quality:'low'}),mesh=new THREE.Mesh(library.treeCanopy(1));const old=mesh.geometry;library.setQuality('high');library.updateGeometry(mesh);assert.notEqual(mesh.geometry,old);assert.equal(mesh.geometry.userData.qualityShape.variant,1);library.dispose();mesh.material.dispose();
});

test('near leaves follow the same rotated branch layout and remain a single bounded draw',()=>{
  const trees=[{id:'tree-a',x:0,z:0,scale:1,variant:2,rotation:0}],a=createVegetationDetail(THREE,{trees,heightAt:()=>3,quality:'high'}),b=createVegetationDetail(THREE,{trees:[{...trees[0],rotation:Math.PI/2}],heightAt:()=>3,quality:'high'});
  a.update({x:0,z:0});b.update({x:0,z:0});assert.equal(a.group.children.length,1);const ma=a.group.children[0],mb=b.group.children[0];assert.equal(ma.count,180);assert.equal(mb.count,ma.count);const am=new THREE.Matrix4(),bm=new THREE.Matrix4();
  for(let i=0;i<ma.count;i++){ma.getMatrixAt(i,am);mb.getMatrixAt(i,bm);assert.ok(Math.abs(am.elements[14]-bm.elements[12])<1e-5);assert.ok(Math.abs(am.elements[12]+bm.elements[14])<1e-5);assert.ok(Math.abs(am.elements[13]-bm.elements[13])<1e-5);assert.ok(am.elements[13]>5&&am.elements[13]<9.5);}
  const c=createVegetationDetail(THREE,{trees:Array.from({length:100},(_,i)=>({id:i,x:i%10,z:Math.floor(i/10),scale:1})),quality:'cinematic'});c.update({x:0,z:0});assert.equal(c.group.children[0].count,12000);c.setQuality('low');assert.ok(c.group.children[0].count<=384);c.update({x:1000,z:1000});assert.equal(c.group.children[0].count,0);a.dispose();b.dispose();c.dispose();
});
