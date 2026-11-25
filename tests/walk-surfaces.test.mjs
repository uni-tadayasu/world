// node tests/walk-surfaces.test.mjs — numerical walking support without a DOM/GPU.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkSurfaceIndex} from '../dist/walk-surfaces.js';

const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message}: ${actual} != ${expected}`);
const index=createWalkSurfaceIndex({cellSize:4});
index.addRect({x:0,z:0,width:4,depth:4,height:.1},{kind:'floor',id:'lower'});
index.addRect({x:0,z:0,width:2,depth:2,height:1.2},{kind:'landing',id:'upper'});
near(index.sampleGround(0,0).height,1.2,'default returns the actual higher obstacle');
assert.equal(index.sampleGround(0,0).id,'upper');
near(index.sampleGround(0,0,{maxHeight:.6}).height,.1,'explicit height limit selects lower layer');
assert.equal(index.sampleGround(0,0,{minHeight:2}),null);
assert.equal(index.sampleGround(0,0,{minHeight:1,maxHeight:.5}),null);
assert.equal(index.sampleGround(3,3),null,'no floor outside registered surfaces');
assert.equal(index.sampleGround(NaN,0),null);
const normal=index.sampleGround(0,0).normal;normal.y=0;
assert.equal(index.sampleGround(0,0).normal.y,1,'callers cannot mutate stored normals');

const translated=new THREE.PlaneGeometry(8,6,2,2);translated.rotateX(-Math.PI/2);
const positions=translated.attributes.position;
for(let i=0;i<positions.count;i++)positions.setY(i,positions.getX(i)*.2+positions.getZ(i)*.4);
const matrix=new THREE.Matrix4().makeTranslation(-23,7,41);
index.addGeometry(translated,{kind:'terrain',id:'translated'},matrix);
const point=index.sampleGround(-22,42);
near(point.height,7.6,'translated rendered terrain height');
near(point.normal.y,1/Math.hypot(.2,1,.4),'triangle normal matches slope');
near(point.normal.x,-.2/Math.hypot(.2,1,.4),'normal x');
near(point.normal.z,-.4/Math.hypot(.2,1,.4),'normal z');
assert.equal(index.sampleGround(-16,41),null,'translated terrain does not create an infinite floor');
translated.dispose();

index.addRect({x:8,z:8,width:2,depth:2,height:3,yaw:Math.PI/4},{kind:'ramp'});
near(index.sampleGround(8,8).height,3,'grid-cell boundary query');
assert.equal(index.addTriangle({x:0,y:0,z:0},{x:0,y:4,z:0},{x:0,y:0,z:3}),false,'vertical risers are not floor');

const city=createWalkSurfaceIndex({cellSize:8});
for(let i=0;i<1000;i++)city.addRect({x:(i%40)*20,z:Math.floor(i/40)*20,width:12,depth:4,height:0},{kind:'road'});
assert.equal(city.stats().triangles,2000);
near(city.sampleGround(400,200).height,0,'road query');
assert.ok(city.stats().lastCandidates<20,`spatial hash examined ${city.stats().lastCandidates} of 2000 triangles`);
city.dispose();assert.equal(city.sampleGround(400,200),null);
index.dispose();assert.equal(index.stats().cells,0);assert.equal(index.sampleGround(0,0),null);

const bounded=createWalkSurfaceIndex({bounds:{minX:-1,maxX:1,minZ:-1,maxZ:1}});
bounded.addRect({x:0,z:0,width:100,depth:100,height:4});
assert.equal(bounded.sampleGround(2,0),null,'coverage limits do not create an invisible floor');
near(bounded.sampleGround(1,0).height,4,'coverage edge remains supported');
console.log('PASS: exact triangles, translated terrain, bounded layers/voids, normals and spatial indexing.');
