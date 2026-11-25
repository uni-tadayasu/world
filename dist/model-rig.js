// Preserve authored skins. Only a verified, upright humanoid may receive generated
// joint motion; spatial guesses never select a skeleton in the default path.
export function identifyHumanoid(THREE, source, gltf, json, frame) {
  const bones={},byIndex=new Map(),skinnedMeshes=[],weightedBones=new Set();
  source.traverse(object=>{
    const index=gltf.parser?.associations?.get(object)?.nodes;
    if(Number.isInteger(index))byIndex.set(index,object);
    if(object.isSkinnedMesh&&object.skeleton)skinnedMeshes.push(object);
  });
  for(const mesh of skinnedMeshes) {
    const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    if(!indices||!weights)continue;
    for(let i=0;i<weights.count;i++)for(let j=0;j<4;j++) {
      if(weights.getComponent(i,j)>.00001) {
        const bone=mesh.skeleton.bones[indices.getComponent(i,j)];if(bone)weightedBones.add(bone);
      }
    }
  }
  const affectsMesh=object=>{
    if(weightedBones.has(object))return true;
    if([...weightedBones].some(b=>isDescendant(b,object)))return true;
    let visible=object.isMesh;object.traverse(child=>{if(child.isMesh)visible=true;});return visible;
  };
  let definition='named';
  for(const item of json.extensions?.VRM?.humanoid?.humanBones||[])if(byIndex.has(item.node)){bones[item.bone]=byIndex.get(item.node);definition='vrm';}
  for(const [key,item]of Object.entries(json.extensions?.VRMC_vrm?.humanoid?.humanBones||{}))if(byIndex.has(item.node)){bones[key]=byIndex.get(item.node);definition='vrm';}
  source.traverse(object=>{
    const key=humanoidKey(object.userData?.name||object.name||'');
    if(key&&!bones[key]&&affectsMesh(object))bones[key]=object;
  });
  const unavailable=reason=>({bones,rigged:false,inferred:false,confidence:'none',reason,hasSkin:skinnedMeshes.length>0});
  const required=['hips','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot'];
  if(required.some(key=>!bones[key]))return unavailable('人型の関節定義を確認できないため、元の骨格と形状を保持します。');
  if(new Set(required.map(key=>bones[key])).size!==required.length)return unavailable('複数の関節が同じノードを参照しているため、人型補正を停止しています。');
  for(const side of ['left','right']) {
    const upper=bones[side+'UpperLeg'],lower=bones[side+'LowerLeg'],foot=bones[side+'Foot'];
    if(!isDescendant(upper,bones.hips)||!isDescendant(lower,upper)||!isDescendant(foot,lower)||!affectsMesh(upper)||!affectsMesh(lower))return unavailable('脚の親子関係とスキンの対応を確認できないため、人型補正を停止しています。');
  }
  // Independently bound clothing/hair/second characters must never be left behind
  // while only the first matching skeleton is posed.
  if([...weightedBones].some(b=>b!==bones.hips&&!isDescendant(b,bones.hips)))return unavailable('独立した骨格が含まれるため、付属モーションと元の形状を優先します。');
  for(const bone of Object.values(bones))for(let node=bone;node&&node!==frame;node=node.parent) {
    const {x,y,z}=node.scale,largest=Math.max(Math.abs(x),Math.abs(y),Math.abs(z));
    if(![x,y,z].every(Number.isFinite)||Math.min(x,y,z)<=0||largest-Math.min(x,y,z)>largest*.0001)return unavailable('非一様または反転した縮尺があるため、骨格の自動補正を停止しています。');
  }
  for(const mesh of skinnedMeshes)for(const inverse of mesh.skeleton.boneInverses) {
    if(!inverse.elements.every(Number.isFinite)||inverse.determinant()===0)return unavailable('スキンの結合行列を確認できないため、骨格の自動補正を停止しています。');
  }
  frame.updateWorldMatrix(true,true);const inverseFrame=frame.matrixWorld.clone().invert();
  const point=key=>bones[key].getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseFrame);
  const hips=point('hips');
  if(hips.y<.35||hips.y>1.45)return unavailable('立ち姿の関節配置ではないため、元の姿勢を保持します。');
  for(const side of ['left','right']) {
    const upper=point(side+'UpperLeg'),lower=point(side+'LowerLeg'),foot=point(side+'Foot');
    const thigh=upper.clone().sub(lower),shin=lower.clone().sub(foot),a=thigh.length(),b=shin.length();
    if(a<.08||b<.08||a+b>1.5||a/b<.25||a/b>4||thigh.y/a<.6||shin.y/b<.6||foot.y<-.25||foot.y>.65)return unavailable('座り姿・寝姿などの関節配置は、立ち姿へ強制変換せず保持します。');
  }
  if(point('leftUpperLeg').distanceTo(point('rightUpperLeg'))<.04)return unavailable('左右の脚を安全に区別できないため、元の姿勢を保持します。');
  // Optional arms also need a real chain. Their absence must not lead us to pose
  // an unrelated accessory, hair joint, or object with a similar name.
  for(const side of ['left','right']) {
    const upper=bones[side+'UpperArm'],lower=bones[side+'LowerArm'];
    if(!upper||!lower||!isDescendant(upper,bones.hips)||!isDescendant(lower,upper)||!affectsMesh(upper)||!affectsMesh(lower)) {
      delete bones[side+'UpperArm'];delete bones[side+'LowerArm'];delete bones[side+'Hand'];
    }
  }
  return {bones,rigged:true,inferred:false,confidence:definition,reason:'',hasSkin:skinnedMeshes.length>0};
}

function isDescendant(node,parent) {
  for(let p=node?.parent;p;p=p.parent)if(p===parent)return true;
  return false;
}

export function humanoidKey(raw) {
  let name = raw.normalize('NFKC').toLowerCase().replace(/^.*:/,'')
    .replace(/^(?:mixamorig\d*|j[_ .-]?bip|bip\d*|def|org)[_ .-]*/,'')
    .replace(/^(?:c|center)[_. -]+/,'')
    .replace(/(?:[_. -]\d+)+$/,'');
  if (/twist|roll|捩|補助|(?:^|[_. -])(?:ik|mch|ctrl)(?:[_. -]|$)|(?:end|nub)$/.test(name)) return null;
  const side = /left|左/.test(name) || /(?:^|[_. -])l(?:[_. -]|$)/.test(name) ? 'left'
    : /right|右/.test(name) || /(?:^|[_. -])r(?:[_. -]|$)/.test(name) ? 'right' : null;
  let compact = name.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g,'');
  let resolvedSide = side;
  if (!resolvedSide && /^(?:l|r)(?:upper|lower|up|fore|arm|leg|thigh|calf|shin|foot|toe|hand|shoulder)/.test(compact)) {resolvedSide = compact[0] === 'l' ? 'left' : 'right';compact=compact.slice(1);}
  if (!resolvedSide && /(?:arm|leg|thigh|calf|shin|foot|toe|hand|shoulder)[lr]$/.test(compact)) {resolvedSide = compact.endsWith('l') ? 'left' : 'right';compact=compact.slice(0,-1);}
  if (resolvedSide) {
    if(side)compact=name.replace(/left|right|左|右/g,'').replace(/(?:^|[_. -])[lr](?=[_. -]|$)/g,'').replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g,'');
    compact=compact.replace(/\d+$/,'');
    if (/upperleg|upleg|thigh|もも|腿|大腿/.test(compact) || compact==='足') return resolvedSide+'UpperLeg';
    if (/lowerleg|calf|shin|knee|ひざ|膝/.test(compact) || compact==='leg') return resolvedSide+'LowerLeg';
    if (/toes?|ball|つま先|足先/.test(compact)) return resolvedSide+'Toes';
    if (/foot|ankle|足首/.test(compact)) return resolvedSide+'Foot';
    if (/lowerarm|forearm|elbow|ひじ|肘/.test(compact)) return resolvedSide+'LowerArm';
    if (/upperarm|^arm$|腕/.test(compact)) return resolvedSide+'UpperArm';
    if (/shoulder|clavicle|肩/.test(compact)) return resolvedSide+'Shoulder';
    if (/^hand$|wrist|手首/.test(compact)) return resolvedSide+'Hand';
  }
  if (/^(?:hips?|pelvis|waist|lowerbody|腰|下半身)$/.test(compact)) return 'hips';
  if (/^(?:spine\d*|chest\d*|upperbody\d*|上半身\d*|胸)$/.test(compact)) return 'spine';
  if (/^(?:neck\d*|首)$/.test(compact)) return 'neck';
  if (/^(?:head\d*|頭)$/.test(compact)) return 'head';
  return null;
}

/** Explicit experimental option. Its original meshes remain available for undo. */
export function buildAutomaticHumanoid(THREE, source, frame, { force=false } = {}) {
  frame.updateWorldMatrix(true, true);
  const inverse = frame.matrixWorld.clone().invert(), point = new THREE.Vector3();
  const meshes = [], samples = [], box = new THREE.Box3();
  let existingSkin = false,unsupportedMesh=false;
  source.traverse(mesh => {
    if (mesh.isSkinnedMesh) existingSkin = true;
    if(mesh.isInstancedMesh)unsupportedMesh=true;
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry?.attributes.position) return;
    meshes.push(mesh);
    const attr = mesh.geometry.attributes.position, matrix = inverse.clone().multiply(mesh.matrixWorld);
    const stride = Math.max(1,Math.floor(attr.count/1200));
    for(let i=0;i<attr.count;i+=stride) { point.fromBufferAttribute(attr,i).applyMatrix4(matrix); samples.push(point.clone()); box.expandByPoint(point); }
  });
  if (existingSkin || unsupportedMesh || !meshes.length || box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3()), h=size.y;
  const bandWidth = (min,max) => {
    const xs=samples.filter(p=>p.y>=box.min.y+h*min && p.y<=box.min.y+h*max).map(p=>p.x).sort((a,b)=>a-b);
    return xs.length ? xs[Math.floor((xs.length-1)*.96)]-xs[Math.floor((xs.length-1)*.04)] : null;
  };
  const headWidth=bandWidth(.87,1), shoulderWidth=bandWidth(.64,.85), lowerWidth=bandWidth(.03,.44);
  const plausible=h>.5 && size.x/h>=.12 && size.x/h<=1.55 && size.z/h<=.56 && shoulderWidth && lowerWidth && headWidth !== null && headWidth<shoulderWidth*.88;
  if (!force && !plausible) return null;
  const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2, base=box.min.y;
  const positions={}, bones={}, list=[];
  const rigRoot=new THREE.Group(); rigRoot.name='MachiAutomaticHumanoid'; frame.add(rigRoot);
  const add=(key,parent,x,y,z=0)=>{
    const p=new THREE.Vector3(cx+x*h,base+y*h,cz+z*h), bone=new THREE.Bone();
    bone.name='Machi_'+key; bone.position.copy(p);
    if(parent) bone.position.sub(positions[parent]);
    (parent?bones[parent]:rigRoot).add(bone); positions[key]=p; bones[key]=bone; list.push(bone); return bone;
  };
  add('hips',null,0,.52); add('spine','hips',0,.67); add('neck','spine',0,.85); add('head','neck',0,.89);
  const segments=[['hips','spine'],['spine','neck'],['neck','head'],['head',null]];
  for(const [side,sign] of [['left',1],['right',-1]]) {
    add(side+'UpperLeg','hips',sign*.085,.51);
    add(side+'LowerLeg',side+'UpperLeg',sign*.085,.28);
    add(side+'Foot',side+'LowerLeg',sign*.085,.055);
    add(side+'Toes',side+'Foot',sign*.085,.025,.07);
    // Fit both T and A poses using the outer arm surface rather than assuming T.
    const armSamples=samples.filter(p=>(p.x-cx)*sign>h*.19 && p.y>base+h*.44 && p.y<base+h*.88);
    let endX=.20, endY=.49;
    if(armSamples.length) {
      armSamples.sort((a,b)=>(b.x-a.x)*sign);
      const outer=armSamples.slice(0,Math.max(1,Math.ceil(armSamples.length*.13)));
      endX=outer.reduce((sum,p)=>sum+(p.x-cx)*sign/h,0)/outer.length;
      endY=outer.reduce((sum,p)=>sum+(p.y-base)/h,0)/outer.length;
    }
    add(side+'UpperArm','spine',sign*.13,.80);
    add(side+'LowerArm',side+'UpperArm',sign*(.13+(endX-.13)*.52),.80+(endY-.80)*.52);
    add(side+'Hand',side+'LowerArm',sign*endX,endY);
    segments.push([side+'UpperLeg',side+'LowerLeg'],[side+'LowerLeg',side+'Foot'],[side+'Foot',side+'Toes'],[side+'Toes',null],
      [side+'UpperArm',side+'LowerArm'],[side+'LowerArm',side+'Hand'],[side+'Hand',null]);
  }
  frame.updateWorldMatrix(true,true);
  const skeleton=new THREE.Skeleton(list);
  const segmentsData=segments.map(([key,end])=>({key,index:list.indexOf(bones[key]),a:positions[key],b:end?positions[end]:positions[key].clone().add(new THREE.Vector3(0,key==='head'?h*.1:0,key.includes('Toes')?h*.03:0))}));
  const ab=new THREE.Vector3(), ap=new THREE.Vector3(), closest=new THREE.Vector3();
  const replacements=[];
  for(const original of meshes) {
    const geometry=original.geometry.clone(), attr=geometry.attributes.position;
    const indices=new Uint16Array(attr.count*4), weights=new Float32Array(attr.count*4);
    const matrix=inverse.clone().multiply(original.matrixWorld);
    for(let i=0;i<attr.count;i++) {
      point.fromBufferAttribute(attr,i).applyMatrix4(matrix);
      const y=(point.y-base)/h, x=(point.x-cx)/h;
      let first=null, second=null, d1=Infinity, d2=Infinity;
      for(const segment of segmentsData) {
        const leg=/Leg|Foot|Toes/.test(segment.key), arm=/Arm|Hand/.test(segment.key);
        if (leg && y>.60 || arm && (y<.36 || Math.abs(x)<.08) || !leg && !arm && y<.43) continue;
        if (/^left/.test(segment.key) && x<-.015 || /^right/.test(segment.key) && x>.015) continue;
        ab.subVectors(segment.b,segment.a); ap.subVectors(point,segment.a);
        const t=Math.max(0,Math.min(1,ap.dot(ab)/Math.max(1e-8,ab.lengthSq())));
        closest.copy(segment.a).addScaledVector(ab,t);
        const distance=point.distanceToSquared(closest)+h*h*.0001;
        if(distance<d1) { second=first;d2=d1;first=segment;d1=distance; }
        else if(distance<d2) {second=segment;d2=distance;}
      }
      if(!first) first=segmentsData[0];
      const w2=second?Math.min(.5,(d1*d1)/(d1*d1+d2*d2)):0;
      indices[i*4]=first.index; weights[i*4]=1-w2;
      if(second) {indices[i*4+1]=second.index;weights[i*4+1]=w2;}
    }
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const replacement=new THREE.SkinnedMesh(geometry,original.material);
    THREE.Mesh.prototype.copy.call(replacement,original,false);
    replacement.geometry=geometry; replacement.uuid=original.uuid;
    replacement.frustumCulled=false; replacement.userData={...original.userData,automaticHumanoid:true};
    const parent=original.parent,index=parent.children.indexOf(original);
    for(const child of [...original.children]) replacement.add(child);
    parent.remove(original);parent.add(replacement);
    parent.children.splice(parent.children.indexOf(replacement),1);parent.children.splice(index,0,replacement);
    replacement.updateWorldMatrix(true,false); replacement.bind(skeleton,replacement.matrixWorld);
    replacements.push({original,replacement,parent,index});
  }
  let restored=false;
  function restore() {
    if(restored)return;restored=true;
    // Reverse order also restores meshes nested inside another replaced mesh.
    for(const {original,replacement,parent,index}of [...replacements].reverse()) {
      for(const child of [...replacement.children])original.add(child);
      parent.remove(replacement);parent.add(original);
      parent.children.splice(parent.children.indexOf(original),1);parent.children.splice(index,0,original);
      replacement.geometry.dispose();
    }
    rigRoot.removeFromParent();skeleton.dispose();frame.updateMatrixWorld(true);
  }
  return {bones,rigRoot,skeleton,rigged:true,inferred:false,confidence:'approximate',autoRigged:true,restore};
}
