/** Metre-based street geometry. Convex clipping keeps junctions free of layered road faces. */
const EPS=1e-7;
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
export const polygonAreaXZ=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.z-q.x*p.z;},0)/2;
function clean(points){
  const out=[];for(const p of points)if(Number.isFinite(p.x)&&Number.isFinite(p.z)&&(!out.length||Math.hypot(p.x-out.at(-1).x,p.z-out.at(-1).z)>EPS))out.push({x:p.x,z:p.z});
  if(out.length>1&&Math.hypot(out[0].x-out.at(-1).x,out[0].z-out.at(-1).z)<EPS)out.pop();
  return out.length>=3&&Math.abs(polygonAreaXZ(out))>EPS?out:[];
}
function positive(points){const p=clean(points);return polygonAreaXZ(p)<0?p.reverse():p;}
function boundsOf(points){return points.reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minZ:Math.min(b.minZ,p.z),maxZ:Math.max(b.maxZ,p.z)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});}
function split(points,a,b){
  const inside=[],outside=[];
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],dp=cross(a,b,p),dq=cross(a,b,q);
    if(dp>=-EPS)inside.push(p);if(dp<=EPS)outside.push(p);
    if((dp>EPS&&dq<-EPS)||(dp<-EPS&&dq>EPS)){const t=dp/(dp-dq),hit={x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t};inside.push(hit);outside.push(hit);}
  }
  return [clean(inside),clean(outside)];
}
export function subtractConvexPolygon(subject,clip){
  let remaining=positive(subject);const cutter=positive(clip),outside=[];if(!cutter.length)return remaining.length?[remaining]:[];
  if(!remaining.length)return [];
  // Most neighboring street patches merely share an edge. Reject separated
  // convex pairs before allocating clipped pieces, including diagonal contacts.
  for(const [axes,vertices] of [[cutter,remaining],[remaining,cutter]])for(let i=0;i<axes.length;i++)if(vertices.every(p=>cross(axes[i],axes[(i+1)%axes.length],p)<=EPS))return [remaining];
  if(cutter.every((a,i)=>remaining.every(p=>cross(a,cutter[(i+1)%cutter.length],p)>=-EPS)))return [];
  for(let i=0;i<cutter.length&&remaining.length;i++){
    const [within,without]=split(remaining,cutter[i],cutter[(i+1)%cutter.length]);
    if(without.length)outside.push(without);remaining=within;
  }
  return outside;
}

/** The index stores original convex footprints, while emitted surfaces are disjoint. */
export function createPolygonCoverage({cellSize=24}={}){
  const cells=new Map(),entries=[];
  function keys(bounds){const result=[];for(let z=Math.floor(bounds.minZ/cellSize);z<=Math.floor(bounds.maxZ/cellSize);z++)for(let x=Math.floor(bounds.minX/cellSize);x<=Math.floor(bounds.maxX/cellSize);x++)result.push(x+','+z);return result;}
  function nearby(bounds){const found=new Set();for(const key of keys(bounds))for(const id of cells.get(key)||[])found.add(id);return [...found].sort((a,b)=>a-b).map(id=>entries[id]).filter(e=>e.bounds.maxX>=bounds.minX-EPS&&e.bounds.minX<=bounds.maxX+EPS&&e.bounds.maxZ>=bounds.minZ-EPS&&e.bounds.minZ<=bounds.maxZ+EPS);}
  function add(points,metadata={}){const polygon=positive(points);if(!polygon.length)return;const bounds=boundsOf(polygon),id=entries.length;entries.push({polygon,bounds,metadata});for(const key of keys(bounds)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);}}
  function subtract(points){
    let fragments=[positive(points)].filter(p=>p.length);if(!fragments.length)return [];
    const bounds=boundsOf(points);
    for(const entry of nearby(bounds)){if(entry.bounds.maxX<=bounds.minX+EPS||entry.bounds.minX>=bounds.maxX-EPS||entry.bounds.maxZ<=bounds.minZ+EPS||entry.bounds.minZ>=bounds.maxZ-EPS)continue;const next=[];for(const polygon of fragments)next.push(...subtractConvexPolygon(polygon,entry.polygon));fragments=next;if(!fragments.length)break;}
    return fragments;
  }
  function contains(p,predicate=()=>true){return nearby({minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z}).some(e=>predicate(e.metadata)&&e.polygon.every((a,i)=>cross(a,e.polygon[(i+1)%e.polygon.length],p)>=-EPS));}
  return {add,subtract,contains,stats:()=>({polygons:entries.length,cells:cells.size}),clear(){cells.clear();entries.length=0;}};
}

/** Shared mitered cross-sections close every bend; a bounded miter avoids hairpin spikes. */
export function joinedStripPolygons(input,from,to,{maxSegment=8,miterLimit=2}={}){
  const points=input.filter((p,i)=>!i||Math.hypot(p.x-input[i-1].x,p.z-input[i-1].z)>1e-5);if(points.length<2||Math.abs(from-to)<EPS)return [];
  const directions=points.slice(1).map((p,i)=>{const a=points[i],length=Math.hypot(p.x-a.x,p.z-a.z);return {x:(p.x-a.x)/length,z:(p.z-a.z)/length,length};});
  const offset=(i,distance)=>{
    const incoming=directions[Math.max(0,i-1)],outgoing=directions[Math.min(i,directions.length-1)];
    let nx=-incoming.z-outgoing.z,nz=incoming.x+outgoing.x,length=Math.hypot(nx,nz);
    if(length<1e-5){nx=-outgoing.z;nz=outgoing.x;length=1;}
    nx/=length;nz/=length;const projection=Math.max(.001,nx*(-outgoing.z)+nz*outgoing.x),miter=Math.min(miterLimit,1/projection);
    return {x:points[i].x+nx*distance*miter,z:points[i].z+nz*distance*miter};
  };
  const sides=points.map((p,i)=>[offset(i,from),offset(i,to)]),polygons=[];
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
  for(let i=0;i<directions.length;i++){
    const count=Math.max(1,Math.ceil(directions[i].length/maxSegment));
    for(let j=0;j<count;j++){
      const a=mix(sides[i][0],sides[i+1][0],j/count),b=mix(sides[i][1],sides[i+1][1],j/count),c=mix(sides[i][1],sides[i+1][1],(j+1)/count),d=mix(sides[i][0],sides[i+1][0],(j+1)/count);
      // Two convex patches also cover acute joins whose cross-section quad can fold.
      for(const triangle of [[a,b,c],[a,c,d]]){const p=positive(triangle);if(p.length)polygons.push(p);}
    }
  }
  return polygons;
}

/** Split large land/road triangles before sampling the DEM, including polygon holes. */
export function drapedSurfaceGeometry(THREE,triangles,heightAt,{offset=0,maxEdge=8,maxDepth=12}={}){
  const positions=[],uv=[],normals=[];
  function emit(a,b,c,depth=0){
    const lengths=[Math.hypot(a.x-b.x,a.z-b.z),Math.hypot(b.x-c.x,b.z-c.z),Math.hypot(c.x-a.x,c.z-a.z)],longest=Math.max(...lengths);
    if(longest>maxEdge&&depth<maxDepth){
      const index=lengths.indexOf(longest),points=[a,b,c],p=points[index],q=points[(index+1)%3],r=points[(index+2)%3],mid={x:(p.x+q.x)/2,z:(p.z+q.z)/2};emit(p,mid,r,depth+1);emit(mid,q,r,depth+1);return;
    }
    if(Math.abs(cross(a,b,c))<EPS)return;
    // Positive XZ area faces down in Three's Y-up coordinates.
    const face=cross(a,b,c)>0?[a,c,b]:[a,b,c];
    for(const p of face){positions.push(p.x,heightAt(p.x,p.z)+offset,p.z);uv.push(p.x,p.z);const dx=(heightAt(p.x+.25,p.z)-heightAt(p.x-.25,p.z))/.5,dz=(heightAt(p.x,p.z+.25)-heightAt(p.x,p.z-.25))/.5,n=Math.hypot(dx,1,dz);normals.push(-dx/n,1/n,-dz/n);}
  }
  for(const polygon of triangles)for(let i=1;i<polygon.length-1;i++)emit(polygon[0],polygon[i],polygon[i+1]);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geometry;
}

/** Vertical skirts for retaining foundations and curb faces; never walking support. */
export function verticalSkirtGeometry(THREE,polygons,upperAt,lowerAt,{maxEdge=4}={}){
  const positions=[],uv=[];
  const vertex=(p,y,u)=>{positions.push(p.x,y,p.z);uv.push(u,y);};
  for(const source of polygons){const polygon=positive(source);let distance=0;for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b.x-a.x,b.z-a.z),segments=Math.max(1,Math.ceil(length/maxEdge));
    for(let j=0;j<segments;j++){
      const t0=j/segments,t1=(j+1)/segments,p={x:a.x+(b.x-a.x)*t0,z:a.z+(b.z-a.z)*t0},q={x:a.x+(b.x-a.x)*t1,z:a.z+(b.z-a.z)*t1};
      const py=upperAt(p.x,p.z),qy=upperAt(q.x,q.z),pl=Math.min(py,lowerAt(p.x,p.z)),ql=Math.min(qy,lowerAt(q.x,q.z));
      const u=distance+length*t0,v=distance+length*t1;
      vertex(p,pl,u);vertex(p,py,u);vertex(q,qy,v);vertex(p,pl,u);vertex(q,qy,v);vertex(q,ql,v);
    }distance+=length;
  }}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
}

/** Facade apertures are actual holes with inset reveals, not glass pasted over a solid wall. */
export function facadePanelGeometry(THREE,polygon,baseY,height,openingsByEdge){
  const wall=[],reveal=[],orientation=Math.sign(polygonAreaXZ(polygon))||1;
  const quad=(target,a,b,c,d,normal)=>{
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    const dot=(uy*vz-uz*vy)*normal.x+(uz*vx-ux*vz)*normal.y+(ux*vy-uy*vx)*normal.z;
    for(const p of dot>=0?[a,b,c,a,c,d]:[a,c,b,a,d,c])target.push(p.x,p.y,p.z);
  };
  for(let edge=0;edge<polygon.length;edge++){
    const a=polygon[edge],b=polygon[(edge+1)%polygon.length],length=Math.hypot(b.x-a.x,b.z-a.z);if(length<1e-5)continue;
    const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,normal={x:tz*orientation,y:0,z:-tx*orientation};
    const at=(u,v,depth=0)=>({x:a.x+tx*u+normal.x*depth,y:baseY+v,z:a.z+tz*u+normal.z*depth});
    const rect=(u0,u1,v0,v1)=>{if(u1-u0<1e-6||v1-v0<1e-6)return;quad(wall,at(u0,v0),at(u1,v0),at(u1,v1),at(u0,v1),normal);};
    const windows=(openingsByEdge[edge]||[]).filter(w=>w.u0>=0&&w.u1<=length&&w.y0>=0&&w.y1<=height).sort((a,b)=>a.y0-b.y0||a.u0-b.u0);
    const rows=new Map();for(const window of windows){const key=window.y0+','+window.y1;if(!rows.has(key))rows.set(key,[]);rows.get(key).push(window);}
    let y=0;
    for(const row of rows.values()){
      const bottom=row[0].y0,top=row[0].y1;rect(0,length,y,bottom);let x=0;
      for(const window of row){rect(x,window.u0,bottom,top);x=window.u1;const {u0,u1,y0,y1}=window,depth=window.depth??.14;
        quad(reveal,at(u0,y0),at(u0,y1),at(u0,y1,-depth),at(u0,y0,-depth),{x:tx,y:0,z:tz});
        quad(reveal,at(u1,y0),at(u1,y0,-depth),at(u1,y1,-depth),at(u1,y1),{x:-tx,y:0,z:-tz});
        quad(reveal,at(u0,y0),at(u0,y0,-depth),at(u1,y0,-depth),at(u1,y0),{x:0,y:1,z:0});
        quad(reveal,at(u0,y1),at(u1,y1),at(u1,y1,-depth),at(u0,y1,-depth),{x:0,y:-1,z:0});
      }
      rect(x,length,bottom,top);y=top;
    }
    rect(0,length,y,height);
  }
  const make=positions=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();return geometry;};
  return {walls:make(wall),reveals:make(reveal)};
}
