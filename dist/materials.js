/** Deterministic PBR surfaces and reusable detail geometry. No asset downloads. */
import {generateSurfaceData,surfaceMeters,surfaceSeed} from './surface-textures.js';
import {treeLayout,buildTreeGeometry} from './vegetation.js';
export {SURFACE_METERS,surfaceMeters} from './surface-textures.js';
const sharedTextureCaches=new WeakMap();
export const QUALITY_PROFILES={
  low:{texture:128,sphere:14,cylinder:12,bevel:1,leafCount:32,leafDistance:18,cars:4,people:8,view:100},
  medium:{texture:256,sphere:22,cylinder:20,bevel:2,leafCount:70,leafDistance:27,cars:8,people:14,view:150},
  auto:{texture:256,sphere:30,cylinder:28,bevel:3,leafCount:110,leafDistance:34,cars:10,people:18,view:190},
  high:{texture:512,sphere:36,cylinder:32,bevel:4,leafCount:180,leafDistance:42,cars:14,people:24,view:220},
  ultra:{texture:768,sphere:52,cylinder:48,bevel:6,leafCount:280,leafDistance:55,cars:20,people:32,view:270},
  cinematic:{texture:1024,sphere:72,cylinder:64,bevel:8,leafCount:400,leafDistance:70,cars:26,people:42,view:320}
};
export function qualityName(tier){return Object.hasOwn(QUALITY_PROFILES,tier)?tier:'high';}
export function createMaterialLibrary(THREE,{quality='high',maxTextureSize}={}){
  let tier=qualityName(quality),disposed=false;
  const textures=new Map(),textureRefs=new Map(),geometries=new Map(),bindings=new Map(),ownedMaterials=new Set(),clones=new Set();
  const memory=Number(globalThis.navigator?.deviceMemory),mobile=globalThis.matchMedia?.('(pointer:coarse)')?.matches||(Number.isFinite(memory)&&memory<=4);
  const textureLimit=Math.max(32,Math.min(1024,Number(maxTextureSize)||(mobile?256:1024)));
  let cache=sharedTextureCaches.get(THREE);if(!cache){cache=new Map();sharedTextureCaches.set(THREE,cache);}
  function surface(type){
    if(textures.has(type))return textures.get(type);
    const detailLimit=type==='glass'?32:['paint','metal','water'].includes(type)?128:1024;
    const n=Math.min(QUALITY_PROFILES[tier].texture,textureLimit,detailLimit),anisotropy=tier==='low'?2:mobile?4:8,key=`${type}:${n}:${anisotropy}`;
    let pack=cache.get(key);
    if(!pack){
      const data=generateSurfaceData(type,n);
      const tex=(bytes,colorSpace)=>{const t=new THREE.DataTexture(bytes,data.width,data.height,THREE.RGBAFormat);t.colorSpace=colorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=anisotropy;t.needsUpdate=true;t.userData={surfaceType:type,surfaceMeters:data.meters};return t;};
      const maps={map:tex(data.albedo,THREE.SRGBColorSpace),normalMap:tex(data.normal,THREE.NoColorSpace),roughnessMap:tex(data.roughness,THREE.NoColorSpace)};
      pack={key,maps,references:0,bytes:data.width*data.height*4*3};cache.set(key,pack);
    }
    pack.references++;textureRefs.set(type,pack);textures.set(type,pack.maps);return pack.maps;
  }
  function releaseTextures(){for(const pack of textureRefs.values()){if(--pack.references===0){for(const t of Object.values(pack.maps))t.dispose();cache.delete(pack.key);}}textureRefs.clear();textures.clear();}
  function releaseClones(info){for(const t of info?.generated||[]){t.dispose();clones.delete(t);}}
  function ownsTexture(texture){return clones.has(texture)||[...textures.values()].some(maps=>Object.values(maps).includes(texture));}
  function apply(material,type='plaster',{preserveMap=true,repeat}={}){
    if(disposed||!material?.isMaterial)return material;
    const old=bindings.get(material),original=old?{...old.original}:{map:material.map,normalMap:material.normalMap,roughnessMap:material.roughnessMap,normalScale:material.normalScale?.clone?.()};
    if(old)for(const name of ['map','normalMap','roughnessMap'])if(material[name]!==old.applied[name])original[name]=material[name];
    releaseClones(old);
    const maps=surface(type),baseRepeat=repeat||original.map?.repeat||{x:1,y:1},reps={x:Number(baseRepeat.x)||1,y:Number(baseRepeat.y)||1},generated=[];
    const wrapped=t=>{if(reps.x===1&&reps.y===1)return t;const copy=t.clone();copy.repeat.set(reps.x,reps.y);clones.add(copy);generated.push(copy);copy.needsUpdate=true;return copy;};
    for(const name of ['map','normalMap','roughnessMap'])material[name]=preserveMap&&original[name]?original[name]:wrapped(maps[name]);
    const strength=type==='glass'?.02:type==='paint'?.16:type==='fabric'?.65:type==='bark'?1.1:.9;
    material.normalScale=preserveMap&&original.normalMap?original.normalScale||new THREE.Vector2(1,1):new THREE.Vector2(strength,strength);
    material.userData.surfaceType=type;material.userData.surfaceMeters=surfaceMeters(type);material.needsUpdate=true;
    const info={type,preserveMap,repeat:repeat?new THREE.Vector2(reps.x,reps.y):undefined,original,generated,applied:{map:material.map,normalMap:material.normalMap,roughnessMap:material.roughnessMap}};
    if(!old){info.onDispose=()=>{const current=bindings.get(material);releaseClones(current);bindings.delete(material);ownedMaterials.delete(material);material.removeEventListener('dispose',info.onDispose);};material.addEventListener('dispose',info.onDispose);}else info.onDispose=old.onDispose;
    bindings.set(material,info);return material;
  }
  function material(type,color,options={}){
    const physical=['paint','glass','metal','fabric','water','wood','leaf','foliage'].includes(type);
    const defaults={wood:{roughness:.52,clearcoat:.18,clearcoatRoughness:.48},paint:{roughness:.25,metalness:.35,clearcoat:1,clearcoatRoughness:.13},glass:{roughness:.13,metalness:0,clearcoat:1,clearcoatRoughness:.08},fabric:{roughness:.92,sheen:.6,sheenRoughness:.8,sheenColor:new THREE.Color(color)},metal:{roughness:.3,metalness:.75},water:{roughness:.14,metalness:.06,clearcoat:1},foliage:{roughness:.88,side:THREE.DoubleSide,alphaTest:.42,depthWrite:true,sheen:.2,sheenColor:new THREE.Color('#b7c98b')},leaf:{roughness:.85,side:THREE.DoubleSide,sheen:.25,sheenColor:new THREE.Color('#b7c98b')},asphalt:{roughness:1},concrete:{roughness:.98},plaster:{roughness:.98},brick:{roughness:.97},paving:{roughness:.98},tile:{roughness:.93},grass:{roughness:1}}[type]||{roughness:.95};
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
  function treeParts(variant=0){
    const v=treeLayout(variant).variant,key=`tree:${tier}:${v}`;
    if(!geometries.has(key+':canopy')){const parts=buildTreeGeometry(THREE,{variant:v,quality:tier});geometries.set(key+':canopy',parts.canopy);geometries.set(key+':branches',parts.branches);}
    return {canopy:geometries.get(key+':canopy'),branches:geometries.get(key+':branches')};
  }
  const treeCanopy=variant=>treeParts(variant).canopy,treeBranches=variant=>treeParts(variant).branches;
  function qualityGeometry(original){const spec=original?.userData?.qualityShape;if(!spec)return original;if(spec.type==='box')return roundedBox(spec.w,spec.h,spec.d,spec.radius);if(spec.type==='sphere')return sphere(spec.foliage);if(spec.type==='cylinder')return cylinder();if(spec.type==='capsule')return capsule(spec.radius,spec.length);if(spec.type==='treeCanopy')return treeCanopy(spec.variant);if(spec.type==='treeBranches')return treeBranches(spec.variant);return original;}
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
  function setQuality(value){const next=qualityName(value);if(disposed||next===tier)return;tier=next;releaseTextures();for(const [mat,info] of [...bindings])apply(mat,info.type,info);}
  function dispose(){if(disposed)return;disposed=true;for(const [mat,info]of bindings){releaseClones(info);mat.removeEventListener('dispose',info.onDispose);}releaseTextures();for(const g of geometries.values())g.dispose();for(const m of ownedMaterials)m.dispose();geometries.clear();bindings.clear();clones.clear();ownedMaterials.clear();}
  return {apply,material,roundedBox,sphere,cylinder,capsule,treeCanopy,treeBranches,surfaceMeters,ownsTexture,mergeStatic,updateGeometry,setQuality,dispose,get tier(){return tier;},get profile(){return QUALITY_PROFILES[tier];},get resourceStats(){return {surfaceTypes:textures.size,textureBytes:[...textureRefs.values()].reduce((sum,p)=>sum+p.bytes,0),textureLimit,textureClones:clones.size,geometries:geometries.size};}};

}

/** Fine leaf blades are instanced only on nearby trees; the canopy remains the distant LOD. */
export function createVegetationDetail(THREE,{trees=[],heightAt=()=>0,quality='high'}={}){
  const group=new THREE.Group();group.name='近景の葉';let tier=qualityName(quality),lastX=Infinity,lastZ=Infinity,disposed=false;
  const positions=[],uvs=[],indices=[],segments=7;
  for(let i=0;i<=segments;i++){const t=i/segments,w=Math.sin(Math.PI*t)*.055;for(const side of [-1,1]){positions.push((t-.5)*.24,Math.sin(t*Math.PI)*.018,side*w);uvs.push(t,(side+1)/2);}}
  for(let i=0;i<segments;i++){const p=i*2;indices.push(p,p+1,p+2,p+1,p+3,p+2);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const library=createMaterialLibrary(THREE,{quality:tier,maxTextureSize:256}),material=library.material('leaf','#ffffff');
  const capacity=12000,mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.count=0;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),e=new THREE.Euler(),color=new THREE.Color();
  function update(observer={x:0,z:0},force=false){if(disposed)return;const x=Number(observer.x)||0,z=Number(observer.z)||0;if(!force&&Math.hypot(x-lastX,z-lastZ)<4)return;lastX=x;lastZ=z;
    const profile=QUALITY_PROFILES[tier],treeLimit={low:12,medium:20,auto:26,high:32,ultra:38,cinematic:40}[tier],near=trees.map(t=>({...t,d:Math.hypot(t.x-x,t.z-z)})).filter(t=>Number.isFinite(t.d)&&t.d<profile.leafDistance).sort((a,b)=>a.d-b.d).slice(0,treeLimit);let count=0;
    for(const tree of near){let seed=surfaceSeed(tree.seed??tree.id??`${tree.x},${tree.z}`);const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},scale=Math.max(.1,Number(tree.scale)||1),base=Number(heightAt(tree.x,tree.z))||0,yaw=Number(tree.rotation)||0,c=Math.cos(yaw),sn=Math.sin(yaw),clusters=treeLayout(tree.variant).clusters;
      for(let i=0;i<profile.leafCount&&count<capacity;i++){
        const cluster=clusters[i%clusters.length],a=rand()*Math.PI*2,ry=rand()*2-1,r=Math.sqrt(Math.max(0,1-ry*ry)),rho=Math.cbrt(rand())*.78;
        const lx=(cluster.x+Math.cos(a)*r*cluster.radius*rho)*scale,lz=(cluster.z+Math.sin(a)*r*cluster.radius*rho)*scale;
        p.set(tree.x+c*lx+sn*lz,base+(cluster.y+ry*cluster.radius*.75*rho)*scale,tree.z-sn*lx+c*lz);e.set((rand()-.5)*1.5,cluster.angle+a+yaw,(rand()-.5)*1.0);q.setFromEuler(e);s.setScalar((.8+rand()*.65)*scale);m.compose(p,q,s);mesh.setMatrixAt(count,m);color.setHSL(.23+rand()*.045,.23+rand()*.14,.39+rand()*.15);mesh.setColorAt(count,color);count++;
      }
    }
    mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
  }
  function setQuality(value){if(disposed)return;tier=qualityName(value);library.setQuality(tier);update({x:lastX===Infinity?0:lastX,z:lastZ===Infinity?0:lastZ},true);}
  function dispose(){if(disposed)return;disposed=true;geometry.dispose();library.dispose();group.removeFromParent();group.clear();}
  return {group,update,setQuality,dispose};
}
