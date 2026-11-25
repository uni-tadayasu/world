/** Deterministic PBR surfaces and reusable detail geometry. No asset downloads. */
export const QUALITY_PROFILES={
  low:{texture:128,sphere:14,cylinder:12,bevel:1,leafCount:24,leafDistance:18,cars:4,people:8,view:100},
  medium:{texture:256,sphere:22,cylinder:20,bevel:2,leafCount:44,leafDistance:27,cars:8,people:14,view:150},
  auto:{texture:256,sphere:30,cylinder:28,bevel:3,leafCount:60,leafDistance:34,cars:10,people:18,view:190},
  high:{texture:512,sphere:36,cylinder:32,bevel:4,leafCount:88,leafDistance:42,cars:14,people:24,view:220},
  ultra:{texture:768,sphere:52,cylinder:48,bevel:6,leafCount:144,leafDistance:55,cars:20,people:32,view:270},
  cinematic:{texture:1024,sphere:72,cylinder:64,bevel:8,leafCount:220,leafDistance:70,cars:26,people:42,view:320}
};
export function qualityName(tier){return Object.hasOwn(QUALITY_PROFILES,tier)?tier:'high';}
export function createMaterialLibrary(THREE,{quality='high'}={}){
  let tier=qualityName(quality);const textures=new Map(),geometries=new Map(),bindings=new Map(),ownedMaterials=new Set(),clones=new Set();
  const frac=n=>n-Math.floor(n),noise=(x,y)=>frac(Math.sin(x*127.1+y*311.7)*43758.5453);
  function surface(type){
    if(textures.has(type))return textures.get(type);const n=QUALITY_PROFILES[tier].texture,height=new Float32Array(n*n),color=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),rough=new Uint8Array(n*n*4);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const u=x/n,v=y/n,grain=noise(x,y),broad=noise(Math.floor(u*48),Math.floor(v*48));let h=grain*.13+broad*.025,light=.93,roughness=.94;
      if(type==='wood'||type==='bark'){
        const wave=Math.sin((u*29+Math.sin(v*6.28)*.22+Math.sin(v*18.85)*.075)*6.28),fine=Math.sin((u*117+Math.sin(v*12.56)*.3)*6.28);
        h=(wave*.13+fine*.035+grain*.05)*(type==='bark'?1.5:.55);light=.91+wave*.045+fine*.015;roughness=type==='wood'?.89:.98;
      }else if(type==='paving'||type==='brick'){
        const rows=type==='brick'?8:4,cols=type==='brick'?4:4,yy=frac(v*rows),xx=frac(u*cols+(type==='brick'?Math.floor(v*rows)%2*.5:0));
        const mortar=xx<.028||xx>.975||yy<.035||yy>.975;h=mortar?-.16:grain*.03;light=mortar?.7:.91+noise(Math.floor(u*cols),Math.floor(v*rows))*.075;roughness=.95;
      }else if(type==='fabric'){
        const weave=Math.sin(u*6.28*92)*Math.sin(v*6.28*92);h=weave*.035+grain*.014;light=.93+weave*.022;roughness=.99;
      }else if(type==='asphalt'){
        h=grain*.09+broad*.035;light=.85+grain*.1+(grain>.96?.05:0);roughness=.96;
      }else if(type==='leaf'){
        const vein=Math.exp(-Math.abs(u-.5)*60),sideVeins=Math.sin((v+Math.abs(u-.5)*.7)*6.28*9);h=vein*.08+sideVeins*.012;light=.91+vein*.05+sideVeins*.025;roughness=.87;
      }else if(type==='metal'||type==='glass'||type==='paint'){
        h=type==='metal'?Math.sin(u*n*.8)*.003:grain*.0005;light=type==='metal'?.97:1;roughness=type==='metal'?.91:.98;
      }else if(type==='grass'){
        h=grain*.13;light=.84+grain*.14+broad*.025;roughness=.99;
      }else if(type==='stone'){
        h=grain*.045+broad*.025;light=.89+grain*.065;roughness=.95;
      }else{h=grain*.035;light=.91+grain*.055;roughness=.97;}
      const i=y*n+x,p=i*4;height[i]=h;const c=Math.round(Math.max(0,Math.min(1,light))*255);color[p]=color[p+1]=color[p+2]=c;color[p+3]=255;rough[p]=rough[p+1]=rough[p+2]=Math.round(roughness*255);rough[p+3]=255;
    }
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const dx=height[y*n+(x+1)%n]-height[y*n+(x+n-1)%n],dy=height[((y+1)%n)*n+x]-height[((y+n-1)%n)*n+x],scale=type==='bark'?4:type==='paving'||type==='brick'?2:1.6;
      const nx=-dx*scale,ny=-dy*scale,inv=1/Math.hypot(nx,ny,1),p=(y*n+x)*4;normal[p]=Math.round((nx*inv*.5+.5)*255);normal[p+1]=Math.round((ny*inv*.5+.5)*255);normal[p+2]=Math.round((inv*.5+.5)*255);normal[p+3]=255;
    }
    const tex=(data,colorSpace)=>{const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.colorSpace=colorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=tier==='low'?2:8;t.needsUpdate=true;return t;};
    const result={map:tex(color,THREE.SRGBColorSpace),normalMap:tex(normal,THREE.NoColorSpace),roughnessMap:tex(rough,THREE.NoColorSpace)};textures.set(type,result);return result;
  }
  function apply(material,type='plaster',{preserveMap=true,repeat}={}){
    if(!material?.isMaterial)return material;const maps=surface(type),old=bindings.get(material),baseMap=old?old.baseMap:material.map;
    const reps=repeat||baseMap?.repeat||{x:1,y:1};
    const wrapped=t=>{if(reps.x===1&&reps.y===1)return t;const c=t.clone();c.repeat.copy(reps);clones.add(c);c.needsUpdate=true;return c;};
    material.map=preserveMap&&baseMap?baseMap:wrapped(maps.map);material.normalMap=wrapped(maps.normalMap);material.roughnessMap=wrapped(maps.roughnessMap);
    material.normalScale=new THREE.Vector2(type==='fabric'?.45:type==='glass'?.03:.65,type==='fabric'?.45:type==='glass'?.03:.65);
    material.needsUpdate=true;bindings.set(material,{type,preserveMap,repeat,baseMap});return material;
  }
  function material(type,color,options={}){
    const physical=['paint','glass','metal','fabric','water','wood'].includes(type);
    const defaults={wood:{roughness:.52,clearcoat:.18,clearcoatRoughness:.48},paint:{roughness:.25,metalness:.35,clearcoat:1,clearcoatRoughness:.13},glass:{roughness:.13,metalness:.42,clearcoat:1,clearcoatRoughness:.08},fabric:{roughness:.92,sheen:.6,sheenRoughness:.8,sheenColor:new THREE.Color(color)},metal:{roughness:.3,metalness:.75},water:{roughness:.14,metalness:.26,clearcoat:1}}[type]||{roughness:.84};
    const m=new (physical?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial)({color,...defaults,...options});ownedMaterials.add(m);return apply(m,type);
  }
  function geometry(key,make){if(!geometries.has(key))geometries.set(key,make());return geometries.get(key);}
  function roundedBox(w=1,h=1,d=1,radius=.055){
    const segments=QUALITY_PROFILES[tier].bevel,r=Math.min(radius,w*.17,h*.17,d*.17),key=`box:${w},${h},${d},${r},${segments}`;
    return geometry(key,()=>{const iw=w-2*r,ih=h-2*r,c=Math.min(r,iw/4,ih/4),s=new THREE.Shape();s.moveTo(c,0);s.lineTo(iw-c,0);s.quadraticCurveTo(iw,0,iw,c);s.lineTo(iw,ih-c);s.quadraticCurveTo(iw,ih,iw-c,ih);s.lineTo(c,ih);s.quadraticCurveTo(0,ih,0,ih-c);s.lineTo(0,c);s.quadraticCurveTo(0,0,c,0);const g=new THREE.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelSize:r,bevelThickness:r,bevelSegments:segments,steps:1,curveSegments:Math.max(2,segments)});g.translate(-w/2+r,-h/2+r,-d/2+r);g.userData.qualityShape={type:'box',w,h,d,radius};return g;});
  }
  function sphere(foliage=false){const segments=QUALITY_PROFILES[tier].sphere,detail=foliage?Math.min(segments,36):segments;return geometry(`sphere:${detail}:${foliage}`,()=>{const g=new THREE.SphereGeometry(1,detail,Math.round(detail*.65));if(foliage){const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=1+.09*Math.sin(x*6.7+z*4.2)*Math.cos(y*5.3)+.035*Math.sin(z*13+x*9);p.setXYZ(i,x*f,y*f,z*f);}g.computeVertexNormals();}g.userData.qualityShape={type:'sphere',foliage};return g;});}
  function cylinder(){const n=QUALITY_PROFILES[tier].cylinder;return geometry('cylinder:'+n,()=>{const g=new THREE.CylinderGeometry(1,1,1,n);g.userData.qualityShape={type:'cylinder'};return g;});}
  function capsule(radius,length){const n=QUALITY_PROFILES[tier].cylinder;return geometry(`capsule:${radius}:${length}:${n}`,()=>{const g=new THREE.CapsuleGeometry(radius,length,Math.max(4,Math.round(n/4)),n);g.userData.qualityShape={type:'capsule',radius,length};return g;});}
  function qualityGeometry(original){const spec=original?.userData?.qualityShape;if(!spec)return original;if(spec.type==='box')return roundedBox(spec.w,spec.h,spec.d,spec.radius);if(spec.type==='sphere')return sphere(spec.foliage);if(spec.type==='cylinder')return cylinder();if(spec.type==='capsule')return capsule(spec.radius,spec.length);return original;}
  function mergedGeometry(parts){
    const sources=parts.map(part=>({...part,geometry:part.fixedLOD?part.geometry:qualityGeometry(part.geometry)}));
    const key='merged:'+sources.map(part=>part.geometry.uuid+':'+part.matrix.elements.join(',')).join('|');
    return geometry(key,()=>{let count=0;for(const part of sources)count+=part.geometry.index?.count||part.geometry.attributes.position.count;
      const position=new Float32Array(count*3),normal=new Float32Array(count*3),uv=new Float32Array(count*2),point=new THREE.Vector3(),direction=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();let offset=0;
      for(const part of sources){const g=part.geometry,p=g.attributes.position,n=g.attributes.normal,t=g.attributes.uv,idx=g.index;normalMatrix.getNormalMatrix(part.matrix);
        for(let i=0;i<(idx?.count||p.count);i++){const source=idx?idx.getX(i):i;point.fromBufferAttribute(p,source).applyMatrix4(part.matrix);position.set([point.x,point.y,point.z],offset*3);direction.set(n?n.getX(source):0,n?n.getY(source):1,n?n.getZ(source):0).applyMatrix3(normalMatrix).normalize();normal.set([direction.x,direction.y,direction.z],offset*3);if(t)uv.set([t.getX(source),t.getY(source)],offset*2);offset++;}
      }const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position,3));g.setAttribute('normal',new THREE.BufferAttribute(normal,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeBoundingSphere();return g;
    });
  }
  // Bake decorative parts by material while retaining animated joint groups.
  // Distant actors can flatten their entire static pose into only a few draws.
  function mergeStatic(parent,{flatten=false}={}){
    if(!flatten)for(const child of [...parent.children])if(child.isGroup)mergeStatic(child);
    parent.updateWorldMatrix(true,true);const inverse=new THREE.Matrix4().copy(parent.matrixWorld).invert(),buckets=new Map();
    const take=object=>{if(!object.isMesh||object.isInstancedMesh||Array.isArray(object.material))return;const key=object.material.uuid;if(!buckets.has(key))buckets.set(key,{material:object.material,objects:[],parts:[]});const bucket=buckets.get(key);bucket.objects.push(object);bucket.parts.push({geometry:object.geometry,matrix:new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld),fixedLOD:Boolean(object.userData.fixedLOD)});};
    if(flatten)parent.traverse(take);else for(const child of parent.children)take(child);
    for(const bucket of buckets.values()){if(bucket.parts.length<2&&!flatten)continue;const mesh=new THREE.Mesh(mergedGeometry(bucket.parts),bucket.material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.qualityParts=bucket.parts;for(const object of bucket.objects)object.removeFromParent();parent.add(mesh);}
    if(flatten)for(const child of [...parent.children])if(child.isGroup)parent.remove(child);
  }
  function updateGeometry(object){if(object.userData.fixedLOD)return;if(object.userData.qualityParts)object.geometry=mergedGeometry(object.userData.qualityParts);else object.geometry=qualityGeometry(object.geometry);if(object.isInstancedMesh)object.computeBoundingSphere();}
  function setQuality(value){const next=qualityName(value);if(next===tier)return;tier=next;for(const maps of textures.values())for(const t of Object.values(maps))t.dispose();textures.clear();for(const t of clones)t.dispose();clones.clear();for(const [mat,info] of [...bindings])apply(mat,info.type,info);}
  function dispose(){for(const maps of textures.values())for(const t of Object.values(maps))t.dispose();for(const t of clones)t.dispose();for(const g of geometries.values())g.dispose();for(const m of ownedMaterials)m.dispose();textures.clear();geometries.clear();bindings.clear();clones.clear();}
  return {apply,material,roundedBox,sphere,cylinder,capsule,mergeStatic,updateGeometry,setQuality,dispose,get tier(){return tier;},get profile(){return QUALITY_PROFILES[tier];}};
}

/** Fine leaf blades are instanced only on nearby trees; the canopy remains the distant LOD. */
export function createVegetationDetail(THREE,{trees=[],heightAt=()=>0,quality='high'}={}){
  const group=new THREE.Group();group.name='近景の葉';let tier=qualityName(quality),lastX=Infinity,lastZ=Infinity,disposed=false;
  const positions=[],uvs=[],indices=[],segments=7;
  for(let i=0;i<=segments;i++){const t=i/segments,w=Math.sin(Math.PI*t)*.055;for(const side of [-1,1]){positions.push((t-.5)*.24,Math.sin(t*Math.PI)*.018,side*w);uvs.push(t,(side+1)/2);}}
  for(let i=0;i<segments;i++){const p=i*2;indices.push(p,p+1,p+2,p+1,p+3,p+2);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.MeshPhysicalMaterial({color:'#6e8b57',roughness:.8,side:THREE.DoubleSide,sheen:.3,sheenColor:new THREE.Color('#b3be7c')});
  const capacity=9000,mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.count=0;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),e=new THREE.Euler(),color=new THREE.Color();
  function update(observer={x:0,z:0},force=false){if(disposed)return;const x=Number(observer.x)||0,z=Number(observer.z)||0;if(!force&&Math.hypot(x-lastX,z-lastZ)<4)return;lastX=x;lastZ=z;
    const profile=QUALITY_PROFILES[tier],near=trees.map(t=>({...t,d:Math.hypot(t.x-x,t.z-z)})).filter(t=>t.d<profile.leafDistance).sort((a,b)=>a.d-b.d).slice(0,38);let count=0;
    for(const tree of near){let seed=(tree.seed||tree.id||37)>>>0;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const scale=tree.scale||1,base=heightAt(tree.x,tree.z),top=tree.canopyY??(3.5*scale+1*scale),size=tree.canopySize||1.65*scale;
      for(let i=0;i<profile.leafCount&&count<capacity;i++){const a=rand()*Math.PI*2,y=rand()*2-1,r=Math.sqrt(Math.max(0,1-y*y)),rho=.91+rand()*.16;p.set(tree.x+Math.cos(a)*r*size*rho,base+top+y*size*.91*rho,tree.z+Math.sin(a)*r*size*rho);e.set(rand()*1.4,a,rand()*.7);q.setFromEuler(e);s.setScalar((.85+rand()*.7)*scale);m.compose(p,q,s);mesh.setMatrixAt(count,m);color.setHSL(.23+rand()*.05,.23+rand()*.15,.27+rand()*.1);mesh.setColorAt(count,color);count++;}
    }
    mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
  }
  function setQuality(value){tier=qualityName(value);update({x:lastX===Infinity?0:lastX,z:lastZ===Infinity?0:lastZ},true);}
  function dispose(){disposed=true;geometry.dispose();material.dispose();group.removeFromParent();group.clear();}
  return {group,update,setQuality,dispose};
}
