import {placeHumanoidFoot} from './model-motion.js';
/** Local articulated avatars. Image reconstruction is an approximate visual hull,
 * not a recovered scan: unseen surfaces and joints are estimated explicitly. */
export function createAvatar(THREE) {
  const group = new THREE.Group();
  group.name = 'MACHI playable character';
  let current, phase = 0, idleTime = 0, importSequence = 0;
  let style = {shirt:'#d7d6ce',pants:'#222e3c',skin:'#bd9278',hair:'#302722',shoes:'#dbe0e2'};
  const qualityTable = {
    standard:{radial:36,rings:24,maxImage:1024},
    high:{radial:64,rings:42,maxImage:1280},
    ultra:{radial:88,rings:62,maxImage:1536},
    cinematic:{radial:192,rings:154,maxImage:2048}
  };
  const presets={ivory:{shirt:'#d7d6ce',pants:'#222e3c'},navy:{shirt:'#2a4160',pants:'#95958d'},sage:{shirt:'#73827c',pants:'#27313c'},black:{shirt:'#293342',pants:'#171e29'}};
  const material=(color,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  function addMesh(parent,geometry,mat,x=0,y=0,z=0,sx=1,sy=1,sz=1){
    const o=new THREE.Mesh(geometry,mat);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  function ellipsoid(parent,x,y,z,rx,ry,rz,mat){return addMesh(parent,new THREE.SphereGeometry(1,36,26),mat,x,y,z,rx,ry,rz);}
  function block(parent,x,y,z,w,h,d,mat){return addMesh(parent,new THREE.BoxGeometry(w,h,d),mat,x,y,z);}
  function skeleton(){
    const root=new THREE.Group(), body=new THREE.Group();root.add(body);
    const pivot=(parent,x,y,z=0)=>{const p=new THREE.Group();p.position.set(x,y,z);parent.add(p);return p;};
    const torso=pivot(body,0,1.43), head=pivot(body,0,1.74), neck=pivot(body,0,1.48), pelvis=pivot(body,0,.97);
    const arms=[-1,1].map(side=>{const upper=pivot(body,side*.255,1.38);const lower=pivot(upper,0,-.285);const hand=pivot(lower,0,-.27);return{upper,lower,hand,side};});
    const legs=[-1,1].map(side=>{const upper=pivot(body,side*.105,.81);const lower=pivot(upper,0,-.38);const foot=pivot(lower,0,-.33,-.025);return{upper,lower,foot,side};});
    return{root,body,torso,head,neck,pelvis,arms,legs,kind:'default'};
  }
  function softSegment(length,rx,rz,top=.88,bottom=.92){
    const rings=30,radial=48,positions=[],uvs=[],indices=[];
    for(let i=0;i<=rings;i++){
      const t=i/rings;const edge=t<.12?top+(1-top)*t/.12:t>.88?1+(bottom-1)*(t-.88)/.12:1;
      const waist=1-.055*Math.sin(Math.PI*t);
      for(let j=0;j<=radial;j++){const a=j/radial*Math.PI*2;positions.push(Math.cos(a)*rx*edge*waist,-length*t,Math.sin(a)*rz*edge*waist);uvs.push(j/radial,1-t);}
    }
    for(let i=0;i<rings;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+1,c=a+radial+1,d=c+1;indices.push(a,b,c,b,d,c);}
    for(const end of [0,rings]){const center=positions.length/3;positions.push(0,-length*end/rings,0);uvs.push(.5,.5);for(let j=0;j<radial;j++){const a=end*(radial+1)+j,b=a+1;if(end===0)indices.push(center,b,a);else indices.push(center,a,b);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function surfaceTexture(kind){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d'),data=ctx.createImageData(256,256);let seed=907;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      seed=(seed*16807)%2147483647;const noise=(seed%1000)/1000;
      const weave=kind==='cloth'?((x%4===0||y%4===0)?-15:0):0;
      const v=Math.max(0,Math.min(255,239+noise*16+weave));const p=(y*256+x)*4;
      data.data[p]=data.data[p+1]=data.data[p+2]=v;data.data[p+3]=255;
    }
    ctx.putImageData(data,0,0);const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='cloth'?7:2,kind==='cloth'?8:2);t.anisotropy=4;return t;
  }
  function tube(parent,points,radius,mat,segments=18,sides=7){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    return addMesh(parent,new THREE.TubeGeometry(curve,segments,radius,sides,false),mat);
  }
  function roundPatch(parent,points,depth,mat,z){
    const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.0015,bevelSize:.0015,bevelSegments:3,steps:1,curveSegments:12});
    return addMesh(parent,geo,mat,0,0,z-depth/2);
  }
  function consolidatePart(parent){
    // Merge static detail on EACH animated joint, preserving articulation while
    // avoiding hundreds of extra draw calls for hair, seams and finger details.
    const buckets=new Map();
    for(const mesh of [...parent.children])if(mesh.isMesh&&!Array.isArray(mesh.material)){
      if(!buckets.has(mesh.material))buckets.set(mesh.material,[]);buckets.get(mesh.material).push(mesh);
    }
    for(const [mat,meshes] of buckets){
      if(meshes.length<2)continue;
      const positions=[],normals=[],uvs=[],indices=[];let offset=0;
      for(const mesh of meshes){
        mesh.updateMatrix();const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrix),g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv;
        const vertex=new THREE.Vector3(),normal=new THREE.Vector3();
        for(let i=0;i<p.count;i++){
          vertex.fromBufferAttribute(p,i).applyMatrix4(mesh.matrix);positions.push(vertex.x,vertex.y,vertex.z);
          if(n)normal.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();else normal.set(0,1,0);normals.push(normal.x,normal.y,normal.z);
          uvs.push(u?u.getX(i):0,u?u.getY(i):0);
        }
        if(g.index)for(const index of g.index.array)indices.push(index+offset);else for(let i=0;i<p.count;i++)indices.push(i+offset);
        offset+=p.count;mesh.removeFromParent();g.dispose();
      }
      const merged=new THREE.BufferGeometry();merged.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));merged.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));merged.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));merged.setIndex(indices);merged.computeBoundingSphere();addMesh(parent,merged,mat);
    }
  }
  function procedural(){
    const rig=skeleton(),clothMap=surfaceTexture('cloth'),pores=surfaceTexture('skin');
    const shirt=new THREE.MeshPhysicalMaterial({color:style.shirt,roughness:.89,metalness:0,map:clothMap,bumpMap:clothMap,bumpScale:.00065,sheen:.24,sheenRoughness:.85,sheenColor:new THREE.Color('#d8e0e8')});
    const pants=new THREE.MeshPhysicalMaterial({color:style.pants,roughness:.91,metalness:0,bumpMap:clothMap,bumpScale:.00045,sheen:.12,sheenRoughness:.92});
    const skin=new THREE.MeshPhysicalMaterial({color:style.skin,roughness:.61,metalness:0,bumpMap:pores,bumpScale:.00023,clearcoat:.035,clearcoatRoughness:.64,sheen:.13,sheenRoughness:.8,sheenColor:new THREE.Color('#e1b296')});
    const hair=new THREE.MeshPhysicalMaterial({color:style.hair,roughness:.48,metalness:0,clearcoat:.1,clearcoatRoughness:.45});
    const hairLight=material(new THREE.Color(style.hair).multiplyScalar(1.23),.53),hairDark=material(new THREE.Color(style.hair).multiplyScalar(.76),.56);
    const shoes=new THREE.MeshPhysicalMaterial({color:style.shoes,roughness:.52,clearcoat:.12,clearcoatRoughness:.55});
    const sole=material('#737d87',.86),tee=material('#e5e7e4',.94),stitch=material(new THREE.Color(style.shirt).multiplyScalar(.76),.87),dark=material('#343b42',.52),metal=material('#8f9ca9',.3,.72);
    const lip=material('#9d6f60',.7),innerSkin=material(new THREE.Color(style.skin).multiplyScalar(.74),.83),nail=material('#c8b5a7',.49);
    const white=new THREE.MeshPhysicalMaterial({color:'#d8d8cd',roughness:.34,clearcoat:.6,clearcoatRoughness:.1}),iris=material('#514335',.3),pupil=material('#111c25',.22),glint=material('#edf5ff',.16);
    // Tailored overshirt: layered collar, pocket, placket, buttons and seams.
    addMesh(rig.torso,softSegment(.53,.222,.12,.89,.96),shirt);
    addMesh(rig.pelvis,softSegment(.18,.18,.116,.99,.97),pants);
    addMesh(rig.neck,softSegment(.12,.059,.057,.94,.97),skin);
    roundPatch(rig.torso,[[-.037,-.012],[.037,-.012],[.038,-.49],[-.037,-.49]],.005,tee,-.121);
    for(const side of [-1,1]){
      roundPatch(rig.torso,[[side*.025,-.005],[side*.082,-.009],[side*.117,-.108],[side*.065,-.077],[side*.032,-.14]],.006,shirt,-.123);
      tube(rig.torso,[[side*.048,-.14,-.125],[side*.048,-.32,-.123],[side*.049,-.51,-.115]],.0011,stitch,15,5);
      tube(rig.torso,[[side*.19,-.08,-.043],[side*.211,-.27,-.013],[side*.21,-.5,-.006]],.00125,stitch,18,6);
    }
    roundPatch(rig.torso,[[-.173,-.16],[-.077,-.16],[-.077,-.26],[-.124,-.275],[-.173,-.26]],.004,shirt,-.106);
    tube(rig.torso,[[-.171,-.162,-.112],[-.125,-.166,-.126],[-.079,-.162,-.119]],.0014,stitch,10,5);
    for(let y=-.15;y>-.5;y-=.087){const b=addMesh(rig.torso,new THREE.CylinderGeometry(.005,.005,.0035,18),metal,.048,y,-.132);b.rotation.x=Math.PI/2;for(const dx of [-.0014,.0014])ellipsoid(rig.torso,.048+dx,y,-.1345,.0007,.0007,.0006,dark);}
    tube(rig.torso,[[-.19,-.515,-.037],[0,-.525,-.113],[.19,-.515,-.037]],.0012,stitch,24,5);
    // A subtly sculpted head rather than a featureless sphere.
    const faceGeometry=new THREE.SphereGeometry(1,68,44),facePosition=faceGeometry.attributes.position;
    for(let i=0;i<facePosition.count;i++){
      const x=facePosition.getX(i),y=facePosition.getY(i),z=facePosition.getZ(i);
      const jaw=y<-.3?1-(Math.abs(y)-.3)*.16:1;const cheek=z<0?Math.exp(-((y+.08)**2)/.1)*Math.exp(-((Math.abs(x)-.58)**2)/.1)*.004:0;
      facePosition.setXYZ(i,x*.108*jaw,-.151+y*.132,z*.1-cheek);
    }
    faceGeometry.computeVertexNormals();addMesh(rig.head,faceGeometry,skin);
    for(const side of [-1,1]){
      ellipsoid(rig.head,side*.108,-.153,.006,.018,.032,.025,skin);
      ellipsoid(rig.head,side*.113,-.154,-.002,.009,.019,.011,innerSkin);
      tube(rig.head,[[side*.113,-.128,.002],[side*.121,-.141,.008],[side*.121,-.164,.004],[side*.112,-.177,-.003]],.0031,skin,15,7);
      // Eye rims, iris, pupil and a small catchlight.
      ellipsoid(rig.head,side*.041,-.126,-.091,.02,.010,.009,innerSkin);
      ellipsoid(rig.head,side*.041,-.126,-.096,.0175,.0072,.008,white);
      ellipsoid(rig.head,side*.041,-.126,-.103,.0069,.0064,.0027,iris);
      ellipsoid(rig.head,side*.041,-.126,-.105,.0033,.0042,.0015,pupil);
      ellipsoid(rig.head,side*.038,-.123,-.106,.0012,.0013,.0006,glint);
      const eyeX=side*.041;
      tube(rig.head,[[eyeX-.017,-.127,-.098],[eyeX,-.119,-.103],[eyeX+.017,-.127,-.098]],.0015,skin,14,6);
      tube(rig.head,[[eyeX-.016,-.128,-.098],[eyeX,-.133,-.101],[eyeX+.016,-.128,-.098]],.0011,skin,14,6);
      tube(rig.head,[[eyeX-side*.018,-.109,-.095],[eyeX,-.102,-.099],[eyeX+side*.017,-.107,-.093]],.0022,hairDark,14,6);
      for(let i=0;i<6;i++){const bx=eyeX-.013+i*.005;tube(rig.head,[[bx,-.104,-.099],[bx+side*.003,-.1,-.098]],.00065,hairLight,4,4);}
    }
    ellipsoid(rig.head,0,-.154,-.097,.009,.027,.013,skin);
    ellipsoid(rig.head,0,-.179,-.113,.012,.011,.015,skin);
    for(const side of [-1,1]){ellipsoid(rig.head,side*.012,-.185,-.108,.008,.006,.01,skin);ellipsoid(rig.head,side*.009,-.19,-.111,.0035,.0018,.0038,innerSkin);}
    tube(rig.head,[[-.026,-.212,-.084],[-.011,-.21,-.097],[0,-.213,-.1],[.011,-.21,-.097],[.026,-.212,-.084]],.0018,lip,24,7);
    ellipsoid(rig.head,0,-.217,-.093,.021,.0034,.004,lip);
    tube(rig.head,[[-.024,-.213,-.085],[0,-.214,-.099],[.024,-.213,-.085]],.0007,innerSkin,18,5);
    // Contoured scalp with swept, individually modelled hair strands.
    const hairPositions=[],hairUV=[],hairIndices=[],hairRings=34,hairRadial=72;
    for(let i=0;i<=hairRings;i++)for(let j=0;j<=hairRadial;j++){
      const a=j/hairRadial*Math.PI*2,front=Math.max(0,-Math.sin(a)),theta=i/hairRings*(1.87-front*.64),s=Math.sin(theta),c=Math.cos(theta);
      hairPositions.push(Math.cos(a)*s*.113,-.132+c*.157,.009+Math.sin(a)*s*.105);hairUV.push(j/hairRadial,i/hairRings);
    }
    for(let i=0;i<hairRings;i++)for(let j=0;j<hairRadial;j++){const a=i*(hairRadial+1)+j,b=a+1,c=a+hairRadial+1,d=c+1;hairIndices.push(a,c,b,b,c,d);}
    const scalp=new THREE.BufferGeometry();scalp.setAttribute('position',new THREE.Float32BufferAttribute(hairPositions,3));scalp.setAttribute('uv',new THREE.Float32BufferAttribute(hairUV,2));scalp.setIndex(hairIndices);scalp.computeVertexNormals();addMesh(rig.head,scalp,hair);
    for(let i=0;i<64;i++){
      const s=i/63,x=-.097+s*.194,arch=Math.sin(Math.PI*s),mat=i%5===0?hairLight:i%3===0?hairDark:hair;
      tube(rig.head,[[x,-.072+arch*.013,-.078+Math.abs(x)*.25],[x-.018,.002+arch*.02,-.062],[x*.62-.015,.031+arch*.004,.005],[x*.5,-.009,.084]],.0013+(i%4)*.00037,mat,18,6);
    }
    for(const side of [-1,1])for(let i=0;i<9;i++){const z=-.035+i*.011;tube(rig.head,[[side*.095,-.07,z-.012],[side*.108,-.104,z],[side*.103,-.141,z+.008]],.0012,i%3?hair:hairLight,10,5);}
    // Articulated sleeves, rolled cuffs and separate fingers and nails.
    rig.arms.forEach(a=>{
      addMesh(a.upper,softSegment(.29,.071,.07,.88,.94),shirt);addMesh(a.lower,softSegment(.27,.061,.063,.97,.78),shirt);
      addMesh(a.lower,softSegment(.037,.054,.058,1,1),shirt,0,-.23);addMesh(a.lower,softSegment(.005,.055,.059,1,1),stitch,0,-.236);
      tube(a.upper,[[a.side*.05,-.02,.012],[a.side*.064,-.15,.008],[a.side*.054,-.275,.006]],.001,stitch,16,5);
      tube(a.lower,[[a.side*.051,-.015,.008],[a.side*.048,-.145,.008],[a.side*.043,-.252,.005]],.001,stitch,16,5);
      ellipsoid(a.hand,0,-.027,0,.036,.044,.021,skin);
      for(let i=0;i<4;i++){
        const x=-.026+i*.0175,len=[.041,.052,.048,.037][i];const finger=addMesh(a.hand,new THREE.CapsuleGeometry(.0073,len-.0146,7,14),skin,x,-.058-len/2,.001);finger.rotation.x=.055;
        ellipsoid(a.hand,x,-.057,.001,.0083,.009,.01,skin);ellipsoid(a.hand,x,-.058-len+.009,.008,.005,.0075,.0015,nail);
      }
      const thumb=addMesh(a.hand,new THREE.CapsuleGeometry(.009,.03,7,14),skin,-a.side*.033,-.037,-.003);thumb.rotation.z=-a.side*.51;
      a.upper.rotation.z=a.side*.065;
      if(a.side<0){const strap=addMesh(a.lower,new THREE.TorusGeometry(.051,.0065,8,32),dark,0,-.246,0);strap.rotation.x=Math.PI/2;const watch=addMesh(a.lower,new THREE.CylinderGeometry(.021,.021,.006,32),metal,0,-.246,-.058);watch.rotation.x=Math.PI/2;const dial=addMesh(a.lower,new THREE.CircleGeometry(.018,32),dark,0,-.246,-.0615);dial.rotation.y=Math.PI;tube(a.lower,[[0,-.246,-.062],[-.009,-.24,-.062]],.0007,tee,3,4);}
    });
    // Tapered trousers, piping, ankle hems, layered soles and stitched sneakers.
    rig.legs.forEach(l=>{
      addMesh(l.upper,softSegment(.39,.091,.096,.99,.82),pants);addMesh(l.lower,softSegment(.34,.072,.079,.99,.79),pants);
      tube(l.upper,[[l.side*.081,-.015,.005],[l.side*.087,-.19,.005],[l.side*.073,-.375,.004]],.0011,dark,20,5);
      tube(l.lower,[[l.side*.069,-.008,.004],[l.side*.065,-.17,.003],[l.side*.055,-.325,.004]],.001,dark,18,5);
      addMesh(l.lower,softSegment(.017,.058,.066,1,1),pants,0,-.32);
      ellipsoid(l.foot,0,-.033,-.044,.085,.058,.155,shoes);ellipsoid(l.foot,0,-.072,-.045,.089,.023,.159,sole);
      ellipsoid(l.foot,0,-.056,-.045,.088,.009,.16,tee);ellipsoid(l.foot,0,-.009,-.034,.047,.036,.085,shoes);
      for(const side of [-1,1]){
        tube(l.foot,[[side*.078,-.034,.047],[side*.083,-.03,-.043],[side*.067,-.038,-.137],[0,-.04,-.189]],.0011,dark,25,5);
        for(let i=0;i<5;i++){const z=.008-i*.024;ellipsoid(l.foot,side*.038,.011-i*.002,z,.003,.002,.003,metal);}
      }
      for(let i=0;i<5;i++){const z=.008-i*.024;tube(l.foot,[[-.036,.012-i*.002,z],[0,.022-i*.002,z-.006],[.036,.012-i*.002,z-.018]],.0017,tee,8,6);}
      for(let i=0;i<4;i++)ellipsoid(l.foot,-.024+i*.016,-.003,-.145,.0015,.0011,.0015,dark);
    });
    const joints=[rig.head,rig.neck,rig.torso,rig.pelvis,...rig.arms.flatMap(a=>[a.upper,a.lower,a.hand]),...rig.legs.flatMap(l=>[l.upper,l.lower,l.foot])];
    for(const joint of joints)consolidatePart(joint);
    rig.root.userData.visualMethod='sculpted procedural humanoid';return rig;
  }
  function disposeRig(rig){
    if(!rig)return new Set();
    const geometries=new Set(),materials=new Set(),textures=new Set();
    rig.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const mat of(Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(mat);for(const k of ['map','bumpMap','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap'])if(mat[k])textures.add(mat[k]);}});
    rig.root.removeFromParent();for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();return textures;
  }
  function swap(rig){const old=current;current=rig;group.add(rig.root);disposeRig(old);phase=0;}
  function setStyle(value){
    const changes=typeof value==='string'?(presets[value]||{}):(value||{});
    style={...style,...changes};importSequence++;swap(procedural());
  }
  function triangleCount(root){let count=0;root.traverse(o=>{if(o.isMesh&&o.geometry)count+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});return Math.round(count);}
  function update(dt,{moving=false,running=false,jumping=false,speed=0,grounded=!jumping,groundHeightAt}={}){
    if(!current)return;dt=Math.min(.1,Math.max(0,Number(dt)||0));idleTime+=dt;
    const motion=moving?Math.min(1,Math.max(.25,(Number(speed)||3)/(running?5:3))):0;
    if(moving)phase+=dt*(running?10.8:7.2);
    const blend=Math.min(1,dt*12),swing=Math.sin(phase)*motion;
    const lerp=(object,key,target)=>{object[key]+=(target-object[key])*blend;};
    current.gaitBodyY??=0;lerp(current,'gaitBodyY',-.02+(moving?Math.abs(Math.sin(phase*2))*(running?.034:.016):Math.sin(idleTime*1.7)*.004));current.body.position.y=current.gaitBodyY;
    lerp(current.torso.rotation,'x',running&&moving?-.075:Math.sin(idleTime*1.4)*.007);
    lerp(current.head.rotation,'y',moving?Math.sin(phase*.5)*.018:Math.sin(idleTime*.4)*.035);
    lerp(current.body.rotation,'z',moving?-Math.sin(phase)*.011:0);lerp(current.pelvis.rotation,'y',moving?Math.sin(phase)*.024:0);
    lerp(current.head.rotation,'x',moving?-.009:Math.sin(idleTime*.65)*.009);
    current.legs.forEach((l,i)=>{const sign=i===0?1:-1;
      l.gait??={upper:0,lower:0,foot:0};lerp(l.gait,'upper',jumping?.32:sign*swing*(running?.77:.49));lerp(l.gait,'lower',jumping?-.58:-Math.max(0,-sign*swing)*(running?1.03:.65));lerp(l.gait,'foot',jumping?.1:Math.max(0,sign*swing)*.11);
      l.upper.rotation.set(l.gait.upper,0,0);l.lower.rotation.set(l.gait.lower,0,0);l.foot.rotation.set(l.gait.foot,0,0);
    });
    current.arms.forEach((a,i)=>{const sign=i===0?1:-1;lerp(a.upper.rotation,'x',jumping?-.45:-sign*swing*(running?.69:.34));lerp(a.upper.rotation,'z',a.side*(jumping?.22:.065));lerp(a.lower.rotation,'x',running&&moving?-.9:-.12-Math.max(0,sign*swing)*.17);});
    if(grounded&&!jumping&&typeof groundHeightAt==='function'){
      group.updateWorldMatrix(true,true);const frame=group.getWorldQuaternion(new THREE.Quaternion()),base=group.getWorldPosition(new THREE.Vector3()).y;
      const placements=[];let requiredDrop=0;
      for(const l of current.legs){const foot=l.foot.getWorldPosition(new THREE.Vector3()),height=groundHeightAt(foot.x,foot.z);if(!Number.isFinite(height)||Math.abs(height-base)>.4)continue;
        const target=foot.clone(),lift=moving?Math.min(running?.22:.14,Math.max(0,foot.y-base-.1)):0;target.y=height+.1+lift;
        const hip=l.upper.getWorldPosition(new THREE.Vector3()),knee=l.lower.getWorldPosition(new THREE.Vector3()),reach=hip.distanceTo(knee)+knee.distanceTo(foot)-.004;
        const verticalReach=Math.sqrt(Math.max(0,reach*reach-(target.x-hip.x)**2-(target.z-hip.z)**2));
        requiredDrop=Math.max(requiredDrop,hip.y-target.y-verticalReach);placements.push({l,target});
      }
      // Gait bob and terrain offset are separate: a lower tread must bend the
      // pelvis, never accumulate an offset or stretch the leg past its length.
      current.footDrop??=0;lerp(current,'footDrop',Math.max(0,Math.min(.22,requiredDrop)));
      current.body.position.y=current.gaitBodyY-current.footDrop;group.updateWorldMatrix(true,true);
      for(const {l,target} of placements){const foot=l.foot.getWorldPosition(new THREE.Vector3());if(Math.abs(target.y-foot.y)>.002&&Math.abs(target.y-foot.y)<.45)placeHumanoidFoot(THREE,l.upper,l.lower,l.foot,target,frame,-1);}
      group.updateWorldMatrix(true,true);
    }else current.footDrop=0;
  }
  const waitFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  function prepareView(image,maxImage,name){
    const iw=image.naturalWidth||image.videoWidth||image.width,ih=image.naturalHeight||image.videoHeight||image.height;
    if(!iw||!ih)throw new Error(`${name}の画像を読み込めません。画像の読み込み完了後にお試しください。`);
    const scale=Math.min(1,maxImage/Math.max(iw,ih));const w=Math.max(16,Math.round(iw*scale)),h=Math.max(16,Math.round(ih*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
    let imageData;try{imageData=ctx.getImageData(0,0,w,h);}catch{throw new Error('画像を読み取れません。端末から画像ファイルを選択してください。');}
    const pixels=imageData.data,n=w*h,mask=new Uint8Array(n),edgeR=[],edgeG=[],edgeB=[];
    let transparent=0,samples=0;
    for(let y=0;y<h;y+=Math.max(1,Math.floor(h/120)))for(let x=0;x<w;x+=Math.max(1,Math.floor(w/120))){samples++;if(pixels[(y*w+x)*4+3]<64)transparent++;}
    const hasAlpha=transparent/Math.max(1,samples)>.025;
    const edge=(x,y)=>{const i=(y*w+x)*4;if(pixels[i+3]>128){edgeR.push(pixels[i]);edgeG.push(pixels[i+1]);edgeB.push(pixels[i+2]);}};
    for(let x=0;x<w;x+=Math.max(1,Math.floor(w/80))){edge(x,0);edge(x,h-1);}for(let y=0;y<h;y+=Math.max(1,Math.floor(h/80))){edge(0,y);edge(w-1,y);}
    const median=a=>a.length?a.sort((a,b)=>a-b)[Math.floor(a.length/2)]:220;
    const bg=[median(edgeR),median(edgeG),median(edgeB)];let removed=0;
    if(hasAlpha){for(let i=0;i<n;i++){mask[i]=pixels[i*4+3]>48?1:0;if(!mask[i])removed++;}}
    else{
      // Only a connected, near-uniform edge background is removed. This avoids
      // pretending that arbitrary photographic backgrounds can be segmented.
      mask.fill(1);const seen=new Uint8Array(n),queue=new Uint32Array(n);let head=0,tail=0;
      const enqueue=i=>{if(seen[i])return;seen[i]=1;const p=i*4,dr=pixels[p]-bg[0],dg=pixels[p+1]-bg[1],db=pixels[p+2]-bg[2];if(dr*dr+dg*dg+db*db>58*58)return;queue[tail++]=i;mask[i]=0;removed++;};
      for(let x=0;x<w;x++){enqueue(x);enqueue((h-1)*w+x);}for(let y=0;y<h;y++){enqueue(y*w);enqueue(y*w+w-1);}
      while(head<tail){const i=queue[head++],x=i%w;if(x)enqueue(i-1);if(x<w-1)enqueue(i+1);if(i>=w)enqueue(i-w);if(i<n-w)enqueue(i+w);}
    }
    const rows=new Uint32Array(h),cols=new Uint32Array(w);let fg=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){rows[y]++;cols[x]++;fg++;}
    let minX=0,maxX=w-1,minY=0,maxY=h-1;const rowMin=Math.max(2,w*.004),colMin=Math.max(2,h*.004);
    while(minX<maxX&&cols[minX]<colMin)minX++;while(maxX>minX&&cols[maxX]<colMin)maxX--;while(minY<maxY&&rows[minY]<rowMin)minY++;while(maxY>minY&&rows[maxY]<rowMin)maxY--;
    const reliable=fg/n>.035&&fg/n<.92&&removed/n>.06;
    if(fg/n<.035||maxY-minY<h*.2){mask.fill(1);minX=0;maxX=w-1;minY=0;maxY=h-1;}
    // Color dilation prevents white/transparent halos on the closed 3D shell.
    for(let y=0;y<h;y++){
      const nearest=new Int32Array(w);let last=-1;for(let x=0;x<w;x++){if(mask[y*w+x])last=x;nearest[x]=last;}let next=-1;
      for(let x=w-1;x>=0;x--){if(mask[y*w+x])next=x;const p=(y*w+x)*4;if(!mask[y*w+x]){const left=nearest[x],pick=left<0?next:next<0?left:x-left<next-x?left:next;if(pick>=0){const q=(y*w+pick)*4;pixels[p]=pixels[q];pixels[p+1]=pixels[q+1];pixels[p+2]=pixels[q+2];}else{pixels[p]=bg[0];pixels[p+1]=bg[1];pixels[p+2]=bg[2];}}pixels[p+3]=255;}
    }
    ctx.putImageData(imageData,0,0);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const bbox={x:minX,y:minY,w:Math.max(1,maxX-minX+1),h:Math.max(1,maxY-minY+1)};
    function contour(rect,yNorm){
      const yy=Math.max(0,Math.min(h-1,Math.round(bbox.y+yNorm*bbox.h)));const start=Math.max(0,Math.floor(bbox.x+rect[0]*bbox.w)),end=Math.min(w-1,Math.ceil(bbox.x+rect[1]*bbox.w));
      let lo=end,hi=start,found=false;for(let x=start;x<=end;x++)if(mask[yy*w+x]){lo=Math.min(lo,x);hi=Math.max(hi,x);found=true;}
      if(!found){lo=start;hi=end;}return{center:(lo+hi)/2,half:Math.max(1,(hi-lo)/2),y:yy,valid:found};
    }
    function average(rect){let r=0,g=0,b=0,count=0;const x0=bbox.x+rect[0]*bbox.w,x1=bbox.x+rect[1]*bbox.w,y0=bbox.y+rect[2]*bbox.h,y1=bbox.y+rect[3]*bbox.h;
      for(let y=Math.floor(y0);y<y1;y+=3)for(let x=Math.floor(x0);x<x1;x+=3){if(x<0||x>=w||y<0||y>=h||!mask[y*w+x])continue;const p=(y*w+x)*4;r+=pixels[p];g+=pixels[p+1];b+=pixels[p+2];count++;}return count?new THREE.Color(r/count/255,g/count/255,b/count/255).convertSRGBToLinear():new THREE.Color('#87928b');}
    return{texture,w,h,bbox,contour,average,reliable,hasAlpha};
  }
  function imageSegment(spec,views,q){
    const {length,rx,rz,rect,sideRect=rect,shape='tube'}=spec;
    const colors=views.front.average(rect);
    const backColor=shape==='head'?views.front.average([rect[0],rect[1],rect[2],rect[2]+(rect[3]-rect[2])*.35]):colors;
    const mats=[0,1,2,3].map((_,i)=>{const view=views[['front','back','left','right'][i]];return view?new THREE.MeshStandardMaterial({map:view.texture,color:0xffffff,roughness:.83}):new THREE.MeshStandardMaterial({color:i===1?backColor:colors,roughness:.88});});
    mats.push(new THREE.MeshStandardMaterial({color:colors,roughness:.88}));
    const rings=q.rings,sideSlices=q.radial/4,positions=[],normals=[],uvs=[],indices=[];
    const data=[];
    const mirrorRect=r=>[1-r[1],1-r[0],r[2],r[3]];
    for(let i=0;i<=rings;i++){
      const t=i/rings,y=rect[2]+t*(rect[3]-rect[2]);const contours={};
      for(const name of ['front','back','left','right'])if(views[name]){const rr=name==='back'?mirrorRect(rect):name==='left'||name==='right'?sideRect:rect;contours[name]=views[name].contour(rr,y);}
      const front=contours.front;let width=rx,depth=rz;
      if(views.front.reliable&&front.valid)width=Math.max(rx*.6,Math.min(rx*1.55,front.half*1.74/views.front.bbox.h));
      let ds=0,dc=0;for(const name of ['left','right'])if(views[name]?.reliable&&contours[name]?.valid){ds+=contours[name].half*1.74/views[name].bbox.h;dc++;}if(dc)depth=Math.max(rz*.6,Math.min(rz*1.65,ds/dc));
      // Rounded ends, retaining anatomical silhouettes through the middle.
      let round=1;if(shape==='head')round=Math.max(.22,Math.pow(Math.sin(Math.PI*t),.38));else if(shape==='hand')round=.64+.36*Math.sin(Math.PI*t);else if(shape==='foot')round=.7+.3*Math.sin(Math.PI*t);else round=t<.07?.84+.16*t/.07:t>.93?.84+.16*(1-t)/.07:1;
      data.push({width:width*round,depth:depth*round,contours});
    }
    // A small contour smoothing pass removes pixel stair-steps without changing
    // the selected polygon budget or turning the model into a flat billboard.
    for(let pass=0;pass<2;pass++){const copy=data.map(r=>[r.width,r.depth]);for(let i=1;i<rings;i++){data[i].width=(copy[i-1][0]+copy[i][0]*2+copy[i+1][0])/4;data[i].depth=(copy[i-1][1]+copy[i][1]*2+copy[i+1][1])/4;}}
    const geometry=new THREE.BufferGeometry();
    const surfaces=[{name:'front',start:Math.PI*1.25,mat:0},{name:'back',start:Math.PI*.25,mat:1},{name:'left',start:Math.PI*.75,mat:2},{name:'right',start:Math.PI*1.75,mat:3}];
    for(const surface of surfaces){
      const offset=positions.length/3,startIndex=indices.length;
      for(let i=0;i<=rings;i++){
        const t=i/rings,row=data[i],prev=data[Math.max(0,i-1)],next=data[Math.min(rings,i+1)];
        const dY=-length*(Math.min(rings,i+1)-Math.max(0,i-1))/rings;
        const drx=(next.width-prev.width)/(dY||1),drz=(next.depth-prev.depth)/(dY||1);
        for(let j=0;j<=sideSlices;j++){
          const a=surface.start+j/sideSlices*Math.PI*.5,c=Math.cos(a),s=Math.sin(a),x=c*row.width,z=s*row.depth;
          positions.push(x,-length*t,z);
          const normal=new THREE.Vector3(c/row.width,-(c*c*drx/row.width+s*s*drz/row.depth),s/row.depth).normalize();normals.push(normal.x,normal.y,normal.z);
          const view=views[surface.name],ct=row.contours[surface.name];
          if(view&&ct){const ratio=surface.name==='front'?c:surface.name==='back'?-c:surface.name==='left'?s:-s;uvs.push((ct.center+ratio*ct.half)/view.w,1-ct.y/view.h);}else uvs.push((c+1)/2,1-t);
        }
      }
      for(let i=0;i<rings;i++)for(let j=0;j<sideSlices;j++){const a=offset+i*(sideSlices+1)+j,b=a+1,c=a+sideSlices+1,d=c+1;indices.push(a,b,c,b,d,c);}
      geometry.addGroup(startIndex,indices.length-startIndex,surface.mat);
    }
    const capStart=indices.length;
    for(const end of [0,rings]){
      const row=data[end],center=positions.length/3;positions.push(0,-length*end/rings,0);normals.push(0,end===0?1:-1,0);uvs.push(.5,.5);
      for(let j=0;j<=q.radial;j++){const a=j/q.radial*Math.PI*2;positions.push(Math.cos(a)*row.width,-length*end/rings,Math.sin(a)*row.depth);normals.push(0,end===0?1:-1,0);uvs.push(.5+.5*Math.cos(a),.5+.5*Math.sin(a));}
      for(let j=0;j<q.radial;j++){const a=center+1+j,b=a+1;if(end===0)indices.push(center,b,a);else indices.push(center,a,b);}
    }
    geometry.addGroup(capStart,indices.length-capStart,4);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,mats);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
  }
  async function fromImage(input,{quality='standard'}={}){
    const requestedQuality=qualityTable[quality]?quality:'standard',levels=['standard','high','ultra','cinematic'];
    const nav=globalThis.navigator||{},memory=Number(nav.deviceMemory)||0,cores=Number(nav.hardwareConcurrency)||0,coarse=typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(pointer:coarse)').matches;
    let maximum=3;if((memory>0&&memory<=2)||(cores>0&&cores<=2))maximum=1;else if((memory>0&&memory<=4)||(cores>0&&cores<=4)||coarse)maximum=2;
    const effectiveQuality=levels[Math.min(levels.indexOf(requestedQuality),maximum)],budgetCapped=effectiveQuality!==requestedQuality;
    const ownSequence=++importSequence,q=qualityTable[effectiveQuality];
    const supplied=input?.front?input:{front:input};if(!supplied.front)throw new Error('正面の全身画像を選択してください。');
    const views={},names={front:'正面',back:'背面',left:'左側面',right:'右側面'};let rig;
    try{
      for(const name of ['front','back','left','right'])if(supplied[name]){views[name]=prepareView(supplied[name],q.maxImage,names[name]);await waitFrame();}
      rig=skeleton();rig.kind='image';
      const add=(parent,spec)=>parent.add(imageSegment(spec,views,q));
      add(rig.head,{length:.28,rx:.112,rz:.105,rect:[.30,.70,0,.16],sideRect:[.22,.78,0,.16],shape:'head'});
      add(rig.neck,{length:.12,rx:.062,rz:.06,rect:[.39,.61,.14,.20],sideRect:[.35,.65,.14,.20]});
      add(rig.torso,{length:.53,rx:.22,rz:.123,rect:[.25,.75,.18,.49],sideRect:[.23,.77,.18,.49]});
      add(rig.pelvis,{length:.18,rx:.181,rz:.12,rect:[.25,.75,.46,.565],sideRect:[.25,.75,.46,.565]});
      for(const a of rig.arms){
        // The front image's left half is the model's local -X side.
        const x=a.side<0?[.045,.28]:[.72,.955],hand=a.side<0?[.055,.27]:[.73,.945];
        add(a.upper,{length:.285,rx:.07,rz:.074,rect:[...x,.20,.365],sideRect:[.30,.70,.20,.365]});
        add(a.lower,{length:.27,rx:.059,rz:.062,rect:[...x,.355,.51],sideRect:[.30,.70,.355,.51]});
        add(a.hand,{length:.10,rx:.041,rz:.028,rect:[...hand,.50,.56],sideRect:[.35,.65,.50,.56],shape:'hand'});
        a.upper.rotation.z=a.side*.035;
      }
      await waitFrame();
      for(const l of rig.legs){
        const x=l.side<0?[.23,.50]:[.50,.77];
        add(l.upper,{length:.38,rx:.092,rz:.10,rect:[...x,.54,.76],sideRect:[.28,.72,.54,.76]});
        add(l.lower,{length:.33,rx:.071,rz:.079,rect:[...x,.75,.94],sideRect:[.30,.70,.75,.94]});
        add(l.foot,{length:.10,rx:.087,rz:.15,rect:[...x,.93,1],sideRect:[.18,.82,.93,1],shape:'foot'});
      }
      const triangles=triangleCount(rig.root);
      if(ownSequence!==importSequence)throw new Error('画像の生成を中止しました。');
      swap(rig);rig=undefined;
      const missing=['back','left','right'].filter(n=>!views[n]);
      const limitations=[
        '写真を対応する面へ投影した簡易立体化です。実測の3Dスキャンや、完全な人体形状の復元ではありません。',
        '各画像は同じ姿勢・同じ服装の全身を、正面／背面／真横から撮影すると対応しやすくなります。手足の位置は推定した関節へ合わせます。',
        '頭頂・足裏・隠れた部分、指、服の細かな凹凸は推定です。ポリゴン数を増やしても、写真にない情報は復元されません。'
      ];
      if(budgetCapped)limitations.unshift(`端末の負荷を抑えるため、${requestedQuality}の指定を${effectiveQuality}のポリゴン上限へ調整しました。`);
      if(missing.length)limitations.unshift(`${missing.map(n=>names[n]).join('・')}の画像がないため、その面は正面の色と標準形状から推定しています。`);
      const uncertain=Object.keys(views).filter(n=>!views[n].reliable);if(uncertain.length)limitations.push(`${uncertain.map(n=>names[n]).join('・')}の背景を十分に分離できなかったため、一部は標準の体形を使っています。背景透過または単色背景をおすすめします。`);
      return{triangles,method:`${Object.keys(views).length}方向の写真投影による関節付き簡易立体モデル`,limitations,views:Object.keys(views),quality:effectiveQuality,requestedQuality,budgetCapped};
    }catch(error){const disposed=disposeRig(rig);for(const v of Object.values(views))if(!disposed.has(v.texture))v.texture.dispose();throw error;}
  }
  swap(procedural());
  return{group,update,setStyle,fromImage,get triangles(){return current?triangleCount(current.root):0;},dispose(){importSequence++;disposeRig(current);current=null;}};
}
