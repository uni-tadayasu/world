/** Upright character contacts in world metres. Render LODs are never inspected at runtime. */
const EPS=.002;
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const pointX=p=>p.x??p[0],pointZ=p=>p.z??p[1];
const validPoint=p=>p&&Number.isFinite(pointX(p))&&Number.isFinite(pointZ(p));

export function createBoxCollider({x=0,z=0,width=1,depth=1,yaw=0,minY=0,maxY=1,...extra}={}){
  const halfX=Math.max(.001,finite(width,1)/2),halfZ=Math.max(.001,finite(depth,1)/2),rotation=finite(yaw),c=Math.abs(Math.cos(rotation)),s=Math.abs(Math.sin(rotation));
  x=finite(x);z=finite(z);
  return {...extra,shape:'box',x,z,width:halfX*2,depth:halfZ*2,yaw:rotation,minY,maxY,
    minX:x-c*halfX-s*halfZ,maxX:x+c*halfX+s*halfZ,minZ:z-s*halfX-c*halfZ,maxZ:z+s*halfX+c*halfZ};
}
export function createCylinderCollider({x=0,z=0,radius=.25,minY=0,maxY=1,...extra}={}){
  x=finite(x);z=finite(z);radius=Math.max(.001,finite(radius,.25));
  return {...extra,shape:'cylinder',x,z,radius,minY,maxY,minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};
}
function normalized(raw){
  if(!raw||raw.enabled===false||raw.visible===false||raw.collision===false)return null;
  let c=raw;
  if(raw.shape==='box')c=createBoxCollider(raw);
  else if(raw.shape==='cylinder'||raw.shape==='circle')c=createCylinderCollider(raw);
  else if(raw.polygon?.length>=3&&raw.polygon.every(validPoint)){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const p of raw.polygon){const x=pointX(p),z=pointZ(p);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    c={...raw,shape:'polygon',minX,maxX,minZ,maxZ,holes:(raw.holes||[]).filter(h=>h.length>=3&&h.every(validPoint))};
  }
  if(![c.minX,c.maxX,c.minZ,c.maxZ].every(Number.isFinite)||c.minX>c.maxX||c.minZ>c.maxZ)return null;
  // Legacy callers may omit heights. All scene registrations in production supply them.
  const minY=Number.isFinite(c.minY)?c.minY:-Infinity,maxY=Number.isFinite(c.maxY)?c.maxY:Infinity;
  return maxY>minY?{...c,minY,maxY}:null;
}
function inside(x,z,points){
  let result=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const ax=pointX(points[i]),az=pointZ(points[i]),bx=pointX(points[j]),bz=pointZ(points[j]);
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)result=!result;
  }return result;
}
function edgeDistanceSquared(x,z,a,b){
  const ax=pointX(a),az=pointZ(a),dx=pointX(b)-ax,dz=pointZ(b)-az,length=dx*dx+dz*dz;
  const t=length?clamp(((x-ax)*dx+(z-az)*dz)/length,0,1):0;
  return (x-ax-t*dx)**2+(z-az-t*dz)**2;
}
function nearEdge(x,z,r,polygon){const rr=r*r;return polygon.some((p,i)=>edgeDistanceSquared(x,z,p,polygon[(i+1)%polygon.length])<rr);}
function overlapsXZ(c,x,z,radius){
  if(x+radius<=c.minX||x-radius>=c.maxX||z+radius<=c.minZ||z-radius>=c.maxZ)return false;
  if(c.shape==='cylinder'||c.shape==='circle')return Math.hypot(x-c.x,z-c.z)<radius+c.radius;
  if(c.shape==='box'){
    const dx=x-c.x,dz=z-c.z,cos=Math.cos(c.yaw),sin=Math.sin(c.yaw),lx=cos*dx-sin*dz,lz=sin*dx+cos*dz;
    const nx=clamp(lx,-c.width/2,c.width/2),nz=clamp(lz,-c.depth/2,c.depth/2);
    return (lx-nx)**2+(lz-nz)**2<radius*radius;
  }
  if(c.polygon?.length){
    for(const hole of c.holes||[])if(inside(x,z,hole))return nearEdge(x,z,radius,hole);
    return inside(x,z,c.polygon)||nearEdge(x,z,radius,c.polygon);
  }
  const nx=clamp(x,c.minX,c.maxX),nz=clamp(z,c.minZ,c.maxZ);
  return (x-nx)**2+(z-nz)**2<radius*radius;
}
function heightOverlaps(c,y,height){return y+height>c.minY+EPS&&y<c.maxY-EPS;}

/** A round horizontal body with a finite height, including rotated object footprints. */
export function colliderIntersects(collider,{x,y=0,z,radius=.32,height=1.75}={}){
  if(![x,y,z,radius,height].every(Number.isFinite))return false;
  const c=normalized(collider);return !!c&&heightOverlaps(c,y,Math.max(.01,height))&&overlapsXZ(c,x,z,Math.max(.001,radius));
}

/** Static cells stay reusable; a small dynamic actor pool is read on each query. */
export function createObjectCollisionIndex({colliders=[],getDynamic=()=>[],cellSize=8}={}){
  const size=clamp(finite(cellSize,8),1,64),grid=new Map(),large=[];let objects=[],disposed=false;
  function replaceStatic(next=[]){
    if(disposed)return;objects=[];grid.clear();large.length=0;
    for(const raw of next){const c=normalized(raw);if(!c)continue;objects.push(c);
      const x0=Math.floor(c.minX/size),x1=Math.floor(c.maxX/size),z0=Math.floor(c.minZ/size),z1=Math.floor(c.maxZ/size);
      if((x1-x0+1)*(z1-z0+1)>256){large.push(c);continue;}
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(c);}
    }
  }
  function nearby(x,z,radius){
    if(disposed)return [];
    const found=new Set(large);
    for(let ix=Math.floor((x-radius)/size);ix<=Math.floor((x+radius)/size);ix++)for(let iz=Math.floor((z-radius)/size);iz<=Math.floor((z+radius)/size);iz++)for(const c of grid.get(ix+','+iz)||[])found.add(c);
    let dynamic;try{dynamic=getDynamic()||[];}catch{dynamic=[];}
    for(const raw of dynamic){const c=normalized(raw);if(c&&x+radius>c.minX&&x-radius<c.maxX&&z+radius>c.minZ&&z-radius<c.maxZ)found.add(c);}
    return found;
  }
  function isBlocked(x,z,radius=.32,feetY=0,height=1.75){
    if(![x,z,radius,feetY,height].every(Number.isFinite))return true;
    radius=Math.max(.001,radius);height=Math.max(.01,height);
    for(const c of nearby(x,z,radius))if(heightOverlaps(c,feetY,height)&&overlapsXZ(c,x,z,radius))return true;
    return false;
  }
  function sampleSupport(x,z,feetY,maxStep=.35,radius=.32){
    if(![x,z,feetY,maxStep,radius].every(Number.isFinite))return null;let best=null;
    for(const c of nearby(x,z,radius)){
      if(c.support===false||c.walkable===false||!Number.isFinite(c.maxY)||c.maxY>feetY+Math.max(0,maxStep)+EPS||best&&c.maxY<=best.height)continue;
      if(overlapsXZ(c,x,z,Math.max(.001,radius)))best={height:c.maxY,normal:{x:0,y:1,z:0},kind:'object',id:c.id??c.objectId??c.buildingId??null,object:c};
    }return best;
  }
  function sweepVertical({x,z,radius=.32,height=1.75,fromY,toY}={}){
    const result={y:toY,hit:false,grounded:false,ceiling:false,object:null};
    if(![x,z,radius,height,fromY,toY].every(Number.isFinite)||Math.abs(toY-fromY)<1e-9)return result;
    const upward=toY>fromY;
    for(const c of nearby(x,z,radius)){
      if(c.vertical===false||!overlapsXZ(c,x,z,Math.max(.001,radius)))continue;
      const surface=upward?c.minY-height:c.maxY;if(!Number.isFinite(surface))continue;
      const crossing=upward?fromY<=surface+EPS&&toY>=surface-EPS:fromY>=surface-EPS&&toY<=surface+EPS;
      if(!crossing||result.hit&&(upward?surface>=result.y:surface<=result.y))continue;
      Object.assign(result,{y:surface,hit:true,grounded:!upward,ceiling:upward,object:c,normal:{x:0,y:upward?-1:1,z:0},kind:'object'});
    }return result;
  }
  function dispose(){disposed=true;objects=[];large.length=0;grid.clear();}
  replaceStatic(colliders);
  return {replaceStatic,isBlocked,sampleSupport,sweepVertical,dispose,get size(){return objects.length;}};
}

/** Build one stable hull for an explicitly chosen semantic object, never both visible LODs. */
export function colliderFromObject(THREE,object,{id,type='object',support=true,...extra}={}){
  if(!object)return null;object.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(object.matrixWorld).invert(),local=new THREE.Box3(),part=new THREE.Box3(),matrix=new THREE.Matrix4();
  local.makeEmpty();
  function visit(node){
    if(node.visible===false||node.userData?.collision===false)return;
    if(node.isMesh&&!node.isInstancedMesh&&node.geometry){
      if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
      if(node.geometry.boundingBox){matrix.multiplyMatrices(inverse,node.matrixWorld);part.copy(node.geometry.boundingBox).applyMatrix4(matrix);local.union(part);}
    }
    for(const child of node.children||[])visit(child);
  }
  visit(object);if(local.isEmpty())return null;
  const m=object.matrixWorld.elements,world=local.clone().applyMatrix4(object.matrixWorld),center=local.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  if(![...world.min,...world.max].every(Number.isFinite)||world.max.y-world.min.y<.003)return null;
  if(Math.abs(m[1])+Math.abs(m[9])>.0001)return {...extra,id,type,shape:'aabb',support,minY:world.min.y,maxY:world.max.y,minX:world.min.x,maxX:world.max.x,minZ:world.min.z,maxZ:world.max.z};
  return createBoxCollider({...extra,id,type,support,x:center.x,z:center.z,width:(local.max.x-local.min.x)*Math.hypot(m[0],m[2]),depth:(local.max.z-local.min.z)*Math.hypot(m[8],m[10]),yaw:Math.atan2(-m[2],m[0]),minY:world.min.y,maxY:world.max.y});
}
