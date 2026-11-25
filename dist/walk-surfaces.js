/** Static, explicitly registered walking surfaces. Scenery is never raycast.
 * Heights and normals use the same triangles as the rendered floors/terrain.
 * A horizontal spatial hash keeps each foot/physics query local even in cities.
 */
export function createWalkSurfaceIndex({cellSize=8,bounds=null}={}){
  cellSize=Number.isFinite(cellSize)&&cellSize>0?cellSize:8;
  const cells=new Map();let triangleCount=0,lastCandidates=0;
  const epsilon=1e-6;
  const key=(x,z)=>`${x},${z}`;
  function addTriangle(a,b,c,metadata={}){
    if(![a?.x,a?.y,a?.z,b?.x,b?.y,b?.z,c?.x,c?.y,c?.z].every(Number.isFinite))return false;
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    const determinant=ux*vz-vx*uz;
    // Vertical risers/walls cannot support a foot. Slopes retain their actual normal.
    if(Math.abs(determinant)<1e-10)return false;
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const length=Math.hypot(nx,ny,nz),sign=ny<0?-1:1;
    nx=nx/length*sign;ny=ny/length*sign;nz=nz/length*sign;
    const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x),minZ=Math.min(a.z,b.z,c.z),maxZ=Math.max(a.z,b.z,c.z);
    if(bounds&&(maxX<bounds.minX||minX>bounds.maxX||maxZ<bounds.minZ||minZ>bounds.maxZ))return false;
    const triangle={x:a.x,y:a.y,z:a.z,ux,uy,uz,vx,vy,vz,inverse:1/determinant,minX,maxX,minZ,maxZ,minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y),normal:{x:nx,y:ny,z:nz},kind:metadata.kind||'ground',id:metadata.id??null};
    const x0=Math.floor(Math.max(minX-epsilon,bounds?.minX??-Infinity)/cellSize),x1=Math.floor(Math.min(maxX+epsilon,bounds?.maxX??Infinity)/cellSize);
    const z0=Math.floor(Math.max(minZ-epsilon,bounds?.minZ??-Infinity)/cellSize),z1=Math.floor(Math.min(maxZ+epsilon,bounds?.maxZ??Infinity)/cellSize);
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const k=key(x,z);let bucket=cells.get(k);if(!bucket){bucket=[];cells.set(k,bucket);}bucket.push(triangle);}
    triangleCount++;return true;
  }
  function addRect({x=0,z=0,width,depth,height=0,yaw=0},metadata={}){
    if(!(width>0&&depth>0))return;
    const cs=Math.cos(yaw),sn=Math.sin(yaw),point=(xx,zz)=>({x:x+xx*cs+zz*sn,y:height,z:z-xx*sn+zz*cs});
    const a=point(-width/2,-depth/2),b=point(width/2,-depth/2),c=point(width/2,depth/2),d=point(-width/2,depth/2);
    addTriangle(a,b,d,metadata);addTriangle(b,c,d,metadata);
  }
  function addGeometry(geometry,metadata={},matrix=null){
    const positions=geometry?.attributes?.position;if(!positions)return;
    const index=geometry.index,elements=matrix?.elements||matrix;
    const vertex=i=>{
      const j=index?index.getX(i):i,x=positions.getX(j),y=positions.getY(j),z=positions.getZ(j);
      if(!elements)return {x,y,z};
      const w=1/(elements[3]*x+elements[7]*y+elements[11]*z+elements[15]);
      return {x:(elements[0]*x+elements[4]*y+elements[8]*z+elements[12])*w,y:(elements[1]*x+elements[5]*y+elements[9]*z+elements[13])*w,z:(elements[2]*x+elements[6]*y+elements[10]*z+elements[14])*w};
    };
    const count=index?.count??positions.count;
    for(let i=0;i+2<count;i+=3)addTriangle(vertex(i),vertex(i+1),vertex(i+2),metadata);
  }
  function sampleGround(x,z,{maxHeight=Infinity,minHeight=-Infinity}={}){
    lastCandidates=0;
    if(!Number.isFinite(x)||!Number.isFinite(z)||Number.isNaN(minHeight)||Number.isNaN(maxHeight)||maxHeight<minHeight)return null;
    if(bounds&&(x<bounds.minX-epsilon||x>bounds.maxX+epsilon||z<bounds.minZ-epsilon||z>bounds.maxZ+epsilon))return null;
    const bucket=cells.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)));if(!bucket)return null;
    let best=null,bestHeight=-Infinity;
    for(const t of bucket){
      lastCandidates++;
      if(x<t.minX-epsilon||x>t.maxX+epsilon||z<t.minZ-epsilon||z>t.maxZ+epsilon||t.minY>maxHeight+epsilon||t.maxY<minHeight-epsilon||t.maxY<bestHeight-epsilon)continue;
      const dx=x-t.x,dz=z-t.z,b=(dx*t.vz-t.vx*dz)*t.inverse,c=(t.ux*dz-dx*t.uz)*t.inverse;
      if(b<-epsilon||c<-epsilon||b+c>1+epsilon)continue;
      const height=t.y+b*t.uy+c*t.vy;
      if(height<minHeight-epsilon||height>maxHeight+epsilon||height<bestHeight-epsilon)continue;
      best=t;bestHeight=height;
    }
    return best?{height:bestHeight,normal:{...best.normal},kind:best.kind,id:best.id}:null;
  }
  function clear(){cells.clear();triangleCount=0;lastCandidates=0;}
  return {addTriangle,addRect,addGeometry,sampleGround,clear,dispose:clear,stats:()=>({triangles:triangleCount,cells:cells.size,lastCandidates})};
}
