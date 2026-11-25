import test from 'node:test';
import assert from 'node:assert/strict';
import {headingFromYaw,nearestStreet,getNavigationState,rebaseLocation} from '../dist/navigation.js';
const radius=6378137,rad=Math.PI/180;
function world(latitude,longitude){const cos=Math.cos(latitude*rad),wrap=v=>((v+180)%360+360)%360-180;return {real:true,bounds:{minX:-150,maxX:150,minZ:-150,maxZ:150},toGeo:(x,z)=>({latitude:latitude-z/radius/rad,longitude:wrap(longitude+x/radius/cos/rad)}),toLocal:(lat,lon)=>({x:wrap(lon-longitude)*rad*radius*cos,z:-(lat-latitude)*rad*radius})};}
test('heading uses north-up world coordinates and wraps rotations',()=>{
  assert.deepEqual(headingFromYaw(0),{degrees:0,label:'北'});assert.equal(headingFromYaw(-Math.PI/2).label,'東');assert.equal(headingFromYaw(Math.PI).label,'南');assert.equal(headingFromYaw(9*Math.PI/2).label,'西');
});
test('nearest street follows actual mapped line segments and ignores unnamed distant roads',()=>{
  const roads=[{id:'a',name:'中央通り',points:[{x:0,z:0},{x:0,z:100}]},{id:'b',name:'海岸通り',points:[{x:30,z:0},{x:30,z:100}]}];
  assert.equal(nearestStreet(roads,2,60).name,'中央通り');assert.equal(nearestStreet(roads,28,60).name,'海岸通り');assert.equal(nearestStreet(roads,200,60),null);
});
test('stream rebase preserves the position reached while a map request is pending',()=>{
  const before=world(35.6812,139.7671),request=before.toGeo(100,0),after=world(request.latitude,request.longitude),current={x:136,z:-21};
  const p=rebaseLocation(before,after,current),g1=before.toGeo(current.x,current.z),g2=after.toGeo(p.x,p.z);
  assert.ok(Math.abs(p.x-36)<1e-6);assert.ok(Math.abs(g1.latitude-g2.latitude)<1e-10);assert.ok(Math.abs(g1.longitude-g2.longitude)<1e-10);
  assert.equal(rebaseLocation(before,after,{x:-140,z:0}),null,'a late tile must not teleport the player into its bounds');
});
test('stream rebase wraps longitude across the date line',()=>{
  const before=world(0,179.9995),g=before.toGeo(100,0),after=world(g.latitude,g.longitude),p=rebaseLocation(before,after,{x:110,z:2});
  assert.ok(g.longitude<0);assert.ok(Math.abs(p.x-10)<1e-6);
});
test('GPS readout describes virtual coordinates and actual movement speed',()=>{
  const w=world(35,139),state=getNavigationState(w,{x:10,z:-20,yaw:-Math.PI/2,speed:2.7});
  assert.ok(state.coordinates.latitude>35);assert.ok(state.coordinates.longitude>139);assert.equal(state.heading.label,'東');assert.equal(state.speedKmh,9.72);
  assert.equal(getNavigationState({real:false}).coordinates,null);
});
