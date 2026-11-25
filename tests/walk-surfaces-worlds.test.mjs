// node tests/walk-surfaces-worlds.test.mjs — real renderer fixtures, no GPU/network.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createInterior} from '../dist/interiors.js';
import {buildRealWorldFromData} from '../dist/realworld.js';

const originalDocument=globalThis.document;
globalThis.document={createElement:()=>({width:1,height:1,getContext(){return new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),measureText:text=>({width:String(text).length*10}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(target,key)=>key in target?target[key]:()=>{}});}})};
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<2e-5,`${message}: ${actual} != ${expected}`);
const worlds=[];
function renderedHeight(world,x,z){world.group.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(world.group,true);assert.ok(hits.length,`no rendered surface at ${x},${z}`);return hits[0].point.y;}
function matchesRendering(world,x,z,expected,kind){const result=world.sampleGround(x,z);near(result.height,expected,`${kind} support`);assert.equal(result.kind,kind);near(result.height,renderedHeight(world,x,z),`${kind} rendered height`);}
try{
  const room=createInterior(THREE,'home');worlds.push(room);
  near(room.sampleGround(0,7).height,0,'interior floor');
  near(room.sampleGround(4.3,-5.2).height,.0275,'bed is not walkable; only its underlying rug');
  assert.equal(room.sampleGround(4.3,-5.2).kind,'rug');
  near(room.sampleGround(4.3,-5.2,{maxHeight:.01}).height,0,'room floor beneath a rug');
  assert.equal(room.sampleGround(9,0),null,'outside room is void');

  const latitude=35,longitude=139,radius=100,earth=6378137,cos=Math.cos(latitude*Math.PI/180);
  const geo=(x,z)=>({lat:latitude-z/earth*180/Math.PI,lon:longitude+x/(earth*cos)*180/Math.PI});
  const way=(id,points,tags)=>({type:'way',id,tags,geometry:points.map(([x,z])=>geo(x,z))});
  const data={elements:[
    way(1,[[-30,0],[30,0]],{highway:'residential',width:'6',name:'Fixture Street',surface:'paving_stones'}),
    way(2,[[0,10],[0,20]],{highway:'steps',width:'2'}),
    way(3,[[30,30],[40,30],[40,40],[30,40],[30,30]],{building:'yes',height:'12','building:colour':'#a76b4f','building:material':'brick','roof:shape':'gabled','roof:height':'3','roof:direction':'N','roof:colour':'#42505c','roof:material':'slate'}),
    way(4,[[-20,-30],[20,-30],[20,-10],[-20,-10],[-20,-30]],{leisure:'park'}),
    way(5,[[-50,30],[-40,30],[-40,40],[-50,40],[-50,30]],{building:'yes',height:'10','roof:shape':'skillion','roof:height':'2','roof:direction':'N'}),
    way(6,[[-50,-50],[-40,-50],[-40,-40],[-50,-40],[-50,-50]],{building:'yes',height:'9','roof:shape':'pyramidal','roof:height':'2'}),
    way(7,[[30,-40],[40,-40],[40,-30],[30,-30],[30,-40]],{building:'yes',height:'11','roof:shape':'gabled','building:colour':'not a valid colour'})
  ]};
  const terrain={heightAt:(x,z)=>5+.02*x+.04*z+.0007*x*x,sourceInfo:{provider:'fixture-elevation'}};
  const real=buildRealWorldFromData(THREE,data,{latitude,longitude,radius,terrain});worlds.push(real);
  for(const [x,z,kind] of [[22.23,22.71,'terrain'],[1.1,0,'road'],[1.1,3.6,'sidewalk'],[0,12,'steps']]){
    const sample=real.sampleGround(x,z);assert.equal(sample.kind,kind);near(sample.height,renderedHeight(real,x,z),`${kind} fixture matches triangles`);assert.ok(sample.normal.y>0);
  }
  assert.ok(Math.abs(real.sampleGround(22.23,22.71).height-(terrain.heightAt(22.23,22.71)-.015))>1e-5,'query must interpolate rendered triangles rather than re-read curved DEM');
  assert.equal(real.sourceInfo.stairwayCount,1);assert.ok(real.sourceInfo.renderedTreadCount>1);
  assert.equal(real.mapFeatures.roads.find(r=>r.type==='steps').stairElevation,'terrain-estimate');
  near(real.sampleGround(0,12).normal.y,1,'rendered stair treads are horizontal');
  assert.equal(real.sampleGround(101,0),null,'no ground beyond downloaded coverage');
  assert.equal(real.sampleGround(35,35).kind,'terrain','building roof excluded');
  const gabled=real.buildings.find(b=>b.osmId===3),skillion=real.buildings.find(b=>b.osmId===5),pyramid=real.buildings.find(b=>b.osmId===6),unsized=real.buildings.find(b=>b.osmId===7);
  assert.equal(gabled.appearance.wallColour,'#a76b4f');assert.equal(gabled.appearance.wallMaterial,'brick');assert.equal(gabled.appearance.roofMaterial,'slate');
  near(renderedHeight(real,35,35),gabled.baseY+12,'gabled ridge respects total height including roof');
  near(renderedHeight(real,35,32),gabled.baseY+10.2,'gable has a visible roof slope');
  near(renderedHeight(real,-45,32),skillion.baseY+8.4,'skillion faces the mapped compass direction');
  near(renderedHeight(real,-45,38),skillion.baseY+9.6,'skillion upper side');
  near(renderedHeight(real,-45,-45),pyramid.baseY+9,'pyramidal peak');
  near(renderedHeight(real,-48,-45),pyramid.baseY+7.8,'pyramidal roof face');
  assert.equal(unsized.appearance.roofShapeSource,'simplified','unknown roof rise is not invented');
  assert.equal(unsized.appearance.wallColour,null,'invalid colour tags fall back safely');
  assert.equal(real.sourceInfo.mappedAppearanceCount,1);assert.equal(real.sourceInfo.mappedRoofCount,3);assert.equal(real.sourceInfo.mappedRoadSurfaceCount,1);
  const colours=new Set();real.group.traverse(o=>{if(o.material?.color)colours.add(o.material.color.getHexString());});
  assert.ok(colours.has('a76b4f'),'mapped wall colour reaches rendered material');assert.ok(colours.has('42505c'),'mapped roof colour reaches rendered material');
  const gps=real.toGeo(23.4,-45.6),local=real.toLocal(gps.latitude,gps.longitude);near(local.x,23.4,'GPS round-trip x');near(local.z,-45.6,'GPS round-trip z');

  const flat=buildRealWorldFromData(THREE,data,{latitude,longitude,radius});worlds.push(flat);
  assert.equal(flat.sourceInfo.terrain,'flat');assert.equal(flat.sourceInfo.renderedTreadCount,0);
  assert.equal(flat.mapFeatures.roads.find(r=>r.type==='steps').stairElevation,'unavailable');
  matchesRendering(flat,0,12,.049,'path');
  console.log('PASS: rendered OSM roads/stairs, interior rugs, DEM triangles, mapped roof appearances and honest missing elevations.');
}finally{
  for(const world of worlds){world.dispose();assert.equal(world.sampleGround(0,0),null,'disposed worlds release walking surfaces');}
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
}
