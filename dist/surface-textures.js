/** Metre-sized, seamless procedural surfaces. No photographic or imported assets. */
export const SURFACE_METERS=Object.freeze(Object.fromEntries(Object.entries({
  asphalt:[4,4],concrete:[2,2],plaster:[1.5,1.5],brick:[1.04,.52],tile:[1.2,1.6],paving:[2.4,2.4],
  stone:[2,2],grass:[4,4],wood:[.72,2.4],bark:[1,2],fabric:[.32,.32],leaf:[.24,.11],foliage:[1.5,1.5],
  metal:[1,1],paint:[1,1],glass:[1,1],water:[4,4],
}).map(([key,[x,y]])=>[key,Object.freeze({x,y})])));
export function surfaceMeters(typeOrMaterial){return SURFACE_METERS[typeof typeOrMaterial==='string'?typeOrMaterial:typeOrMaterial?.userData?.surfaceType]||SURFACE_METERS.plaster;}
export function surfaceSeed(value){let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const fract=v=>v-Math.floor(v);
const blend=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function hash(x,y,seed){let n=Math.imul(x^seed,374761393)^Math.imul(y+seed,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(u,v,nx,ny,seed){
  const x=u*nx,y=v*ny,ix=Math.floor(x),iy=Math.floor(y),tx=fract(x),ty=fract(y),sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);
  const ax=((ix%nx)+nx)%nx,ay=((iy%ny)+ny)%ny,bx=(ax+1)%nx,by=(ay+1)%ny;
  return blend(blend(hash(ax,ay,seed),hash(bx,ay,seed),sx),blend(hash(ax,by,seed),hash(bx,by,seed),sx),sy);
}

/** RGBA arrays retain physical height gradients across texture quality levels. */
export function generateSurfaceData(type='plaster',size=256){
  const n=Math.max(32,Math.min(1024,Math.round(size))),meters=surfaceMeters(type),seed=surfaceSeed(type);
  const albedo=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),roughness=new Uint8Array(n*n*4),height=new Float32Array(n*n);
  if(type==='foliage')paintFoliage(n,albedo,roughness,height,seed);
  else for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const u=x/n,v=y/n,grain=hash(x,y,seed),macro=noise(u,v,3,3,seed+11),medium=noise(u,v,17,17,seed+17);
    let h=0,light=.96,rough=.95,r=1,g=1,b=1;
    if(type==='asphalt'){
      const repair=smooth(.55,.68,noise(u,v,2,2,seed+51)*.75+noise(u,v,6,6,seed+52)*.25);
      const aggregate=smooth(.64,.89,grain),dust=smooth(.52,.8,macro),crack=1-smooth(.005,.018,Math.abs(noise(u,v,6,6,seed+9)-.5));
      light=(.86+aggregate*.13+medium*.035)*(1-repair*.18)*(1-crack*.16);
      h=(grain-.5)*(.0015*256/n)+aggregate*.0008+repair*.0012-crack*.0015;
      rough=.94-repair*.18+aggregate*.045; r=1;g=1-dust*.015;b=1-dust*.055;
    }else if(type==='concrete'){
      const pore=grain>.985?(grain-.985)/.015:0,stain=smooth(.58,.82,macro),sand=noise(u,v,55,55,seed+7);
      light=.93+medium*.045-stain*.075-pore*.14;h=(sand-.5)*.00055-pore*.0017;
      rough=.86+medium*.1+pore*.04;r=1;g=.99;b=.965+macro*.02;
    }else if(type==='plaster'){
      const streak=noise(u,v,11,2,seed+49),chalk=noise(u,v,37,37,seed+35);
      light=.95+chalk*.035-smooth(.62,.85,streak)*.055;h=(grain-.5)*.00022*256/n+(chalk-.5)*.00015;
      rough=.88+medium*.105;r=1;g=.995;b=.985;
    }else if(type==='brick'||type==='paving'||type==='tile'){
      const rows=type==='brick'?8:4,cols=4,row=Math.floor(v*rows),offset=type==='brick'?(row%2)*.5:0;
      const xx=fract(u*cols+offset),yy=fract(v*rows),column=Math.floor(u*cols+offset)%cols;
      const block=hash(column,row,seed+7),edge=Math.min(Math.min(xx,1-xx)*meters.x/cols,Math.min(yy,1-yy)*meters.y/rows);
      if(type==='tile'){
        const joint=1-smooth(.0015,.005,edge),overlap=1-smooth(.015,.09,yy);
        h=Math.sin(xx*Math.PI)*.007+(1-yy)*.0025-joint*.004-overlap*.0015;
        light=(.85+block*.13+medium*.035)*(1-joint*.22-overlap*.09);rough=.64+block*.14+medium*.08;r=1;g=.965+block*.025;b=.92+block*.045;
      }else{
        const mortar=1-smooth(type==='brick'?.002:.0025,type==='brick'?.005:.007,edge);
        const porous=grain>.93?(grain-.93)/.07:0;
        light=blend(.83+block*.155+medium*.025-porous*.045,type==='brick'?.67:.62,mortar);
        h=blend((grain-.5)*.0005*256/n+(medium-.5)*.0007,type==='brick'?-.005:-.008,mortar);
        rough=blend(.82+block*.11+medium*.055,.985,mortar);
        r=1;g=type==='brick'?.95+block*.04:.99;b=type==='brick'?.89+block*.07:.95+block*.035;
      }
    }else if(type==='wood'||type==='bark'){
      const warp=Math.sin(v*Math.PI*2)*.18+Math.sin(v*Math.PI*6)*.055;
      const long=noise(u,v,27,3,seed+9),ring=Math.sin((u*21+warp)*Math.PI*2),fine=Math.sin((u*83+warp*.8)*Math.PI*2);
      const groove=smooth(.55,.92,long),knot=Math.sin(Math.hypot((u-.42)*8,(v-.53)*2.5)*26)*Math.exp(-Math.hypot((u-.42)*8,(v-.53)*2.5)*3);
      if(type==='bark'){h=ring*.0025+long*.006-groove*.004;light=.78+long*.18+ring*.045;rough=.93+medium*.065;r=1;g=.96;b=.87;}
      else{h=ring*.00013+fine*.00005+knot*.00012;light=.86+ring*.055+long*.07+knot*.045;rough=.56+long*.18;r=1;g=.975;b=.91+macro*.035;}
    }else if(type==='grass'){
      const tufts=noise(u,v,31,31,seed+54),dry=smooth(.47,.8,macro),soil=smooth(.65,.89,noise(u,v,7,7,seed+42));
      const cellX=Math.floor(u*40),cellY=Math.floor(v*40),bend=hash(cellX,cellY,seed+5),a=(bend-.5)*2.7,xx=fract(u*40)-.5,yy=fract(v*40)-.5;
      const bx=xx*Math.cos(a)-yy*Math.sin(a),by=xx*Math.sin(a)+yy*Math.cos(a),blade=(1-smooth(.025,.09,Math.abs(bx-by*by*.4)))*(1-smooth(.32,.5,Math.abs(by)));
      r=blend(.73,.99,dry);g=blend(.99,.90,dry);b=blend(.53,.65,dry);
      r=blend(r,.63,soil*.7);g=blend(g,.60,soil*.7);b=blend(b,.47,soil*.7);
      light=.80+tufts*.14+blade*.08+(grain-.5)*.035;h=(tufts-.5)*.002+blade*.0018;
      rough=.91+medium*.085;
    }else if(type==='stone'){
      const mineral=noise(u,v,29,29,seed+47),vein=1-smooth(.025,.07,Math.abs(noise(u,v,7,7,seed+6)-.5));
      light=.87+mineral*.1+vein*.035+(grain>.96?.04:0);h=(medium-.5)*.001+(grain-.5)*.00045*256/n;
      rough=.77+mineral*.2;r=.97+macro*.03;g=.98;b=.95+medium*.045;
    }else if(type==='fabric'){
      const threads=Math.min(80,Math.floor(n/4)),weave=Math.sin(u*Math.PI*2*threads)*Math.sin(v*Math.PI*2*threads);
      h=weave*.00009;light=.94+weave*.035;rough=.94+medium*.05;
    }else if(type==='leaf'){
      const vein=Math.exp(-Math.abs(v-.5)*75),side=Math.pow(Math.max(0,Math.cos((u+Math.abs(v-.5)*.8)*Math.PI*18)),16);
      h=vein*.00022+side*.00007;light=.88+macro*.085+vein*.04;rough=.69+macro*.17;
      r=.88+medium*.1;g=1;b=.72+medium*.1;
    }else if(type==='metal'){
      h=(hash(x,0,seed)-.5)*.000008;light=.97+grain*.02;rough=.72+noise(u,v,80,2,seed+5)*.22;
    }else if(type==='paint'){
      h=(medium-.5)*.000025;light=.995;rough=.91+medium*.065;
    }else if(type==='glass'){light=1;rough=1;}
    else if(type==='water'){h=Math.sin(u*Math.PI*6+Math.sin(v*Math.PI*2)*.5)*.006+Math.sin(v*Math.PI*10)*.003;light=.98;rough=.87+medium*.1;}
    const i=y*n+x,p=i*4;height[i]=h;
    albedo[p]=Math.round(clamp(light*r)*255);albedo[p+1]=Math.round(clamp(light*g)*255);albedo[p+2]=Math.round(clamp(light*b)*255);albedo[p+3]=255;
    const roughByte=Math.round(clamp(rough)*255);roughness[p]=roughness[p+1]=roughness[p+2]=roughByte;roughness[p+3]=255;
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const dx=(height[y*n+(x+1)%n]-height[y*n+(x+n-1)%n])*n/(2*meters.x),dy=(height[((y+1)%n)*n+x]-height[((y+n-1)%n)*n+x])*n/(2*meters.y);
    const inv=1/Math.hypot(dx,dy,1),p=(y*n+x)*4;
    normal[p]=Math.round((-.5*dx*inv+.5)*255);normal[p+1]=Math.round((-.5*dy*inv+.5)*255);normal[p+2]=Math.round((.5*inv+.5)*255);normal[p+3]=255;
  }
  return {width:n,height:n,albedo,normal,roughness,meters};
}

function paintFoliage(n,color,rough,height,seed){
  // A branch spray, not a solid billboard: cut-out gaps survive into the crown.
  for(let i=0;i<n*n;i++){color[i*4]=174;color[i*4+1]=223;color[i*4+2]=137;rough[i*4]=rough[i*4+1]=rough[i*4+2]=220;rough[i*4+3]=255;}
  const paintLeaf=(cx,cy,length,width,angle,id)=>{
    const c=Math.cos(angle),s=Math.sin(angle),extent=length+width;
    for(let y=Math.max(0,Math.floor((cy-extent)*n));y<Math.min(n,Math.ceil((cy+extent)*n));y++)for(let x=Math.max(0,Math.floor((cx-extent)*n));x<Math.min(n,Math.ceil((cx+extent)*n));x++){
      const dx=(x+.5)/n-cx,dy=(y+.5)/n-cy,u=(dx*c+dy*s)/length,v=(-dx*s+dy*c)/width;
      const shape=u*u+v*v*(1+.25*Math.abs(u));if(shape>1)continue;
      const alpha=Math.round(clamp((1-shape)*n*.08)*255),p=(y*n+x)*4;if(alpha<color[p+3])continue;
      const vein=Math.exp(-Math.abs(v)*24),light=.76+hash(id,0,seed)*.2+vein*.06+(1-u)*.025;
      color[p]=Math.round(light*(190+hash(id,2,seed)*30));color[p+1]=Math.round(light*255);color[p+2]=Math.round(light*(140+hash(id,3,seed)*35));color[p+3]=alpha;
      rough[p]=rough[p+1]=rough[p+2]=Math.round((.73+hash(id,4,seed)*.17)*255);height[y*n+x]=vein*.0003+(1-shape)*.0004;
    }
  };
  for(let stem=0;stem<7;stem++){
    const angle=-1.25+stem*.4,endX=.5+Math.sin(angle)*(.28+hash(stem,5,seed)*.14),endY=.16+Math.cos(angle)*.69;
    for(let leaf=0;leaf<6;leaf++)for(const side of [-1,1]){
      const t=.22+leaf*.13,cx=blend(.5,endX,t)+side*Math.cos(angle)*.035,cy=blend(.1,endY,t)-side*Math.sin(angle)*.035,id=stem*12+leaf*2+(side>0?1:0);
      paintLeaf(cx,cy,.055+hash(id,7,seed)*.034,.019+hash(id,8,seed)*.014,Math.PI/2-angle+side*.65,id);
    }
  }
}
