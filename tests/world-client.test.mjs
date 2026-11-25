// Run with: node tests/world-client.test.mjs. No network, DOM or GPU required.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRealWorld} from '../dist/realworld.js';

const original={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,location:globalThis.location,localStorage:globalThis.localStorage};
const native='https://machi-life.hisa-0128-1996.chatgpt.site',direct='https://overpass.private.coffee/api/interpreter';
const data={osm3s:{timestamp_osm_base:'2026-11-25T00:00:00Z'},elements:[]};
const storage=new Map(),worlds=[];
globalThis.location={origin:native,hostname:new URL(native).hostname};
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
const options={latitude:35.6812,longitude:139.7671,radius:150};
const json=(status=200,body=data,headers={})=>Response.json(body,{status,headers});
const build=async input=>{const world=await createRealWorld(THREE,input);worlds.push(world);return world;};
let passed=0;
async function scenario(name,fn){storage.clear();await fn();passed++;console.log('PASS: '+name);}

try{
  await scenario('map request starts before elevation; exact radius and source survive cache',async()=>{
    const calls=[];let releaseTerrain;
    fetch=async(url,init)=>{calls.push({url,init});return json(200,data,{'X-World-Provider':'dresel-asia'});};
    const terrainPromise=new Promise(resolve=>releaseTerrain=resolve);
    const pending=build({...options,terrainPromise});assert.equal(calls.length,1,'map must start while terrain is pending');
    const parsed=new URL(calls[0].url);assert.equal(parsed.origin,native);assert.equal(parsed.pathname,'/api/world');assert.equal(parsed.searchParams.get('radius'),'150');assert.equal(calls[0].init.credentials,'omit');
    releaseTerrain({heightAt:()=>0,sourceInfo:{provider:'fixture'}});const world=await pending;
    assert.equal(world.radius,150);assert.equal(world.sourceInfo.provider,'dresel-asia');assert.equal(world.sourceInfo.transport,'proxy');assert.equal(world.sourceInfo.terrain,'elevation');assert.equal(world.real,true);
    assert.equal(world.sourceInfo.traffic.mode,'simulation');assert.equal(world.sourceInfo.traffic.observed,false);
    const cached=await build(options);assert.equal(calls.length,1);assert.equal(cached.sourceInfo.cached,true);assert.equal(cached.sourceInfo.provider,'dresel-asia');
  });

  await scenario('503 proxy response or network error uses one direct transport fallback',async()=>{
    for(const mode of ['503','network']){
      storage.clear();const calls=[];fetch=async(url,init)=>{calls.push({url,init});if(calls.length===1){if(mode==='network')throw new TypeError('offline');return json(503,{error:'temporary'});}return json();};
      const world=await build(options);assert.equal(calls.length,2);assert.equal(calls[1].url,direct);assert.equal(calls[1].init.method,'POST');assert.equal(world.sourceInfo.transport,'direct');assert.equal(world.sourceInfo.provider,'private.coffee');
    }
  });

  await scenario('rate/policy/client errors never trigger another fetch',async()=>{
    for(const status of [429,406,400,403,404,413,502]){
      let calls=0;fetch=async()=>{calls++;return json(status,{error:'rejected'});};
      await assert.rejects(createRealWorld(THREE,options),error=>error.status===status);assert.equal(calls,1,`HTTP ${status} must stop`);
    }
  });

  await scenario('timeout bounds both routes and releases timer resources',async()=>{
    const timers=new Map(),calls=[];let id=0;
    globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;};globalThis.clearTimeout=key=>timers.delete(key);
    fetch=(url,{signal})=>{calls.push(url);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}));};
    try{
      const result=createRealWorld(THREE,options);const rejected=assert.rejects(result,/制限時間内/);
      assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,45000);[...timers.values()][0].fn();
      for(let i=0;i<8;i++)await Promise.resolve();assert.equal(calls.length,2);assert.equal([...timers.values()][0].ms,10000);[...timers.values()][0].fn();
      await rejected;assert.equal(calls.length,2);assert.equal(timers.size,0);
    }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;}
  });

  await scenario('user cancellation stops the outstanding request without fallback or cache',async()=>{
    const controller=new AbortController();let calls=0;
    fetch=(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));};
    const pending=createRealWorld(THREE,{...options,signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);assert.equal(storage.size,0);
    await assert.rejects(createRealWorld(THREE,{...options,signal:controller.signal}),error=>error.name==='AbortError');assert.equal(calls,1);
  });

  await scenario('malformed, incomplete and oversized map results are not cached or accepted',async()=>{
    for(const response of [new Response('<html>oops</html>'),json(200,{remark:'timeout',elements:[]}),json(200,{error:'missing elements'}),json(200,data,{'Content-Length':String(25*1024*1024)})]){
      let calls=0;fetch=async()=>{calls++;return response;};await assert.rejects(createRealWorld(THREE,options));assert.equal(calls,1);assert.equal(storage.size,0);
    }
  });

  await scenario('invalid coordinates never send a request',async()=>{
    fetch=()=>{throw new Error('invalid coordinates reached network');};
    for(const point of [{latitude:86,longitude:139},{latitude:35,longitude:181},{latitude:NaN,longitude:139},{latitude:35,longitude:Infinity}])await assert.rejects(createRealWorld(THREE,point),/緯度・経度/);
  });
  console.log(`PASS: ${passed} world client scenarios.`);
}finally{for(const world of worlds)world.dispose();Object.assign(globalThis,original);}
