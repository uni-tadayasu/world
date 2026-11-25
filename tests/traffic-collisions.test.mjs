import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createTraffic} from '../dist/traffic.js';
import {buildRealWorldFromData} from '../dist/realworld.js';
import {colliderIntersects} from '../dist/object-collisions.js';

const focus={x:0,z:0},bodyAt=(x,z,y=0)=>({x,y,z,radius:.32,height:1.75});
const near=(a,b,t=.0001)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const noContact=(traffic,body)=>{for(const collider of traffic.getCollisionObjects())assert.equal(colliderIntersects(collider,body),false,`${collider.id} entered the stationary player`);};

test('a car brakes before a stationary player at low FPS, then resumes; LODs have one collider',()=>{
  const traffic=createTraffic(THREE,{roads:[{id:'road',points:[{x:-100,z:0},{x:100,z:0}],width:8,type:'residential',oneWay:'yes'}],bounds:{minX:-120,maxX:120,minZ:-30,maxZ:30},pedestrians:false,quality:'low',seed:1});
  try{
    traffic.update(0,4,focus);for(let i=0;i<20;i++)traffic.update(.1,4,focus);
    let car=traffic.snapshot().cars[0];assert.ok(car);assert.ok(car.speed>1);
    const body=bodyAt(car.x+7,car.z);
    for(let i=0;i<120;i++){traffic.update(.25,4,focus,body);noContact(traffic,body);}
    car=traffic.snapshot().cars.find(car=>car.id==='car-0');assert.ok(car.x<body.x-2.4);assert.ok(car.speed<.01,'actual sound/motion speed reaches zero at the stop');
    const stopped=car.x;for(let i=0;i<35;i++)traffic.update(.1,4,focus,null);
    car=traffic.snapshot().cars.find(car=>car.id==='car-0');assert.ok(car.x>stopped+4,'car moves again after the player leaves');assert.ok(car.speed>1);
    traffic.setQuality('high');const colliders=traffic.getCollisionObjects(),snapshot=traffic.snapshot();assert.equal(colliders.length,snapshot.cars.length);assert.equal(new Set(colliders.map(c=>c.id)).size,colliders.length);
    assert.ok(colliders.every(c=>c.shape==='box'&&c.width===2.1&&c.depth===4.25&&c.maxY>c.minY));
    const occupied=bodyAt(snapshot.cars[0].x,snapshot.cars[0].z);traffic.update(0,4,focus,occupied);noContact(traffic,occupied);
  }finally{traffic.dispose();assert.equal(traffic.getCollisionObjects().length,0);}
});

test('a pedestrian stops its movement and animation at contact and clears reactivated spawn overlap',()=>{
  const traffic=createTraffic(THREE,{roads:[{id:'walk',points:[{x:-100,z:0},{x:100,z:0}],width:3,type:'footway'}],bounds:{minX:-120,maxX:120,minZ:-30,maxZ:30},quality:'low',seed:1});
  try{
    traffic.update(0,4,focus);const before=traffic.snapshot().people[0];assert.ok(before);traffic.update(.1,4,focus);
    let person=traffic.snapshot().people.find(p=>p.id===before.id),direction=Math.sign(person.x-before.x);assert.notEqual(direction,0);
    const body=bodyAt(person.x+direction*4,person.z);
    for(let i=0;i<100;i++){traffic.update(.3,4,focus,body);noContact(traffic,body);}
    person=traffic.snapshot().people.find(p=>p.id===before.id);assert.equal(person.speed,0);assert.ok(Math.abs(person.x-body.x)<1,'stopped near the player instead of running through');
    const stopped=person.x;for(let i=0;i<25;i++)traffic.update(.1,4,focus,null);
    person=traffic.snapshot().people.find(p=>p.id===before.id);assert.ok((person.x-stopped)*direction>1);
    const collider=traffic.getCollisionObjects().find(c=>c.id==='traffic-'+person.id);assert.equal(collider.shape,'cylinder');assert.notEqual(collider.support,false);assert.notEqual(collider.vertical,false);
    const occupied=bodyAt(person.x,person.z);traffic.update(0,4,focus,occupied);noContact(traffic,occupied);
  }finally{traffic.dispose();}
});

test('turning-car sweep catches an intermediate corner even when the endpoint is clear',()=>{
  const traffic=createTraffic(THREE,{roads:[{id:'road',points:[{x:-100,z:0},{x:100,z:0}],width:8,type:'residential',oneWay:'yes'}],bounds:{minX:-120,maxX:120,minZ:-30,maxZ:30},pedestrians:false,quality:'low',seed:1});
  try{
    traffic.update(0,4,focus);const car=traffic.snapshot().cars[0],actor=traffic.group.children[0];
    // A vehicle entering a bend can still face its previous segment. This
    // player lies in the corner's swept arc, outside its starting footprint.
    actor.rotation.y=0;const body=bodyAt(car.x+1.96,car.z+1.71);
    traffic.update(.1,4,focus,body);noContact(traffic,body);near(actor.rotation.y,0);near(actor.position.x,car.x);near(traffic.snapshot().cars[0].speed,0);
    traffic.update(.1,4,focus,{...body,y:4});assert.ok(actor.rotation.y>0,'a player above the vehicle does not create an infinite collision wall');
  }finally{traffic.dispose();}
});

test('production world registers finite building clearance, actual furniture parts, trees and collision-safe spawn',()=>{
  const latitude=35,longitude=139,earth=6378137,cos=Math.cos(latitude*Math.PI/180),geo=(x,z)=>({lat:latitude-z/earth*180/Math.PI,lon:longitude+x/(earth*cos)*180/Math.PI});
  const way=(id,points,tags)=>({type:'way',id,tags,geometry:points.map(([x,z])=>geo(x,z))}),node=(id,x,z,tags)=>({type:'node',id,...geo(x,z),tags});
  const world=buildRealWorldFromData(THREE,{elements:[
    way(1,[[-40,15],[40,15]],{highway:'residential',width:'6'}),
    way(2,[[-4,-4],[4,-4],[4,4],[-4,4],[-4,-4]],{'building:part':'yes',height:'8',min_height:'3'}),
    way(3,[[-25,-10],[-15,-10],[-15,0],[-25,0],[-25,-10]],{natural:'water'}),
    node(10,15,10,{natural:'tree',height:'6'}),node(11,12,10,{amenity:'bench',direction:'0'}),node(12,18,10,{highway:'street_lamp'})
  ]},{latitude,longitude,radius:100});
  try{
    const index=world.collisionIndex,ground=world.sampleGround(0,0).height;
    assert.equal(index.isBlocked(0,0,.32,ground,1.75),false,'player fits under mapped min_height');assert.equal(index.isBlocked(0,0,.32,2,1.75),true,'head contacts the elevated building');
    const building=world.colliders.find(c=>c.buildingId==='osm-way-2');near(building.minY,3);near(building.maxY,8);
    assert.equal(index.isBlocked(15,10,.32,-.015,1.75),true);near(index.sampleSupport(15,10,5,.35,.1).height,4.835); // Solid trunk top, not the canopy.
    assert.equal(index.isBlocked(18,10,.32,-.015,1.75),true);
    const seat=index.sampleSupport(12,10.15,.4,.35,.1);assert.ok(seat);near(seat.height,.49);assert.equal(index.isBlocked(12,10.15,.1,.5,1.75),false,'seat top is usable rather than a full bench-height box');
    assert.equal(index.isBlocked(-20,-5,.32,0,1.75),true);assert.equal(index.isBlocked(-20,-5,.32,2,1.75),false,'water does not form an infinitely tall wall');
    const y=world.sampleGround(world.spawn.x,world.spawn.z).height;assert.equal(index.isBlocked(world.spawn.x,world.spawn.z,.32,y,1.75),false);
    const player=bodyAt(world.spawn.x,world.spawn.z,y);world.update(.1,12,world.spawn,player);assert.equal(index.isBlocked(player.x,player.z,player.radius,player.y,player.height),false);
  }finally{world.dispose();}
});

test('falling onto buildings, trunks and poles stays outside; min_height stops a jump at the underside',()=>{
  const latitude=35,longitude=139,earth=6378137,cos=Math.cos(latitude*Math.PI/180),geo=(x,z)=>({lat:latitude-z/earth*180/Math.PI,lon:longitude+x/(earth*cos)*180/Math.PI});
  const way=(id,points,tags)=>({type:'way',id,tags,geometry:points.map(([x,z])=>geo(x,z))});
  const world=buildRealWorldFromData(THREE,{elements:[
    way(1,[[20,20],[30,20],[30,30],[20,30],[20,20]],{building:'yes',height:'12','roof:shape':'gabled','roof:height':'3'}),
    way(2,[[-4,-4],[4,-4],[4,4],[-4,4],[-4,-4]],{'building:part':'yes',height:'8',min_height:'3'}),
    {type:'node',id:10,...geo(50,10),tags:{natural:'tree',height:'6'}},
    {type:'node',id:11,...geo(55,10),tags:{highway:'street_lamp',height:'5.5'}}
  ]},{latitude,longitude,radius:100});
  try{
    const index=world.collisionIndex;
    const landing=index.sweepVertical({x:23,z:23,radius:.32,height:1.75,fromY:20,toY:0});
    assert.equal(landing.hit,true);assert.equal(landing.grounded,true);near(landing.y,12);
    near(index.sampleSupport(23,23,landing.y,.35,.32).height,12);
    assert.equal(index.isBlocked(23,23,.32,landing.y,1.75),false,'landing cannot leave the body stuck inside the building');
    assert.equal(index.isBlocked(0,0,.32,0,1.75),false,'mapped overhead clearance stays open');
    const ceiling=index.sweepVertical({x:0,z:0,radius:.32,height:1.75,fromY:0,toY:2});
    assert.equal(ceiling.hit,true);assert.equal(ceiling.ceiling,true);near(ceiling.y,1.25);
    assert.equal(index.isBlocked(0,0,.32,ceiling.y,1.75),false,'head stops flush against the underside');
    for(const [x,z,expected] of [[50,10,4.835],[55,10,5.485]]){
      const landed=index.sweepVertical({x,z,radius:.32,height:1.75,fromY:10,toY:0});assert.equal(landed.grounded,true);near(landed.y,expected);
      near(index.sampleSupport(x,z,landed.y,.35,.32).height,expected);
      assert.equal(index.isBlocked(x,z,.32,landed.y,1.75),false,'solid top contact never leaves the body embedded');
    }
    assert.match(world.sourceInfo.buildingContacts,/maximum height/);assert.ok(world.sourceInfo.note.includes('斜屋根に沿う精密な歩行には対応していません'));
  }finally{world.dispose();}
});
