export const MUSIC_TRACKS=Object.freeze({
  morning:{id:'morning',label:'朝',file:'morning-00001.mp3',source:'00001',hours:'05:00–10:59'},
  day:{id:'day',label:'昼',file:'day-00002.mp3',source:'00002',hours:'11:00–17:59'},
  night:{id:'night',label:'夜',file:'night-00003.mp3',source:'00003',hours:'18:00–04:59'},
});
export function musicPeriod(minutes){const m=((Number(minutes)||0)%1440+1440)%1440;return m>=300&&m<660?'morning':m>=660&&m<1080?'day':'night';}
export function createMusic({toast=()=>{},onChange=()=>{},audioFactory=()=>new Audio(),contextFactory=()=>new(window.AudioContext||window.webkitAudioContext)()}={}){
  const KEY='machi.music.v1',slots=new Map();let preferences={enabled:true,volume:.42};
  try{const stored=JSON.parse(localStorage.getItem(KEY)||'null');if(stored){preferences.enabled=stored.enabled!==false;if(Number.isFinite(stored.volume))preferences.volume=Math.max(0,Math.min(1,stored.volume));}}catch{}
  let context=null,master=null,current=null,desired='morning',playing=false,active=false,blocked=false,loading=false,revision=0,fadeTimer=null,lastError='',disposed=false;
  function state(){return {...preferences,period:desired,track:MUSIC_TRACKS[desired],playing,active,blocked,loading,error:lastError};}
  function emit(){onChange(state());}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch{toast('音楽の設定を端末に保存できませんでした。');}}
  function ensureContext(){if(context)return;context=contextFactory();master=context.createGain();master.gain.value=preferences.volume;master.connect(context.destination);}
  function slot(id){if(slots.has(id))return slots.get(id);ensureContext();const media=audioFactory();media.preload='none';media.loop=true;media.src=new URL('./audio/'+MUSIC_TRACKS[id].file,import.meta.url).href;const gain=context.createGain();gain.gain.value=0;const source=context.createMediaElementSource(media);source.connect(gain);gain.connect(master);const item={id,media,gain,source};media.addEventListener('error',()=>{if(desired===id&&active){halt();blocked=false;lastError='BGMを読み込めませんでした。通信を確認し、音楽の画面から再生してください。';emit();}});slots.set(id,item);return item;}
  async function unlock(){if(disposed)return false;try{ensureContext();await context.resume();return context.state==='running';}catch{return false;}}
  async function switchTo(id,{force=false}={}){
    desired=id;if(disposed||!active||!preferences.enabled||document.hidden)return;
    if(!force&&(loading||blocked||(current===id&&playing)))return;
    const own=++revision;loading=true;lastError='';emit();clearTimeout(fadeTimer);
    try{
      if(!await unlock())throw new Error('gesture');const next=slot(id);await next.media.play();
      if(own!==revision||disposed||!active||!preferences.enabled||document.hidden){if(!(current===id&&playing&&active&&preferences.enabled&&!document.hidden))next.media.pause();return;}
      current=id;playing=true;loading=false;blocked=false;const now=context.currentTime;
      for(const item of slots.values()){item.gain.gain.cancelScheduledValues(now);item.gain.gain.setValueAtTime(item.gain.gain.value,now);item.gain.gain.linearRampToValueAtTime(item.id===id?1:0,now+2.4);}
      fadeTimer=setTimeout(()=>{if(own!==revision)return;for(const item of slots.values())if(item.id!==current)item.media.pause();},2500);emit();
    }catch(error){if(own!==revision||disposed)return;halt();blocked=error.name==='NotAllowedError'||error.message==='gesture';lastError=blocked?'音楽の「再生」を押すとBGMが始まります。':'BGMを読み込めませんでした。通信を確認して再生してください。';emit();}
  }
  function halt(){revision++;clearTimeout(fadeTimer);for(const item of slots.values()){item.media.pause();if(context){item.gain.gain.cancelScheduledValues(context.currentTime);item.gain.gain.setValueAtTime(0,context.currentTime);}}playing=false;loading=false;emit();}
  function update(minutes){const id=musicPeriod(minutes);if(id!==desired){desired=id;blocked=false;if(loading){revision++;loading=false;}switchTo(id);emit();}}
  function start(minutes){active=true;desired=musicPeriod(minutes);blocked=false;return switchTo(desired,{force:true});}
  function setEnabled(value){preferences.enabled=!!value;persist();if(value){blocked=false;if(active)switchTo(desired,{force:true});}else halt();emit();}
  function setVolume(value){preferences.volume=Math.max(0,Math.min(1,Number(value)||0));if(master&&context){master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(preferences.volume,context.currentTime,.05);}persist();emit();}
  function visibility(){if(document.hidden){halt();context?.suspend().catch(()=>{});}else if(active&&preferences.enabled){blocked=false;switchTo(desired,{force:true});}}
  document.addEventListener('visibilitychange',visibility);
  return {getState:state,unlock,start,update,setEnabled,setVolume,retry(){blocked=false;active=true;preferences.enabled=true;persist();return switchTo(desired,{force:true});},stop(){active=false;halt();context?.suspend().catch(()=>{});},dispose(){disposed=true;active=false;halt();document.removeEventListener('visibilitychange',visibility);for(const item of slots.values()){item.source.disconnect();item.gain.disconnect();item.media.removeAttribute('src');item.media.load();}slots.clear();context?.close().catch(()=>{});}};
}
