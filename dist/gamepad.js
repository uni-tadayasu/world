// Browser Gamepad API adapter. Action buttons are edge-triggered; run is held.
// Movement Y and look Y are positive toward forward/up, respectively.
const STORAGE_KEY='machi.gamepad.v1';
const DEFAULTS={
  moveXAxis:0,moveYAxis:1,lookXAxis:2,lookYAxis:3,
  invertLookY:false,deadzone:0.18,
  runButton:1,jumpButton:0,interactButton:2,mapButton:3,pauseButton:9,viewButton:8,
  gamepadIndex:-1,
};
const EDGE_ACTIONS=['jump','interact','map','pause','view'];
const AXIS_KEYS=['moveXAxis','moveYAxis','lookXAxis','lookYAxis'];
const BUTTON_KEYS=['runButton','jumpButton','interactButton','mapButton','pauseButton','viewButton'];
const neutral=()=>({moveX:0,moveY:0,lookX:0,lookY:0,run:false,jump:false,interact:false,map:false,pause:false,view:false});
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const deviceInfo=pad=>({index:pad.index,id:String(pad.id||'Gamepad'),mapping:String(pad.mapping||''),connected:pad.connected!==false});
const deviceKey=pad=>`${pad.index}:${pad.id||''}`;

function sanitizeConfig(input,base=DEFAULTS){
  const result={...base};
  if(!input||typeof input!=='object'||Array.isArray(input))return result;
  for(const key of AXIS_KEYS)if(Number.isInteger(input[key]))result[key]=clamp(input[key],0,31);
  for(const key of BUTTON_KEYS)if(Number.isInteger(input[key]))result[key]=clamp(input[key],-1,63);
  if(Number.isInteger(input.gamepadIndex))result.gamepadIndex=clamp(input.gamepadIndex,-1,15);
  if(typeof input.deadzone==='number'&&Number.isFinite(input.deadzone))result.deadzone=clamp(input.deadzone,0.05,0.5);
  if(typeof input.invertLookY==='boolean')result.invertLookY=input.invertLookY;
  return result;
}

function buttonValue(button){
  if(typeof button==='number')return clamp(finite(button),0,1);
  if(!button)return 0;
  return button.pressed?1:clamp(finite(button.value),0,1);
}

export function createGamepadManager({onConnect=()=>{},onDisconnect=()=>{},onToast=()=>{}}={}){
  let config={...DEFAULTS};
  let calibrations=Object.create(null);
  let activeKey=null;
  let activePad=null;
  let primeButtons=true;
  let previousButtons={};
  let destroyed=false;
  let apiWarning=false;
  let storageWarning=false;
  const known=new Map();
  const eventTarget=typeof window!=='undefined'?window:null;

  function notify(callback,value){try{callback(value);}catch(_){/* UI callbacks do not interrupt polling. */}}
  try{
    const raw=globalThis.localStorage?.getItem(STORAGE_KEY);
    if(raw){
      const saved=JSON.parse(raw);
      config=sanitizeConfig(saved.config||saved);
      if(saved.calibrations&&typeof saved.calibrations==='object'){
        for(const [id,centers]of Object.entries(saved.calibrations).slice(0,24)){
          if(!centers||typeof centers!=='object')continue;
          const valid=Object.create(null);
          for(const [axis,value]of Object.entries(centers))if(/^\d+$/.test(axis)&&Number(axis)<32&&Number.isFinite(value))valid[axis]=clamp(value,-0.35,0.35);
          calibrations[id]=valid;
        }
      }
    }
  }catch(_){/* Defaults remain usable when browser storage is unavailable. */}

  function persist(){
    try{
      globalThis.localStorage?.setItem(STORAGE_KEY,JSON.stringify({version:1,config,calibrations}));
      return true;
    }catch(_){
      if(!storageWarning){notify(onToast,'コントローラー設定はこのプレイ中のみ有効です。ブラウザ保存を利用できません。');storageWarning=true;}
      return false;
    }
  }
  function readPads(){
    if(destroyed||typeof navigator==='undefined'||typeof navigator.getGamepads!=='function')return [];
    try{
      return Array.from(navigator.getGamepads()||[]).filter(pad=>pad&&pad.connected!==false);
    }catch(_){
      if(!apiWarning){notify(onToast,'このブラウザではコントローラー情報を取得できません。キーボードやタッチ操作をご利用ください。');apiWarning=true;}
      return [];
    }
  }
  function reconcile(pads){
    const current=new Map(pads.map(pad=>[deviceKey(pad),deviceInfo(pad)]));
    for(const [key,info]of known)if(!current.has(key)){known.delete(key);notify(onDisconnect,{...info,connected:false});}
    for(const [key,info]of current)if(!known.has(key)){known.set(key,info);notify(onConnect,info);}
  }
  function choosePad(pads){
    if(config.gamepadIndex>=0)return pads.find(pad=>pad.index===config.gamepadIndex)||null;
    return pads.find(pad=>deviceKey(pad)===activeKey)||pads.find(pad=>pad.mapping==='standard')||pads[0]||null;
  }
  function poll(){
    const pads=readPads();
    reconcile(pads);
    const pad=choosePad(pads);
    const key=pad?deviceKey(pad):null;
    if(key!==activeKey){activeKey=key;previousButtons={};primeButtons=true;}
    activePad=pad;
    return pad;
  }
  function axisValue(pad,index){
    const raw=clamp(finite(pad.axes?.[index]),-1,1);
    const center=calibrations[String(pad.id||'Gamepad')]?.[index]||0;
    const offset=raw-center;
    return clamp(offset/(offset>=0?1-center:1+center),-1,1);
  }
  function stick(pad,xIndex,yIndex){
    const x=axisValue(pad,xIndex),y=axisValue(pad,yIndex);
    const length=Math.hypot(x,y);
    if(length<=config.deadzone)return {x:0,y:0};
    const magnitude=(Math.min(length,1)-config.deadzone)/(1-config.deadzone);
    return {x:x/length*magnitude,y:y/length*magnitude};
  }
  function update(){
    if(destroyed)return neutral();
    const pad=poll();
    if(!pad)return neutral();
    const move=stick(pad,config.moveXAxis,config.moveYAxis);
    const look=stick(pad,config.lookXAxis,config.lookYAxis);
    const result={...neutral(),moveX:move.x,moveY:-move.y,lookX:look.x,lookY:look.y*(config.invertLookY?1:-1)};
    result.run=config.runButton>=0&&buttonValue(pad.buttons?.[config.runButton])>0.5;
    for(const action of EDGE_ACTIONS){
      const index=config[`${action}Button`];
      const pressed=index>=0&&buttonValue(pad.buttons?.[index])>0.5;
      result[action]=!primeButtons&&pressed&&!previousButtons[action];
      previousButtons[action]=pressed;
    }
    primeButtons=false;
    return result;
  }
  function getDevices(){
    if(destroyed)return [];
    const pads=readPads();reconcile(pads);
    return pads.map(deviceInfo);
  }
  function getConfig(){return {...config};}
  function setConfig(partial){
    config=sanitizeConfig(partial,config);
    previousButtons={};primeButtons=true;
    persist();
    return getConfig();
  }
  function resetConfig(){
    config={...DEFAULTS};calibrations=Object.create(null);
    activeKey=null;activePad=null;previousButtons={};primeButtons=true;
    persist();
    return getConfig();
  }
  function calibrate(){
    const pad=poll();
    if(!pad)return {ok:false,message:'コントローラーを接続し、いずれかのボタンを押してください。'};
    const centers=Object.create(null);
    for(const key of AXIS_KEYS){
      const index=config[key];
      if(index>=pad.axes.length)continue;
      const value=finite(pad.axes[index]);
      if(Math.abs(value)>0.35)return {ok:false,message:'スティックを中央に戻し、手を離してからもう一度調整してください。'};
      centers[index]=value;
    }
    calibrations[String(pad.id||'Gamepad')]=centers;
    primeButtons=true;previousButtons={};persist();
    return {ok:true,message:'スティックの中央位置を調整しました。'};
  }
  function getRaw(){
    if(destroyed)return null;
    const pad=poll();
    if(!pad)return null;
    return {axes:Array.from(pad.axes||[],value=>clamp(finite(value),-1,1)),buttons:Array.from(pad.buttons||[],buttonValue),id:String(pad.id||'Gamepad'),index:pad.index};
  }
  async function vibrate({duration=80,strongMagnitude=0.2,weakMagnitude=0.35}={}){
    const pad=poll();
    if(!pad)return false;
    try{
      const ms=clamp(finite(duration,80),0,1000);
      const strong=clamp(finite(strongMagnitude,0.2),0,1);
      const weak=clamp(finite(weakMagnitude,0.35),0,1);
      if(pad.vibrationActuator?.playEffect){await pad.vibrationActuator.playEffect('dual-rumble',{duration:ms,startDelay:0,strongMagnitude:strong,weakMagnitude:weak});return true;}
      if(pad.hapticActuators?.[0]?.pulse){await pad.hapticActuators[0].pulse(Math.max(strong,weak),ms);return true;}
    }catch(_){/* Unsupported actuator modes are optional. */}
    return false;
  }
  function disconnected(event){
    const pad=event?.gamepad;
    if(!pad)return;
    const key=deviceKey(pad);
    const info=known.get(key);
    if(info){known.delete(key);notify(onDisconnect,{...info,connected:false});}
    if(key===activeKey){activeKey=null;activePad=null;previousButtons={};primeButtons=true;}
  }
  function connected(){if(!destroyed)reconcile(readPads());}
  function destroy(){
    destroyed=true;activePad=null;activeKey=null;previousButtons={};known.clear();
    eventTarget?.removeEventListener('gamepadconnected',connected);
    eventTarget?.removeEventListener('gamepaddisconnected',disconnected);
  }
  eventTarget?.addEventListener('gamepadconnected',connected);
  eventTarget?.addEventListener('gamepaddisconnected',disconnected);
  return {update,getDevices,getConfig,setConfig,resetConfig,calibrate,destroy,getRaw,vibrate};
}
