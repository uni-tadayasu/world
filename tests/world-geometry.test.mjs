// CPU verification of rendered street geometry; fixtures are never a playable town.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createPolygonCoverage,joinedStripPolygons,polygonAreaXZ} from '../dist/world-geometry.js';
import {buildRealWorldFromData} from '../dist/realworld.js';
import {createCharacterController} from '../dist/character-controller.js';

const latitude=35,longitude=139,earth=6378137,cos=Math.cos(latitude*Math.PI/180);
const geo=(x,z)=>({lat:latitude-z/earth*180/Math.PI,lon:longitude+x/(earth*cos)*180/Math.PI});
const way=(id,points,tags)=>({type:'way',id,tags,geometry:points.map(([x,z])=>geo(x,z))});
const node=(id,x,z,tags)=>({type:'node',id,...geo(x,z),tags});
const near=(actual,expected,tolerance=2e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const renderHits=(world,x,z)=>new THREE.Raycaster(new THREE.Vector3(x,80,z),new THREE.Vector3(0,-1,0)).intersectObjects(world.group.children.filter(object=>object.isMesh),true);

test('joined bends cover the previous triangular gap; crossing roads emit one surface',()=>{
  const bend=createPolygonCoverage(),bendPolygons=joinedStripPolygons([{x:0,z:0},{x:12,z:0},{x:12,z:12}],-3,3);
  for(const p of bendPolygons)bend.add(p);
  assert.equal(bend.contains({x:14,z:-2}),true,'outside bend is joined');
  assert.equal(bend.contains({x:16,z:-2}),false,'join keeps the mapped road width');
  const index=createPolygonCoverage(),emitted=[];
  for(const points of [[{x:-20,z:0},{x:20,z:0}],[{x:0,z:-20},{x:0,z:20}]]){
    const width=points[0].x===0?4:6;
    for(const polygon of joinedStripPolygons(points,-width/2,width/2)){emitted.push(...index.subtract(polygon));index.add(polygon);}
  }
  near(emitted.reduce((sum,p)=>sum+Math.abs(polygonAreaXZ(p)),0),40*6+40*4-6*4,1e-6);
  const strictContains=(polygon,p)=>polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>1e-8;});
  assert.equal(emitted.filter(p=>strictContains(p,{x:.781,z:1.317})).length,1,'junction has one owner, including different widths');
  for(let i=0;i<1000;i++)index.add([{x:i*30,z:100},{x:i*30+5,z:100},{x:i*30+5,z:105},{x:i*30,z:105}]);
  assert.equal(index.contains({x:999*30+2,z:102}),true);assert.equal(index.contains({x:999*30+8,z:102}),false);
});

test('production world has continuous streets, raised curbs, recessed facades and mapped furniture',()=>{
  const world=buildRealWorldFromData(THREE,{elements:[
    way(1,[[-50,0],[50,0]],{highway:'residential',width:'6'}),
    way(2,[[0,-50],[0,50]],{highway:'residential',width:'4'}),
    way(3,[[35,-20],[50,-20],[50,-5]],{highway:'residential',width:'4'}),
    way(10,[[20,20],[32,20],[32,32],[20,32],[20,20]],{building:'yes',height:'12','building:material':'brick'}),
    way(20,[[-55,15],[-15,15],[-15,55],[-55,55],[-55,15]],{landuse:'meadow'}),
    way(21,[[-60,-60],[-30,-60],[-30,-30],[-60,-30],[-60,-60]],{natural:'water'}),
    node(100,8,4,{amenity:'bench'}),node(101,11,4,{highway:'street_lamp',height:'6'}),
    node(102,14,4,{amenity:'waste_basket'}),node(103,17,4,{amenity:'drinking_water'}),
    node(104,26,26,{amenity:'bench'}),node(105,60,30,{natural:'tree',height:'9'}),node(106,0,0,{natural:'tree'})
  ]},{latitude,longitude,radius:100});
  try{
    world.group.updateMatrixWorld(true);
    for(const [x,z,kind] of [[.781,1.317,'road'],[1,3.7,'road'],[51,-21,'road'],[10,3.6,'sidewalk'],[20,3.07,'curb']]){
      const support=world.sampleGround(x,z);assert.equal(support.kind,kind);near(support.height,renderHits(world,x,z)[0].point.y);
    }
    const junction=renderHits(world,.781,1.317).filter(hit=>Math.abs(hit.point.y-.059)<1e-5);assert.equal(junction.length,1,'no overlapping road triangles at crossing');
    near(world.sampleGround(10,3.6).height-world.sampleGround(10,2.7).height,.121);
    const controller=createCharacterController({sampleGround:world.sampleGround});controller.reset({x:20,z:2.6});
    for(let i=0;i<90;i++)controller.step(1/60,{dz:.02});near(controller.state.z,4.4);assert.equal(controller.state.grounded,true);near(controller.state.y,.18);
    const building=world.buildings[0];near(building.baseY,0);near(building.height,12);
    const glassRay=new THREE.Raycaster(new THREE.Vector3(23.2,4.85,17),new THREE.Vector3(0,0,1));
    const glass=glassRay.intersectObject(world.group,true)[0];assert.ok(glass.point.z>20.08&&glass.point.z<20.17,'glass sits inside an actual facade aperture');assert.equal(glass.object.material.userData.surfaceType,'glass');
    const wall=new THREE.Raycaster(new THREE.Vector3(24.5,4.85,17),new THREE.Vector3(0,0,1)).intersectObject(world.group,true)[0];near(wall.point.z,20);assert.equal(wall.object.material.userData.surfaceType,'brick');
    assert.equal(world.mapFeatures.streetObjects.length,4);assert.ok(!world.mapFeatures.streetObjects.some(object=>object.osmId===104),'indoor amenity cannot become an outdoor bench');
    const bench=world.mapFeatures.streetObjects.find(object=>object.kind==='bench');near(bench.x,8);near(bench.z,4);near(bench.y,.18);
    assert.equal(world.audioSources.filter(source=>source.kind==='tree').length,1,'no generated trees on meadow or road');
    assert.ok(world.audioSources.some(source=>source.kind==='water'));assert.ok(world.audioSources.some(source=>source.kind==='building-office'));
    assert.ok(world.audioSources.some(source=>source.kind==='bench'&&source.ambient===false));
    assert.equal(new Set(world.audioSources.map(source=>source.id)).size,world.audioSources.length,'static sound IDs stay unique');
    world.update(.1,21,{x:0,z:0});const sound=world.getAudioSources();
    for(const source of sound){assert.ok([source.x,source.y,source.z,source.radius].every(Number.isFinite));assert.ok(source.id);}
    for(const vehicle of world.trafficSnapshot().cars){assert.match(vehicle.id,/^car-/);assert.ok(Number.isFinite(vehicle.speed));}
    assert.ok(world.sourceInfo.note.includes('実際の外観を撮影・測量したものではありません'));
  }finally{world.dispose();assert.deepEqual(world.getAudioSources(),[]);assert.equal(world.audioSources.length,0);}
});

test('terrain skirts close downhill building gaps and landuse follows the DEM between polygon corners',()=>{
  const heightAt=(x,z)=>10+.08*x+.05*z+3*Math.exp(-((x+35)**2+(z+35)**2)/150);
  const world=buildRealWorldFromData(THREE,{elements:[
    way(10,[[25,25],[35,25],[35,35],[25,35],[25,25]],{building:'yes',height:'12'}),
    way(20,[[-55,-55],[-15,-55],[-15,-15],[-55,-15],[-55,-55]],{landuse:'meadow'})
  ]},{latitude,longitude,radius:100,terrain:{heightAt}});
  try{
    world.group.updateMatrixWorld(true);const base=world.buildings[0].baseY;
    const hits=new THREE.Raycaster(new THREE.Vector3(27,base-.25,22),new THREE.Vector3(0,0,1)).intersectObject(world.group,true);
    assert.ok(hits.length,'foundation is visible from outside, below the level facade base');near(hits[0].point.z,25);assert.equal(hits[0].object.material.userData.surfaceType,'concrete');
    const support=world.sampleGround(-35,-35);assert.equal(support.kind,'grass');near(support.height,renderHits(world,-35,-35)[0].point.y);near(support.height,heightAt(-35,-35)+.018,1e-4);
    assert.ok(support.height>heightAt(-55,-55)+2,'large land-use polygon retains its interior terrain peak');
  }finally{world.dispose();}
});
