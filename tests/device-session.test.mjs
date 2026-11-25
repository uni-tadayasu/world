import assert from 'node:assert/strict';
import test from 'node:test';
import {readDeviceSession} from '../dist/device-session.js';

const connected=id=>({connected:true,identityKind:'device',signedIn:true,user:{id,name:'旅人'}});
const response=(data,status=200)=>Response.json(data,{status});
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
async function withEnvironment(run){
  const originals=new Map(['fetch','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:{}});
  try{await run();}finally{for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('concurrent screens share one connection and later calls recheck the identity',()=>withEnvironment(async()=>{
  let calls=0,release;
  fetch=async(url,options)=>{calls++;assert.equal(url,'/api/social/me');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return new Promise(resolve=>release=resolve);};
  const a=readDeviceSession(),b=readDeviceSession();assert.equal(calls,1);
  release(response(connected('device-A')));assert.equal((await a).user.id,'device-A');assert.equal((await b).user.id,'device-A');
  const changed=readDeviceSession();assert.equal(calls,2);release(response(connected('device-B')));assert.equal((await changed).user.id,'device-B');
}));

test('one closed screen does not cancel a shared session request',()=>withEnvironment(async()=>{
  let release,fetchSignal;fetch=(url,{signal})=>{fetchSignal=signal;return new Promise(resolve=>release=resolve);};
  const controller=new AbortController(),closed=readDeviceSession({signal:controller.signal}),open=readDeviceSession();
  const rejected=assert.rejects(closed,error=>error.name==='AbortError');controller.abort();await rejected;
  assert.equal(fetchSignal.aborted,false);release(response(connected('device-A')));assert.equal((await open).user.id,'device-A');
}));

test('Web Locks serialize cold starts in separate tabs before either can create a second identity',()=>withEnvironment(async()=>{
  let queue=Promise.resolve(),cookie=null,calls=0,releaseFirst;const names=[];
  navigator.locks={request(name,options,callback){names.push(name);assert.equal(options.mode,'exclusive');assert.ok(options.signal instanceof AbortSignal);const next=queue.then(callback);queue=next.catch(()=>{});return next;}};
  fetch=async()=>{const observed=cookie,number=++calls;if(number===1)await new Promise(resolve=>releaseFirst=resolve);const id=observed||`device-${number}`;cookie=id;return response(connected(id));};
  // Separate module instances model independent tab JavaScript realms, sharing
  // the browser's lock manager and cookie jar rather than a module promise.
  const tabA=await import('../dist/device-session.js?tab=a'),tabB=await import('../dist/device-session.js?tab=b');
  const first=tabA.readDeviceSession(),second=tabB.readDeviceSession();await pause();assert.equal(calls,1);
  releaseFirst();const [a,b]=await Promise.all([first,second]);assert.equal(calls,2);assert.equal(a.user.id,b.user.id);assert.equal(a.user.id,cookie);assert.deepEqual(names,['machi-device-session','machi-device-session']);
}));

test('session failures preserve status and obsolete account responses are not accepted as device ownership',()=>withEnvironment(async()=>{
  fetch=async()=>response({error:'接続を確認してください。',code:'session_required'},401);
  await assert.rejects(readDeviceSession(),error=>error.status===401&&error.code==='session_required');
  fetch=async()=>response({signedIn:true,user:{id:'legacy-account'}});
  await assert.rejects(readDeviceSession(),error=>error.code==='session_unavailable');
  fetch=async()=>response(connected('new-device'));assert.equal((await readDeviceSession()).user.id,'new-device');
}));
