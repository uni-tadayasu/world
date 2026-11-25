// Humanoid discovery and a bounded, local fallback for unskinned upright models.
// Spatial skinning is approximate; authored weights remain untouched.
export function identifyHumanoid(THREE, source, gltf, json, frame) {
  const bones = {}, byIndex = new Map(), candidates = [];
  source.traverse(object => {
    const index = gltf.parser?.associations?.get(object)?.nodes;
    if (Number.isInteger(index)) byIndex.set(index, object);
    if (object.isBone) candidates.push(object);
  });
  for (const item of json.extensions?.VRM?.humanoid?.humanBones || []) {
    if (byIndex.has(item.node)) bones[item.bone] = byIndex.get(item.node);
  }
  for (const [key, item] of Object.entries(json.extensions?.VRMC_vrm?.humanoid?.humanBones || {})) {
    if (byIndex.has(item.node)) bones[key] = byIndex.get(item.node);
  }
  source.traverse(object => {
    const key = humanoidKey(object.userData?.name || object.name || '');
    if (key && !bones[key] && affectsMesh(object)) bones[key] = object;
  });
  let inferred = false;
  // Some exporters replace joint names with numbers. Use anatomy only when the
  // model contains enough joints, and require two distinct downward leg chains.
  if (['leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg'].some(key=>!bones[key]) && candidates.length >= 10) {
    frame.updateWorldMatrix(true, true);
    const inverse = frame.matrixWorld.clone().invert();
    const points = new Map(candidates.map(b => [b, b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse)]));
    const used = new Set(Object.values(bones));
    const nearest = (x, y, z, predicate = () => true) => {
      let best = null, score = Infinity;
      for (const bone of candidates) {
        if (used.has(bone) || !predicate(bone)) continue;
        const p = points.get(bone), d = (p.x-x)**2 + (p.y-y)**2 + (p.z-z)**2;
        if (d < score) { best = bone; score = d; }
      }
      return score < .26**2 ? best : null;
    };
    const hips = bones.hips || nearest(0, .91, 0, b => b.children.length >= 2);
    if (hips) {
      const found = {};
      for (const [side, sign] of [['left', 1], ['right', -1]]) {
        const upper = bones[side+'UpperLeg'] || nearest(sign*.14, .88, 0, b => isDescendant(b, hips) && points.get(b).x*sign > .025);
        if (!upper) continue;
        const lower = bones[side+'LowerLeg'] || nearest(sign*.14, .48, 0, b => isDescendant(b, upper));
        const foot = bones[side+'Foot'] || (lower && nearest(sign*.14, .10, 0, b => isDescendant(b, lower)));
        if (lower && foot && upper !== lower && lower !== foot) Object.assign(found, {[side+'UpperLeg']:upper, [side+'LowerLeg']:lower, [side+'Foot']:foot});
      }
      if (found.leftFoot && found.rightFoot && found.leftUpperLeg !== found.rightUpperLeg) {
        Object.assign(bones, {hips}, found); inferred = true;
        Object.values(bones).forEach(b => used.add(b));
        for (const [key, x, y] of [['spine',0,1.13],['head',0,1.57],['leftUpperArm',.23,1.4],['rightUpperArm',-.23,1.4]]) {
          if (!bones[key]) { const bone = nearest(x,y,0); if (bone) { bones[key]=bone; used.add(bone); } }
        }
      }
    }
  }
  // Complete recognized chains without depending on a particular naming scheme.
  for (const side of ['left','right']) {
    for (const [parentKey, childKey] of [['UpperLeg','LowerLeg'],['LowerLeg','Foot'],['Foot','Toes'],['UpperArm','LowerArm'],['LowerArm','Hand']]) {
      if (!bones[side+childKey] && bones[side+parentKey]) {
        const children = bones[side+parentKey].children.filter(b => b.isBone && !/twist|roll|ik|end|helper/i.test(b.name));
        if (children.length === 1) bones[side+childKey] = children[0];
      }
    }
  }
  return { bones, inferred, rigged: ['leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg'].every(key=>bones[key] && affectsMesh(bones[key])) };
}

function affectsMesh(object) {
  if(object.isBone || object.isMesh)return true;
  let found=false;object.traverse(child=>{if(child.isMesh)found=true;});return found;
}

function isDescendant(node, parent) {
  for (let p=node.parent; p; p=p.parent) if (p === parent) return true;
  return false;
}

export function humanoidKey(raw) {
  let name = raw.normalize('NFKC').toLowerCase().replace(/^.*:/,'')
    .replace(/^(?:mixamorig\d*|j[_ .-]?bip|bip\d*|def|org)[_ .-]*/,'')
    .replace(/(?:[_. -]\d+)+$/,'');
  if (/twist|roll|(?:^|[_. -])(?:ik|mch|ctrl)(?:[_. -]|$)|(?:end|nub)$/.test(name)) return null;
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

/** Generate GPU skin weights in the normalized model frame; preserve UVs/materials. */
export function buildAutomaticHumanoid(THREE, source, frame, { force=false } = {}) {
  frame.updateWorldMatrix(true, true);
  const inverse = frame.matrixWorld.clone().invert(), point = new THREE.Vector3();
  const meshes = [], samples = [], box = new THREE.Box3();
  let existingSkin = false;
  source.traverse(mesh => {
    if (mesh.isSkinnedMesh) existingSkin = true;
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry?.attributes.position) return;
    meshes.push(mesh);
    const attr = mesh.geometry.attributes.position, matrix = inverse.clone().multiply(mesh.matrixWorld);
    const stride = Math.max(1,Math.floor(attr.count/1200));
    for(let i=0;i<attr.count;i+=stride) { point.fromBufferAttribute(attr,i).applyMatrix4(matrix); samples.push(point.clone()); box.expandByPoint(point); }
  });
  if (existingSkin || !meshes.length || box.isEmpty()) return null;
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
  const replacedGeometry=new Set();
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
    replacedGeometry.add(original.geometry);
  }
  // Only dispose old geometries once all replacements have stopped referencing them.
  const retained=new Set();source.traverse(o=>{if(o.geometry)retained.add(o.geometry);});
  for(const geometry of replacedGeometry) if(!retained.has(geometry)) geometry.dispose();
  return {bones,rigRoot,skeleton,rigged:true,inferred:false,autoRigged:true};
}
