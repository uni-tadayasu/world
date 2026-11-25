import {surfaceSeed} from './surface-textures.js';

const layouts=new Map();
const normalizeVariant=value=>((Math.floor(Number(value)||0)%3)+3)%3;
export function treeLayout(variant=0){
  variant=normalizeVariant(variant);if(layouts.has(variant))return layouts.get(variant);
  let state=surfaceSeed('tree-shape-'+variant);const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const branches=[],clusters=[],upright=variant===1,spread=upright?1.05:variant===2?1.85:1.55;
  const add=(a,b,radius,tip=.45)=>branches.push({a,b,radius,tip});
  const trunk=[[0,0,0],[.06,1.7,.025],[variant===2?.23:-.04,3.25,.04],[.10,4.85,-.06]];
  for(let i=1;i<trunk.length;i++)add(trunk[i-1],trunk[i],.19-i*.035,.65);
  for(let i=0;i<10;i++){
    const angle=i*2.39996+rand()*.4,level=1.7+i*.215,upper=i>6,taper=upper?.72:1;
    const reach=spread*(.75+rand()*.28)*taper,asymmetry=variant===2?.35:0;
    const a=[.03,level,0],joint=[Math.cos(angle)*reach*.55+asymmetry*.4,level+.85,Math.sin(angle)*reach*.55];
    const end=[Math.cos(angle)*reach+asymmetry,level+1.25+rand()*.35,Math.sin(angle)*reach];
    add(a,joint,.082-i*.003,.6);add(joint,end,.045-i*.0015,.35);
    clusters.push({x:end[0],y:end[1]+.22,z:end[2],radius:(upright?.68:.81)*(upper?.84:1),angle});
    if(i%2===0){const side=angle+.68,tip=[end[0]*.7+Math.cos(side)*.58,end[1]+.38,end[2]*.7+Math.sin(side)*.58];add(joint,tip,.028,.32);clusters.push({x:tip[0],y:tip[1]+.12,z:tip[2],radius:.59,angle:side});}
  }
  clusters.push({x:.08,y:5.15,z:-.05,radius:upright?.65:.72,angle:0});
  const layout=Object.freeze({variant,height:6,branches:Object.freeze(branches.map(Object.freeze)),clusters:Object.freeze(clusters.map(Object.freeze))});layouts.set(variant,layout);return layout;
}

/** Two geometries per variant: tapered branches and leaf-spray cut-out cards. */
export function buildTreeGeometry(THREE,{variant=0,quality='high'}={}){
  const layout=treeLayout(variant),small=quality==='low'||quality==='medium',radial=quality==='low'?6:small?8:10;
  const trunkParts=[],canopyParts=[],up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),matrix=new THREE.Matrix4(),euler=new THREE.Euler();
  for(const branch of layout.branches){
    const a=new THREE.Vector3(...branch.a),b=new THREE.Vector3(...branch.b),length=a.distanceTo(b),geometry=new THREE.CylinderGeometry(branch.tip,1,1,radial,1);
    rotation.setFromUnitVectors(up,direction.subVectors(b,a).normalize());position.copy(a).add(b).multiplyScalar(.5);scale.set(branch.radius,length,branch.radius);matrix.compose(position,rotation,scale);
    trunkParts.push({geometry,matrix:matrix.clone(),uvScale:[Math.PI*branch.radius*(1+branch.tip),length/2]});
  }
  const plane=new THREE.PlaneGeometry(1,1,small?1:2,small?1:2),p=plane.attributes.position;
  for(let i=0;i<p.count;i++)p.setZ(i,Math.sin((p.getX(i)+.5)*Math.PI)*.065);plane.computeVertexNormals();
  layout.clusters.forEach((cluster,index)=>{
    if(quality==='low'&&index%4===3)return;
    const layers=small?2:3;
    for(let layer=0;layer<layers;layer++){
      position.set(cluster.x+(layer-1)*.045,cluster.y,cluster.z);
      euler.set((index%3-1)*.22+(layer===2?.42:0),cluster.angle+layer*Math.PI/layers,(index%2?1:-1)*.1);
      rotation.setFromEuler(euler);scale.set(cluster.radius*2.25,cluster.radius*2.1,1);matrix.compose(position,rotation,scale);
      canopyParts.push({geometry:plane,matrix:matrix.clone()});
    }
  });
  const branches=merge(THREE,trunkParts),canopy=merge(THREE,canopyParts);
  for(const part of trunkParts)part.geometry.dispose();plane.dispose();
  branches.userData.qualityShape={type:'treeBranches',variant:layout.variant};canopy.userData.qualityShape={type:'treeCanopy',variant:layout.variant};
  branches.userData.treeHeight=canopy.userData.treeHeight=layout.height;
  return {branches,canopy};
}
function merge(THREE,parts){
  const count=parts.reduce((sum,part)=>sum+(part.geometry.index?.count||part.geometry.attributes.position.count),0),positions=new Float32Array(count*3),normals=new Float32Array(count*3),uvs=new Float32Array(count*2);
  const vector=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();let offset=0;
  for(const part of parts){const geometry=part.geometry,p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,idx=geometry.index;normalMatrix.getNormalMatrix(part.matrix);
    for(let i=0;i<(idx?.count||p.count);i++){const j=idx?idx.getX(i):i;vector.fromBufferAttribute(p,j).applyMatrix4(part.matrix);normal.fromBufferAttribute(n,j).applyMatrix3(normalMatrix).normalize();positions.set(vector.toArray(),offset*3);normals.set(normal.toArray(),offset*3);uvs[offset*2]=uv.getX(j)*(part.uvScale?.[0]??1);uvs[offset*2+1]=uv.getY(j)*(part.uvScale?.[1]??1);offset++;}
  }
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.BufferAttribute(positions,3));result.setAttribute('normal',new THREE.BufferAttribute(normals,3));result.setAttribute('uv',new THREE.BufferAttribute(uvs,2));result.computeBoundingBox();result.computeBoundingSphere();return result;
}
