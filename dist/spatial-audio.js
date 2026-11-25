import {ambientRecipe,interactionRecipe,synthesizeSound,SOUND_RECIPES} from './object-sounds.js';
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,finite(v,a)));
const LIMITS={low:6,medium:10,auto:14,high:18,ultra:22,cinematic:26};
const MAX_RETIRING=4,MAX_EFFECTS=8;
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const point=p=>({x:finite(p?.x),y:finite(p?.y),z:finite(p?.z)});
function direction(value){const p={x:finite(value?.x),y:finite(value?.y),z:finite(value?.z)},length=Math.hypot(p.x,p.y,p.z);return length>1e-7&&Number.isFinite(length)?{x:p.x/length,y:p.y/length,z:p.z/length}:{x:0,y:0,z:-1};}
export function soundDistance(source,listener){const a=point(source),b=point(listener);return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
export function sourceAudibility(source,listener){
  const radius=clamp(source?.radius??28,2,160),d=soundDistance(source,listener);if(d>=radius)return 0;
  const fade=clamp((radius-d)/(radius*.32));return fade*fade/(1+Math.max(0,d-2)*.18);
}
export function stereoPosition(source,listener){
  const a=point(source),b=point(listener),dx=a.x-b.x,dz=a.z-b.z,f=direction(listener?.forward),length=Math.hypot(f.x,f.z);
  const rightX=length>1e-7?-f.z/length:1,rightZ=length>1e-7?f.x/length:0;
  return clamp(finite((dx*rightX+dz*rightZ)/Math.max(1,Math.hypot(dx,dz))),-1,1);
}
export function soundOccluded(source,listener,colliders=[]){
  const a=point(source),b=point(listener),dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;
  if(Math.hypot(dx,dy,dz)<.01||!Array.isArray(colliders))return false;
  for(const box of colliders){
    if(!box||box.type==='water'||![box.minX,box.maxX,box.minZ,box.maxZ].every(Number.isFinite)||box.minX>box.maxX||box.minZ>box.maxZ)continue;
    if(Math.max(a.x,b.x)<box.minX||Math.min(a.x,b.x)>box.maxX||Math.max(a.z,b.z)<box.minZ||Math.min(a.z,b.z)>box.maxZ)continue;
    let enter=0,exit=1,hit=true;
    const slabs=[[b.x,dx,box.minX,box.maxX],[b.z,dz,box.minZ,box.maxZ]];
    // Existing world colliders only have horizontal bounds. Honor vertical
    // bounds when available without inventing heights for unmapped objects.
    if(Number.isFinite(box.minY)&&Number.isFinite(box.maxY)){if(box.minY>box.maxY)continue;slabs.push([b.y,dy,box.minY,box.maxY]);}
    for(const [start,d,min,max] of slabs){
      if(Math.abs(d)<1e-7){if(start<min||start>max)hit=false;continue;}
      let near=(min-start)/d,far=(max-start)/d;if(near>far)[near,far]=[far,near];enter=Math.max(enter,near);exit=Math.min(exit,far);if(enter>exit)hit=false;
    }
    if(hit&&exit>.04&&enter<.96&&exit-enter>.025)return true;
  }return false;
}
export function createSpatialAudio({contextFactory=()=>new(globalThis.AudioContext||globalThis.webkitAudioContext)(),volume=.6,quality='auto',onStatus=()=>{}}={}){
  let ctx=null,master=null,compressor=null,stateListener=null,active=false,disposed=false,level=clamp(volume),tier=Object.hasOwn(LIMITS,quality)?quality:'auto';
  let lastZone=null,lastScan=-Infinity,elapsed=0,lastBird=-100,generation=0,pendingUnlock=null;
  let listener={x:0,y:1.65,z:0,forward:{x:0,y:0,z:-1}},walls=[],sources=[],state='idle';
  const buffers=new Map(),voices=new Map(),shots=new Set(),retiring=new Set();
  const status=()=>{try{onStatus(getState());}catch{/* Status UI must not interrupt audio cleanup. */}};
  const notify=next=>{if(state!==next){state=next;status();}};
  const quiet=fn=>{try{fn()?.catch?.(()=>{});}catch{}};
  function setParam(param,value,smoothing=.06){if(!param)return;const now=Math.max(0,finite(ctx?.currentTime)),safe=finite(value);if(param.cancelScheduledValues)param.cancelScheduledValues(now);if(param.setTargetAtTime)param.setTargetAtTime(safe,now,smoothing);else param.value=safe;}
  function disconnect(voice,stop=true){
    if(!voice||voice.disposed)return;voice.disposed=true;
    if(voice.source){voice.source.onended=null;if(stop)quiet(()=>voice.source.stop());}
    for(const node of [voice.source,voice.filter,voice.gain,voice.panner])quiet(()=>node?.disconnect());
    if(voices.get(String(voice.data?.id))===voice)voices.delete(String(voice.data.id));
    shots.delete(voice);retiring.delete(voice);
  }
  function release(voice){
    if(voice.disposed||retiring.has(voice))return;
    if(voices.get(String(voice.data.id))===voice)voices.delete(String(voice.data.id));
    // Short fades may overlap new loops, but never accumulate without a cap.
    while(retiring.size>=MAX_RETIRING)disconnect(retiring.values().next().value);
    retiring.add(voice);try{setParam(voice.gain.gain,0,.025);voice.source.stop(ctx.currentTime+.12);}catch{disconnect(voice);}
  }
  function clear(){for(const voice of [...voices.values(),...shots,...retiring])disconnect(voice);voices.clear();sources=[];}
  function discardContext(){
    const old=ctx;clear();buffers.clear();
    if(old&&stateListener){if(old.removeEventListener)old.removeEventListener('statechange',stateListener);else if(old.onstatechange===stateListener)old.onstatechange=null;}
    quiet(()=>master?.disconnect());quiet(()=>compressor?.disconnect());if(old?.state!=='closed')quiet(()=>old?.close?.());
    ctx=master=compressor=stateListener=null;
  }
  function ensure(){
    if(disposed)return false;if(ctx?.state!=='closed'&&ctx)return true;if(ctx)discardContext();
    let created=null,gain=null,limiter=null;
    try{
      created=contextFactory();gain=created.createGain();gain.gain.value=level*.85;
      limiter=created.createDynamicsCompressor?.();if(limiter){limiter.threshold.value=-12;limiter.knee.value=12;limiter.ratio.value=3;limiter.attack.value=.01;limiter.release.value=.2;gain.connect(limiter);limiter.connect(created.destination);}else gain.connect(created.destination);
      ctx=created;master=gain;compressor=limiter;
      stateListener=()=>{if(disposed||ctx!==created||!active)return;if(created.state==='closed'){clear();buffers.clear();notify('unavailable');}else notify(created.state==='running'?'playing':'blocked');};
      if(created.addEventListener)created.addEventListener('statechange',stateListener);else created.onstatechange=stateListener;
      return true;
    }catch{
      if(ctx===created)discardContext();else{quiet(()=>gain?.disconnect());quiet(()=>limiter?.disconnect());quiet(()=>created?.close?.());}
      notify('unavailable');return false;
    }
  }
  async function unlock(){
    if(!ensure())return false;const context=ctx,version=generation;
    if(pendingUnlock?.context===context&&pendingUnlock.version===version)return pendingUnlock.promise;
    const operation={context,version,promise:null};pendingUnlock=operation;
    operation.promise=(async()=>{try{
      await context.resume();
      if(disposed||ctx!==context||version!==generation){if(!disposed&&ctx===context&&!active)quiet(()=>context.suspend?.());return false;}
      if(active)notify(context.state==='running'?'playing':'blocked');return context.state==='running';
    }catch{if(!disposed&&ctx===context&&version===generation)notify('blocked');return false;}
    finally{if(pendingUnlock===operation)pendingUnlock=null;}})();
    return operation.promise;
  }
  async function start(){if(disposed)return false;active=true;lastScan=-Infinity;return unlock();}
  function stop(){if(disposed)return;active=false;generation++;pendingUnlock=null;clear();quiet(()=>ctx?.suspend?.());notify('paused');}
  function bufferFor(kind){if(buffers.has(kind))return buffers.get(kind);const rendered=synthesizeSound(kind),buffer=ctx.createBuffer(1,rendered.samples.length,rendered.sampleRate);buffer.getChannelData(0).set(rendered.samples);buffers.set(kind,buffer);return buffer;}
  function makeVoice(kind,source,loop){
    const voice={source:null,gain:null,filter:null,panner:null,kind,data:source,loop,disposed:false};
    try{
      const node=voice.source=ctx.createBufferSource(),gain=voice.gain=ctx.createGain(),filter=voice.filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=14000;gain.gain.value=0;
      let panner;if(ctx.createPanner){panner=voice.panner=ctx.createPanner();panner.panningModel=tier==='low'?'equalpower':'HRTF';panner.distanceModel='inverse';panner.refDistance=2;panner.maxDistance=160;panner.rolloffFactor=0;}
      else if(ctx.createStereoPanner)panner=voice.panner=ctx.createStereoPanner();
      node.buffer=bufferFor(kind);node.loop=loop;node.connect(filter);filter.connect(gain);gain.connect(panner||master);panner?.connect(master);
      node.onended=()=>disconnect(voice,false);node.start(0,loop?(hash(source.id)%1000)/1000*node.buffer.duration:0);return voice;
    }catch{disconnect(voice);notify('unavailable');return null;}
  }
  function positionVoice(voice,source,{normalization=1,impact=1}={}){
    try{
      const blocked=soundOccluded(source,listener,walls),audibility=sourceAudibility(source,listener),p=voice.panner;
      if(p?.positionX){setParam(p.positionX,source.x);setParam(p.positionY,source.y);setParam(p.positionZ,source.z);}
      else if(p?.setPosition)p.setPosition(source.x,source.y,source.z);else if(p?.pan)setParam(p.pan,stereoPosition(source,listener));
      let speed=1;if(voice.kind==='engine')speed=.82+clamp(source.speed??0,0,18)*.045;else if(voice.kind==='footsteps')speed=clamp(finite(source.speed,1.1)/1.1,.1,2);
      setParam(voice.source.playbackRate,speed,.12);
      const moving=voice.kind!=='footsteps'||finite(source.speed,1.1)>.08;
      setParam(voice.filter.frequency,blocked?900:voice.kind==='room'||voice.kind==='vent'?3500:14000,.1);
      const volume=clamp(source.gain??1,0,2)*clamp(impact,0,2)*audibility*clamp(normalization)*(blocked?.24:1)*(moving?1:0);
      setParam(voice.gain.gain,volume,voice.loop?.08:.003);voice.data=source;return true;
    }catch{disconnect(voice);notify('unavailable');return false;}
  }
  function updateListener(){
    const a=ctx.listener,f=listener.forward,up=Math.abs(f.y)>.99?{x:0,y:0,z:1}:{x:0,y:1,z:0};
    if(a?.positionX){for(const [k,v] of Object.entries({positionX:listener.x,positionY:listener.y,positionZ:listener.z,forwardX:f.x,forwardY:f.y,forwardZ:f.z,upX:up.x,upY:up.y,upZ:up.z}))setParam(a[k],v,.025);}
    else{a?.setPosition?.(listener.x,listener.y,listener.z);a?.setOrientation?.(f.x,f.y,f.z,up.x,up.y,up.z);}
  }
  function update(dt,{position,forward={x:0,y:0,z:-1},getSources=()=>[],colliders=[],zone=null,minutes=720}={}){
    if(disposed||!active||!ctx)return;
    if(zone!==lastZone){clear();lastZone=zone;lastScan=-Infinity;}
    if(ctx.state!=='running'){notify(ctx.state==='closed'?'unavailable':'blocked');return;}
    elapsed+=clamp(dt,0,.2);listener={x:finite(position?.x),y:finite(position?.y,1.65),z:finite(position?.z),forward:direction(forward)};
    try{updateListener();}catch{notify('unavailable');return;}walls=Array.isArray(colliders)?colliders:[];
    if(elapsed-lastScan<.16)return;lastScan=elapsed;
    try{const value=getSources();sources=Array.isArray(value)?value:[];}catch{sources=[];}
    const unique=new Map();for(const item of sources){if(item?.id!=null&&String(item.id)!==''&&[item.x,item.z].every(Number.isFinite))unique.set(String(item.id),{...item,y:finite(item.y)});}
    const candidates=[...unique.values()].map(source=>{
      const kind=ambientRecipe(source.kind),gain=clamp(source.gain??1,0,2),audibility=sourceAudibility(source,listener);
      const audible=source.ambient!==false&&gain>0&&audibility>.008&&(kind!=='footsteps'||finite(source.speed,1.1)>.08);
      return {...source,recipe:kind,score:audible?gain*audibility*(soundOccluded(source,listener,walls)?.24:1)*(source.kind==='vehicle'?1.4:1):0};
    }).filter(source=>source.score>0).sort((a,b)=>b.score-a.score).slice(0,LIMITS[tier]);
    const ids=new Set(candidates.map(s=>String(s.id)));for(const [id,voice] of voices)if(!ids.has(id))release(voice);
    const normalization=1/Math.sqrt(Math.max(1,candidates.length/4));let failed=false;
    for(const source of candidates){const id=String(source.id),kind=source.recipe;let voice=voices.get(id);if(voice&&voice.kind!==kind){release(voice);voice=null;}if(!voice){voice=makeVoice(kind,source,true);if(voice)voices.set(id,voice);}if(!voice||!positionVoice(voice,source,{normalization}))failed=true;}
    for(const voice of shots)if(!positionVoice(voice,voice.data))failed=true;
    const hour=((finite(minutes,720)/60)%24+24)%24,tree=candidates.find(s=>s.kind==='tree'&&soundDistance(s,listener)<18);
    if(tree&&hour>=5&&hour<19&&elapsed-lastBird>9+(hash(tree.id)%11)){lastBird=elapsed;if(!playAt('bird',tree,{gain:.32}))failed=level>0||failed;}
    notify(failed?'unavailable':'playing');
  }
  function playAt(kind,position,{gain=1,radius=18,action=''}={}){
    if(disposed||!active||!ctx||ctx.state!=='running'||level===0)return false;
    const recipe=Object.hasOwn(SOUND_RECIPES,kind)?kind:interactionRecipe(kind,action),source={id:'effect-'+elapsed+'-'+shots.size,...point(position),radius,gain};
    if(clamp(gain,0,2)*sourceAudibility(source,listener)===0)return false;
    if(shots.size>=MAX_EFFECTS)disconnect(shots.values().next().value);
    const voice=makeVoice(recipe,source,false);if(!voice)return false;shots.add(voice);return positionVoice(voice,source);
  }
  function interact(kind,position,action=''){return playAt(interactionRecipe(kind,action),position,{action,radius:kind==='door'?22:14});}
  function step(position,surface='stone',running=false){const kind=/grass|dirt|earth/.test(surface)?'footgrass':/wood|floor|rug/.test(surface)?'footwood':'footstone';return playAt(kind,position,{gain:running?1.05:.8,radius:14});}
  function setVolume(value){if(disposed)return;level=clamp(value);try{if(master)setParam(master.gain,level*.85);}catch{notify('unavailable');}status();}
  function setQuality(value){
    if(disposed)return;tier=Object.hasOwn(LIMITS,value)?value:'auto';lastScan=-Infinity;
    const ordered=[...voices.values()].sort((a,b)=>finite(b.data.score)-finite(a.data.score));for(const voice of ordered.slice(LIMITS[tier]))release(voice);
    for(const voice of voices.values())if(voice.panner?.panningModel)quiet(()=>{voice.panner.panningModel=tier==='low'?'equalpower':'HRTF';});
  }
  function getState(){return {state,active,volume:level,spatial:!!ctx?.createPanner,voices:voices.size,effects:shots.size,retiring:retiring.size,registered:sources.length};}
  function dispose(){if(disposed)return;stop();disposed=true;generation++;discardContext();pendingUnlock=null;}
  return {start,unlock,stop,update,playAt,interact,step,setVolume,setQuality,getState,dispose};
}
