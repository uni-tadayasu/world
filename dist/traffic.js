/** Road-following ambient simulation. It does not observe real people, cars or live traffic. */
import {createMaterialLibrary,QUALITY_PROFILES,qualityName} from './materials.js';
export function createTraffic(THREE,{roads=[],colliders=[],terrainHeight=()=>0,bounds={minX:-450,maxX:450,minZ:-450,maxZ:450},quality='high',seed=3917,leftHandTraffic=false,pedestrians=true}={}){
  const group=new THREE.Group();group.name='道路に沿う交通シミュレーション';
  const library=createMaterialLibrary(THREE,{quality}),farLibrary=createMaterialLibrary(THREE,{quality:'low'}),interactables=[],vehicles=[],people=[],materialCache=new Map(),extraGeometries=new Set();
  let tier=qualityName(quality),state=seed>>>0,elapsed=0,lastPopulation=-1,lastHour=12,observer={x:0,z:0},disposed=false;
  const rand=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  const material=(type,color,extra={})=>{const key=type+color+JSON.stringify(extra);if(!materialCache.has(key))materialCache.set(key,library.material(type,color,extra));return materialCache.get(key);};
  const rubber=material('fabric','#252b2a',{roughness:.88,sheen:.05}),chrome=material('metal','#b1b8b1'),dark=material('metal','#35413e',{roughness:.46,metalness:.3}),glass=material('glass','#5a7479'),lampMat=material('glass','#efe8cc',{emissive:'#ffecb9',emissiveIntensity:.35}),tailMat=material('glass','#9b3430',{emissive:'#fa3227',emissiveIntensity:.35});
  const grid=new Map(),large=[];const cell=24;
  for(const collider of colliders){const x0=Math.floor(collider.minX/cell),x1=Math.floor(collider.maxX/cell),z0=Math.floor(collider.minZ/cell),z1=Math.floor(collider.maxZ/cell);if((x1-x0+1)*(z1-z0+1)>500){large.push(collider);continue;}for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(collider);}}
  function blocked(x,z,r=.35){
    if(x<bounds.minX+r||x>bounds.maxX-r||z<bounds.minZ+r||z>bounds.maxZ-r)return true;
    const nearby=new Set(large);for(let cx=Math.floor((x-r)/cell);cx<=Math.floor((x+r)/cell);cx++)for(let cz=Math.floor((z-r)/cell);cz<=Math.floor((z+r)/cell);cz++)for(const c of grid.get(cx+','+cz)||[])nearby.add(c);
    for(const c of nearby){if(x+r<c.minX||x-r>c.maxX||z+r<c.minZ||z-r>c.maxZ)continue;
      if(c.holes?.some(h=>inside(x,z,h)&&!h.some((a,i)=>segmentDistance(x,z,a,h[(i+1)%h.length])<r)))continue;
      if(!c.polygon)return true;if(inside(x,z,c.polygon)||c.polygon.some((a,i)=>segmentDistance(x,z,a,c.polygon[(i+1)%c.polygon.length])<r))return true;
    }return false;
  }
  function carClear(p){return !blocked(p.x,p.z,.97)&&!blocked(p.x+p.dx*1.65,p.z+p.dz*1.65,.92)&&!blocked(p.x-p.dx*1.65,p.z-p.dz*1.65,.92);}
  const vehicleRoutes=[],walkingRoutes=[];
  for(const road of roads){
    const points=(road.points||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));if(points.length<2)continue;
    const base=route(points);if(base.length<8)continue;const roadType=road.type||road.highway||'residential',width=Math.max(1,Number(road.width)||5.5),footOnly=['footway','path','pedestrian','steps','bridleway','cycleway'].includes(roadType);
    if(!footOnly&&width>=4.1&&!['construction','proposed'].includes(roadType)&&!road.bridge){
      const oneWay=road.oneWay==='yes'||road.oneWay==='1'||road.oneWay===true||road.oneWay==='-1';
      const directions=oneWay?[road.oneWay==='-1'?-1:1]:[1,-1];
      for(const direction of directions){const lane=oneWay?0:Math.min(2.8,width*.24)*(leftHandTraffic?1:-1)*direction;const samples=[];
        for(let d=2.4;d<base.length-2.4;d+=2){const p=sample(base,d),nx=-p.dz,nz=p.dx;samples.push({x:p.x+nx*lane,z:p.z+nz*lane});}
        if(direction<0)samples.reverse();for(const safe of safeFragments(samples,true)){if(safe.length>=20)vehicleRoutes.push(safe);}
      }
    }
    if(pedestrians&&!['motorway','motorway_link','trunk','trunk_link'].includes(roadType)&&road.foot!=='no'){
      const offsets=footOnly?[0]:[width/2+.7,-width/2-.7];
      for(const offset of offsets){const samples=[];for(let d=.5;d<base.length-.5;d+=1.25){const p=sample(base,d);samples.push({x:p.x-p.dz*offset,z:p.z+p.dx*offset});}for(const safe of safeFragments(samples,false))if(safe.length>=7)walkingRoutes.push(safe);}
    }
  }
  function safeFragments(points,car){const fragments=[];let current=[];
    for(let i=0;i<points.length;i++){const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],len=Math.hypot(b.x-a.x,b.z-a.z)||1;const pose={...p,dx:(b.x-a.x)/len,dz:(b.z-a.z)/len};
      const clear=car?carClear(pose):!blocked(p.x,p.z,.34);if(clear)current.push(p);else{if(current.length>3)fragments.push(route(current));current=[];}
    }if(current.length>3)fragments.push(route(current));return fragments;
  }
  function mesh(parent,geometry,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;m.userData.fixedLOD=Boolean(parent.userData.farLod);parent.add(m);return m;}
  function box(parent,mat,x,y,z,w,h,d,r=.04){return mesh(parent,(parent.userData.farLod?farLibrary:library).roundedBox(w,h,d,r),mat,x,y,z);}
  function ball(parent,mat,x,y,z,sx,sy=sx,sz=sx){const m=mesh(parent,(parent.userData.farLod?farLibrary:library).sphere(),mat,x,y,z);m.scale.set(sx,sy,sz);return m;}
  function cylinder(parent,mat,x,y,z,r,h){const m=mesh(parent,(parent.userData.farLod?farLibrary:library).cylinder(),mat,x,y,z);m.scale.set(r,h,r);return m;}
  function cabinGeometry(){
    const key='cabin';if(cabinGeometry.cached)return cabinGeometry.cached;
    const rings=[[-1.38,.78,.94],[-.87,.70,1.48],[.47,.69,1.5],[1.14,.79,.94]],p=[],idx=[],n=16;
    for(const [z,w,top] of rings)for(let i=0;i<=n;i++){const a=i/n*Math.PI;p.push(Math.cos(a)*w,.86+Math.sin(a)*(top-.86),z);}
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i;idx.push(a,a+1,a+n+1,a+1,a+n+2,a+n+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();extraGeometries.add(g);cabinGeometry.cached=g;return g;
  }
  const paintColors=['#e5e3d7','#4f7474','#455b69','#b0b0a2','#694d49','#202c31','#b9a375'];
  function makeCar(index){
    const actor=new THREE.Group(),near=new THREE.Group(),far=new THREE.Group();actor.add(near,far);group.add(actor);const paint=material('paint',paintColors[index%paintColors.length]),wheels=[];
    for(const [target,detailed] of [[near,true],[far,false]]){
      target.userData.farLod=!detailed;const detailLibrary=detailed?library:farLibrary;
      box(target,paint,0,.66,0,1.84,.57,4.12,.2);mesh(target,cabinGeometry(),glass);box(target,paint,0,1.47,-.16,1.38,.09,1.41,.035);
      box(target,paint,0,.97,1.38,1.67,.1,.9,.045);box(target,paint,0,.91,-1.63,1.68,.11,.67,.035);
      for(const x of [-.83,.83])for(const z of [-1.32,1.28]){const wheel=new THREE.Group();wheel.userData.farLod=!detailed;wheel.position.set(x,.36,z);target.add(wheel);const tyre=cylinder(wheel,rubber,0,0,0,.34,.19);tyre.rotation.z=Math.PI/2;const rim=cylinder(wheel,chrome,x<0?-.025:.025,0,0,.225,.202);rim.rotation.z=Math.PI/2;wheels.push(wheel);if(detailed){const hub=cylinder(wheel,dark,x<0?-.035:.035,0,0,.095,.207);hub.rotation.z=Math.PI/2;for(let k=0;k<5;k++){const spoke=box(wheel,chrome,x<0?-.11:.11,Math.cos(k*Math.PI*.4)*.135,Math.sin(k*Math.PI*.4)*.135,.018,.17,.037,.006);spoke.rotation.x=k*Math.PI*.4;}}}
      for(const x of [-.59,.59]){box(target,lampMat,x,.79,2.055,.36,.11,.06,.025);box(target,tailMat,x,.8,-2.06,.39,.12,.045,.02);}
      if(detailed){
        box(target,dark,0,.54,2.067,1.17,.2,.025,.012);for(let j=-4;j<=4;j++)box(target,chrome,j*.12,.54,2.085,.045,.15,.008,.002);
        box(target,ivoryPlate(),0,.49,-2.086,.42,.16,.018,.007);box(target,ivoryPlate(),0,.46,2.087,.42,.14,.018,.007);
        for(const side of [-1,1]){box(target,paint,side*.91,1.04,.65,.22,.15,.27,.055);box(target,glass,side*.93,1.05,.57,.17,.09,.017,.015);for(const z of [-.67,.44])box(target,chrome,side*.925,.92,z,.025,.045,.15,.012);box(target,paint,side*.725,1.18,-.2,.058,.56,.075,.014);box(target,chrome,side*.87,.96,-.05,.025,.025,2.6,.005);box(target,dark,side*.931,.67,-.05,.012,.015,2.7,.003);}
      }
    }
    library.mergeStatic(near);library.mergeStatic(far,{flatten:true});
    return {group:actor,near,far,wheels,index,route:null,distance:0,speed:0,targetSpeed:7+rand()*4,visible:false,stopped:0};
  }
  function ivoryPlate(){return material('plaster','#dedfd0');}
  function makePerson(index){
    const actor=new THREE.Group(),near=new THREE.Group(),far=new THREE.Group();actor.add(near,far);group.add(actor);
    const skin=material('plaster',['#cfa487','#c6a08a','#ad8366','#dfbba0'][index%4],{roughness:.7}),shirt=material('fabric',['#c8b89b','#62867c','#7d8d9d','#a4987d','#a57b66','#53665b'][index%6]),pants=material('fabric',['#46575a','#575f56','#354850'][index%3]),hair=material('fabric',['#38332d','#55453a','#2c3430'][index%3],{roughness:.91,sheen:.15});
    const rigs=[];
    for(const [target,detailed] of [[near,true],[far,false]]){
      target.userData.farLod=!detailed;const detailLibrary=detailed?library:farLibrary;
      const torso=mesh(target,detailLibrary.capsule(.18,.31),shirt,0,1.19,0);torso.scale.set(1.2,1, .8);const hips=mesh(target,detailLibrary.capsule(.16,.15),pants,0,.92,0);hips.scale.set(1.2,1,.8);
      cylinder(target,skin,0,1.46,0,.065,.12);ball(target,skin,0,1.63,.005,.128,.165,.125);
      const hairCap=ball(target,hair,0,1.705,-.022,.133,.105,.127);
      const arms=[],legs=[];
      for(const side of [-1,1]){
        const leg=new THREE.Group();leg.userData.farLod=!detailed;leg.position.set(side*.105,.93,0);target.add(leg);mesh(leg,detailLibrary.capsule(.071,.27),pants,0,-.2,0);const knee=new THREE.Group();knee.userData.farLod=!detailed;knee.position.y=-.405;leg.add(knee);mesh(knee,detailLibrary.capsule(.06,.29),pants,0,-.205,0);box(knee,rubber,0,-.429,.055,.135,.095,.265,.035);legs.push({upper:leg,lower:knee});
        const arm=new THREE.Group();arm.userData.farLod=!detailed;arm.position.set(side*.245,1.4,0);arm.rotation.z=side*.07;target.add(arm);mesh(arm,detailLibrary.capsule(.062,.2),shirt,0,-.14,0);const elbow=new THREE.Group();elbow.userData.farLod=!detailed;elbow.position.y=-.28;arm.add(elbow);mesh(elbow,detailLibrary.capsule(.045,.18),shirt,0,-.13,0);ball(elbow,skin,0,-.285,0,.047,.072,.035);arms.push({upper:arm,lower:elbow});
        if(detailed){for(let finger=0;finger<4;finger++){const f=mesh(elbow,detailLibrary.capsule(.008,.036),skin,(finger-1.5)*.018,-.35,.007);f.rotation.z=(finger-1.5)*.055;}ball(elbow,skin,side*.037,-.29,.025,.016,.039,.017);}
      }
      if(detailed){
        for(const side of [-1,1]){ball(target,skin,side*.127,1.64,0,.027,.041,.02);ball(target,ivoryPlate(),side*.045,1.66,.119,.026,.013,.009);ball(target,dark,side*.045,1.66,.127,.01,.01,.005);box(target,hair,side*.047,1.687,.121,.043,.009,.008,.003);}
        ball(target,skin,0,1.625,.132,.017,.027,.023);box(target,material('plaster','#9e7669'),0,1.573,.12,.045,.008,.008,.003);
        box(target,shirt,0,1.37,.145,.07,.12,.025,.007);box(target,dark,0,1.17,.153,.008,.34,.009,.002);
        if(index%3===0)box(target,material('fabric','#6a6150'),0,1.22,-.19,.29,.4,.14,.06);
        if(index%4===1){const bag=box(arms[1].lower,material('fabric','#b7ab84'),.02,-.48,.02,.23,.31,.11,.03);}
      }
      rigs.push({target,arms,legs});
    }
    library.mergeStatic(near);library.mergeStatic(far,{flatten:true});
    const talk={id:'resident-'+index,kind:'npc',title:['街の住人・あおい','街の住人・蓮','街の住人・はるか','街の住人・悠斗','街の住人・さくら','街の住人・大地'][index%6],subtitle:'街の住人に声をかける',position:new THREE.Vector3(1e9,0,1e9),radius:2.3,simulated:true};interactables.push(talk);
    return {group:actor,near,far,rigs,talk,index,route:null,distance:0,direction:index%2?1:-1,speed:.85+rand()*.5,phase:rand()*6.28,visible:false};
  }
  function assign(actor,routes,car){
    if(!routes.length){actor.route=null;return false;}
    const ranked=routes.map(r=>({r,d:Math.min(...r.points.filter((_,i)=>i%8===0).map(p=>Math.hypot(p.x-observer.x,p.z-observer.z)))})).sort((a,b)=>a.d-b.d).slice(0,Math.min(routes.length,20));
    for(let attempt=0;attempt<32;attempt++){const r=ranked[(actor.index*7+attempt*3)%ranked.length].r,d=(.06+rand()*.88)*r.length,p=sample(r,d);if(car&&vehicles.some(v=>v!==actor&&v.route&&Math.hypot(v.group.position.x-p.x,v.group.position.z-p.z)<7))continue;actor.route=r;actor.distance=d;actor.nextConnectionAt=0;actor.group.position.set(p.x,terrainHeight(p.x,p.z)+(car?-.02:-.048),p.z);actor.group.rotation.y=Math.atan2(p.dx,p.dz);return true;}
    actor.route=null;return false;
  }
  function continueRoad(actor){
    const previous=actor.route,current=sample(previous,actor.distance);
    if(previous.nextRoute){if(previous.length-actor.distance>.08)return false;actor.route=previous.nextRoute;actor.distance=previous.nextDistance;return true;}
    if(previous.length-actor.distance>2.6||elapsed<(actor.nextConnectionAt||0))return false;actor.nextConnectionAt=elapsed+2;
    const candidates=vehicleRoutes.filter(r=>r!==previous).map(r=>{const p=sample(r,Math.min(2,r.length*.05)),distance=Math.hypot(p.x-current.x,p.z-current.z),dot=current.dx*p.dx+current.dz*p.dz;return {route:r,point:p,distance,dot,score:distance+(1-dot)*2};}).filter(c=>c.distance<15&&c.distance>.4&&c.dot>-.8).sort((a,b)=>a.score-b.score);
    for(const candidate of candidates.slice(0,8)){const end=candidate.point,distance=candidate.distance,handle=Math.min(6,distance*.44),points=[],steps=Math.max(5,Math.ceil(distance/.65));
      for(let i=0;i<=steps;i++){const t=i/steps,u=1-t;points.push({x:u*u*u*current.x+3*u*u*t*(current.x+current.dx*handle)+3*u*t*t*(end.x-end.dx*handle)+t*t*t*end.x,z:u*u*u*current.z+3*u*u*t*(current.z+current.dz*handle)+3*u*t*t*(end.z-end.dz*handle)+t*t*t*end.z});}
      const bridge=route(points);let safe=true;for(let d=0;d<bridge.length;d+=.6)if(!carClear(sample(bridge,d))){safe=false;break;}if(!safe)continue;
      bridge.nextRoute=candidate.route;bridge.nextDistance=Math.min(2,candidate.route.length*.05);actor.route=bridge;actor.distance=0;actor.stopped=0;return true;
    }return false;
  }
  // Pools remain bounded and reusable. Hidden actors do not perform animation or route queries.
  for(let i=0;i<QUALITY_PROFILES.cinematic.cars;i++){const a=makeCar(i);vehicles.push(a);assign(a,vehicleRoutes,true);a.group.visible=false;}
  if(pedestrians)for(let i=0;i<QUALITY_PROFILES.cinematic.people;i++){const a=makePerson(i);people.push(a);assign(a,walkingRoutes,false);a.group.visible=false;}
  function density(hour){if(hour<5)return {cars:.2,people:.1};if(hour<7)return {cars:.4,people:.28};if(hour<10)return {cars:1,people:.85};if(hour<16)return {cars:.72,people:.78};if(hour<20)return {cars:1,people:1};if(hour<23)return {cars:.55,people:.48};return {cars:.28,people:.18};}
  function update(dt,hour=12,focus){
    if(disposed)return;const delta=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));elapsed+=delta;
    if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.z))observer={x:focus.x,z:focus.z};hour=Number.isFinite(hour)?((hour%24)+24)%24:12;lastHour=hour;const profile=QUALITY_PROFILES[tier],traffic=density(hour),carCount=Math.round(profile.cars*traffic.cars),personCount=Math.round(profile.people*traffic.people),night=hour<6||hour>=18;
    lampMat.emissiveIntensity=night?2.2:.35;tailMat.emissiveIntensity=night?1.5:.35;
    for(const a of vehicles){
      if(a.index>=carCount||!a.route){a.group.visible=false;a.visible=false;continue;}
      const dToObserver=Math.hypot(a.group.position.x-observer.x,a.group.position.z-observer.z);
      if(dToObserver>profile.view*1.4&&elapsed-lastPopulation>4)assign(a,vehicleRoutes,true);
      if(!a.route)continue;continueRoad(a);let target=a.targetSpeed;
      const current=sample(a.route,a.distance),look=sample(a.route,Math.min(a.route.length,a.distance+7));const bend=Math.abs(current.dx*look.dz-current.dz*look.dx);target*=1-Math.min(.7,bend*.75);
      for(const b of vehicles){if(b===a||b.index>=carCount||!b.route)continue;const dx=b.group.position.x-a.group.position.x,dz=b.group.position.z-a.group.position.z,ahead=dx*current.dx+dz*current.dz,lateral=Math.abs(dx*current.dz-dz*current.dx);if(ahead>0&&ahead<10&&lateral<1.55)target=Math.min(target,Math.max(0,(ahead-4.8)*1.8));}
      for(const person of people){if(!person.visible)continue;const dx=person.group.position.x-a.group.position.x,dz=person.group.position.z-a.group.position.z,ahead=dx*current.dx+dz*current.dz,lateral=Math.abs(dx*current.dz-dz*current.dx);if(ahead>0&&ahead<9&&lateral<1.45)target=Math.min(target,Math.max(0,(ahead-3.1)*1.2));}
      // Stop at safe route ends; changing density is generated, never a live signal feed.
      if(!a.route.nextRoute&&a.distance>a.route.length-5)target=Math.min(target,Math.max(0,(a.route.length-a.distance-1)*1.4));
      a.speed+=(target-a.speed)*Math.min(1,delta*2.8);const travel=a.speed*delta,nextDistance=Math.min(a.route.length,a.distance+travel),next=sample(a.route,nextDistance);
      if(carClear(next)){a.distance=nextDistance;a.group.position.set(next.x,terrainHeight(next.x,next.z)-.02,next.z);const yaw=Math.atan2(next.dx,next.dz);a.group.rotation.y+=angleDelta(a.group.rotation.y,yaw)*Math.min(1,delta*5);for(const wheel of a.wheels)wheel.rotation.x+=travel/.34;}else a.speed=0;
      if(!a.route.nextRoute&&a.route.length-a.distance<1.25){a.stopped+=delta;if(a.stopped>2&&dToObserver>48){assign(a,vehicleRoutes,true);a.stopped=0;}}else a.stopped=0;
      const visible=dToObserver<profile.view;a.group.visible=visible;a.visible=visible;a.near.visible=dToObserver<(tier==='cinematic'?75:tier==='ultra'?58:42);a.far.visible=!a.near.visible;
    }
    for(const a of people){
      if(a.index>=personCount||!a.route){a.group.visible=false;a.visible=false;a.talk.position.set(1e9,0,1e9);continue;}
      const distance=Math.hypot(a.group.position.x-observer.x,a.group.position.z-observer.z);if(distance>profile.view*1.3&&elapsed-lastPopulation>4)assign(a,walkingRoutes,false);if(!a.route)continue;
      let speed=a.speed;for(const b of people){if(b===a||!b.visible)continue;const separation=Math.hypot(b.group.position.x-a.group.position.x,b.group.position.z-a.group.position.z);if(separation<.7&&b.index<a.index)speed*=.15;}
      let nextDistance=a.distance+speed*delta*a.direction;if(nextDistance<=0||nextDistance>=a.route.length){a.direction*=-1;nextDistance=Math.max(0,Math.min(a.route.length,nextDistance));}
      const next=sample(a.route,nextDistance);if(!blocked(next.x,next.z,.34)){a.distance=nextDistance;a.group.position.set(next.x,terrainHeight(next.x,next.z)-.048,next.z);}else a.direction*=-1;
      const heading=Math.atan2(next.dx*a.direction,next.dz*a.direction);a.group.rotation.y+=angleDelta(a.group.rotation.y,heading)*Math.min(1,delta*5);
      a.visible=distance<profile.view*.75;a.group.visible=a.visible;a.near.visible=distance<(tier==='cinematic'?48:tier==='ultra'?34:24);a.far.visible=!a.near.visible;
      if(a.visible){a.phase+=delta*speed*5.5;const swing=Math.sin(a.phase)*.42;const rig=a.rigs[0];if(a.near.visible)for(let i=0;i<2;i++){const sign=i?1:-1;rig.legs[i].upper.rotation.x=swing*sign;rig.legs[i].lower.rotation.x=Math.max(0,Math.sin(a.phase)*-sign)*.65;rig.arms[i].upper.rotation.x=-swing*sign*.7;rig.arms[i].lower.rotation.x=-.12;}a.talk.position.copy(a.group.position);}else a.talk.position.set(1e9,0,1e9);
    }
    if(elapsed-lastPopulation>4)lastPopulation=elapsed;
  }
  function setQuality(value){tier=qualityName(value);library.setQuality(tier);group.traverse(o=>{if(o.isMesh)library.updateGeometry(o);});update(0,lastHour,observer);}
  function getStats(){return {mode:'simulation',observed:false,cars:vehicles.filter(a=>a.visible).length,pedestrians:people.filter(a=>a.visible).length,vehicleRoutes:vehicleRoutes.length,pedestrianRoutes:walkingRoutes.length,quality:tier};}
  function snapshot(){return {cars:vehicles.filter(a=>a.visible).map(a=>({x:a.group.position.x,y:a.group.position.y,z:a.group.position.z,direction:a.group.rotation.y})),people:people.filter(a=>a.visible).map(a=>({x:a.group.position.x,y:a.group.position.y,z:a.group.position.z,direction:a.group.rotation.y}))};}
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.clear();library.dispose();farLibrary.dispose();for(const g of extraGeometries)g.dispose();}
  update(0,12,observer);
  return {group,interactables,update,setQuality,getStats,snapshot,dispose,sourceInfo:{mode:'simulation',observed:false,label:'道路と時間帯に沿う交通シミュレーション',note:'表示中の人・車はゲーム内の生成・行動シミュレーションです。現実の人や車、混雑、信号をリアルタイム観測していません。'}};
}
function route(points){const clean=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z)>.01),distance=[0];let length=0;for(let i=1;i<clean.length;i++){length+=Math.hypot(clean[i].x-clean[i-1].x,clean[i].z-clean[i-1].z);distance.push(length);}return {points:clean,distance,length};}
function sample(r,d){if(!r.points.length)return {x:0,z:0,dx:0,dz:1};d=Math.max(0,Math.min(r.length,d));let lo=0,hi=r.distance.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(r.distance[mid]<=d)lo=mid;else hi=mid;}const a=r.points[lo],b=r.points[Math.min(lo+1,r.points.length-1)],len=Math.hypot(b.x-a.x,b.z-a.z)||1,t=(d-r.distance[lo])/len;return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,dx:(b.x-a.x)/len,dz:(b.z-a.z)/len};}
function inside(x,z,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;}
function segmentDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);}
function angleDelta(a,b){return Math.atan2(Math.sin(b-a),Math.cos(b-a));}
