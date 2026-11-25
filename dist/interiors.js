import {createMaterialLibrary} from './materials.js';
import {createWalkSurfaceIndex} from './walk-surfaces.js';
import {createObjectCollisionIndex,colliderFromObject} from './object-collisions.js';
/** Hand-built, human-scale interiors for MACHI LIFE. */
export function createInterior(THREE, id) {
  const library=createMaterialLibrary(THREE,{quality:'high'});
  const group = new THREE.Group();
  group.name = `interior-${id}`;
  const colliders = [], interactables = [], audioSources=[];
  const sound=(kind,x,y,z,options={})=>{const source={kind,x,y,z,radius:4,ambient:false,...options,id:`interior:${id}:${options.id||kind+'-'+audioSources.length}`};audioSources.push(source);return source;};
  const bounds={minX:-7.5,maxX:7.5,minZ:-8.5,maxZ:8.5};
  const walkSurfaces=createWalkSurfaceIndex({bounds}),sampleGround=walkSurfaces.sampleGround;
  const labels = {home:'自分の住まい',cafe:'カフェ',market:'マーケット',office:'オフィス',gallery:'ギャラリー',bookstore:'書店'};
  const label = labels[id] || labels.home;
  const matCache = new Map();
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  const cylGeo = library.cylinder();
  const sphereGeo = library.sphere();
  const m = (color, roughness=.7, metalness=0) => {
    const key = `${color}-${roughness}-${metalness}`;
    if(!matCache.has(key))matCache.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness}));
    return matCache.get(key);
  };
  function box(x,y,z,w,h,d,material,shadow=true){
    const rounded=Math.max(w,h,d)<6&&Math.min(w,h,d)>=.04;const o=new THREE.Mesh(rounded?library.roundedBox(w,h,d,Math.min(.07,Math.min(w,h,d)*.15)):boxGeo,typeof material==='number'?m(material):material);o.position.set(x,y,z);if(!rounded)o.scale.set(w,h,d);o.castShadow=shadow;o.receiveShadow=true;group.add(o);return o;
  }
  function cyl(x,y,z,r,h,material,rTop=1){
    const geo=rTop===1?cylGeo:new THREE.CylinderGeometry(r*rTop,r,h,48);
    const o=new THREE.Mesh(geo,typeof material==='number'?m(material):material);o.position.set(x,y,z);if(rTop===1)o.scale.set(r,h,r);o.castShadow=true;o.receiveShadow=true;group.add(o);return o;
  }
  function sphere(x,y,z,rx,ry,rz,material){const o=new THREE.Mesh(sphereGeo,typeof material==='number'?m(material):material);o.position.set(x,y,z);o.scale.set(rx,ry,rz);o.castShadow=true;group.add(o);return o;}
  function collider(x,z,w,d){colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});}
  function texture(kind, base='#b69b77'){
    const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,512,512);
    let seed=71;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
    if(kind==='wood'){
      for(let x=0;x<512;x+=64){ctx.fillStyle=x%128===0?'rgba(255,238,203,.09)':'rgba(55,30,15,.04)';ctx.fillRect(x,0,64,512);ctx.fillStyle='rgba(46,27,13,.22)';ctx.fillRect(x,0,1.5,512);for(let i=0;i<44;i++){ctx.strokeStyle=`rgba(65,36,17,${.025+rand()*.08})`;ctx.beginPath();let xx=x+rand()*63;ctx.moveTo(xx,0);ctx.bezierCurveTo(xx+rand()*8,160,xx-rand()*8,350,xx+rand()*4,512);ctx.stroke();}ctx.fillStyle='rgba(46,27,13,.18)';ctx.fillRect(x,x%128===0?160:350,64,1.3);}
    } else if(kind==='tile'){
      for(let x=0;x<512;x+=128)for(let y=0;y<512;y+=128){ctx.fillStyle=`rgba(255,255,255,${rand()*.07})`;ctx.fillRect(x+2,y+2,124,124);ctx.strokeStyle='rgba(60,70,68,.15)';ctx.strokeRect(x,y,128,128);}
    } else if(kind==='rug'){
      for(let y=0;y<512;y+=3){ctx.strokeStyle=y%6===0?'rgba(255,255,255,.09)':'rgba(0,0,0,.06)';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}for(let x=0;x<512;x+=4){ctx.strokeStyle='rgba(255,255,255,.04)';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke();}
    } else {
      for(let i=0;i<15000;i++){ctx.fillStyle=`rgba(${rand()>.5?'255,255,255':'60,60,55'},${rand()*.045})`;ctx.fillRect(rand()*512,rand()*512,1+rand()*2,1+rand()*2);}
    }
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='wood'?2:3,kind==='wood'?3:3);t.anisotropy=4;return t;
  }
  const wood=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('wood','#bb9c73'),roughness:.67});
  const walnut=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('wood','#74513a'),roughness:.58});
  const floorWood=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('wood','#b79c7d'),roughness:.72});
  const wall=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('plaster','#eeeae3'),roughness:.96});
  const tile=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('tile','#deded7'),roughness:.65});
  const dark=m(0x252d2a,.6,.15), ivory=m(0xf6f2e7,.8), green=m(0x48634c,.8), fabric=m(0x9fa294,.93), black=m(0x161d20,.5), brass=m(0xa88c51,.32,.7), white=m(0xe9ece7,.65);
  const lightMat=new THREE.MeshStandardMaterial({color:0xfff3d3,emissive:0xffdca7,emissiveIntensity:.65,roughness:.45});
  function textPanel(text,sub,w=2,h=.7,bg='#f1ede4',fg='#33463a'){
    const c=document.createElement('canvas');c.width=1024;c.height=Math.max(128,Math.round(1024*h/w));const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${sub?c.height*.30:c.height*.44}px "Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif`;ctx.fillText(text,512,sub?c.height*.39:c.height*.5,970);if(sub){ctx.globalAlpha=.65;ctx.font=`400 ${c.height*.13}px sans-serif`;ctx.fillText(sub,512,c.height*.76,950);}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t}));group.add(o);return o;
  }
  function panel(text,sub,x,y,z,w,h,rot=0,bg,fg){const o=textPanel(text,sub,w,h,bg,fg);o.position.set(x,y,z);o.rotation.y=rot;return o;}
  function plant(x,z,scale=1){
    sound('plant',x,.8*scale,z);
    cyl(x,.23*scale,z,.26*scale,.46*scale,m(0xb58b69,.9),.8);cyl(x,.46*scale,z,.21*scale,.035*scale,m(0x4c3f30));
    cyl(x,.9*scale,z,.03*scale,.9*scale,walnut);
    for(let i=0;i<8;i++){const a=i*2.4;const r=.22+(i%3)*.035;const leaf=sphere(x+Math.cos(a)*r*scale,(.93+i*.075)*scale,z+Math.sin(a)*r*scale,.21*scale,.12*scale,.35*scale,m([0x3f6546,0x54764c,0x667f54][i%3]));leaf.rotation.set(.35*Math.cos(a),a,.4*Math.sin(a));}
  }
  function pendant(x,z,y=3.25){
    sound('lamp',x,y,z);
    cyl(x,(y+4.5)/2,z,.012,4.5-y,dark);cyl(x,y,z,.42,.28,ivory, .45);cyl(x,y-.145,z,.33,.018,lightMat);
    const l=new THREE.PointLight(0xffe7bd,7,8,2);l.position.set(x,y-.25,z);group.add(l);
  }
  function wallLight(x,z,rot=0){sound('lamp',x,2.7,z);const o=box(x,2.7,z,.18,.52,.16,brass);o.rotation.y=rot;const g=box(x,2.7,z+.09,.1,.36,.08,lightMat);g.rotation.y=rot;}
  function table(x,z,w=1.8,d=1.0,y=.76,material=wood){sound('table',x,y,z);box(x,y,z,w,.095,d,material);for(const dx of [-w/2+.12,w/2-.12])for(const dz of [-d/2+.12,d/2-.12])box(x+dx,y/2,z+dz,.07,y,.07,dark);collider(x,z,w,d);}
  function chair(x,z,rot=0,color=0x98734e){
    sound('chair',x,.55,z);
    const cg=new THREE.Group();const add=(xx,yy,zz,w,h,d,mat)=>{const o=new THREE.Mesh(library.roundedBox(w,h,d,Math.min(.045,Math.min(w,h,d)*.15)),mat);o.position.set(xx,yy,zz);o.castShadow=true;cg.add(o);};
    const seat=m(color,.85);add(0,.47,0,.47,.07,.48,seat);add(0,.77,-.215,.47,.54,.065,seat);for(const xx of [-.18,.18])for(const zz of [-.18,.18])add(xx,.23,zz,.045,.47,.045,dark);cg.position.set(x,0,z);cg.rotation.y=rot;group.add(cg);
  }
  function mug(x,y,z,color=0xe9e3d7){cyl(x,y+.065,z,.075,.13,m(color,.35));cyl(x,y+.132,z,.062,.005,m(0x3b261b));const ring=new THREE.Mesh(new THREE.TorusGeometry(.045,.012,16,48),m(color,.4));ring.position.set(x+.078,y+.07,z);group.add(ring);}
  function book(x,y,z,w=.15,h=.45,color=0x697b73,rot=0){const o=box(x,y+h/2,z,w,h,.29,m(color,.8));o.rotation.y=rot;box(x,y+h*.77,z+.148,w*.72,.012,.006,ivory,false);}
  function shelf(x,z,w=2,h=2.8,d=.55,rot=0,fill='books'){
    sound(fill==='books'?'bookshelf':'shelf',x,h/2,z);
    const g=new THREE.Group();const old=group.children.length;
    box(x,h/2,z,w,h,d*.12,wood); // solid backing
    for(const dx of [-w/2,w/2])box(x+dx,h/2,z+.2,.065,h,d,wood);
    for(let j=0;j<=4;j++){const yy=.12+j*(h-.24)/4;box(x,yy,z+.2,w,.065,d,wood);if(j===4)continue;for(let i=0;i<Math.floor(w/.2)-1;i++){const xx=x-w/2+.17+i*.19;const hh=.27+((i*3+j*7)%5)*.045;if(fill==='books')book(xx,yy+.035,z+.23,.13+(i%3)*.015,hh,[0x6f8b7f,0xc1a06d,0x576c7b,0xbc8170,0xddd1b3,0x708f91][(i+j*2)%6]);else{const col=[0xbc5140,0xe6c875,0x91a67a,0xcedbd9,0xde9763][(i+j)%5];box(xx,yy+hh/2+.035,z+.23,.14,hh,.23,m(col));box(xx,yy+hh*.55,z+.351,.1,hh*.3,.007,ivory,false);}}
    }
    // Shelves are aligned against the rear wall unless caller rotates the unit.
    if(rot){const kids=group.children.slice(old);for(const k of kids){k.position.x-=x;k.position.z-=z;g.add(k);}g.position.set(x,0,z);g.rotation.y=rot;group.add(g);}
    const rotatedWidth=Math.abs(Math.cos(rot))*w+Math.abs(Math.sin(rot))*d;
    const rotatedDepth=Math.abs(Math.sin(rot))*w+Math.abs(Math.cos(rot))*d;
    collider(x,z,rotatedWidth,rotatedDepth);
  }
  function rug(x,z,w,d,color){sound('rug',x,.025,z);const rm=new THREE.MeshStandardMaterial({color:0xffffff,map:texture('rug',color),roughness:1});box(x,.015,z,w,.025,d,rm,false);walkSurfaces.addRect({x,z,width:w,depth:d,height:.0275},{kind:'rug'});}
  const actionSources={sleep:['bed',4.3,.65,-5.2],cook:['stove',-2.75,1.1,-7.9],relax:['sofa',-4.7,.55,1.4],cafe_menu:['counter',-.8,1.1,-5.5],cafe_work:['coffeemachine',-3.2,1.5,-5.5],shop:['counter',4.3,1.05,5.2],office_work:['desk',4.2,.8,-1.7],admire:['gallery',0,1.85,-2.2],books:['bookshelf',3.7,1,5.7]};
  function action(key,title,subtitle,x,z,radius=2.5){const [kind,sx,sy,sz]=actionSources[key]||['object',x,1,z];const source=sound(kind,sx,sy,sz,{id:'action-'+key});interactables.push({id:key,kind:'action',title,subtitle,position:new THREE.Vector3(x,1.2,z),radius,action:key,soundKind:kind,soundPosition:new THREE.Vector3(source.x,source.y,source.z)});}
  function art(x,y,z,w,h,seed=0,rot=0){
    sound('gallery',x,y,z);
    const c=document.createElement('canvas');c.width=512;c.height=Math.round(512*h/w);const ctx=c.getContext('2d');const colors=[['#e2d9bd','#7a9385','#c08265','#273e38'],['#e3e6df','#446d7d','#a1b6b2','#ccaa79'],['#ece2cf','#c6a266','#8a735a','#5e776c']][seed%3];ctx.fillStyle=colors[0];ctx.fillRect(0,0,c.width,c.height);for(let i=0;i<7;i++){ctx.fillStyle=colors[(i+seed)%3+1];ctx.globalAlpha=.55+i*.05;ctx.beginPath();ctx.ellipse(80+(i*137+seed*43)%420,80+(i*91)%Math.max(90,c.height-80),120+(i*19)%100,60+(i*61)%180,(i+seed)*.8,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const frame=box(x,y,z,w+.12,h+.12,.08,wood);frame.rotation.y=rot;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:t,roughness:.85}));o.position.set(x+Math.sin(rot)*.048,y,z+Math.cos(rot)*.048);o.rotation.y=rot;group.add(o);
  }
  function windowView(x,y,z,w=3.2,h=2.0,rot=Math.PI/2){
    sound('window',x,y,z);
    const c=document.createElement('canvas');c.width=512;c.height=384;const ctx=c.getContext('2d');const grad=ctx.createLinearGradient(0,0,0,384);grad.addColorStop(0,'#b6d3da');grad.addColorStop(1,'#e8e5d8');ctx.fillStyle=grad;ctx.fillRect(0,0,512,384);for(let i=0;i<12;i++){ctx.fillStyle=['#d6d2c5','#c5cbbe','#c4c9c7'][i%3];let bx=(i*91)%512,by=80+(i*73)%160;ctx.fillRect(bx,by,65,384-by);ctx.fillStyle='#9eaca9';for(let xx=bx+7;xx<bx+58;xx+=16)for(let yy=by+12;yy<380;yy+=28)ctx.fillRect(xx,yy,8,15);}for(let i=0;i<9;i++){ctx.fillStyle=['#779977','#8ca482','#5f8868'][i%3];ctx.beginPath();ctx.arc((i*79)%512,300+(i%2)*30,54,0,Math.PI*2);ctx.fill();}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:t,emissive:0xaec8ba,emissiveMap:t,emissiveIntensity:.4,roughness:.18}));o.position.set(x,y,z);o.rotation.y=rot;group.add(o);
    const wx=Math.sin(rot),wz=Math.cos(rot);const ex=Math.cos(rot),ez=-Math.sin(rot);
    const frame=(xx,yy,zz,ww,hh,dd)=>{const b=box(xx,yy,zz,ww,hh,dd,m(0xf0eee7));b.rotation.y=rot;};
    for(const off of [-w/2,w/2,0])frame(x+ex*off+wx*.025,y,z+ez*off+wz*.025,.075,h+.12,.08);
    for(const off of [-h/2,h/2])frame(x+wx*.025,y+off,z+wz*.025,w+.12,.08,.1);
    frame(x+wx*.06,y-h/2-.055,z+wz*.06,w+.2,.09,.28);
  }
  // Shared shell: a solid room, two generous street-facing windows and entry.
  box(0,-.12,0,16,.24,18,id==='market'||id==='gallery'?tile:floorWood,false);
  walkSurfaces.addRect({x:0,z:0,width:16,depth:18,height:0},{kind:'floor',id:`floor-${id}`});
  box(0,4.52,0,16,.16,18,m(0xeae7df),false);
  box(0,2.25,-9,16,4.5,.22,wall);box(-8,2.25,0,.22,4.5,18,wall);box(8,2.25,0,.22,4.5,18,wall);
  box(-4.65,2.25,9,6.7,4.5,.22,wall);box(4.65,2.25,9,6.7,4.5,.22,wall);box(0,3.65,9,2.6,1.7,.22,wall);
  for(const s of [-1,1])box(s*7.85,.1,0,.06,.2,17.8,ivory);box(0,.1,-8.85,15.7,.2,.06,ivory);
  collider(0,-9,16,.3);collider(-8,0,.3,18);collider(8,0,.3,18);collider(-4.65,9,6.7,.3);collider(4.65,9,6.7,.3);
  // A visible entrance remains behind the player. Interaction handles going outside.
  box(0,1.4,9.02,2.45,2.8,.12,wood);box(0,1.6,8.945,1.8,1.7,.035,m(0x9db6b3,.2,.12));box(.8,1.18,8.88,.045,.28,.065,brass);
  panel('外へ','STREET',0,2.95,8.83,1.4,.32,Math.PI,'#e8e6df','#33463a');
  sound('door',0,1.4,9.02,{id:'entrance'});
  interactables.push({id:'exit',kind:'exit',title:'街へ出る',subtitle:'玄関を開ける',position:new THREE.Vector3(0,1.2,8),radius:2.5,soundKind:'door',soundPosition:new THREE.Vector3(0,1.4,9.02)});
  // The low room tone comes from a visible ventilation grille.
  box(0,3.92,-8.82,1.1,.34,.09,ivory);for(let i=0;i<5;i++)box(0,3.8+i*.05,-8.76,.9,.014,.025,dark);
  sound('vent',0,3.92,-8.76,{id:'vent',radius:17,gain:.11,ambient:true});
  sound('floor',0,0,0,{id:'floor',radius:12});
  windowView(-7.87,2.2,-3.8,3.8,2.15,Math.PI/2);windowView(-7.87,2.2,3.3,3.8,2.15,Math.PI/2);
  const ambient=new THREE.HemisphereLight(0xfff7e8,0x7a8175,.8);group.add(ambient);
  const fill=new THREE.PointLight(0xfff1da,16,22,2);fill.position.set(0,3.8,0);group.add(fill);
  const sunpatch=new THREE.Mesh(new THREE.PlaneGeometry(4.7,2.5),new THREE.MeshBasicMaterial({color:0xfff0c2,transparent:true,opacity:.1,depthWrite:false}));sunpatch.rotation.x=-Math.PI/2;sunpatch.rotation.z=.3;sunpatch.position.set(-4.6,.025,1.9);group.add(sunpatch);

  if(id==='home'){
    sound('fridge',-6.9,1.1,-5.5,{id:'fridge',radius:8,gain:.16,ambient:true});sound('faucet',-5.25,1.19,-8.2,{id:'faucet'});sound('counter',-4.3,.93,-7.95,{id:'kitchen'});sound('cabinet',.1,.6,1.4,{id:'tv-cabinet'});
    // Bedroom nook with layered linen and a low headboard.
    rug(3.9,-4.1,4.8,6.4,'#d3c8b7');box(4.3,.3,-5.2,2.5,.55,3.6,walnut);box(4.3,.64,-5.2,2.43,.25,3.5,ivory);box(4.3,.82,-4.65,2.48,.18,2.25,m(0x78908a,.95));box(4.3,.94,-6.13,2.0,.22,.65,m(0xf5eee0,.95));box(4.3,.75,-7.05,2.6,1.3,.16,walnut);collider(4.3,-5.2,2.6,3.8);
    box(6.15,.32,-6.25,.7,.65,.65,wood);cyl(6.15,.83,-6.25,.09,.38,brass);cyl(6.15,1.13,-6.25,.24,.32,ivory,.7);
    // Kitchen is a usable working counter.
    box(-4.3,.45,-7.95,5.5,.9,1.5,ivory);box(-4.3,.93,-7.95,5.65,.09,1.6,m(0xd3d3c8,.28));collider(-4.3,-7.95,5.65,1.6);
    for(let x=-6.5;x<=-2.5;x+=1){box(x,.5,-7.17,.86,.72,.025,m(0xded6c7));box(x,.75,-7.14,.22,.025,.04,brass);}
    box(-5.25,.99,-7.9,1.05,.035,.8,m(0x64716d,.3,.6));box(-5.25,1.0,-7.9,.88,.035,.64,m(0x394843,.32,.6));cyl(-5.25,1.19,-8.2,.027,.42,brass);
    box(-2.75,.995,-7.9,1.35,.02,.9,black);for(const xx of [-3.05,-2.48])for(const zz of [-8.1,-7.7]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.17,.012,8,24),m(0x8b9490,.2,.7));ring.rotation.x=Math.PI/2;ring.position.set(xx,1.012,zz);group.add(ring);}
    box(-6.9,1.1,-5.5,1.05,2.2,1.0,m(0xbfc6c0,.35,.2));box(-6.35,1.35,-5.42,.04,.8,.06,dark);collider(-6.9,-5.5,1.05,1.1);
    box(-3.5,2.45,-8.5,3.5,.78,.6,m(0xb3a086));box(-4.0,2.45,-8.185,.025,.7,.025,walnut);plant(-1.7,-7.8,.45);
    // Lounge and personal touches.
    rug(-2.5,1.4,5.3,4.8,'#a9afa4');box(-4.7,.35,1.4,1.2,.6,3.1,m(0x7f8d7f,.95));box(-5.18,.85,1.4,.28,1.0,3.15,m(0x7f8d7f,.95));for(const zz of [.1,2.7])box(-4.7,.73,zz,1.25,.65,.25,fabric);for(const zz of [.68,2.06])box(-4.55,.7,zz,.9,.22,1.12,m(0xa3aa99,.94));collider(-4.7,1.4,1.3,3.2);
    table(-2.4,1.4,1.5,1.6,.42,wood);mug(-2.65,.48,1.5);box(-2.1,.49,1.1,.45,.04,.62,m(0x7c8a80));
    box(.1,.32,1.4,.55,.62,2.4,walnut);const tv=box(.13,1.2,1.4,.08,1.1,1.9,black);box(.18,1.21,1.4,.015,.96,1.75,m(0x243d38,.15));collider(.1,1.4,.6,2.4);
    table(4.6,2.7,2.1,1.4,.76,wood);chair(4.6,3.7,Math.PI);chair(4.6,1.7,0);plant(4.8,2.6,.3);collider(4.6,2.7,2.1,1.4);
    plant(6.8,6.7,1.35);art(3.6,2.5,-8.83,2.0,1.25,0);shelf(6.9,.4,2.5,2.2,.5,-Math.PI/2);
    pendant(-2.4,1.4);pendant(4.6,2.7);panel('ただいま。','A place to return to',4.6,2.8,8.84,2.3,.6,Math.PI);
    action('sleep','ベッドで休む','8時間の睡眠や、短い仮眠をとる',3.2,-3.0);
    action('cook','料理をする','買ってきた食材で食事をつくる',-3.6,-6.25);
    action('relax','ソファでくつろぐ','お気に入りの場所でひと休み',-3.2,2.9);
  } else if(id==='cafe'){
    sound('counter',3.9,.96,-7.8);sound('coffeemachine',-1.95,1.55,-5.55);sound('counter',-6.8,1,1);
    // Tiled service island and warmly lit timber bar.
    box(-.8,.55,-5.5,9.2,1.1,1.6,m(0x4e6659));box(-.8,1.13,-5.5,9.4,.14,1.82,walnut);collider(-.8,-5.5,9.4,1.8);
    for(let x=-5.2;x<3.6;x+=.18)box(x,.54,-4.68,.055,.95,.035,m(0x6d826c));
    shelf(-4.2,-8.5,4.2,2.4,.65,0,'goods');box(3.9,.46,-7.8,4.5,.92,1.4,ivory);box(3.9,.96,-7.8,4.65,.1,1.5,walnut);collider(3.9,-7.8,4.65,1.5);
    // Espresso machine, grinder, cups and bakery display.
    box(-3.2,1.45,-5.5,1.2,.55,.65,m(0xb8bebb,.25,.8));box(-3.2,1.75,-5.51,1.25,.06,.7,dark);for(const xx of [-3.55,-3.0]){cyl(xx,1.34,-5.1,.04,.21,black);mug(xx,1.2,-4.98);}box(-1.95,1.36,-5.55,.35,.4,.45,dark);cyl(-1.95,1.72,-5.55,.18,.35,m(0x6a4632,.2));
    box(.2,1.24,-5.3,2.2,.12,.8,wood);const glass=new THREE.MeshPhysicalMaterial({color:0xdce6da,transparent:true,opacity:.19,roughness:.1,metalness:0,side:THREE.DoubleSide});box(.2,1.59,-5.35,2.2,.65,.85,glass,false);for(let i=0;i<7;i++){sphere(-.65+i*.27,1.35,-5.14,.13,.09,.16,m([0xa96d35,0xd2a15d,0xbf844b][i%3],.85));}
    box(2.8,1.27,-5.38,.6,.2,.5,dark);const reg=box(2.8,1.6,-5.4,.6,.5,.05,m(0x293d36,.2));reg.rotation.x=-.2;
    for(const x of [-3.6,-.4,2.7])pendant(x,-5.2,2.95);
    panel('こもれび喫茶','KOMOREBI · COFFEE & BAKES',1.6,2.7,-8.83,4.7,1.25,0,'#ece8dc','#405448');
    panel('本日のおすすめ','コーヒー  ¥420    /    サンドイッチ  ¥780',-6.6,2.4,-8.84,1.8,1.3,0,'#293f35','#f2ead8');
    for(const [x,z] of [[-4,0],[3.8,0],[-4,4.6],[3.8,4.6]]){table(x,z,1.55,1.4,.76,walnut);chair(x,z-1,0,0x6a806d);chair(x,z+1,Math.PI,0x6a806d);mug(x-.25,.81,z-.1);plant(x+.3,z+.2,.22);}
    // A compact window counter and magazines near the entrance.
    box(-6.8,1.0,1,1.2,.09,5.5,wood);collider(-6.8,1,1.2,5.5);for(const z of [-.5,1.2,2.9]){cyl(-6.1,.7,z,.28,.08,walnut);cyl(-6.1,.35,z,.045,.65,dark);}
    plant(6.7,-7,1.5);plant(6.7,6.8,1.2);art(7.84,2.5,1.2,2.6,1.75,2,-Math.PI/2);
    action('cafe_menu','注文する','香りのよい珈琲と、手づくりの食事',-.7,-3.55,2.6);
    action('cafe_work','カフェで働く','お店を手伝って、収入を得る',3.5,-3.55,2.4);
  } else if(id==='market'){
    sound('fridge',0,1.25,-8.3,{id:'fridge',radius:13,gain:.2,ambient:true});for(const x of [-4.7,-.3,4.1])sound('shelf',x,1.2,-2);for(const z of [4.5,6])sound('crate',-5.7,.6,z);
    // Three merchandise rows, each with space around both ends.
    for(const x of [-4.7,-.3,4.1]){
      box(x,.13,-2.0,1.3,.26,6.4,m(0xc4c8be));box(x,1.23,-2.0,.09,2.2,6.3,white);collider(x,-2,1.4,6.4);
      for(let j=0;j<4;j++){
        const y=.32+j*.52;box(x,y,-2.0,1.35,.065,6.4,white);
        for(const side of [-1,1])for(let k=0;k<14;k++){
          const z=-4.85+k*.43;const col=[0x9aaa6c,0xd39658,0xe4c783,0xc76d5c,0x7395a0,0xe5ddd0][(k+j)%6];const hh=.24+(k%3)*.04;
          if(j===0&&k%3===0)cyl(x+side*.36,y+.19,z,.115,.31,m(col,.3));else box(x+side*.37,y+hh/2+.035,z,.23,hh,.31,m(col));
          box(x+side*.495,y+.18,z,.008,.1,.17,ivory,false);
        }
      }
    }
    // Refrigerated display on the back wall.
    box(0,1.25,-8.3,12,2.5,.9,m(0xc3c9c5,.3,.3));for(let x=-5.25;x<=5.3;x+=1.5){box(x,1.28,-7.82,1.4,2.3,.035,m(0x66827a,.18,.15));box(x+.55,1.24,-7.77,.03,.56,.055,white);for(let y=.4;y<2.2;y+=.5){box(x,y,-7.7,1.32,.035,.1,white);for(let k=0;k<4;k++)box(x-.45+k*.3,y+.16,-7.74,.18,.27,.05,m([0xc9d8c8,0xe2b877,0xc5836c,0xe3e5d8][k]));}}
    collider(0,-8.3,12,1);
    // Checkout has a clear approach from the door.
    box(4.3,.5,5.2,4.0,1,1.2,m(0x62806b));box(4.3,1.05,5.2,4.15,.1,1.35,wood);collider(4.3,5.2,4.15,1.35);
    box(5.2,1.2,5.2,.6,.2,.5,dark);const sc=box(5.2,1.53,5.2,.65,.46,.05,black);sc.rotation.x=-.15;box(5.2,1.53,5.24,.55,.36,.015,m(0x7da49a,.2));
    box(2.85,1.16,5.2,.9,.12,.6,m(0xceb47f));box(2.85,1.3,5.2,.5,.22,.35,m(0x938363));
    // Fruit crates at the front window.
    for(let j=0;j<2;j++){box(-5.7,.35,4.5+j*1.5,2.9,.7,1.2,wood);for(let a=0;a<6;a++)for(let b=0;b<2;b++)sphere(-6.8+a*.42,.8,4.22+j*1.5+b*.42,.18,.17,.18,m(j===0?0xb84d36:0xd4b255,.4));collider(-5.7,4.5+j*1.5,2.9,1.2);}
    panel('毎日の、おいしいを。','マーケット',0,3.5,-8.83,7.8,.7,0,'#54705b','#fff8e8');
    for(const [x,t] of [[-4.7,'食材'],[-.3,'日用品'],[4.1,'飲みもの']])panel(t,'DAILY MARKET',x,2.7,.9,1.3,.45);
    for(const x of [-3.5,3.5]){box(x,4.35,-1,.25,.08,12,lightMat,false);}
    action('shop','買い物をする','食材や軽食、飲み物をレジで購入する',3.6,6.6,2.7);
  } else if(id==='office'){
    // Shared working studio with a spacious central aisle.
    rug(0,-2.6,13.8,10,'#a4aaa5');
    for(const x of [-4.2,4.2])for(const z of [-5.1,-1.7,1.7]){
      table(x,z,2.5,1.25,.76,wood);chair(x,z+1.0,Math.PI,0x566967);
      box(x,.82,z-.12,.45,.035,.27,dark);box(x,1.08,z-.25,.055,.48,.05,dark);box(x,1.35,z-.25,1.1,.67,.06,dark);box(x,1.35,z-.212,.98,.54,.012,m(0x6f9690,.2));
      box(x,.825,z+.35,.65,.035,.2,m(0xd6dcd6));box(x+.55,.825,z+.35,.13,.045,.2,white);mug(x-.85,.81,z+.25,0x667a6a);box(x+.8,.83,z-.1,.3,.05,.42,m(0xbeaa86));
    }
    box(0,2.25,-8.82,7.5,1.8,.055,m(0xe9ece5,.3));panel('MACHI WORKS','小さなアイデアから、まちをつくる。',0,2.3,-8.77,6.2,1.2,0,'#e9ece5','#446756');
    plant(-6.8,-7.6,1.5);plant(6.8,-7.6,1.5);plant(6.8,6.7,1.1);
    shelf(-6.6,6.8,3.0,2.35,.55,Math.PI);shelf(4.5,8.1,3.2,2.35,.55,Math.PI);
    // Pinboard and architectural models.
    box(7.84,2.4,-2.3,.06,1.8,4.4,m(0xb39b71));for(let i=0;i<7;i++)box(7.795,2.0+(i%3)*.38,-3.9+i*.5,.015,.45,.35,m([0xeee6d2,0xd1dfd6,0xe7ceac][i%3]));
    table(-3.2,5.5,2.6,1.25,.76,wood);for(let i=0;i<7;i++){box(-4.15+i*.31,.88+(i%3)*.1,5.5,.23,.2+(i%3)*.2,.38,ivory);}
    for(const x of [-4.2,4.2])for(const z of [-4.5,1.5])pendant(x,z,3.4);
    action('office_work','デスクで仕事をする','集中して働き、お給料を受け取る',2.4,-.1,2.8);
  } else if(id==='gallery'){
    // Three curated original pieces and sculpture in a luminous quiet room.
    box(0,4.35,-1.0,.08,.06,13,dark,false);box(-4.8,4.35,-1.0,.08,.06,13,dark,false);box(4.8,4.35,-1.0,.08,.06,13,dark,false);
    art(-4.65,2.4,-8.82,3.0,2.15,0);art(0,2.4,-8.82,2.4,2.8,1);art(4.65,2.4,-8.82,3.0,2.15,2);
    art(7.84,2.45,-3.5,3.7,2.3,1,-Math.PI/2);art(7.84,2.45,3.5,3.7,2.3,0,-Math.PI/2);
    for(const x of [-4.65,0,4.65]){panel(x===0?'余白のある風景':'静かな時間','MACHI COLLECTION',x,1.05,-8.77,1.2,.22);const l=new THREE.PointLight(0xfff3da,4,7,2);l.position.set(x,3.7,-6.4);group.add(l);}
    // An original sculptural loop on a stone plinth.
    box(0,.55,-2.2,1.55,1.1,1.55,m(0xbfc3b9,.9));const sculpture=new THREE.Mesh(new THREE.TorusKnotGeometry(.65,.12,192,28,2,3),m(0xb59b70,.27,.6));sculpture.position.set(0,1.85,-2.2);sculpture.rotation.set(.2,.5,.1);sculpture.castShadow=true;group.add(sculpture);collider(0,-2.2,1.7,1.7);
    panel('巡るかたち','BRASS / 2026',0,.79,-1.395,1.05,.25);
    // Benches leave the view to the exhibition open.
    for(const x of [-3.4,3.4]){box(x,.48,3.0,2.8,.12,.7,wood);for(const dx of [-1.05,1.05])box(x+dx,.23,3.0,.18,.46,.6,m(0x899187));collider(x,3.0,2.8,.75);}
    box(5.7,.6,7.2,2.4,1.2,1.15,ivory);box(5.7,1.23,7.2,2.5,.07,1.25,wood);collider(5.7,7.2,2.5,1.25);box(5.6,1.3,7.2,.6,.05,.65,m(0x617768));
    for(const x of [-3.4,3.4])sound('bench',x,.48,3);sound('counter',5.7,1.23,7.2);
    plant(-6.7,6.8,1.5);panel('ギャラリー','GALLERY',-4.5,2.7,8.83,2.8,.85,Math.PI);
    action('admire','アートを鑑賞する','少し立ち止まって、感性を休める',0,-4.3,3.0);
  } else {
    for(const x of [-4.4,1.9])for(const z of [-3,.8])sound('bookshelf',x,1.2,z);sound('sofa',-5.75,.55,5.6);sound('counter',3.7,1.04,5.7);
    // A real bookshop layout with many individually colored spines.
    shelf(-4.7,-8.4,5.3,3.2,.7);shelf(2.5,-8.4,7.3,3.2,.7);
    shelf(7.35,-3.7,5.7,2.95,.65,-Math.PI/2);shelf(7.35,3.5,4.9,2.95,.65,-Math.PI/2);
    for(const x of [-4.4,1.9]){
      for(const z of [-3.0,.8]){box(x,.57,z,2.5,1.14,1.6,walnut);box(x,1.17,z,2.65,.1,1.75,wood);collider(x,z,2.7,1.8);for(let j=0;j<3;j++)for(let i=0;i<4;i++){const col=[0xbfa77c,0x6c8375,0x8b9b9b,0xbd8170][i];box(x-.8+i*.52,1.26+j*.045,z-.48+j*.45,.4,.06,.55,m(col));}panel(z<0?'新刊・話題の本':'暮らしと旅','HONDANA BOOKS',x,.85,z+.88,1.7,.27);}
    }
    // Reading nook by a window.
    rug(-4.8,5.5,3.6,3.6,'#98a38d');box(-5.75,.35,5.6,1.1,.65,2.0,m(0x84957e,.95));box(-6.2,.8,5.6,.22,.9,2.0,m(0x84957e,.95));collider(-5.75,5.6,1.1,2.0);table(-4.1,5.6,1.2,1.2,.48,wood);box(-4.1,.56,5.6,.55,.04,.7,ivory);plant(-6.7,7.7,1.25);
    box(3.7,.5,5.7,3.7,1,1.35,wood);box(3.7,1.04,5.7,3.85,.1,1.5,walnut);collider(3.7,5.7,3.85,1.5);box(4.7,1.19,5.65,.55,.23,.5,dark);const scr=box(4.7,1.5,5.65,.6,.43,.045,black);scr.rotation.x=-.2;box(2.7,1.18,5.8,.8,.15,.7,m(0x6e8979));
    panel('本棚書店','物語と暮らす。',0,3.75,-8.82,5.0,.65,0,'#ece8dd','#48614f');
    for(const x of [-4.4,1.9])for(const z of [-3,1])pendant(x,z,3.2);
    art(-7.84,2.6,6.2,1.7,1.4,2,Math.PI/2);action('books','本を手に取る','新しい物語と、ゆっくり過ごす時間',1.0,5.3,2.7);
  }
  library.apply(wood,'wood');library.apply(walnut,'wood');library.apply(floorWood,'wood');library.apply(wall,'plaster');library.apply(tile,'paving');library.apply(fabric,'fabric');
  for(const mat of matCache.values())library.apply(mat,mat.metalness>.35?'metal':mat.roughness>.9?'fabric':'stone');
  // Furnishing is static. Consolidating repeated pieces preserves the detail
  // while keeping hundreds of products/books inexpensive on mobile GPUs.
  group.updateMatrixWorld(true);
  // Register solids before visual instancing. Seats, pots, appliances and their
  // actual height are included; flat floors/rugs stay with sampleGround.
  colliders.length=0;
  group.traverse(object=>{if(!object.isMesh)return;const c=colliderFromObject(THREE,object,{id:`interior:${id}:solid:${colliders.length}`,type:'interior-object'});if(c&&c.maxY>.045)colliders.push(c);});
  const collisionIndex=createObjectCollisionIndex({colliders,cellSize:2.5});
  const batches=new Map();
  group.traverse(o=>{
    if(!o.isMesh || o.material.transparent || (!o.geometry.userData.qualityShape&&![boxGeo,cylGeo,sphereGeo].includes(o.geometry)))return;
    const key=`${o.geometry.uuid}:${o.material.uuid}:${o.castShadow}`;
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key).push(o);
  });
  for(const pieces of batches.values()){
    if(pieces.length<3)continue;
    const first=pieces[0];const batch=new THREE.InstancedMesh(first.geometry,first.material,pieces.length);
    batch.castShadow=first.castShadow;batch.receiveShadow=true;
    pieces.forEach((piece,index)=>{batch.setMatrixAt(index,piece.matrixWorld);piece.removeFromParent();});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();group.add(batch);
  }
  let disposed=false;const lights=[];group.traverse(o=>{if(o.isPointLight){o.userData.baseIntensity=o.intensity;lights.push(o);}});
  function setQuality(tier){library.setQuality(tier);group.traverse(o=>{if(o.isMesh)library.updateGeometry(o);});const limit=tier==='low'?2:tier==='medium'?4:12;lights.forEach((light,index)=>{light.visible=index<limit;});}
  function update(){}
  function dispose(){if(disposed)return;disposed=true;audioSources.length=0;collisionIndex.dispose();walkSurfaces.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const mat of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture&&!library.ownsTexture(value))textures.add(value);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();library.dispose();group.removeFromParent();group.clear();}
  return {group,colliders,collisionIndex,interactables,audioSources,getAudioSources:()=>audioSources,sampleGround,setQuality,update,dispose,spawn:{x:0,z:7,yaw:0},bounds,label};
}
