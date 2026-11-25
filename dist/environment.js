/** Local-time daylight, a continuous sky, and bounded image-based lighting. */
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const DAY={top:[.095,.23,.47],horizon:[.58,.69,.76],ground:[.16,.18,.16]};
const NIGHT={top:[.003,.007,.018],horizon:[.025,.04,.075],ground:[.009,.012,.019]};
export function daylightAt(minutes=720){
  const hour=((Number.isFinite(minutes)?minutes:720)/60%24+24)%24,angle=(hour-6)/12*Math.PI;
  const elevation=Math.sin(angle),day=clamp((elevation+.08)/.38),twilight=clamp(1-Math.abs(elevation)/.34);
  const length=Math.hypot(Math.cos(angle),elevation,.28);
  return {hour,day,night:1-day,twilight,direction:{x:Math.cos(angle)/length,y:elevation/length,z:.28/length},
    top:mix(NIGHT.top,DAY.top,day),horizon:mix(mix(NIGHT.horizon,DAY.horizon,day),[.73,.34,.15],twilight*day*.5),
    ground:mix(NIGHT.ground,DAY.ground,day),sunColor:mix([1,.48,.22],[1,.94,.81],clamp(elevation/.6)),
    sunIntensity:elevation>0?3.4*clamp(elevation/.32):.10,exposure:.98+(1-day)*.18};
}
const VERTEX=`varying vec3 vDirection;
void main(){vDirection=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}`;
const FRAGMENT=`varying vec3 vDirection;
uniform vec3 zenith,horizon,groundColor,sunDirection,sunColor;
uniform float daylight,cloudTime;
uniform sampler2D clouds;
void main(){
  vec3 d=normalize(vDirection);float height=max(0.0,d.y);
  vec3 color=mix(horizon,zenith,pow(height,.48));
  if(d.y<0.0)color=mix(horizon,groundColor,smoothstep(0.0,.32,-d.y));
  float sun=max(0.0,dot(d,sunDirection));
  color+=sunColor*pow(sun,42.0)*.18*daylight;
  color+=sunColor*smoothstep(.99972,.99992,sun)*5.0*daylight;
  vec2 uv=d.xz/max(.12,d.y)*.075+vec2(cloudTime*.0007,cloudTime*.0002);
  float a=texture2D(clouds,uv).r,b=texture2D(clouds,uv*2.1+.19).g;
  float cloud=smoothstep(.48,.72,a*.78+b*.22)*smoothstep(.03,.22,height);
  color=mix(color,mix(vec3(.04,.055,.08),vec3(.82,.85,.87),daylight),cloud*.62);
  gl_FragColor=vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createEnvironment(THREE,{scene,renderer,sun,hemi,fillLight,quality='high',pmremFactory=r=>new THREE.PMREMGenerator(r)}={}){
  let disposed=false,tier=quality,clock=0,lastPhase='',pmrem=null;const environments=new Map();
  const cloudSize=128,cloudBytes=new Uint8Array(cloudSize*cloudSize*4);
  const hash=(x,y,n)=>{let k=(x*374761393+y*668265263+n*1442695041)|0;k=(k^(k>>>13))*1274126177;return ((k^(k>>>16))>>>0)/4294967295;};
  function noise(x,y,n){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),h=(a,b)=>hash(((a%n)+n)%n,((b%n)+n)%n,n);return (h(ix,iy)*(1-sx)+h(ix+1,iy)*sx)*(1-sy)+(h(ix,iy+1)*(1-sx)+h(ix+1,iy+1)*sx)*sy;}
  for(let y=0;y<cloudSize;y++)for(let x=0;x<cloudSize;x++){const i=(y*cloudSize+x)*4;let v=0,w=0;for(let s=4,a=1;s<=32;s*=2,a*=.48){v+=noise(x/cloudSize*s,y/cloudSize*s,s)*a;w+=a;}cloudBytes[i]=cloudBytes[i+1]=cloudBytes[i+2]=Math.round(v/w*255);cloudBytes[i+3]=255;}
  const cloudMap=new THREE.DataTexture(cloudBytes,cloudSize,cloudSize,THREE.RGBAFormat);cloudMap.wrapS=cloudMap.wrapT=THREE.RepeatWrapping;cloudMap.magFilter=cloudMap.minFilter=THREE.LinearFilter;cloudMap.needsUpdate=true;
  const uniforms={zenith:{value:new THREE.Color()},horizon:{value:new THREE.Color()},groundColor:{value:new THREE.Color()},sunDirection:{value:new THREE.Vector3()},sunColor:{value:new THREE.Color()},daylight:{value:1},cloudTime:{value:0},clouds:{value:cloudMap}};
  const skyMaterial=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,uniforms,side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false});
  const skyGeometry=new THREE.SphereGeometry(1,40,20),sky=new THREE.Mesh(skyGeometry,skyMaterial);sky.name='空と大気';sky.scale.setScalar(700);sky.frustumCulled=false;sky.renderOrder=-1000;scene.add(sky);
  const background=new THREE.Color(),color=(target,array)=>target.setRGB(...array);
  function environmentFor(phase){
    if(environments.has(phase))return environments.get(phase).texture;
    // Three prefiltered maps are shared for the entire session, not regenerated
    // by every frame, camera movement, world chunk or imported material.
    const minutes={day:720,dusk:380,night:60}[phase],state=daylightAt(minutes),width=128,height=64,values=new Float32Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const latitude=(.5-y/(height-1))*Math.PI,up=Math.sin(latitude),shade=up>=0?mix(state.horizon,state.top,Math.pow(up,.48)):mix(state.horizon,state.ground,clamp(-up*3));
      const longitude=(x/(width-1)-.5)*Math.PI*2,dir={x:Math.cos(latitude)*Math.cos(longitude),y:up,z:Math.cos(latitude)*Math.sin(longitude)},dot=Math.max(0,dir.x*state.direction.x+dir.y*state.direction.y+dir.z*state.direction.z),halo=Math.pow(dot,32)*state.day*.9;
      const i=(y*width+x)*4;for(let c=0;c<3;c++)values[i+c]=shade[c]+state.sunColor[c]*halo;values[i+3]=1;
    }
    const map=new THREE.DataTexture(values,width,height,THREE.RGBAFormat,THREE.FloatType);map.mapping=THREE.EquirectangularReflectionMapping;map.colorSpace=THREE.LinearSRGBColorSpace;map.needsUpdate=true;
    try{pmrem??=pmremFactory(renderer);const target=pmrem.fromEquirectangular(map);environments.set(phase,target);return target.texture;}
    catch{environments.set(phase,{texture:null,dispose(){}});return null;}
    finally{map.dispose();}
  }
  function update({minutes=720,position={x:0,y:0,z:0},cameraPosition=position,indoor=false,radius=250,dt=0}={}){
    if(disposed)return;const state=daylightAt(minutes);clock+=clamp(Number.isFinite(dt)?dt:0,0,.1);
    color(uniforms.zenith.value,state.top);color(uniforms.horizon.value,state.horizon);color(uniforms.groundColor.value,state.ground);color(uniforms.sunColor.value,state.sunColor);
    uniforms.sunDirection.value.set(state.direction.x,state.direction.y,state.direction.z);uniforms.daylight.value=state.day;uniforms.cloudTime.value=clock;
    sky.position.set(finite(cameraPosition?.x),finite(cameraPosition?.y),finite(cameraPosition?.z));sky.visible=!indoor;
    color(background,state.horizon);scene.background=background;
    if(scene.fog){scene.fog.color.copy(background);scene.fog.density=indoor?.004:clamp(.00165*250/Math.max(100,finite(radius,250)),.001,.004);}
    const phase=state.day>.72?'day':state.day>.12?'dusk':'night';
    if(phase!==lastPhase){scene.environment=environmentFor(phase);lastPhase=phase;}
    scene.environmentIntensity=indoor?.38:.36+state.day*.42;
    const x=finite(position?.x),y=finite(position?.y),z=finite(position?.z),moon=state.direction.y<0?-1:1;
    sun.position.set(x+state.direction.x*90*moon,y+Math.max(.28,Math.abs(state.direction.y))*90,z+state.direction.z*90*moon);
    sun.target.position.set(x,y+1.1,z);color(sun.color,state.direction.y>=0?state.sunColor:[.50,.65,1]);sun.intensity=indoor?.7:state.sunIntensity;
    hemi.intensity=indoor?1.05:.28+state.day*.58;hemi.color.set(state.day>.2?'#bbd5ef':'#667b9b');hemi.groundColor.set('#80786d');
    fillLight.intensity=indoor?.20:.08+state.day*.13;fillLight.position.set(x-18,y+12,z-28);
    renderer.toneMappingExposure=indoor?1.05:state.exposure;
    return state;
  }
  function setQuality(value){if(disposed)return;tier=value;const reach=value==='low'?24:value==='medium'?32:value==='cinematic'?60:44;if(sun.shadow){Object.assign(sun.shadow.camera,{left:-reach,right:reach,top:reach,bottom:-reach,near:.5,far:220});sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.018;sun.shadow.bias=-.00015;}}
  function dispose(){if(disposed)return;disposed=true;if([...environments.values()].some(e=>e.texture===scene.environment))scene.environment=null;for(const target of environments.values())target.dispose();environments.clear();pmrem?.dispose();cloudMap.dispose();skyGeometry.dispose();skyMaterial.dispose();sky.removeFromParent();}
  setQuality(tier);
  return {update,setQuality,dispose,sky,get cachedEnvironmentCount(){return environments.size;}};
}
