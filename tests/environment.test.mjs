import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEnvironment,daylightAt} from '../dist/environment.js';

function fixture({fail=false,factoryFails=false}={}){
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2();
  const renderer={toneMappingExposure:1},sun=new THREE.DirectionalLight(),hemi=new THREE.HemisphereLight(),fillLight=new THREE.DirectionalLight();
  const calls=[],targets=[],counts={factory:0,generator:0,cloud:0,geometry:0,material:0};
  const generator={fromEquirectangular(map){const call={map,disposed:0};map.addEventListener('dispose',()=>call.disposed++);calls.push(call);if(fail)throw new Error('GPU texture unavailable');const target={texture:new THREE.Texture(),disposed:0,dispose(){this.disposed++;}};targets.push(target);return target;},dispose(){counts.generator++;}};
  const environment=createEnvironment(THREE,{scene,renderer,sun,hemi,fillLight,pmremFactory(){counts.factory++;if(factoryFails)throw new Error('PMREM unavailable');return generator;}});
  environment.sky.material.uniforms.clouds.value.addEventListener('dispose',()=>counts.cloud++);
  environment.sky.geometry.addEventListener('dispose',()=>counts.geometry++);environment.sky.material.addEventListener('dispose',()=>counts.material++);
  return {environment,scene,renderer,sun,hemi,fillLight,calls,targets,counts};
}
const finiteTree=value=>{if(typeof value==='number')assert.ok(Number.isFinite(value));else for(const child of Object.values(value))finiteTree(child);};

test('daylight wraps real-time minutes and stays finite through all day phases',()=>{
  assert.deepEqual(daylightAt(0),daylightAt(1440));assert.deepEqual(daylightAt(-720),daylightAt(720));
  assert.deepEqual(daylightAt(NaN),daylightAt(720));assert.deepEqual(daylightAt(Infinity),daylightAt(720));
  assert.equal(daylightAt(720).day,1);assert.equal(daylightAt(0).night,1);assert.ok(daylightAt(360).twilight>.99);
  assert.ok(daylightAt(720).sunIntensity>daylightAt(0).sunIntensity);
  for(let minutes=-2880;minutes<=4320;minutes+=17){const state=daylightAt(minutes);finiteTree(state);assert.ok(state.hour>=0&&state.hour<24);assert.equal(state.day+state.night,1);assert.ok(Math.abs(Math.hypot(...Object.values(state.direction))-1)<1e-12);}
});

test('environment follows camera, indoor state and lighting without invalid transforms',()=>{
  const f=fixture(),e=f.environment;
  try{
    e.update({minutes:720,position:{x:100,y:20,z:-50},cameraPosition:{x:110,y:23,z:-40},radius:500,dt:.5});
    assert.deepEqual(e.sky.position.toArray(),[110,23,-40]);assert.deepEqual(f.sun.target.position.toArray(),[100,21.1,-50]);assert.equal(e.sky.material.uniforms.cloudTime.value,.1);assert.equal(e.sky.visible,true);assert.equal(f.scene.environmentIntensity,.78);
    e.update({minutes:0,indoor:true});assert.equal(e.sky.visible,false);assert.equal(f.scene.fog.density,.004);assert.equal(f.renderer.toneMappingExposure,1.05);assert.equal(f.hemi.intensity,1.05);
    for(const value of [{position:{x:NaN,y:Infinity,z:-Infinity},cameraPosition:{x:Infinity,y:NaN,z:undefined},radius:NaN,dt:NaN},{position:null,cameraPosition:null,radius:Infinity},{position:{},radius:-1}]){
      e.update(value);for(const vector of [e.sky.position,f.sun.position,f.sun.target.position,f.fillLight.position])assert.ok(vector.toArray().every(Number.isFinite));assert.ok(Number.isFinite(f.scene.fog.density));assert.ok(f.scene.fog.density>=.001&&f.scene.fog.density<=.004);
    }
  }finally{e.dispose();}
});

test('PMREM is generated at most once for each of three phases and input textures are freed',()=>{
  const f=fixture(),e=f.environment;
  try{
    for(let day=0;day<5;day++)for(const minutes of [0,360,720,1080])e.update({minutes:minutes+day*1440});
    assert.equal(f.counts.factory,1);assert.equal(f.calls.length,3);assert.equal(e.cachedEnvironmentCount,3);
    for(const call of f.calls){assert.equal(call.disposed,1);assert.equal(call.map.image.width,128);assert.equal(call.map.image.height,64);assert.equal(call.map.mapping,THREE.EquirectangularReflectionMapping);assert.ok(call.map.image.data.every(Number.isFinite));}
    e.update({minutes:720});const dayTexture=f.scene.environment;e.update({minutes:0});e.update({minutes:720});assert.equal(f.scene.environment,dayTexture);
  }finally{e.dispose();}
  assert.equal(f.scene.environment,null);assert.ok(f.targets.every(t=>t.disposed===1));assert.equal(f.counts.generator,1);
});

test('unsupported environment generation remains a cached fallback without retrying every frame',()=>{
  for(const options of [{fail:true},{factoryFails:true}]){
    const f=fixture(options);try{for(let repeat=0;repeat<4;repeat++)for(const minutes of [0,360,720])assert.doesNotThrow(()=>f.environment.update({minutes}));assert.equal(f.scene.environment,null);assert.equal(f.environment.cachedEnvironmentCount,3);assert.equal(f.counts.factory,options.factoryFails?3:1);assert.equal(f.calls.length,options.factoryFails?0:3);assert.ok(f.calls.every(c=>c.disposed===1));}finally{f.environment.dispose();}
  }
});

test('quality adjusts shadow coverage and disposal is idempotent and final',()=>{
  const f=fixture(),e=f.environment;e.update();
  for(const [quality,reach] of [['low',24],['medium',32],['high',44],['cinematic',60]]){e.setQuality(quality);assert.equal(f.sun.shadow.camera.left,-reach);assert.equal(f.sun.shadow.camera.right,reach);assert.ok(f.sun.shadow.camera.projectionMatrix.elements.every(Number.isFinite));}
  const calls=f.calls.length;e.dispose();e.dispose();e.update({minutes:0});e.setQuality('low');
  assert.equal(f.calls.length,calls);assert.equal(f.sun.shadow.camera.right,60);assert.equal(e.cachedEnvironmentCount,0);assert.equal(e.sky.parent,null);assert.deepEqual(f.counts,{factory:1,generator:1,cloud:1,geometry:1,material:1});
});

test('disposing one environment does not clear another owner’s scene texture',()=>{
  const f=fixture();f.environment.update();const external=new THREE.Texture();f.scene.environment=external;f.environment.dispose();assert.equal(f.scene.environment,external);external.dispose();
});
