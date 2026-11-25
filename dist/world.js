/* MACHI LIFE — handcrafted, human-scale exterior. No network assets. */
export function createWorld(THREE) {
  const group = new THREE.Group();
  group.name = 'ひかり町';
  const colliders = [], interactables = [], buildings = [];
  const bounds = { minX: -87, maxX: 87, minZ: -100, maxZ: 100 };
  const spawn = { x: 10, z: 33, yaw: 0 };
  const batches = new Map();
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const m = new THREE.Matrix4(), e = new THREE.Euler();
  const boxGeometry = new THREE.BoxGeometry(1,1,1);
  const sphereGeometry = new THREE.SphereGeometry(1,18,12);
  const cylinderGeometry = new THREE.CylinderGeometry(1,1,1,16);
  let seed = 31919;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mats = {};
  function material(name,color,opts={}) { return mats[name] = new THREE.MeshStandardMaterial({color,roughness:.78,metalness:0,...opts}); }
  function canvasTexture(w,h,paint) {
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    paint(c.getContext('2d'),w,h);
    const t = new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
  }
  function noiseTexture(base,amount=9,tile=false) {
    const tex=canvasTexture(256,256,(ctx,w,h)=>{
      ctx.fillStyle=base; ctx.fillRect(0,0,w,h);
      const img=ctx.getImageData(0,0,w,h);
      for(let i=0;i<img.data.length;i+=4){const n=(rnd()-.5)*amount;img.data[i]+=n;img.data[i+1]+=n;img.data[i+2]+=n;}
      ctx.putImageData(img,0,0);
      if(tile){ctx.strokeStyle='rgba(80,78,68,.12)';ctx.lineWidth=1;for(let x=0;x<=256;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,256);ctx.stroke();}for(let y=0;y<=256;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y);ctx.stroke();}}
    });
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;
  }
  const asphalt=material('asphalt','#ffffff',{map:noiseTexture('#636a6d',17)});
  asphalt.map.repeat.set(3,34);
  const sidewalk=material('sidewalk','#ffffff',{map:noiseTexture('#c1bcae',8,true)});sidewalk.map.repeat.set(1,13);
  const plaster=material('plaster','#ffffff',{map:noiseTexture('#e7e1d3',7)});
  const concrete=material('concrete','#ffffff',{map:noiseTexture('#c9c8bf',14)});
  const pale=material('pale','#e4e5dd');
  const cream=material('cream','#efe9d7');
  const stone=material('stone','#a8a79c');
  const dark=material('dark','#263b3c',{roughness:.48,metalness:.25});
  const metal=material('metal','#5b6461',{roughness:.48,metalness:.65});
  const black=material('black','#263031',{roughness:.65});
  const bronze=material('bronze','#8b7a57',{roughness:.48,metalness:.6});
  const wood=material('wood','#88613e',{map:noiseTexture('#aa8055',16),roughness:.84});
  const cedar=material('cedar','#a9784f',{roughness:.8});
  const brick=material('brick','#b7836b',{map:canvasTexture(256,256,(ctx)=>{
    ctx.fillStyle='#aa7e67';ctx.fillRect(0,0,256,256);for(let y=0;y<256;y+=24)for(let x=-32;x<256;x+=64){let xx=x+(y/24%2)*32;ctx.fillStyle=['#ad806a','#b88b74','#ac806b','#bb927b'][Math.floor(rnd()*4)];ctx.fillRect(xx+1,y+1,62,22);}})});
  brick.map.wrapS=brick.map.wrapT=THREE.RepeatWrapping;brick.map.repeat.set(4,3);
  const grass=material('grass','#ffffff',{map:noiseTexture('#6f885b',23)});grass.map.repeat.set(14,14);
  const soil=material('soil','#5c4d3b');
  const leafMats=['#64804e','#6d8753','#567445','#78925d','#81965f'].map((c,i)=>material('leaf'+i,c,{roughness:.95}));
  const bark=material('bark','#6e5c45',{roughness:1});
  const green=material('green','#326856');
  const warmLight=material('warmLight','#fff5cf',{emissive:'#ffc674',emissiveIntensity:.5,roughness:.3});
  const glass=material('glass','#6e9296',{roughness:.22,metalness:.6,emissive:'#253b3f',emissiveIntensity:.16});
  const windowLit=material('windowLit','#b2b9a5',{roughness:.3,metalness:.35,emissive:'#f2d899',emissiveIntensity:.07});
  const roadPaint=material('roadPaint','#e7e5d9',{roughness:1});
  const yellow=material('yellow','#d4ae55');
  const tactile=material('tactile','#c8b775');
  const water=material('water','#75a5a5',{roughness:.2,metalness:.4,transparent:true,opacity:.88});
  const storefront=material('storefront','#ffffff',{roughness:.35,metalness:.1,map:canvasTexture(512,512,(ctx,w,h)=>{
    const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#3c514f');g.addColorStop(.4,'#6c7668');g.addColorStop(1,'#a38d64');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#bfae88';ctx.fillRect(30,240,452,13);ctx.fillRect(52,350,390,16);
    for(let i=0;i<9;i++){ctx.fillStyle=['#e0c89b','#8e9d80','#ba795d'][i%3];ctx.fillRect(45+i*48,260,23,80-rnd()*30);}
    ctx.fillStyle='rgba(227,233,206,.16)';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(170,0);ctx.lineTo(480,512);ctx.lineTo(390,512);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(235,241,222,.18)';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,155);ctx.lineTo(512,110);ctx.stroke();
  })});
  function batch(geo,mat,pos,scale,rotation=[0,0,0],cast=true) {
    const key=geo.uuid+'|'+mat.uuid+'|'+cast;
    let b=batches.get(key);if(!b){b={geo,mat,matrices:[],cast};batches.set(key,b);}
    v.set(...pos); s.set(...scale); e.set(...rotation); q.setFromEuler(e);m.compose(v,q,s);b.matrices.push(m.clone());
  }
  const box=(x,y,z,w,h,d,mat,ry=0,cast=true)=>batch(boxGeometry,mat,[x,y,z],[w,h,d],[0,ry,0],cast);
  const sphere=(x,y,z,sx,sy,sz,mat)=>batch(sphereGeometry,mat,[x,y,z],[sx,sy,sz]);
  const cyl=(x,y,z,r,h,mat,rx=0,rz=0)=>batch(cylinderGeometry,mat,[x,y,z],[r,h,r],[rx,0,rz]);
  const collider=(x,z,w,d)=>colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
  function sign(text,subtitle,w,h,x,y,z,ry=0,bg='#203c38',fg='#f1edda',serif=false){
    const texture=canvasTexture(768,Math.max(128,Math.round(768*h/w)),(ctx,cw,ch)=>{
      ctx.fillStyle=bg;ctx.fillRect(0,0,cw,ch);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=fg;
      ctx.font=`${serif?'500':'600'} ${Math.min(ch*(subtitle?.43:.54),cw/(text.length*.66+1))}px ${serif?'"Yu Mincho", "Hiragino Mincho ProN", serif':'"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif'}`;
      ctx.fillText(text,cw/2,ch*(subtitle?.43:.51));
      if(subtitle){ctx.globalAlpha=.78;ctx.font=`500 ${Math.min(ch*.14,25)}px sans-serif`;ctx.fillText(subtitle,cw/2,ch*.78);}
    });
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texture,roughness:.75,emissive:fg,emissiveIntensity:.025,side:THREE.DoubleSide}));
    mesh.position.set(x,y,z);mesh.rotation.y=ry;group.add(mesh);return mesh;
  }
  function line(x1,z1,x2,z2,y,r,mat){
    const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz);box((x1+x2)/2,y,(z1+z2)/2,r,r,len,mat,Math.atan2(dx,dz));
  }

  // Broad road plane, generous pavements and inset tactile paving.
  box(0,-.22,0,220,.42,240,concrete,0,false);
  box(0,.005,0,14,.035,220,asphalt,0,false);
  box(-11,.065,0,8,.14,202,sidewalk,0,false);box(11,.065,0,8,.14,202,sidewalk,0,false);
  for(const z of [-28,48]){box(0,.013,z,183,.045,12,asphalt,0,false);box(0,.07,z-8,183,.14,4,sidewalk,0,false);box(0,.07,z+8,183,.14,4,sidewalk,0,false);}
  for(const side of [-1,1]){
    for(const [start,end] of [[-101,-35],[-21,41],[55,101]]){
      box(side*7.04,.13,(start+end)/2,.22,.24,end-start,stone,0,false);
      box(side*12.75,.146,(start+end)/2,.32,.016,end-start,tactile,0,false);
      for(let z=start+4;z<end;z+=8)box(side*7.45,.15,z,.48,.018,.85,metal,0,false);
    }
  }
  for(let z=-98;z<102;z+=8){if(Math.abs(z+28)<11||Math.abs(z-48)<11)continue;box(0,.034,z,.11,.012,3.5,roadPaint,0,false);}
  for(const z of [-28,48]){
    for(let x=-80;x<=80;x+=8){if(Math.abs(x)<12)continue;box(x,.042,z,3.5,.012,.11,roadPaint,0,false);}
    for(const dz of [-8.6,8.6])for(let x=-5.9;x<6.1;x+=1.15)box(x,.038,z+dz,.67,.012,3.4,roadPaint,0,false);
    for(const x of [-11,11])for(let zz=z-4.7;zz<z+5;zz+=1.1)box(x,.047,zz,3.6,.012,.62,roadPaint,0,false);
    for(const dx of [-6.2,6.2]){box(dx,.04,z-11,1.1,.012,.18,roadPaint,0,false);box(dx,.04,z+11,1.1,.012,.18,roadPaint,0,false);}
  }
  // Shallow planting beds separate the sidewalks from building frontage.
  for(const side of [-1,1])for(const z of [-87,-40,20,88]){
    box(side*13.4,.32,z,2.4,.5,4.1,concrete);box(side*13.4,.59,z,2.15,.03,3.85,soil,0,false);
    for(let j=0;j<4;j++)sphere(side*13.4,.9,z-1.4+j*.9,.7,.48,.65,leafMats[j%5]);
  }

  function tree(x,z,size=1,variant=0){
    const height=3.5*size;
    cyl(x,height/2,z,.13*size,height,bark);
    for(let i=0;i<3;i++){let a=i*2.1+variant;let bx=x+Math.cos(a)*.45*size,bz=z+Math.sin(a)*.45*size;cyl(bx,height*.82,bz,.055*size,height*.47,bark,Math.sin(a)*.45,Math.cos(a)*.45);}
    sphere(x,height+1*size,z,1.7*size,1.6*size,1.6*size,leafMats[variant%5]);
    sphere(x+.9*size,height+.65*size,z-.2*size,1.1*size,1.1*size,1.25*size,leafMats[(variant+1)%5]);
    sphere(x-.75*size,height+.8*size,z+.65*size,1.2*size,1.15*size,1.12*size,leafMats[(variant+2)%5]);
    sphere(x+.1*size,height+1.75*size,z+.2*size,1.1*size,.9*size,1.05*size,leafMats[(variant+3)%5]);
    collider(x,z,.65*size,.65*size);
  }
  for(const side of [-1,1])for(const z of [-89,-40,20,88])tree(side*12.8,z,1.0+(z===20?.12:0),Math.abs(z)%5);
  function lamp(x,z,angle=0){
    cyl(x,2.7,z,.065,5.4,dark);cyl(x,.25,z,.16,.5,dark);
    const tx=x+Math.cos(angle)*.65,tz=z+Math.sin(angle)*.65;
    line(x,z,tx,tz,5.35,.08,dark);box(tx,5.3,tz,.7,.1,.38,dark,angle);box(tx,5.235,tz,.54,.025,.28,warmLight,angle);
  }
  for(const side of [-1,1])for(const z of [-95,-72,-43,17,79,97])lamp(side*7.9,z,side<0?0:Math.PI);
  for(const z of [-28,48])for(const x of [-62,-36,35,65])lamp(x,z+7,Math.PI*1.5);
  function bench(x,z,ry=0,id=null,title='街角のベンチ'){
    const cs=Math.cos(ry),sn=Math.sin(ry);const B=(lx,y,lz,w,h,d,mat)=>box(x+lx*cs+lz*sn,y,z-lx*sn+lz*cs,w,h,d,mat,ry);
    for(let k=0;k<4;k++)B(0,.58,-.27+k*.18,2.1,.1,.12,wood);
    for(let k=0;k<3;k++)B(0,.91+k*.16,.36,2.1,.11,.07,wood);
    for(const sx of [-.78,.78]){B(sx,.3,0,.08,.6,.68,dark);B(sx,.87,.38,.065,.72,.065,dark);B(sx,.77,0,.07,.07,.72,dark);}
    collider(x,z,Math.abs(cs)*2.25+Math.abs(sn)*.9,Math.abs(sn)*2.25+Math.abs(cs)*.9);
    if(id)interactables.push({id,kind:'bench',title,subtitle:'少し腰を下ろす',position:new THREE.Vector3(x-Math.sin(ry)*1.35,0,z-Math.cos(ry)*1.35),radius:2.8});
  }
  bench(12.6,25,Math.PI/2,'street-bench','並木通りのベンチ');bench(-12.6,-42,-Math.PI/2);

  // Local building axes: the facade lies on z=0; the volume extends backwards.
  function building(config){
    const {id,name,type,side,z,width=26,depth=22,height=12,wall=plaster,accent=dark}=config;
    const x=side*15,ry=side*Math.PI/2,cs=Math.cos(ry),sn=Math.sin(ry);
    const X=(lx,lz)=>x+lx*cs+lz*sn,Z=(lx,lz)=>z-lx*sn+lz*cs;
    const B=(lx,y,lz,w,h,d,mat=wall)=>box(X(lx,lz),y,Z(lx,lz),w,h,d,mat,ry);
    const S=(text,sub,w,h,lx,y,lz,bg,fg,serif=false)=>sign(text,sub,w,h,X(lx,lz),y,Z(lx,lz),ry+Math.PI,bg,fg,serif);
    B(0,height/2,depth/2,width,height,depth,wall);
    B(0,.23,depth/2,width+.26,.46,depth+.15,stone);
    B(0,height-.15,depth/2,width+.7,.35,depth+.6,pale);
    B(0,height+.12,depth/2,width+.22,.12,depth+.2,stone);
    B(0,height-1.05,depth/2,width+.2,.13,depth+.16,concrete);
    const frontage=width-2.1;
    // Dark glazing with wood reveals, transoms and a correctly scaled doorway.
    B(0,1.85,-.105,frontage,3.15,.14,storefront);
    for(let xx=-frontage/2;xx<=frontage/2+.01;xx+=frontage/7)B(xx,1.85,-.21,.085,3.25,.1,accent);
    B(0,.35,-.22,frontage,.12,.13,accent);B(0,3.43,-.22,frontage,.12,.13,accent);B(0,2.65,-.23,frontage,.07,.13,accent);
    B(0,1.47,-.28,1.65,2.8,.08,glass);
    B(-.85,1.46,-.36,.09,2.9,.12,accent);B(.85,1.46,-.36,.09,2.9,.12,accent);B(0,2.91,-.35,1.8,.1,.13,accent);
    B(.6,1.31,-.41,.035,.63,.05,bronze);
    B(0,.16,-.72,2.4,.12,1.3,stone);
    // Canopy and continuous sign fascia.
    B(0,3.72,-.65,width-.6,.18,1.7,accent);
    B(0,4.34,-.12,width-.9,.95,.24,wall);
    const bg= id==='cafe'?'#343c34':id==='market'?'#35665b':id==='bookstore'?'#3b5145':id==='gallery'?'#e7e5da':id==='office'?'#293f43':'#e7e1d4';
    const fg= id==='gallery'||id==='home'?'#354642':'#efe9d7';
    const subtitles={home:'HIKARI RESIDENCE',cafe:'KOMOREBI  ·  COFFEE & BAKES',market:'HIKARI MARKET  ·  EVERYDAY GOODS',office:'MACHI WORKS',gallery:'HIKARI GALLERY',bookstore:'HONDANA  ·  BOOKS & LIFE'};
    S(name,subtitles[id],Math.min(width-2.8,14),.85,0,4.34,-.26,bg,fg,id==='cafe'||id==='bookstore');
    const floors=Math.floor((height-4.9)/3);
    const cols=Math.floor((width-2.8)/3.1);
    for(let floor=0;floor<floors;floor++){
      const yy=6.12+floor*3;
      B(0,yy-1.15,-.12,width,.17,.24,concrete);
      for(let i=0;i<cols;i++){
        const xx=(i-(cols-1)/2)*3.18;
        B(xx,yy,-.14,2.18,1.8,.12,accent);
        B(xx,yy,-.22,2.04,1.64,.07,(i+floor)%4===0?windowLit:glass);
        B(xx,yy,-.28,.045,1.7,.06,accent);
        B(xx,yy-.94,-.32,2.4,.11,.6,pale);
        if(id==='home'){
          B(xx,yy-.98,-.93,2.65,.15,1.6,concrete);
          B(xx,yy-.4,-1.65,2.65,.065,.065,metal);
          B(xx,yy-.88,-1.65,2.65,.06,.06,metal);
          for(let j=-1;j<=1;j++)B(xx+j*.85,yy-.65,-1.65,.045,.55,.045,metal);
          if(i%3===0){B(xx+.75,yy-.7,-1.15,.55,.45,.45,cream);sphere(X(xx+.75,-1.15),yy-.34,Z(xx+.75,-1.15),.4,.42,.4,leafMats[i%5]);}
        }
      }
    }
    // Side walls retain windows, drainpipes and rooftop details.
    for(const ss of [-1,1]){
      for(let f=0;f<Math.max(floors,1);f++)for(let d=4;d<depth-2;d+=4.3){
        B(ss*(width/2+.04),6.1+f*3,d,.09,1.65,2.2,glass);
        B(ss*(width/2+.11),6.1+f*3,d,.04,1.7,.06,accent);
        B(ss*(width/2+.14),5.2+f*3,d,.24,.1,2.4,pale);
      }
      B(ss*(width/2-.28),height/2,-.08,.065,height,.065,metal);
    }
    B(width*.25,height+.55,depth*.6,3.8,1.1,2.2,concrete);
    B(width*.25,height+1.17,depth*.6,4,.12,2.4,metal);
    for(let j=0;j<4;j++)B(width*.25-1.35+j*.9,height+.58,depth*.6-1.11,.55,.75,.04,dark);
    // Reachable door position is outside the facade collision volume.
    const cx=X(0,depth/2),cz=Z(0,depth/2);
    collider(cx,cz,depth,width);
    const entrance={x:x-side*1.7,z,yaw:side===1?-Math.PI/2:Math.PI/2};
    buildings.push({id,name,type,x:cx,z:cz,w:depth,d:width,mapColor:config.mapColor||'#91a99a',entrance});
    interactables.push({id:'door-'+id,kind:'door',title:name,subtitle:'建物に入る',position:new THREE.Vector3(x-side*1.5,0,z),buildingId:id,radius:3.2});
    // Exterior planters flank each door without blocking access.
    for(const lx of [-3.5,3.5]){
      B(lx,.5,-.78,.72,.8,.72,concrete);
      sphere(X(lx,-.78),1.1,Z(lx,-.78),.55,.65,.55,leafMats[(Math.round(lx+4))%5]);
    }
    if(id==='cafe'){
      // Oak fin wall and a recessed terrace bring the cafe down to human scale.
      for(let lx=5;lx<width/2-1;lx+=.42)B(lx,1.82,-.34,.13,2.95,.18,cedar);
      for(const lx of [-6,-10]){
        const xx=X(lx,-2.4),zz=Z(lx,-2.4);
        cyl(xx,.82,zz,.7,.08,wood);cyl(xx,.44,zz,.055,.72,metal);collider(xx,zz,1.35,1.35);
        for(const off of [-1,1]){const xx2=X(lx,-2.4+off),zz2=Z(lx,-2.4+off);box(xx2,.48,zz2,.7,.08,.66,wood,ry);box(xx2,.8,zz2+Math.cos(ry)*off*.25,.7,.6,.07,wood,ry);cyl(xx2,.24,zz2,.035,.45,metal);}
      }
      S('COFFEE','OPEN  8:00 — 20:00',1.45,2.25,6,1.65,-.38,'#eadfc8','#3e5146');
    }
    if(id==='market'){
      B(0,3.53,-.8,width-.5,.16,.06,yellow);B(0,3.83,-.8,width-.5,.23,.06,green);
      S('新鮮な野菜・お弁当','暮らしに、ちょうどいい。',6,1.05,7,1.9,-.29,'#efead7','#39645a');
      B(-7,.63,-1.25,3,.9,.9,wood);
      for(let a=0;a<5;a++)for(let b=0;b<2;b++)sphere(X(-8.1+a*.48,-1.4+b*.35),1.15,Z(-8.1+a*.48,-1.4+b*.35),.2,.21,.2,leafMats[a%5]);
    }
    if(id==='gallery'){
      S('余白と、日々。','EXHIBITION  /  ADMISSION FREE',3.2,2.4,7,1.75,-.3,'#d3c5ae','#34423c',true);
      B(-7,1.8,-.32,4.3,2.5,.04,cream);
      S('暮らしのかたち','HIKARI ART COLLECTION',3.9,2.1,-7,1.8,-.36,'#b8c6bd','#35483e',true);
    }
    if(id==='bookstore'){
      for(const lx of [-8,7]){B(lx,.65,-1.2,2.4,1.1,.8,wood);for(let j=0;j<9;j++)B(lx-1.05+j*.25,1.35,-1.2,.17,.45+(j%3)*.07,.4,[cream,green,brick][j%3]);}
      S('本と、暮らす。','文庫・雑誌・新刊',4.2,1.7,6.8,2.25,-.3,'#e2dac6','#33483c',true);
    }
  }
  building({id:'gallery',name:'ひかりギャラリー',type:'gallery',side:1,z:-64,width:27,depth:23,height:9,wall:concrete,accent:bronze,mapColor:'#c1b7a0'});
  building({id:'cafe',name:'こもれび喫茶',type:'cafe',side:1,z:-4,width:30,depth:22,height:11.8,wall:cream,accent:dark,mapColor:'#aa9873'});
  building({id:'home',name:'ひかりレジデンス',type:'home',side:1,z:68,width:24,depth:23,height:17.5,wall:plaster,accent:dark,mapColor:'#83a99d'});
  building({id:'office',name:'まちワークス',type:'office',side:-1,z:-64,width:27,depth:25,height:21,wall:pale,accent:dark,mapColor:'#8d9fa8'});
  building({id:'bookstore',name:'本棚書店',type:'bookstore',side:-1,z:-4,width:30,depth:22,height:12,wall:brick,accent:dark,mapColor:'#b48d77'});
  building({id:'market',name:'ひかりマート',type:'market',side:-1,z:68,width:24,depth:22,height:9,wall:plaster,accent:green,mapColor:'#84a68b'});

  // Additional architecture encloses the walkable district without filling the park.
  function backgroundBuilding(x,z,w,d,h,color,frontSign){
    const wall=material('bg-'+x+'-'+z,color);
    box(x,h/2,z,w,h,d,wall);box(x,h+.12,z,w+.35,.28,d+.35,pale);
    collider(x,z,w,d);
    const step=3.7;
    for(let y=3;y<h-1;y+=3.15)for(let a=-w/2+2;a<w/2-1;a+=step){
      box(x+a,y,z-d/2-.045,2,1.65,.08,glass);box(x+a,y-.9,z-d/2-.16,2.2,.08,.35,pale);
      box(x+a,y,z+d/2+.045,2,1.65,.08,glass);
    }
    for(let y=3;y<h-1;y+=3.15)for(let a=-d/2+2;a<d/2-1;a+=step){box(x-w/2-.04,y,z+a,.08,1.65,2,glass);box(x+w/2+.04,y,z+a,.08,1.65,2,glass);}
    if(frontSign)sign(frontSign,'HIKARI NEIGHBORHOOD',Math.min(w-2,10),1.15,x,2.4,z-d/2-.12,Math.PI,'#dbd5c6','#40514a');
  }
  backgroundBuilding(-61,-68,25,25,18,'#c8c6b9','花と緑');
  backgroundBuilding(-62,-3,26,27,15,'#d4ccbb','ひかり生活館');
  backgroundBuilding(-63,76,28,33,22,'#babeb9','暮らしの道具');
  backgroundBuilding(62,-72,31,30,15,'#d3d2c7','ひかり図書室');
  backgroundBuilding(65,80,31,30,20,'#bdc3bc','アトリエ');
  for(const [x,z,w,d,h] of [[-90,-92,17,20,33],[-90,-5,18,26,26],[-90,87,22,25,31],[84,-95,24,22,29],[88,90,23,23,35],[-46,-108,21,16,24],[45,-110,19,20,32],[0,-122,31,22,28],[0,121,30,20,32]]){
    backgroundBuilding(x,z,w,d,h,['#bec6c0','#bac3c1','#cad0c8'][Math.floor(rnd()*3)]);
  }

  // A real park-sized garden with a central fountain, winding planting and seating.
  box(62,.075,10,39,.16,57,grass,0,false);
  box(42.9,.14,10,.3,.25,57,stone);box(81.2,.14,10,.3,.25,57,stone);
  box(62,.14,-18.4,38,.25,.3,stone);box(62,.14,38.4,38,.25,.3,stone);
  box(61.5,.17,10,4.5,.05,57,sidewalk,0,false);box(62,.17,8,39,.05,4.5,sidewalk,0,false);box(61.5,.18,8,17,.04,17,sidewalk,0,false);
  const fountain=new THREE.Group();group.add(fountain);
  function disc(radius,height,y,mat){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,48),mat);mesh.position.set(61.5,y,8);mesh.receiveShadow=true;mesh.castShadow=true;fountain.add(mesh);return mesh;}
  disc(4,.3,.32,stone);disc(3.6,.34,.45,pale);disc(3.31,.05,.635,water);disc(.72,.95,1.05,stone);disc(1.8,.16,1.55,pale);disc(1.6,.025,1.65,water);
  collider(61.5,8,8.1,8.1);
  const ripples=[];
  for(let i=0;i<3;i++){const mesh=new THREE.Mesh(new THREE.TorusGeometry(1.3+i*.6,.018,5,64),new THREE.MeshBasicMaterial({color:'#c2e2d7',transparent:true,opacity:.4}));mesh.rotation.x=-Math.PI/2;mesh.position.set(61.5,.67,8);fountain.add(mesh);ripples.push(mesh);}
  const jet=new THREE.Mesh(new THREE.CylinderGeometry(.035,.07,1.25,10),new THREE.MeshBasicMaterial({color:'#d2e9e3',transparent:true,opacity:.65}));jet.position.set(61.5,2.28,8);fountain.add(jet);
  for(const [x,z,k] of [[46,-12,1],[53,-12,0],[70,-12,3],[77,-11,1],[46,1,4],[77,1,2],[46,18,2],[77,17,3],[48,31,0],[55,32,2],[69,32,3],[77,31,1]])tree(x,z,1.25+(k%2)*.15,k);
  for(const [x,z] of [[48,-4],[76,-4],[48,24],[75,24]]){box(x,.32,z,3.8,.5,2.5,concrete);box(x,.59,z,3.6,.02,2.3,soil,0,false);for(let j=0;j<5;j++)sphere(x-1.3+j*.65,.91,z,.7,.46,.7,leafMats[j]);}
  bench(53.6,8,Math.PI/2,'park-bench','ひかり公園のベンチ');bench(69.4,8,-Math.PI/2,'park-bench-east','噴水のそばのベンチ');bench(61.5,24,0,'park-bench-north','木陰のベンチ');
  sign('ひかり公園','HIKARI PARK',3.4,.85,61.5,1.6,37.8,0,'#426457','#f2ead8',true);cyl(60.1,.9,37.8,.055,1.7,metal);cyl(62.9,.9,37.8,.055,1.7,metal);
  for(const [x,z] of [[46,-16],[78,-16],[46,35],[78,35]])lamp(x,z,Math.PI/2);
  // Long boundary hedges, occasional flower beds and low garden fencing.
  for(let z=-95;z<98;z+=4){for(const x of [-85.5,85.5])sphere(x,.7,z,1.1,.85,2.25,leafMats[Math.floor(Math.abs(z))%5]);}
  for(let x=-81;x<84;x+=5){sphere(x,.7,-98.5,2.7,.85,1.3,leafMats[2]);sphere(x,.7,98.5,2.7,.85,1.3,leafMats[1]);}
  // Side-street infrastructure and parking bays, with visible drains and bollards.
  for(const z of [-39,59])for(const x of [-77,-47,47,78]){cyl(x,.65,z,.1,1.25,dark);cyl(x,1.1,z,.11,.1,bronze);}
  for(const z of [-28,48])for(const x of [-16,16]){
    cyl(x,2.65,z+7,.07,5.3,metal);box(x,4.55,z+7,.42,.93,.31,dark);
    for(let i=0;i<3;i++)sphere(x,4.84-i*.29,z+6.82,.095,.095,.035,i===2?material('signal-green-'+x+'-'+z,'#80b9a2',{emissive:'#59ae8a',emissiveIntensity:.5}):black);
  }
  for(const [x,z] of [[-10.7,-18],[10.7,38]]){
    cyl(x,1.5,z,.035,3,dark);sign('ひかり町','並木通り',1.6,.63,x,2.8,z,Math.PI/2,'#4d776a','#f2f0df');
  }
  function vending(x,z){
    box(x,1.15,z,.85,2.2,1.3,pale);box(x-.46,1.38,z,.035,1.45,1.12,glass);
    for(let row=0;row<3;row++)for(let col=0;col<4;col++){
      const zz=z-.4+col*.26;box(x-.49,1.8-row*.32,zz,.05,.21,.14,[green,cream,brick][col%3]);
      sphere(x-.52,1.62-row*.32,zz,.025,.025,.025,warmLight);
    }
    box(x-.48,.38,z,.04,.23,.75,dark);sign('DRINKS','¥140 —',1.08,.22,x-.48,2.12,z,Math.PI*1.5,'#e1e3d9','#3d6858');
    collider(x,z,.95,1.4);interactables.push({id:'vending',kind:'vending',title:'街角の自動販売機',subtitle:'飲み物を買う',position:new THREE.Vector3(x-1,0,z),radius:2.7});
  }
  vending(13.3,15.7);
  // Bicycles outside the bookstore: light frames with fine spokes and rounded tyres.
  for(let i=0;i<3;i++){
    const bx=-13.8,bz=13+i*1.6;
    const bike=new THREE.Group();bike.position.set(bx,0,bz);bike.rotation.y=-.25;
    const tyreMat=black,frameMat=[green,metal,bronze][i];
    for(const dx of [-.7,.7]){
      const wheel=new THREE.Mesh(new THREE.TorusGeometry(.36,.035,7,24),tyreMat);wheel.position.set(dx,.5,0);bike.add(wheel);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.33,.009,5,24),metal);rim.position.copy(wheel.position);bike.add(rim);
    }
    function rod(ax,ay,bx2,by){const a=new THREE.Vector3(ax,ay,0),b=new THREE.Vector3(bx2,by,0),mesh=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,a.distanceTo(b),7),frameMat);mesh.position.copy(a.add(b).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(bx2-ax,by-ay,0).normalize());bike.add(mesh);}
    rod(-.7,.5,-.23,1);rod(-.23,1,0,.52);rod(0,.52,-.7,.5);rod(-.23,1,.44,1);rod(.44,1,0,.52);rod(.44,1,.7,.5);rod(.44,1,.42,1.2);
    const seat=new THREE.Mesh(new THREE.BoxGeometry(.3,.065,.16),black);seat.position.set(-.25,1.08,0);bike.add(seat);group.add(bike);
  }

  // Flush all static geometry into compact material batches.
  for(const b of batches.values()){
    const mesh=new THREE.InstancedMesh(b.geo,b.mat,b.matrices.length);
    for(let i=0;i<b.matrices.length;i++)mesh.setMatrixAt(i,b.matrices[i]);
    mesh.castShadow=b.cast;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
  }

  const vehicles=[];
  const carPaints=['#dddace','#496868','#b8b3a4','#3e505a'];
  const carGeos={body:new THREE.BoxGeometry(1.65,.62,3.55),cabin:new THREE.BoxGeometry(1.46,.65,1.85),glass:new THREE.BoxGeometry(1.48,.46,1.7),wheel:new THREE.CylinderGeometry(.31,.31,.19,16)};
  function makeCar(index,x,z,direction){
    const c=new THREE.Group();c.position.set(x,0,z);c.rotation.y=direction<0?Math.PI:0;
    const paint=new THREE.MeshStandardMaterial({color:carPaints[index%carPaints.length],roughness:.28,metalness:.35});
    function mesh(geo,mat,xx,y,zz){const o=new THREE.Mesh(geo,mat);o.position.set(xx,y,zz);o.castShadow=true;o.receiveShadow=true;c.add(o);return o;}
    mesh(carGeos.body,paint,0,.63,0);mesh(carGeos.glass,glass,0,1.13,-.12);mesh(carGeos.cabin,paint,0,1.17,-.12).scale.set(1,.13,1);
    mesh(new THREE.BoxGeometry(1.5,.05,1.76),paint,0,1.43,-.12);
    for(const xx of [-.74,.74])for(const zz of [-1.15,1.15]){const w=mesh(carGeos.wheel,black,xx,.37,zz);w.rotation.z=Math.PI/2;}
    for(const xx of [-.55,.55]){mesh(new THREE.BoxGeometry(.35,.14,.055),warmLight,xx,.73,1.79);mesh(new THREE.BoxGeometry(.3,.12,.055),material('taillight-'+index+'-'+xx,'#9c4c43'),xx,.74,-1.79);}
    mesh(new THREE.BoxGeometry(.4,.17,.04),pale,0,.5,1.8);mesh(new THREE.BoxGeometry(1.2,.16,.04),dark,0,.51,1.8);
    group.add(c);vehicles.push({group:c,speed:5.2+index*.8,direction,z});
  }
  makeCar(0,-3.6,14,1);makeCar(1,3.5,-13,-1);makeCar(2,-3.6,-70,1);makeCar(3,3.5,80,-1);

  // Rounded, articulated residents move at a pedestrian pace along the sidewalks.
  const residents=[];
  const skin=new THREE.MeshStandardMaterial({color:'#c79c7e',roughness:.92});
  const hair=new THREE.MeshStandardMaterial({color:'#37312d',roughness:1});
  const faceGeo=new THREE.SphereGeometry(.13,14,10);
  const torsoGeo=new THREE.CapsuleGeometry(.19,.34,5,10);
  const limbGeo=new THREE.CapsuleGeometry(.055,.39,4,8);
  const pantsMat=new THREE.MeshStandardMaterial({color:'#465050',roughness:.96});
  const shoeGeo=new THREE.BoxGeometry(.11,.09,.24);
  function person(index,x,z,stationary=false){
    const p=new THREE.Group();p.position.set(x,.12,z);
    const shirt=new THREE.MeshStandardMaterial({color:['#c2b497','#577b74','#7c8c99','#b2aa91','#aa836d','#666c66'][index%6],roughness:1});
    const add=(geo,mat,xx,y,zz)=>{const o=new THREE.Mesh(geo,mat);o.position.set(xx,y,zz);o.castShadow=true;p.add(o);return o;};
    add(torsoGeo,shirt,0,1.08,0);
    add(faceGeo,skin,0,1.57,0);const cap=add(new THREE.SphereGeometry(.14,14,8,0,Math.PI*2,0,Math.PI*.6),hair,0,1.6,-.015);cap.rotation.x=-.15;
    const nose=add(new THREE.SphereGeometry(.027,8,6),skin,0,1.56,.125);
    const armL=add(limbGeo,shirt,-.24,.99,0),armR=add(limbGeo,shirt,.24,.99,0);
    const legL=add(limbGeo,pantsMat,-.1,.44,0),legR=add(limbGeo,pantsMat,.1,.44,0);
    add(shoeGeo,black,-.1,.095,.045);add(shoeGeo,black,.1,.095,.045);
    const talk={id:'resident-'+index,kind:'npc',title:['街の住人・あおい','街の住人・蓮','街の住人・はるか','街の住人・悠斗','街の住人・さくら','街の住人・大地'][index%6],subtitle:'声をかける',position:new THREE.Vector3(x,0,z),radius:2.5};
    group.add(p);interactables.push(talk);residents.push({group:p,x,z,stationary,speed:.5+(index%3)*.12,direction:index%2?1:-1,phase:index*1.5,armL,armR,legL,legR,talk});
  }
  person(0,9.6,-12);person(1,-10.5,-49);person(2,10,-75);person(3,-10.6,27);person(4,10.5,77);person(5,55,24,true);person(6,71,-5,true);

  let elapsed=0,lastNight=-1;
  function update(dt,hour=10){
    elapsed+=Math.min(dt,.1);
    for(const c of vehicles){
      const signalPhase=(elapsed%22);let speed=c.speed;
      // Cars slow briefly before the two marked crossings, then continue.
      for(const crossing of [-28,48]){const ahead=(crossing-c.group.position.z)*c.direction;if(ahead>8&&ahead<14&&signalPhase<5)speed*=.04;}
      c.group.position.z+=speed*dt*c.direction;
      if(c.group.position.z>105)c.group.position.z=-105;if(c.group.position.z<-105)c.group.position.z=105;
    }
    for(const r of residents){
      if(!r.stationary){
        r.group.position.z+=r.speed*dt*r.direction;if(r.group.position.z>92)r.direction=-1;if(r.group.position.z<-92)r.direction=1;
        r.group.rotation.y=r.direction>0?0:Math.PI;
        const a=Math.sin(elapsed*4+r.phase)*.35;r.armL.rotation.x=a;r.armR.rotation.x=-a;r.legL.rotation.x=-a;r.legR.rotation.x=a;
        r.group.position.y=.12+Math.abs(Math.sin(elapsed*4+r.phase))*.015;
      }else{r.group.rotation.y=Math.sin(elapsed*.13+r.phase)*.3;r.group.position.y=.12+Math.sin(elapsed*1.3+r.phase)*.005;}
      r.talk.position.set(r.group.position.x,0,r.group.position.z);
    }
    for(let i=0;i<ripples.length;i++){const scale=1+Math.sin(elapsed*1.4-i)*.06;ripples[i].scale.set(scale,scale,1);ripples[i].material.opacity=.22+Math.sin(elapsed*1.2-i)*.1;}
    jet.scale.y=1+Math.sin(elapsed*2)*.05;
    const night=hour<6||hour>=18?1:0;
    if(night!==lastNight){warmLight.emissiveIntensity=night?2:.5;windowLit.emissiveIntensity=night?.8:.07;glass.emissiveIntensity=night?.25:.16;lastNight=night;}
  }
  return {group,colliders,interactables,buildings,bounds,spawn,update};
}
