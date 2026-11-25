import * as THREE from 'three';

// Real GLB binary fixtures, including accessors, skin and optional animation data.
// No browser/WebGL or network dependency is needed by GLTFLoader.parse.
export function humanoidGlb({skin=true,naming='mixamo',vrm=null,rotatedJoints=false,clips=[],shape='human',nested=false}={}) {
  const definitions=[
    ['hips',null,[0,.91,0]],['spine','hips',[0,1.18,0]],['neck','spine',[0,1.48,0]],['head','neck',[0,1.56,0]],
    ['leftUpperLeg','hips',[.15,.88,0]],['leftLowerLeg','leftUpperLeg',[.15,.46,0]],['leftFoot','leftLowerLeg',[.15,.07,0]],['leftToes','leftFoot',[.15,.04,.10]],
    ['rightUpperLeg','hips',[-.15,.88,0]],['rightLowerLeg','rightUpperLeg',[-.15,.46,0]],['rightFoot','rightLowerLeg',[-.15,.07,0]],['rightToes','rightFoot',[-.15,.04,.10]],
    ['leftUpperArm','spine',[.23,1.40,0]],['leftLowerArm','leftUpperArm',[.48,1.40,0]],['leftHand','leftLowerArm',[.73,1.40,0]],
    ['rightUpperArm','spine',[-.23,1.40,0]],['rightLowerArm','rightUpperArm',[-.48,1.40,0]],['rightHand','rightLowerArm',[-.73,1.40,0]]
  ];
  const nameSets={
    mixamo:['mixamorig:Hips','mixamorig:Spine','mixamorig:Neck','mixamorig:Head','mixamorig:LeftUpLeg','mixamorig:LeftLeg','mixamorig:LeftFoot','mixamorig:LeftToeBase','mixamorig:RightUpLeg','mixamorig:RightLeg','mixamorig:RightFoot','mixamorig:RightToeBase','mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand','mixamorig:RightArm','mixamorig:RightForeArm','mixamorig:RightHand'],
    blender:['pelvis','spine.001','neck','head','DEF-thigh.L','DEF-shin.L','DEF-foot.L','DEF-toe.L','DEF-thigh.R','DEF-shin.R','DEF-foot.R','DEF-toe.R','DEF-upper_arm.L','DEF-forearm.L','DEF-hand.L','DEF-upper_arm.R','DEF-forearm.R','DEF-hand.R'],
    japanese:['下半身','上半身','首','頭','左足','左ひざ','左足首','左つま先','右足','右ひざ','右足首','右つま先','左腕','左ひじ','左手首','右腕','右ひじ','右手首'],
    numbered:definitions.map((_,i)=>'Bone_'+i),
    vrm:definitions.map(([key])=>key.startsWith('left')?'J_Bip_L_'+key.slice(4)+'_001':key.startsWith('right')?'J_Bip_R_'+key.slice(5)+'_001':key)
  };
  const parts=shape==='human'?[
    ['spine',[0,1.13,0],[.4,.46,.22]],['head',[0,1.60,0],[.24,.30,.24]],
    ['leftUpperLeg',[.15,.68,0],[.15,.38,.16]],['leftLowerLeg',[.15,.26,0],[.13,.39,.15]],['leftFoot',[.15,.035,.05],[.15,.07,.25]],
    ['rightUpperLeg',[-.15,.68,0],[.15,.38,.16]],['rightLowerLeg',[-.15,.26,0],[.13,.39,.15]],['rightFoot',[-.15,.035,.05],[.15,.07,.25]],
    ['leftUpperArm',[.36,1.4,0],[.26,.13,.13]],['leftLowerArm',[.61,1.4,0],[.26,.12,.12]],['leftHand',[.76,1.4,0],[.09,.10,.12]],
    ['rightUpperArm',[-.36,1.4,0],[.26,.13,.13]],['rightLowerArm',[-.61,1.4,0],[.26,.12,.12]],['rightHand',[-.76,1.4,0],[.09,.10,.12]]
  ]:[['hips',[0,.3,0],[1.8,.6,1.0]]];
  const geometry={position:[],normal:[],uv:[],joints:[],weights:[]},partVertices={};
  for(const [key,center,size] of parts) {
    const cube=new THREE.BoxGeometry(...size).toNonIndexed();cube.translate(...center);
    partVertices[key]=geometry.position.length/3;
    geometry.position.push(...cube.attributes.position.array);geometry.normal.push(...cube.attributes.normal.array);geometry.uv.push(...cube.attributes.uv.array);
    for(let i=0;i<cube.attributes.position.count;i++) {geometry.joints.push(definitions.findIndex(([name])=>name===key),0,0,0);geometry.weights.push(1,0,0,0);}
    cube.dispose();
  }
  const json={asset:{version:'2.0',generator:'Machi motion regression fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Armature',children:[]}],meshes:[],materials:[{name:'FixtureFabric',pbrMetallicRoughness:{baseColorFactor:[.2,.6,.4,1],metallicFactor:.1,roughnessFactor:.8}}],buffers:[],bufferViews:[],accessors:[]};
  const chunks=[];let byteLength=0;
  const accessor=(values,componentType,type,minMax=false)=>{
    const Typed=componentType===5123?Uint16Array:Float32Array, array=new Typed(values),buffer=new Uint8Array(array.buffer);
    const align=(4-byteLength%4)%4;if(align){chunks.push(new Uint8Array(align));byteLength+=align;}
    const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:buffer.byteLength});chunks.push(buffer);byteLength+=buffer.byteLength;
    const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type],entry={bufferView:view,componentType,count:array.length/size,type};
    if(minMax){entry.min=Array(size).fill(Infinity);entry.max=Array(size).fill(-Infinity);for(let i=0;i<array.length;i++){entry.min[i%size]=Math.min(entry.min[i%size],array[i]);entry.max[i%size]=Math.max(entry.max[i%size],array[i]);}}
    json.accessors.push(entry);return json.accessors.length-1;
  };
  const rig=new THREE.Group(),boneObjects={},jointNodes={};
  for(let i=0;i<definitions.length;i++) {
    const [key,parent,position]=definitions[i],bone=new THREE.Bone();
    const parentObject=parent?boneObjects[parent]:rig;parentObject.add(bone);parentObject.updateWorldMatrix(true,false);
    bone.position.copy(parentObject.worldToLocal(new THREE.Vector3(...position)));
    if(rotatedJoints){const globalQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),i%2?.37:-.23);bone.quaternion.copy(parentObject.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(globalQ));}
    boneObjects[key]=bone;bone.updateWorldMatrix(true,false);
    const index=json.nodes.length;jointNodes[key]=index;
    json.nodes.push({name:(nameSets[naming]||nameSets.mixamo)[i],translation:bone.position.toArray(),rotation:bone.quaternion.toArray(),children:[]});
    json.nodes[parent?jointNodes[parent]:0].children.push(index);
  }
  const attributes={POSITION:accessor(geometry.position,5126,'VEC3',true),NORMAL:accessor(geometry.normal,5126,'VEC3'),TEXCOORD_0:accessor(geometry.uv,5126,'VEC2')};
  if(skin){attributes.JOINTS_0=accessor(geometry.joints,5123,'VEC4');attributes.WEIGHTS_0=accessor(geometry.weights,5126,'VEC4');}
  json.meshes.push({primitives:[{attributes,material:0}]});
  const meshNode=json.nodes.length;json.nodes.push({name:'BodyMesh',mesh:0,...(skin?{skin:0}:{})});json.nodes[0].children.push(meshNode);
  if(nested){const wrapper=json.nodes.length;json.nodes.push({name:'Wrapper',children:[0],translation:[3,2,1],scale:[2,2,2]});json.scenes[0].nodes=[wrapper];}
  if(skin){rig.updateMatrixWorld(true);const inverse=definitions.flatMap(([key])=>boneObjects[key].matrixWorld.clone().invert().toArray());json.skins=[{joints:definitions.map(([key])=>jointNodes[key]),inverseBindMatrices:accessor(inverse,5126,'MAT4'),skeleton:jointNodes.hips}];}
  if(vrm===0){json.extensionsUsed=['VRM'];json.extensions={VRM:{humanoid:{humanBones:definitions.map(([bone])=>({bone,node:jointNodes[bone]}))}}};}
  if(vrm===1){json.extensionsUsed=['VRMC_vrm'];json.extensions={VRMC_vrm:{specVersion:'1.0',humanoid:{humanBones:Object.fromEntries(definitions.map(([key])=>[key,{node:jointNodes[key]}]))}}};}
  if(clips.length)json.animations=clips.map(({name,tracks})=>{
    const animation={name,samplers:[],channels:[]};
    for(const track of tracks){const sampler=animation.samplers.length;animation.samplers.push({input:accessor(track.times,5126,'SCALAR',true),output:accessor(track.values.flat(),5126,track.path==='rotation'?'VEC4':'VEC3'),interpolation:'LINEAR'});animation.channels.push({sampler,target:{node:track.bone==='root'?0:jointNodes[track.bone],path:track.path}});}
    return animation;
  });
  json.buffers=[{byteLength}];const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(encoded.length/4)*4,binLength=Math.ceil(byteLength/4)*4;
  const buffer=new ArrayBuffer(12+8+jsonLength+8+binLength),view=new DataView(buffer),bytes=new Uint8Array(buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,buffer.byteLength,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);
  bytes.fill(32,20,20+jsonLength);bytes.set(encoded,20);view.setUint32(20+jsonLength,binLength,true);view.setUint32(24+jsonLength,0x004e4942,true);
  let offset=28+jsonLength;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {buffer,partVertices,jointNodes};
}

export const rotation=(x=0,y=0,z=0)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)).toArray();
export function vertexWorld(mesh,index){mesh.updateWorldMatrix(true,false);return mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);}
export function findMesh(avatar){let found;avatar.group.traverse(o=>{if(o.isSkinnedMesh || o.isMesh&&!found)found=o;});return found;}
