/** Deterministic, original game sound effects. These are synthesized, not live recordings. */
const TAU=Math.PI*2;
export const SOUND_RECIPES={
  foliage:{seconds:4,loop:true},water:{seconds:4,loop:true},engine:{seconds:3,loop:true},
  footsteps:{seconds:1,loop:true},vent:{seconds:4,loop:true},room:{seconds:4,loop:true},cafe:{seconds:4,loop:true},
  footstone:{seconds:.2},footgrass:{seconds:.24},footwood:{seconds:.24},door:{seconds:.65},
  wood:{seconds:.38},fabric:{seconds:.42},paper:{seconds:.45},metal:{seconds:.35},switch:{seconds:.12},
  pour:{seconds:1.15},cook:{seconds:1.2},clean:{seconds:.85},bird:{seconds:.72}
};
export function ambientRecipe(kind='object'){
  if(/^(tree|plant|foliage|grass)$/.test(kind))return 'foliage';
  if(/water|fountain|stream/.test(kind))return 'water';
  if(/vehicle|car|motor/.test(kind))return 'engine';
  if(/person|pedestrian/.test(kind))return 'footsteps';
  if(/cafe|market|shop|counter/.test(kind))return 'cafe';
  if(/vent|fridge|office|industrial|air/.test(kind))return 'vent';
  return 'room';
}
export function interactionRecipe(kind='object',action=''){
  if(/water|pour|plant/.test(action)||/faucet|fountain|drinking_water/.test(kind))return 'pour';
  if(/cook|coffee|meal/.test(action)||/stove|kitchen/.test(kind))return 'cook';
  if(/clean|sweep|repair/.test(action))return 'clean';
  if(/light|switch/.test(action)||/lamp|light/.test(kind))return 'switch';
  if(/door|entrance|exit/.test(kind))return 'door';
  if(/book|paper|gallery/.test(kind))return 'paper';
  if(/bed|sofa|cushion|person|relax/.test(kind))return 'fabric';
  if(/metal|bin|fridge|vending/.test(kind))return 'metal';
  if(/plant|tree|grass/.test(kind))return 'foliage';
  return 'wood';
}
export function synthesizeSound(kind,{sampleRate=22050,seed=41}={}){
  kind=Object.hasOwn(SOUND_RECIPES,kind)?kind:'wood';
  const recipe=SOUND_RECIPES[kind],rate=Math.max(8000,Math.min(48000,Number.isFinite(sampleRate)?Math.round(sampleRate):22050));
  const count=Math.round(recipe.seconds*rate),blend=recipe.loop?Math.round(rate*.08):0,samples=new Float32Array(count+blend);
  let state=(Number(seed)||41)>>>0,low=0,slow=0,previous=0;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296*2-1;};
  const hit=(t,frequency,decay)=>t>=0&&t<.24?Math.sin(TAU*frequency*t)*Math.exp(-t*decay):0;
  for(let i=0;i<samples.length;i++){
    const t=i/rate,n=rand();low+=.075*(n-low);slow+=.006*(n-slow);const high=n-previous;previous=n;let v=0;
    if(kind==='foliage'){const gust=.42+.19*Math.sin(TAU*t*.47)+.14*Math.sin(TAU*t*.81+.6);v=(low*.68+high*.025)*gust;}
    else if(kind==='water'){const ripple=.75+.18*Math.sin(TAU*t*2.5)+.09*Math.sin(TAU*t*7.1);v=low*.4+high*.048*ripple+Math.sin(TAU*(170*t+Math.sin(t*7)*.6))*.009;}
    else if(kind==='engine'){const tremor=1+.07*Math.sin(TAU*t*14);v=(Math.sin(TAU*t*72)*.042+Math.sin(TAU*t*144)*.021+Math.sin(TAU*t*216)*.009)*tremor+low*.17;}
    else if(kind==='vent'||kind==='room'){v=slow*.5+low*.12+Math.sin(TAU*t*50)*.008+Math.sin(TAU*t*100)*.003;if(kind==='room')v*=.5;}
    else if(kind==='cafe'){const murmur=.5+.2*Math.sin(TAU*t*.65)+.15*Math.sin(TAU*t*1.1);v=low*.21*murmur+slow*.33+Math.sin(TAU*(146*t+.2*Math.sin(t*5)))*.007*murmur;}
    else if(kind==='footsteps'){const phase=t%.5;v=hit(phase,72,44)*.18+n*.12*Math.exp(-phase*60)+hit(phase-.075,125,65)*.08;}
    else if(/^foot/.test(kind)){v=hit(t,kind==='footwood'?84:66,32)*.23+n*.13*Math.exp(-t*(kind==='footgrass'?24:57))+hit(t-.07,145,70)*.07;if(kind==='footgrass')v=v*.45+low*.7*Math.exp(-t*18);}
    else if(kind==='door'){v=n*.18*Math.exp(-t*90)+Math.sin(TAU*(240*t+26*t*t))*.026*Math.sin(Math.PI*Math.min(1,t/.4))+hit(t-.42,65,35)*.3+n*.1*Math.exp(-Math.abs(t-.42)*55);}
    else if(kind==='wood'){v=hit(t,130,27)*.2+hit(t,335,45)*.08+low*.28*Math.exp(-t*16);}
    else if(kind==='metal'){v=(Math.sin(TAU*t*680)*.14+Math.sin(TAU*t*1121)*.06+Math.sin(TAU*t*1772)*.025)*Math.exp(-t*19)+n*.04*Math.exp(-t*80);}
    else if(kind==='switch'){v=n*.22*Math.exp(-t*95)+hit(t-.04,180,90)*.12;}
    else if(kind==='fabric'||kind==='clean'||kind==='paper'){const brush=Math.pow(Math.sin(Math.PI*clamp(t/recipe.seconds)),2),flutter=.6+.4*Math.sin(t*(kind==='paper'?83:22));v=(kind==='paper'?high*.085:low*.45)*brush*flutter;}
    else if(kind==='pour'){const envelope=Math.sin(Math.PI*clamp(t/recipe.seconds));v=(low*.52+n*.025+Math.sin(TAU*(95*t+9*t*t))*.024)*envelope;}
    else if(kind==='cook'){v=(high*.05+low*.11)*(Math.sin(Math.PI*clamp(t/recipe.seconds))*.7+.2)+(n>.997?.22:0);}
    else if(kind==='bird'){for(const [at,length,base] of [[.04,.12,1700],[.24,.1,2400],[.42,.15,1950]]){const q=t-at;if(q>=0&&q<length)v+=Math.sin(TAU*(base*q+2800*q*q))*Math.pow(Math.sin(Math.PI*q/length),2)*.10;}}
    if(!recipe.loop){const edge=Math.min(1,t/.004,(recipe.seconds-t)/.012);v*=Math.max(0,edge);}
    samples[i]=Math.max(-.65,Math.min(.65,Number.isFinite(v)?v:0));
  }
  if(blend)for(let i=0;i<blend;i++){const t=i/(blend-1),w=t*t*(3-2*t);samples[i]=samples[count+i]*(1-w)+samples[i]*w;}
  return {samples:samples.slice(0,count),sampleRate:rate,loop:!!recipe.loop,duration:recipe.seconds};
}
function clamp(v){return Math.max(0,Math.min(1,v));}
