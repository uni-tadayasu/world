// In-place authored clips and rest-pose-aware humanoid locomotion.
// Uses the pinned Three.js r170 AnimationMixer/SkinnedMesh contract.
export function createModelMotion(THREE, {source, group, facing, bones, clips, rigged, frontSign=-1, mode='auto'}) {
  const states=new Map();
  const baseFacingY=facing.position.y;let pelvisDrop=0;
  const remember=node=>{if(!states.has(node)) states.set(node,{position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()});};
  source.traverse(remember);Object.values(bones).forEach(remember);
  const neutral=new Map(), modelX=new THREE.Vector3(1,0,0), modelDown=new THREE.Vector3(0,-1,0);
  const q=new THREE.Quaternion(), parentQ=new THREE.Quaternion(), frameQ=new THREE.Quaternion();
  const axis=new THREE.Vector3(), direction=new THREE.Vector3(), desired=new THREE.Vector3();
  // Motion follows the game's -Z forward axis after the model-facing adjustment.
  // Using the mesh's pre-adjustment axes makes a 90-degree import walk sideways.
  group.updateWorldMatrix(true,true); group.getWorldQuaternion(frameQ);
  // Authored joint axes can point anywhere. Align the upper-arm child direction
  // in world space instead of adding Euler X rotations to an unknown bone frame.
  for(const side of ['left','right']) {
    const upper=bones[side+'UpperArm'],lower=bones[side+'LowerArm'];
    if(!upper || !lower || !upper.parent) continue;
    direction.copy(lower.getWorldPosition(new THREE.Vector3())).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    desired.copy(modelDown).applyQuaternion(frameQ);
    if(direction.lengthSq()<.5 || direction.dot(desired)>.96) continue;
    q.setFromUnitVectors(direction,desired);
    upper.parent.getWorldQuaternion(parentQ);
    neutral.set(upper,parentQ.clone().invert().multiply(q).multiply(parentQ).multiply(upper.quaternion));
  }
  const footOffsets={};
  for(const side of ['left','right']) {
    const foot=bones[side+'Foot'];
    if(foot) footOffsets[side]=Math.max(.015,Math.min(.24,foot.getWorldPosition(new THREE.Vector3()).y-group.getWorldPosition(new THREE.Vector3()).y));
  }
  const rootNodes=new Set([source]);
  if(bones.hips) for(let node=bones.hips;node && node!==source.parent;node=node.parent) rootNodes.add(node);
  else for(const node of source.children) rootNodes.add(node);
  const inPlaceClips=clips.map(clip=>makeInPlace(THREE,clip,source,rootNodes,states));
  const bodyMotion=new Map(inPlaceClips.map(clip=>[clip,clip.tracks.some(track=>{
    let path;try{path=THREE.PropertyBinding.parseTrackName(track.name);}catch{return false;}
    const node=THREE.PropertyBinding.findNode(source,path.nodeName);
    if(!node)return false;
    if(path.propertyName==='morphTargetInfluences')return true;
    if(rootNodes.has(node))return false;
    let visible=node.isBone||node.isMesh;
    if(!visible)node.traverse(child=>{if(child.isMesh)visible=true;});
    return visible && ['position','quaternion','scale'].includes(path.propertyName);
  })]));
  const choose=expression=>inPlaceClips.find(clip=>expression.test(clip.name||''));
  const named={
    idle:choose(/idle|standing|(?:^|[ _-])stand(?:$|[ _-])|breath|待機|静止|休憩/i),
    walk:choose(/walk|歩行|歩く/i),run:choose(/run|jog|sprint|走|駆け/i),jump:choose(/jump|leap|hop|跳|ジャンプ/i)
  };
  const mixer=inPlaceClips.length?new THREE.AnimationMixer(source):null;
  const actions=new Map(inPlaceClips.map(clip=>[clip,mixer.clipAction(clip)]));
  let activeAction=null,activeClip=null,activeRole=null,phase=0,disposed=false,lastMode=mode;
  let status={role:'idle',source:'static',clip:null,time:0,completed:false,footCorrections:0};
  const restore=()=>{facing.position.y=baseFacingY;for(const [node,state] of states) {node.position.copy(state.position);node.quaternion.copy(state.quaternion);node.scale.copy(state.scale);}};
  function rotate(key,amount,z=0) {
    const bone=bones[key];if(!bone)return;
    if(neutral.has(bone))bone.quaternion.copy(neutral.get(bone));
    if(!bone.parent)return;
    bone.parent.updateWorldMatrix(true,false);bone.parent.getWorldQuaternion(parentQ).invert();
    if(amount) {
      axis.copy(modelX).applyQuaternion(frameQ).applyQuaternion(parentQ).normalize();
      bone.quaternion.premultiply(q.setFromAxisAngle(axis,amount*frontSign));
    }
    if(z) {
      axis.set(0,0,1).applyQuaternion(frameQ).applyQuaternion(parentQ).normalize();
      bone.quaternion.premultiply(q.setFromAxisAngle(axis,z));
    }
  }
  function procedural(role,moving,running,verticalVelocity) {
    const jumping=role==='jump',wave=Math.sin(phase),swing=moving&&!jumping?wave*(running?.69:.42):0;
    const knee=moving&&!jumping?(running?1.0:.53):0,breath=!moving&&!jumping?Math.sin(phase)*.018:0;
    const falling=jumping&&verticalVelocity<-.2;
    rotate('spine',jumping?.08:running&&moving?.07:breath*.4);
    rotate('leftUpperLeg',jumping?(falling?-.10:-.32):swing);
    rotate('rightUpperLeg',jumping?(falling?-.08:-.24):-swing);
    rotate('leftLowerLeg',jumping?(falling?.20:.65):Math.max(0,-wave)*knee);
    rotate('rightLowerLeg',jumping?(falling?.20:.53):Math.max(0,wave)*knee);
    rotate('leftFoot',jumping?-.10:-Math.max(0,-wave)*knee*.25);
    rotate('rightFoot',jumping?-.10:-Math.max(0,wave)*knee*.25);
    rotate('leftUpperArm',jumping?-.48:-swing*.77+breath);
    rotate('rightUpperArm',jumping?-.48:swing*.77+breath);
    rotate('leftLowerArm',jumping?-.3:running&&moving?-.65:-.12);
    rotate('rightLowerArm',jumping?-.3:running&&moving?-.65:-.12);
  }
  function select(role) {
    if(mode==='procedural' && rigged) return null;
    const namedClip=named[role] || (role==='run'?named.walk:null);
    // A clip called Walk that only translates the scene has no leg animation.
    // Generate locomotion instead of treating that translation as a moving rig.
    if(namedClip && (mode==='authored' || !rigged || role==='idle' || bodyMotion.get(namedClip)))return namedClip;
    if(mode==='authored' || !rigged) return inPlaceClips[0]||null;
    return null;
  }
  function play(clip,role,speed) {
    if(clip!==activeClip || role!==activeRole) {
      const previous=activeAction;
      activeAction=actions.get(clip);activeClip=clip;activeRole=role;
      // The same clip may be used for several roles. Always reset its loop and
      // completion state on role entry, including the second and later jumps.
      activeAction.reset().setLoop(role==='jump'?THREE.LoopOnce:THREE.LoopRepeat,role==='jump'?1:Infinity);
      activeAction.clampWhenFinished=role==='jump';activeAction.setEffectiveWeight(1).play();
      if(previous && previous!==activeAction) activeAction.crossFadeFrom(previous,.16,false);
      else activeAction.stopFading();
    }
    activeAction.setEffectiveTimeScale(role==='walk'||role==='run'?Math.max(.4,Math.min(1.9,speed/(role==='run'&&clip===named.run?4.2:1.6))):1);
  }
  function update(dt,context={}) {
    if(disposed)return;
    const {moving=false,running=false,jumping=false,grounded=!jumping,groundHeightAt,groundHeight,verticalVelocity=0}=context;
    const speed=Number.isFinite(context.speed)?Math.max(0,context.speed):running?4.2:1.6;
    const delta=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
    const role=jumping||!grounded?'jump':moving?running?'run':'walk':'idle';
    phase=(phase+delta*(moving?(running?11.5:7.3)*Math.max(.35,Math.min(1.8,speed/(running?4.2:1.6))):1.6))%(Math.PI*200);
    if(lastMode!==mode) {mixer?.stopAllAction();activeAction=activeClip=activeRole=null;lastMode=mode;}
    restore();group.updateWorldMatrix(true,false);group.getWorldQuaternion(frameQ);
    const clip=select(role);
    if(clip) {
      play(clip,role,speed);mixer.update(delta);
      // The movement controller owns translation and jump height. Keep pelvis
      // breathing/bobbing, but do not add an exported jump or stair ascent twice.
      for(const node of rootNodes) {
        const state=states.get(node);if(!state)continue;
        node.position.x=state.position.x;node.position.z=state.position.z;
        if(node!==bones.hips || role==='jump') node.position.y=state.position.y;
        else {
          const worldScale=node.parent?.getWorldScale(new THREE.Vector3()).y||1;
          const limit=.16/Math.max(.00001,Math.abs(worldScale));
          node.position.y=Math.max(state.position.y-limit,Math.min(state.position.y+limit,node.position.y));
        }
      }
    }
    else {
      if(activeAction) {mixer.stopAllAction();activeAction=activeClip=activeRole=null;restore();}
      if(rigged)procedural(role,moving,running,verticalVelocity);
    }
    // A malformed clip must not poison the scene graph or the player transform.
    for(const [node,state] of states) {
      if(!node.position.toArray().every(Number.isFinite))node.position.copy(state.position);
      if(!node.quaternion.toArray().every(Number.isFinite) || node.quaternion.lengthSq()<1e-9)node.quaternion.copy(state.quaternion);
      if(!node.scale.toArray().every(Number.isFinite))node.scale.copy(state.scale);
    }
    // r170 refreshes SkinnedMesh.bindMatrixInverse in updateMatrixWorld(), not
    // updateWorldMatrix(). Keep CPU bounds/vertices correct before rendering too.
    group.updateMatrixWorld(true);
    let footCorrections=0;
    if(rigged && grounded && !jumping && typeof groundHeightAt==='function') {
      const base=Number.isFinite(groundHeight)?groundHeight:group.getWorldPosition(new THREE.Vector3()).y;
      const targets=[];let requiredDrop=0;
      for(const side of ['left','right']) {
        const upper=bones[side+'UpperLeg'],lower=bones[side+'LowerLeg'],foot=bones[side+'Foot'];
        if(!upper || !lower || !foot)continue;
        const current=foot.getWorldPosition(new THREE.Vector3());
        let terrain;try{terrain=groundHeightAt(current.x,current.z);}catch{continue;}
        if(!Number.isFinite(terrain) || Math.abs(terrain-base)>.48)continue;
        const lift=moving?Math.min(running?.22:.14,Math.max(0,current.y-base-footOffsets[side])):0;
        const target=current.clone();target.y=terrain+footOffsets[side]+lift;
        targets.push({upper,lower,foot,target});
        const hip=upper.getWorldPosition(new THREE.Vector3()),knee=lower.getWorldPosition(new THREE.Vector3());
        const reach=hip.distanceTo(knee)+knee.distanceTo(current)-.001;
        const horizontal=(hip.x-target.x)**2+(hip.z-target.z)**2;
        const verticalReach=Math.sqrt(Math.max(0,reach*reach-horizontal));
        // The lower foot cannot reach a descending tread with two fully extended
        // legs. Lower the visual body/skeleton together, leaving controller Y intact.
        requiredDrop=Math.max(requiredDrop,hip.y-target.y-verticalReach);
      }
      requiredDrop=Math.max(0,Math.min(.20,requiredDrop));
      pelvisDrop+=(requiredDrop-pelvisDrop)*(delta>0?1-Math.exp(-delta*20):1);
      const parentScale=Math.abs(group.getWorldScale(new THREE.Vector3()).y)||1;
      facing.position.y=baseFacingY-pelvisDrop/parentScale;
      group.updateMatrixWorld(true);
      for(const {upper,lower,foot,target} of targets) {
        const difference=target.y-foot.getWorldPosition(new THREE.Vector3()).y;
        if(Math.abs(difference)<.003 || Math.abs(difference)>.4)continue;
        if(placeHumanoidFoot(THREE,upper,lower,foot,target,frameQ,frontSign))footCorrections++;
      }
    } else pelvisDrop=0;
    group.updateMatrixWorld(true);
    status={role,source:clip?'authored':rigged?'procedural':'static',clip:clip?.name||null,time:activeAction?.time||0,
      completed:Boolean(activeAction?.paused&&role==='jump'),footCorrections,bodyOffset:pelvisDrop?-pelvisDrop:0};
  }
  function dispose() {
    if(disposed)return;disposed=true;mixer?.stopAllAction();mixer?.uncacheRoot(source);restore();
  }
  update(0,{});
  return {update,dispose,setMode:value=>{mode=value;},getStatus:()=>({...status}),
    hasNamedLocomotion:Boolean(named.walk||named.run),hasClips:inPlaceClips.length>0};
}

function makeInPlace(THREE,clip,source,rootNodes,states) {
  const copy=clip.clone();
  for(const track of copy.tracks) {
    let path;try{path=THREE.PropertyBinding.parseTrackName(track.name);}catch{continue;}
    if(path.propertyName!=='position')continue;
    let node=THREE.PropertyBinding.findNode(source,path.nodeName);
    if(path.objectName==='bones' && node?.skeleton) node=node.skeleton.getBoneByName(path.objectIndex);
    if(!rootNodes.has(node))continue;
    const position=states.get(node)?.position;if(!position)continue;
    const cubic=Boolean(track.createInterpolant?.isInterpolantFactoryMethodGLTFCubicSpline),stride=cubic?9:3;
    if(track.getValueSize()!==stride)continue;
    const firstY=track.values[cubic?4:1];
    for(let i=0;i<track.values.length;i+=stride) {
      const value=i+(cubic?3:0);
      track.values[value]=position.x;track.values[value+2]=position.z;
      track.values[value+1]=position.y+track.values[value+1]-firstY;
      if(cubic) for(const offset of [0,6]) {track.values[i+offset]=0;track.values[i+offset+2]=0;}
    }
  }
  return copy;
}

// Also works with pivot Object3Ds (the built-in/photo avatar), not only Bones.
// target is the desired world ankle position including its rest sole offset.
export function placeHumanoidFoot(THREE,upper,lower,foot,target,frameQ,frontSign=1) {
  const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=foot.getWorldPosition(new THREE.Vector3());
  const l1=a.distanceTo(b),l2=b.distanceTo(c);
  if(l1<.015 || l2<.015 || !Number.isFinite(l1+l2))return false;
  const n=target.clone().sub(a),distance=n.length();
  if(distance<1e-6)return false;
  n.divideScalar(distance);
  const reach=Math.max(Math.abs(l1-l2)+1e-4,Math.min(l1+l2-1e-4,distance));
  const d=(l1*l1-l2*l2+reach*reach)/(2*reach),height=Math.sqrt(Math.max(0,l1*l1-d*d));
  const bend=b.clone().sub(a).addScaledVector(n,-b.clone().sub(a).dot(n));
  const forward=new THREE.Vector3(0,0,frontSign).applyQuaternion(frameQ);
  forward.addScaledVector(n,-forward.dot(n));
  // A small toe/ankle offset in a straight rest pose must not choose the reverse
  // knee solution. Keep the anatomical forward pole through the straight pose.
  if(bend.lengthSq()<(l1*.12)**2 || bend.dot(forward)<0) bend.copy(forward);
  if(bend.lengthSq()<1e-8)return false;
  bend.normalize();const knee=a.clone().addScaledVector(n,d).addScaledVector(bend,height);
  const footRotation=foot.getWorldQuaternion(new THREE.Quaternion());
  rotateWorld(THREE,upper,b.clone().sub(a),knee.sub(a));
  upper.updateWorldMatrix(true,true);
  const actualKnee=lower.getWorldPosition(new THREE.Vector3()),actualFoot=foot.getWorldPosition(new THREE.Vector3());
  rotateWorld(THREE,lower,actualFoot.sub(actualKnee),target.clone().sub(actualKnee));
  lower.updateWorldMatrix(true,true);
  if(foot.parent)foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footRotation));
  return true;
}

function rotateWorld(THREE,bone,from,to) {
  if(!bone.parent || from.lengthSq()<1e-10 || to.lengthSq()<1e-10)return;
  const delta=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
  const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));
}
