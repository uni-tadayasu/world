/** Local articulated avatars. Image reconstruction is an approximate visual hull,
 * not a recovered scan: unseen surfaces and joints are estimated explicitly. */
export function createAvatar(THREE) {
  const group = new THREE.Group();
  group.name = 'MACHI playable character';
  let current, phase = 0, idleTime = 0, importSequence = 0;
  let style = {shirt:'#ded7c6',pants:'#26373b',skin:'#c79b7b',hair:'#2b2521',shoes:'#eeece3'};
  const qualityTable = {
    standard:{radial:36,rings:24,maxImage:1024},
    high:{radial:64,rings:42,maxImage:1280},
    ultra:{radial:88,rings:62,maxImage:1536}
  };
  const presets={ivory:{shirt:'#ded7c6',pants:'#26373b'},navy:{shirt:'#344b59',pants:'#beb9a8'},sage:{shirt:'#85917b',pants:'#343a31'},black:{shirt:'#353c3c',pants:'#262c30'}};
  const material=(color,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  function addMesh(parent,geometry,mat,x=0,y=0,z=0,sx=1,sy=1,sz=1){
    const o=new THREE.Mesh(geometry,mat);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  function ellipsoid(parent,x,y,z,rx,ry,rz,mat){return addMesh(parent,new THREE.SphereGeometry(1,28,18),mat,x,y,z,rx,ry,rz);}
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
    const rings=18,radial=28,positions=[],uvs=[],indices=[];
    for(let i=0;i<=rings;i++){
      const t=i/rings;const edge=t<.12?top+(1-top)*t/.12:t>.88?1+(bottom-1)*(t-.88)/.12:1;
      const waist=1-.055*Math.sin(Math.PI*t);
      for(let j=0;j<=radial;j++){const a=j/radial*Math.PI*2;positions.push(Math.cos(a)*rx*edge*waist,-length*t,Math.sin(a)*rz*edge*waist);uvs.push(j/radial,1-t);}
    }
    for(let i=0;i<rings;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+1,c=a+radial+1,d=c+1;indices.push(a,b,c,b,d,c);}
    for(const end of [0,rings]){const center=positions.length/3;positions.push(0,-length*end/rings,0);uvs.push(.5,.5);for(let j=0;j<radial;j++){const a=end*(radial+1)+j,b=a+1;if(end===0)indices.push(center,b,a);else indices.push(center,a,b);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function procedural(){
    const rig=skeleton();
    const shirt=material(style.shirt,.92), pants=material(style.pants,.93), skin=material(style.skin,.67), hair=material(style.hair,.87), shoes=material(style.shoes,.73);
    const sole=material('#5a605b',.85), tee=material('#f3f0e5',.95), seam=material(new THREE.Color(style.shirt).multiplyScalar(.78),.92), dark=material('#3b332c',.7), eye=material('#222723',.4), white=material('#ede9dd',.5);
    addMesh(rig.torso,softSegment(.53,.225,.125,.88,.94),shirt);
    addMesh(rig.pelvis,softSegment(.18,.183,.118,.98,.98),pants);
    addMesh(rig.neck,softSegment(.12,.063,.061,.94,.92),skin);
    // Shirt opening, small buttons, lapels and a patch pocket.
    block(rig.torso,0,-.23,-.125,.075,.43,.012,tee);
    for(const side of [-1,1]){const lapel=block(rig.torso,side*.06,-.075,-.126,.082,.15,.015,shirt);lapel.rotation.z=side*.28;block(rig.torso,side*.049,-.29,-.137,.009,.39,.008,seam);}
    for(let y=-.16;y>-.5;y-=.095)ellipsoid(rig.torso,.048,y,-.145,.009,.009,.006,dark);
    block(rig.torso,-.122,-.205,-.125,.1,.105,.012,seam);block(rig.torso,-.122,-.199,-.135,.088,.089,.009,shirt);
    // Natural head shape, ears and subtle facial details face local -Z.
    ellipsoid(rig.head,0,-.148,0,.112,.145,.102,skin);
    for(const side of [-1,1]){ellipsoid(rig.head,side*.111,-.155,.003,.019,.034,.025,skin);ellipsoid(rig.head,side*.041,-.119,-.091,.02,.009,.012,white);ellipsoid(rig.head,side*.042,-.12,-.102,.007,.007,.005,eye);const brow=block(rig.head,side*.041,-.1,-.099,.036,.006,.006,hair);brow.rotation.z=side*.075;}
    ellipsoid(rig.head,0,-.157,-.102,.018,.024,.02,skin);ellipsoid(rig.head,0,-.205,-.089,.029,.004,.006,material('#946c57',.8));
    const cap=new THREE.SphereGeometry(1,32,18,0,Math.PI*2,0,1.47);addMesh(rig.head,cap,hair,0,-.137,.009,.117,.15,.107);
    ellipsoid(rig.head,0,-.153,.067,.108,.1,.054,hair);for(const side of [-1,1])ellipsoid(rig.head,side*.103,-.13,.016,.014,.054,.072,hair);
    // Arms, cuffs and hands. Each elbow is a real animated pivot.
    rig.arms.forEach(a=>{addMesh(a.upper,softSegment(.29,.071,.073,.88,.92),shirt);addMesh(a.lower,softSegment(.27,.062,.066,.96,.76),shirt);addMesh(a.hand,softSegment(.1,.043,.028,.89,.7),skin);addMesh(a.lower,softSegment(.041,.055,.06,1,1),seam,0,-.229);a.upper.rotation.z=a.side*.065;ellipsoid(a.hand,-a.side*.04,-.035,-.004,.016,.033,.017,skin);});
    // Tapered trousers and low-profile leather sneakers.
    rig.legs.forEach(l=>{addMesh(l.upper,softSegment(.39,.091,.099,.99,.82),pants);addMesh(l.lower,softSegment(.34,.073,.082,.98,.79),pants);ellipsoid(l.foot,0,-.035,-.045,.089,.064,.16,shoes);ellipsoid(l.foot,0,-.072,-.046,.091,.025,.163,sole);for(let j=0;j<4;j++)block(l.foot,0,.005-j*.003,-.02-j*.022,.086,.009,.01,tee);});
    return rig;
  }
  function disposeRig(rig){
    if(!rig)return new Set();
    const geometries=new Set(),materials=new Set(),textures=new Set();
    rig.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const mat of(Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(mat);for(const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap'])if(mat[k])textures.add(mat[k]);}});
    rig.root.removeFromParent();for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();return textures;
  }
  function swap(rig){const old=current;current=rig;group.add(rig.root);disposeRig(old);phase=0;}
  function setStyle(value){
    const changes=typeof value==='string'?(presets[value]||{}):(value||{});
    style={...style,...changes};importSequence++;swap(procedural());
  }
  function triangleCount(root){let count=0;root.traverse(o=>{if(o.isMesh&&o.geometry)count+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});return Math.round(count);}
  function update(dt,{moving=false,running=false,jumping=false,speed=0}={}){
    if(!current)return;dt=Math.min(.1,Math.max(0,Number(dt)||0));idleTime+=dt;
    const motion=moving?Math.min(1,Math.max(.25,(Number(speed)||3)/(running?5:3))):0;
    if(moving)phase+=dt*(running?10.8:7.2);
    const blend=Math.min(1,dt*12),swing=Math.sin(phase)*motion;
    const lerp=(object,key,target)=>{object[key]+=(target-object[key])*blend;};
    lerp(current.body.position,'y',moving?Math.abs(Math.sin(phase*2))*(running?.034:.016):Math.sin(idleTime*1.7)*.004);
    lerp(current.torso.rotation,'x',running&&moving?-.075:Math.sin(idleTime*1.4)*.007);
    lerp(current.head.rotation,'y',moving?Math.sin(phase*.5)*.018:Math.sin(idleTime*.4)*.035);
    current.legs.forEach((l,i)=>{const sign=i===0?1:-1;lerp(l.upper.rotation,'x',jumping?.32:sign*swing*(running?.77:.49));lerp(l.lower.rotation,'x',jumping?-.58:-Math.max(0,-sign*swing)*(running?1.03:.65));lerp(l.foot.rotation,'x',jumping?.1:Math.max(0,sign*swing)*.11);});
    current.arms.forEach((a,i)=>{const sign=i===0?1:-1;lerp(a.upper.rotation,'x',jumping?-.45:-sign*swing*(running?.69:.34));lerp(a.upper.rotation,'z',a.side*(jumping?.22:.065));lerp(a.lower.rotation,'x',running&&moving?-.9:-.12-Math.max(0,sign*swing)*.17);});
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
    const ownSequence=++importSequence,q=qualityTable[quality]||qualityTable.standard;
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
      if(missing.length)limitations.unshift(`${missing.map(n=>names[n]).join('・')}の画像がないため、その面は正面の色と標準形状から推定しています。`);
      const uncertain=Object.keys(views).filter(n=>!views[n].reliable);if(uncertain.length)limitations.push(`${uncertain.map(n=>names[n]).join('・')}の背景を十分に分離できなかったため、一部は標準の体形を使っています。背景透過または単色背景をおすすめします。`);
      return{triangles,method:`${Object.keys(views).length}方向の写真投影による関節付き簡易立体モデル`,limitations,views:Object.keys(views),quality:qualityTable[quality]?quality:'standard'};
    }catch(error){const disposed=disposeRig(rig);for(const v of Object.values(views))if(!disposed.has(v.texture))v.texture.dispose();throw error;}
  }
  swap(procedural());
  return{group,update,setStyle,fromImage,dispose(){importSequence++;disposeRig(current);current=null;}};
}
