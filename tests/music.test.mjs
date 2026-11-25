import assert from 'node:assert/strict';
import {createMusic,musicPeriod} from '../dist/music.js';
const doc=new EventTarget();doc.hidden=false;globalThis.document=doc;
const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(){
  const media=[];let failure=null,pending=null;const param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;}});
  const context={state:'suspended',currentTime:1,destination:{},createGain:()=>({gain:param(),connect(){},disconnect(){}}),createMediaElementSource:()=>({connect(){},disconnect(){}}),async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';}};
  const music=createMusic({contextFactory:()=>context,audioFactory:()=>{
    const a=new EventTarget();a.paused=true;a.play=async()=>{if(failure)throw failure;if(pending)await pending;a.paused=false;};a.pause=()=>a.paused=true;a.removeAttribute=()=>{};a.load=()=>{};media.push(a);return a;
  }});
  return {music,media,context,fail:e=>failure=e,wait:p=>pending=p};
}
for(const [minute,expected]of [[0,'night'],[299.999,'night'],[300,'morning'],[659.99,'morning'],[660,'day'],[1079.99,'day'],[1080,'night'],[1439,'night'],[1440,'night']])assert.equal(musicPeriod(minute),expected);
{
  const h=harness();await h.music.start(300);assert.equal(h.music.getState().track.source,'00001');assert.equal(h.music.getState().playing,true);h.music.update(660);await flush();assert.equal(h.music.getState().track.source,'00002');assert.equal(h.media.length,2);assert.equal(h.media[1].loop,true);h.music.update(1080);await flush();assert.equal(h.music.getState().track.source,'00003');h.music.setVolume(.7);assert.equal(h.music.getState().volume,.7);h.music.setEnabled(false);assert(h.media.every(x=>x.paused));await h.music.retry();assert.equal(h.music.getState().enabled,true);assert.equal(h.music.getState().playing,true);h.music.dispose();
}
{
  const h=harness();await h.music.start(330);h.fail(new Error('offline'));h.music.update(700);await flush();assert.equal(h.music.getState().playing,false);assert(h.media.every(x=>x.paused),'previous period must stop on new-track error');assert.match(h.music.getState().error,/読み込めません/);h.fail(null);await h.music.retry();assert.equal(h.music.getState().playing,true);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert(h.media.every(x=>x.paused));doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(h.music.getState().playing,true);h.music.dispose();
}
{
  const h=harness(),error=new Error('gesture required');error.name='NotAllowedError';h.fail(error);await h.music.start(800);assert.equal(h.music.getState().blocked,true);assert.equal(h.music.getState().playing,false);h.fail(null);await h.music.retry();assert.equal(h.music.getState().blocked,false);assert.equal(h.music.getState().playing,true);h.media[0].dispatchEvent(new Event('error'));assert.equal(h.music.getState().playing,false);assert(h.media[0].paused);h.music.dispose();
}
{
  const h=harness();await h.music.start(700);let resolve;h.wait(new Promise(r=>resolve=r));const pending=h.music.retry();await flush();h.music.stop();resolve();await pending;assert(h.media.every(x=>x.paused),'a late play promise must not restart stopped music');assert.equal(h.music.getState().active,false);h.music.dispose();
}
console.log('PASS: BGM period boundaries, crossfade selection, persistence, mute/retry, network error, autoplay, background pause, late play cancellation.');
