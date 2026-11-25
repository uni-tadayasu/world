import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialAudio,soundDistance,sourceAudibility,stereoPosition,soundOccluded} from '../dist/spatial-audio.js';
import {SOUND_RECIPES,synthesizeSound,ambientRecipe,interactionRecipe} from '../dist/object-sounds.js';

class Param{
  constructor(ctx,value=0){this.ctx=ctx;this.events=[];this.value=value;}
  set value(value){assert.ok(Number.isFinite(value),'AudioParam must be finite');this._value=value;}
  get value(){return this._value;}
  cancelScheduledValues(time){assert.ok(Number.isFinite(time));}
  setTargetAtTime(value,time,smoothing){this.ctx.check('parameter');assert.ok(Number.isFinite(time)&&smoothing>0);this.events.push({value,time,smoothing,from:this.value});this.value=value;}
}
class Node{
  constructor(ctx,kind){this.ctx=ctx;this.kind=kind;this.connections=[];this.disconnections=0;ctx.nodes.push(this);}
  connect(target){this.ctx.check('connect');this.connections.push(target);return target;}
  disconnect(){this.disconnections++;this.connections=[];}
}
class Source extends Node{
  constructor(ctx){super(ctx,'source');this.playbackRate=new Param(ctx,1);this.started=false;this.ended=false;this.loop=false;this.stopAt=Infinity;ctx.sources.push(this);}
  start(when,offset){this.ctx.check('start');assert.ok(Number.isFinite(when)&&Number.isFinite(offset));assert.ok(offset>=0&&offset<this.buffer.duration);this.started=true;this.offset=offset;this.startedAt=this.ctx.currentTime;}
  stop(at=this.ctx.currentTime){this.stopAt=at;if(at<=this.ctx.currentTime)this.end();}
  end(){if(this.ended)return;this.ended=true;this.onended?.();}
}
class Context{
  constructor({stereo=false}={}){
    this.state='suspended';this.currentTime=0;this.nodes=[];this.sources=[];this.buffers=[];this.events=new Set();this.resumeCalls=0;this.suspendCalls=0;this.closeCalls=0;this.pending=[];this.destination={};this.listener={};
    for(const key of ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'])this.listener[key]=new Param(this);
    if(stereo)this.createPanner=undefined;
  }
  check(stage){if(this.fail===stage){this.fail=null;throw new Error(stage+' unavailable');}}
  addEventListener(type,fn){assert.equal(type,'statechange');this.events.add(fn);}
  removeEventListener(type,fn){this.events.delete(fn);}
  setState(state){this.state=state;for(const fn of this.events)fn();}
  resume(){this.resumeCalls++;if(this.rejectResume){this.rejectResume=false;return Promise.reject(new Error('gesture required'));}if(this.deferResume)return new Promise(resolve=>this.pending.push(()=>{if(this.state!=='closed')this.setState('running');resolve();}));this.setState('running');return Promise.resolve();}
  suspend(){this.suspendCalls++;if(this.state!=='closed')this.setState('suspended');return Promise.resolve();}
  close(){this.closeCalls++;this.setState('closed');return Promise.resolve();}
  createGain(){this.check('gain');const node=new Node(this,'gain');node.gain=new Param(this,1);return node;}
  createDynamicsCompressor(){this.check('compressor');const node=new Node(this,'compressor');for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param(this);return node;}
  createBufferSource(){this.check('source');return new Source(this);}
  createBiquadFilter(){this.check('filter');const node=new Node(this,'filter');node.frequency=new Param(this);return node;}
  createPanner(){this.check('panner');const node=new Node(this,'panner');for(const key of ['positionX','positionY','positionZ'])node[key]=new Param(this);return node;}
  createStereoPanner(){this.check('panner');const node=new Node(this,'stereo');node.pan=new Param(this);return node;}
  createBuffer(channels,length,rate){this.check('buffer');assert.equal(channels,1);const data=new Float32Array(length),buffer={duration:length/rate,getChannelData:()=>data};this.buffers.push(buffer);return buffer;}
  advance(seconds){this.currentTime+=seconds;for(const source of this.sources)if(source.started&&(source.stopAt<=this.currentTime||!source.loop&&source.startedAt+source.buffer.duration<=this.currentTime))source.end();}
  live(){return this.sources.filter(s=>s.started&&!s.ended&&s.connections.length);}
}
const graph=source=>{const filter=source.connections[0],gain=filter.connections[0],panner=gain.connections[0];return {source,filter,gain,panner};};
const point={x:0,y:1.65,z:0},source=(id,x=2,overrides={})=>({id,kind:'vehicle',x,y:1.65,z:0,radius:60,gain:.5,...overrides});
const tick=(audio,sources=[],options={})=>audio.update(.2,{position:point,zone:'outdoor',minutes:0,getSources:()=>sources,...options});
const setup=options=>{const ctx=new Context(options),audio=createSpatialAudio({contextFactory:()=>ctx,...options});return {ctx,audio};};

test('distance attenuation, left/right and horizontal/vertical occlusion are finite and directional',()=>{
  const listener={...point,forward:{x:0,y:0,z:-1}};
  assert.equal(soundDistance({...point,x:3,y:5.65},point),5);
  const levels=[0,2,6,15,27,28].map(x=>sourceAudibility({...point,x,radius:28},point));assert.equal(levels[0],1);assert.equal(levels.at(-1),0);for(let i=1;i<levels.length;i++)assert.ok(levels[i]<=levels[i-1]);
  assert.equal(stereoPosition({...point,x:4},listener),1);assert.equal(stereoPosition({...point,x:-4},listener),-1);assert.equal(stereoPosition({...point,z:-4},listener),0);assert.equal(stereoPosition({...point,x:4},{...listener,forward:{x:0,y:0,z:1}}),-1);
  assert.equal(stereoPosition(point,{...point,forward:{x:0,y:0,z:0}}),0);assert.ok(Number.isFinite(sourceAudibility({x:NaN,radius:NaN},{})));assert.ok(Number.isFinite(stereoPosition({},{})));
  const wall={minX:4,maxX:6,minZ:-2,maxZ:2},far={...point,x:10};assert.equal(soundOccluded(far,point,[wall]),true);assert.equal(soundOccluded({...far,z:10},point,[wall]),false);assert.equal(soundOccluded(far,point,[{...wall,type:'water'}]),false);
  assert.equal(soundOccluded(far,point,[{...wall,minY:0,maxY:1}]),false);assert.equal(soundOccluded(far,point,[{...wall,minY:0,maxY:3}]),true);assert.equal(soundOccluded(far,point,[null,{}]),false);assert.equal(soundOccluded(point,point,[wall]),false);
});

test('every generated recipe is finite, deterministic, audible and bounded without media/network assets',()=>{
  for(const [kind,recipe] of Object.entries(SOUND_RECIPES)){
    const result=synthesizeSound(kind),{samples}=result;assert.equal(samples.length,Math.round(recipe.seconds*22050));assert.equal(result.loop,!!recipe.loop);assert.ok(samples.every(Number.isFinite),kind);
    let energy=0,peak=0;for(const sample of samples){energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}const rms=Math.sqrt(energy/samples.length);assert.ok(rms>.001&&rms<.25,kind+' RMS '+rms);assert.ok(peak<=.65,kind);
    assert.deepEqual(samples,synthesizeSound(kind).samples,kind+' deterministic seed');if(!recipe.loop){assert.ok(samples[0]===0);assert.ok(Math.abs(samples.at(-1))<.005,kind+' release tail');}
  }
  assert.deepEqual(synthesizeSound('unknown').samples,synthesizeSound('wood').samples);assert.deepEqual(synthesizeSound('constructor').samples,synthesizeSound('wood').samples);
  assert.equal(synthesizeSound('wood',{sampleRate:1}).sampleRate,8000);assert.equal(synthesizeSound('wood',{sampleRate:1e8}).sampleRate,48000);assert.equal(synthesizeSound('wood',{sampleRate:NaN}).sampleRate,22050);
  assert.notDeepEqual(synthesizeSound('water',{seed:7}).samples,synthesizeSound('water',{seed:8}).samples);assert.equal(ambientRecipe('vehicle'),'engine');assert.equal(interactionRecipe('lamp','switch'),'switch');assert.equal(interactionRecipe('plant','water'),'pour');
});

test('audio is lazy, modern panners have no duplicate attenuation and effects fade in from zero',async()=>{
  let factories=0;const ctx=new Context(),audio=createSpatialAudio({contextFactory:()=>{factories++;return ctx;}});
  try{
    tick(audio,[source('a')]);assert.equal(factories,0);assert.equal(audio.playAt('wood',point),false);assert.equal(await audio.start(),true);
    tick(audio,[source('a',4)]);const g=graph(ctx.live()[0]);assert.equal(g.panner.panningModel,'HRTF');assert.equal(g.panner.rolloffFactor,0);assert.equal(g.panner.positionX.value,4);assert.equal(g.source.loop,true);assert.ok(g.gain.gain.value>0);assert.equal(ctx.nodes[0].gain.value,.51);
    assert.equal(audio.playAt('metal',point),true);const shot=graph(ctx.live().at(-1));assert.equal(shot.source.loop,false);assert.equal(shot.gain.gain.events[0].from,0);assert.equal(shot.gain.gain.events[0].smoothing,.003);assert.ok(shot.gain.gain.value>0);assert.equal(audio.getState().effects,1);
  }finally{audio.dispose();}
});

test('stereo fallback follows heading and occlusion reduces gain and low-pass frequency',async()=>{
  const {ctx,audio}=setup({stereo:true});try{
    await audio.start();const item=source('car',10);tick(audio,[item]);const g=graph(ctx.live()[0]),open=g.gain.gain.value;assert.equal(g.panner.pan.value,1);assert.equal(g.filter.frequency.value,14000);
    tick(audio,[item],{forward:{x:0,y:0,z:1},colliders:[{minX:4,maxX:6,minZ:-1,maxZ:1}]});assert.equal(g.panner.pan.value,-1);assert.equal(g.filter.frequency.value,900);assert.ok(Math.abs(g.gain.gain.value/open-.24)<1e-12);
    tick(audio,[item],{forward:{x:0,y:1,z:0},position:{x:NaN,y:Infinity,z:0}});assert.equal(ctx.listener.forwardY.value,1);assert.equal(ctx.listener.upZ.value,1);assert.equal(audio.getState().spatial,false);
  }finally{audio.dispose();}
});

test('silent stopped people and quiet nearby loops do not displace audible sources',async()=>{
  const {ctx,audio}=setup({quality:'low'});try{
    await audio.start();const audible=Array.from({length:6},(_,i)=>source('loud-'+i,8+i,{kind:'water',gain:.8})),quiet=Array.from({length:12},(_,i)=>source('quiet-'+i,.1+i*.01,{gain:.00001})),people=Array.from({length:12},(_,i)=>source('person-'+i,.5,{kind:'person',speed:0}));
    tick(audio,[...quiet,...people,source('mute',.1,{gain:0}),...audible]);assert.equal(audio.getState().voices,6);assert.deepEqual(ctx.live().map(s=>graph(s).panner.positionX.value).sort((a,b)=>a-b),[8,9,10,11,12,13]);
    tick(audio,[source('walking',1,{kind:'person',speed:2.2})]);assert.equal(audio.getState().voices,1);assert.equal(graph(ctx.live().find(s=>s.stopAt===Infinity)).source.playbackRate.value,2);
  }finally{audio.dispose();}
});

test('ambient quality caps, retiring fades and one-shot caps remain bounded under rapid churn',async()=>{
  const {ctx,audio}=setup({quality:'cinematic'});try{
    await audio.start();for(const [quality,limit] of [['cinematic',26],['ultra',22],['high',18],['auto',14],['medium',10],['low',6]]){audio.setQuality(quality);tick(audio,Array.from({length:40},(_,i)=>source(quality+i,2+i*.01)));assert.equal(audio.getState().voices,limit);assert.ok(audio.getState().retiring<=4);assert.ok(ctx.live().length<=limit+4);}
    for(let i=0;i<30;i++){tick(audio,Array.from({length:10},(_,n)=>source(i+'-'+n,2+n*.01)));assert.equal(audio.getState().voices,6);assert.ok(audio.getState().retiring<=4);assert.ok(ctx.live().length<=10,'wall-clock has not advanced, fades still bounded');}
    for(let i=0;i<15;i++)assert.equal(audio.playAt('wood',point),true);assert.equal(audio.getState().effects,8);assert.ok(ctx.live().length<=18);
    ctx.advance(1);assert.equal(audio.getState().effects,0);assert.equal(audio.getState().retiring,0);assert.equal(ctx.live().length,6);
  }finally{audio.dispose();}
});

test('retired same-ID voice ending cannot remove its replacement and unexpected loop endings recover',async()=>{
  const {ctx,audio}=setup();try{
    await audio.start();tick(audio,[source('same')]);const old=ctx.live()[0];tick(audio,[source('same',2,{kind:'water'})]);const current=ctx.live().find(s=>s!==old);assert.equal(audio.getState().voices,1);assert.equal(audio.getState().retiring,1);
    ctx.advance(.2);assert.equal(audio.getState().voices,1);assert.equal(old.disconnections,1);assert.equal(current.disconnections,0);
    current.end();assert.equal(audio.getState().voices,0);tick(audio,[source('same',2,{kind:'water'})]);assert.equal(audio.getState().voices,1);assert.equal(ctx.live().length,1);
  }finally{audio.dispose();}
});

test('world changes, stop and final disposal remove every source and release the context once',async()=>{
  const {ctx,audio}=setup();await audio.start();tick(audio,[source('a')]);audio.playAt('wood',point);tick(audio,[source('b')]);assert.ok(ctx.live().length>1);
  tick(audio,[source('inside')],{zone:'inside'});assert.equal(ctx.live().length,1);assert.equal(audio.getState().effects,0);assert.equal(audio.getState().retiring,0);
  ctx.setState('suspended');assert.equal(audio.getState().state,'blocked');tick(audio,[],{zone:'another-room'});assert.equal(ctx.live().length,0);
  await audio.start();tick(audio,[source('fresh')]);audio.stop();assert.equal(ctx.live().length,0);assert.equal(audio.getState().state,'paused');assert.equal(audio.getState().active,false);assert.equal(audio.getState().registered,0);
  await audio.start();tick(audio,[source('again')]);audio.dispose();audio.dispose();assert.equal(ctx.live().length,0);assert.equal(ctx.closeCalls,1);assert.equal(ctx.events.size,0);assert.ok(ctx.nodes.every(n=>n.disconnections===1));assert.equal(await audio.unlock(),false);assert.equal(await audio.start(),false);assert.equal(audio.playAt('wood',point),false);
});

test('malformed metadata, callback errors and nonfinite controls do not break the update loop',async()=>{
  const {ctx,audio}=setup({onStatus(){throw new Error('UI unavailable');}});try{
    await audio.start();for(const getSources of [()=>({}),()=>null,()=>{throw new Error('world disposed');}])assert.doesNotThrow(()=>tick(audio,[],{getSources,colliders:{}}));
    tick(audio,[null,{},source('bad',NaN),source(0,2),source(0,3)],{position:{x:NaN,y:Infinity,z:undefined},forward:{x:0,y:0,z:0},colliders:[null,{}]});assert.equal(audio.getState().voices,1);assert.equal(graph(ctx.live()[0]).panner.positionX.value,3);
    audio.setVolume(NaN);assert.equal(audio.getState().volume,0);assert.equal(audio.playAt('wood',point),false);audio.setVolume(3);assert.equal(audio.getState().volume,1);assert.equal(audio.playAt('wood',point,{gain:NaN}),false);assert.equal(audio.playAt('wood',{x:NaN,y:Infinity,z:0}),true);
  }finally{audio.dispose();}
});

test('partial context initialization is closed and a later start can retry cleanly',async()=>{
  const failed=new Context(),working=new Context();failed.fail='compressor';let count=0;const audio=createSpatialAudio({contextFactory:()=>++count===1?failed:working});
  try{assert.equal(await audio.start(),false);assert.equal(audio.getState().state,'unavailable');assert.equal(failed.closeCalls,1);assert.equal(failed.nodes[0].disconnections,1);assert.equal(await audio.start(),true);tick(audio,[source('recovered')]);assert.equal(audio.getState().voices,1);}finally{audio.dispose();}
  assert.equal(working.closeCalls,1);
});

test('voice creation and parameter errors release partial graphs instead of crashing interactions',async()=>{
  for(const failure of ['source','gain','filter','panner','buffer','start','connect','parameter']){
    const {ctx,audio}=setup();try{await audio.start();const first=ctx.nodes.length;ctx.fail=failure;assert.equal(audio.playAt('wood',point),false,failure);assert.equal(audio.getState().effects,0);assert.equal(ctx.live().length,0);assert.ok(ctx.nodes.slice(first).every(n=>n.disconnections===1),failure+' leaked node');assert.equal(audio.playAt('wood',point),true,failure+' retry');ctx.advance(1);assert.equal(audio.getState().effects,0);}finally{audio.dispose();}
  }
});

test('resume rejection and context interruption report blocked then recover; closed contexts are replaced',async()=>{
  const first=new Context(),second=new Context();first.rejectResume=true;let count=0;const audio=createSpatialAudio({contextFactory:()=>++count===1?first:second});
  try{
    assert.equal(await audio.start(),false);assert.equal(audio.getState().state,'blocked');assert.equal(await audio.unlock(),true);tick(audio,[source('a')]);first.setState('interrupted');assert.equal(audio.getState().state,'blocked');assert.equal(audio.playAt('wood',point),false);assert.equal(await audio.unlock(),true);assert.equal(audio.getState().state,'playing');
    first.setState('closed');assert.equal(audio.getState().state,'unavailable');assert.equal(audio.getState().voices,0);assert.equal(await audio.start(),true);tick(audio,[source('b')]);assert.equal(second.live().length,1);assert.equal(first.events.size,0);
  }finally{audio.dispose();}
});

test('concurrent unlocks share resume and a pending resume cannot undo stop or disposal',async()=>{
  const {ctx,audio}=setup();ctx.deferResume=true;
  const a=audio.start(),b=audio.unlock();assert.equal(ctx.resumeCalls,1);ctx.pending.shift()();assert.deepEqual(await Promise.all([a,b]),[true,true]);
  const stopped=audio.start();audio.stop();ctx.pending.shift()();assert.equal(await stopped,false);assert.equal(audio.getState().state,'paused');assert.equal(ctx.state,'suspended');
  const disposed=audio.start();audio.dispose();ctx.pending.shift()();assert.equal(await disposed,false);assert.equal(ctx.state,'closed');assert.equal(ctx.closeCalls,1);const calls=ctx.resumeCalls;assert.equal(await audio.unlock(),false);assert.equal(ctx.resumeCalls,calls);
});

test('a synchronous resume failure is retryable and an older resume cannot suspend a newer start',async()=>{
  const {ctx,audio}=setup(),resume=ctx.resume;try{
    ctx.resume=()=>{throw new Error('context temporarily unavailable');};assert.equal(await audio.start(),false);ctx.resume=resume;assert.equal(await audio.start(),true);
    ctx.deferResume=true;const old=audio.start();audio.stop();const fresh=audio.start();ctx.pending.shift()();assert.equal(await old,false);assert.equal(audio.getState().active,true);assert.equal(ctx.state,'running');ctx.pending.shift()();assert.equal(await fresh,true);assert.equal(audio.getState().state,'playing');
  }finally{audio.dispose();}
});
