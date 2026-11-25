import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TRIANGLES = 2000000;

/** Load a self-contained binary glTF / VRM into the game's avatar adapter. */
export async function loadCharacterModel(THREE, fileOrArrayBuffer, { name = 'モデル' } = {}) {
  let buffer;
  if (fileOrArrayBuffer instanceof ArrayBuffer) buffer = fileOrArrayBuffer;
  else if (ArrayBuffer.isView(fileOrArrayBuffer)) {
    buffer = fileOrArrayBuffer.buffer.slice(fileOrArrayBuffer.byteOffset, fileOrArrayBuffer.byteOffset + fileOrArrayBuffer.byteLength);
  } else if (fileOrArrayBuffer && typeof fileOrArrayBuffer.arrayBuffer === 'function') {
    if (fileOrArrayBuffer.size > MAX_FILE_BYTES) throw new Error('モデルは50MB以下のGLBまたはVRMファイルを選んでください。');
    if (fileOrArrayBuffer.name && !/\.(glb|vrm)$/i.test(fileOrArrayBuffer.name)) throw new Error('読み込める形式はGLB・VRMです。テクスチャを埋め込んだ形式で書き出してください。');
    buffer = await fileOrArrayBuffer.arrayBuffer();
  } else throw new Error('GLBまたはVRMファイルを選んでください。');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('モデルは50MB以下にしてください。');
  const json = inspectBinaryGltf(buffer);
  const extensions = new Set([...(json.extensionsRequired || []), ...(json.extensionsUsed || [])]);
  for (const mesh of json.meshes || []) for (const p of mesh.primitives || []) {
    for (const key of Object.keys(p.extensions || {})) extensions.add(key);
  }
  if (extensions.has('KHR_draco_mesh_compression')) throw new Error('Draco圧縮モデルには対応していません。Draco圧縮をオフにしてGLBを書き出してください。');
  if (extensions.has('EXT_meshopt_compression')) throw new Error('Meshopt圧縮モデルには対応していません。圧縮をオフにしてGLBを書き出してください。');
  if (extensions.has('KHR_texture_basisu')) throw new Error('KTX2圧縮テクスチャには対応していません。PNGまたはJPEGを埋め込んだGLBを書き出してください。');
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (resource.uri && !/^data:/i.test(resource.uri)) throw new Error('外部ファイルを参照するモデルは読み込めません。画像・テクスチャをGLB内に埋め込んでください。');
  }
  if (estimateTriangles(json) > MAX_TRIANGLES) throw new Error('モデルが200万ポリゴンを超えています。描画を安定させるため、200万ポリゴン以下に調整してください。');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw new Error('モデルから外部ファイルへのアクセスを停止しました。テクスチャを埋め込んだGLBを使用してください。');
  });
  const loader = new GLTFLoader(manager);
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  } catch (error) {
    const message = error?.message || String(error);
    if (/外部ファイル|埋め込/.test(message)) throw error;
    throw new Error('モデルを読み込めませんでした。GLB・VRMの書き出し設定を確認してください。' + (/draco/i.test(message) ? ' Draco圧縮は非対応です。' : ''));
  }
  const source = gltf.scene || gltf.scenes?.[0];
  if (!source) throw new Error('モデルに表示できるシーンがありません。');
  let triangles = 0, meshCount = 0;
  source.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    meshCount++;
    triangles += Math.floor((object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3) * (object.isInstancedMesh ? object.count : 1);
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.isSkinnedMesh) object.frustumCulled = false;
  });
  if (!meshCount || triangles > MAX_TRIANGLES) {
    disposeObject(source);
    throw new Error(!meshCount ? '表示できるメッシュが見つかりません。' : 'モデルが200万ポリゴンを超えています。ポリゴン数を調整してください。');
  }
  source.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(source);
  const size = bbox.getSize(new THREE.Vector3()), center = bbox.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y < .00001 || size.y > 1e8) {
    disposeObject(source);
    throw new Error('モデルの大きさを取得できません。メッシュとスケールを確認してください。');
  }
  const scale = 1.75 / size.y;
  const group = new THREE.Group();
  group.name = name;
  const facing = new THREE.Group();
  facing.rotation.y = Math.PI;
  const normalizer = new THREE.Group();
  normalizer.scale.setScalar(scale);
  normalizer.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);
  normalizer.add(source); facing.add(normalizer); group.add(facing);
  group.updateMatrixWorld(true);
  const baseHeight = normalizer.position.y;
  const limitations = [];
  if (triangles > 500000) limitations.push('50万ポリゴン以上のため、端末によっては動作が重くなります。');
  if (buffer.byteLength > 25 * 1024 * 1024) limitations.push('ファイルが25MB以上あるため、スマートフォンでは読み込みに時間がかかる場合があります。');
  if (json.extensions?.VRM || json.extensions?.VRMC_vrm) limitations.push('VRMの揺れ物・表情プリセット・専用シェーダーは簡易表示です。');
  const clips = gltf.animations || [];
  const clipNames = clips.map((clip, index) => clip.name || `アニメーション ${index + 1}`);
  const choose = expression => clips.find(clip => expression.test(clip.name || ''));
  const namedClips = {
    idle: choose(/idle|standing|(?:^|[ _-])stand(?:$|[ _-])|breath|待機|静止|休憩/i),
    walk: choose(/walk|歩行|歩く/i),
    run: choose(/run|jog|sprint|走|駆け/i),
    jump: choose(/jump|leap|hop|跳|ジャンプ/i)
  };
  const bones = identifyHumanoid(source, gltf, json);
  const rigged = Boolean(bones.leftUpperLeg && bones.rightUpperLeg);
  const boneStates = new Map();
  for (const bone of Object.values(bones)) if (bone && !boneStates.has(bone)) {
    boneStates.set(bone, { original: bone.quaternion.clone(), neutral: bone.quaternion.clone(), position: bone.position.clone() });
  }
  // Lower T-pose arms for procedural locomotion, while retaining authored rest transforms.
  const worldDown = new THREE.Vector3(0, -1, 0);
  for (const [upperKey, lowerKey] of [['leftUpperArm', 'leftLowerArm'], ['rightUpperArm', 'rightLowerArm']]) {
    const upper = bones[upperKey], lower = bones[lowerKey];
    if (!upper || !lower || !upper.parent || lower.position.lengthSq() < 1e-10) continue;
    const childDirection = lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    if (childDirection.dot(worldDown) > .72) continue;
    const parentInverse = upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const desired = worldDown.clone().applyQuaternion(parentInverse).normalize();
    const current = lower.position.clone().normalize().applyQuaternion(upper.quaternion);
    const adjust = new THREE.Quaternion().setFromUnitVectors(current, desired);
    boneStates.get(upper).neutral.copy(adjust.multiply(upper.quaternion));
  }
  const mixer = clips.length ? new THREE.AnimationMixer(source) : null;
  const actions = new Map();
  for (const clip of clips) actions.set(clip, mixer.clipAction(clip));
  if (!Object.values(namedClips).some(Boolean) && clips.length && !rigged) {
    namedClips.idle = clips[0]; namedClips.walk = clips[0]; namedClips.run = clips[0];
    limitations.push('動作名を判別できないため、先頭のアニメーションを基本動作として再生します。');
  }
  if (!clips.length && rigged) limitations.push('モデルの骨格から歩行・走行・待機モーションを生成します。');
  if (!rigged && !clips.length) limitations.push('骨格とアニメーションがないため、モデル全体の移動・回転・ジャンプのみ行います。');
  if (rigged && clips.length && (!namedClips.walk || !namedClips.idle)) limitations.push('不足する待機・歩行モーションは骨格を使った簡易モーションで補います。');
  if (!rigged && clips.length && !namedClips.walk) limitations.push('歩行アニメーションがないため、移動時の手足の動きは限定されます。');
  let activeAction = null, activeClip = null, disposed = false, phase = 0;
  const axisX = new THREE.Vector3(1,0,0), axisZ = new THREE.Vector3(0,0,1), rotation = new THREE.Quaternion();
  function restoreOriginal() {
    for (const [bone, state] of boneStates) {
      bone.quaternion.copy(state.original);
      bone.position.copy(state.position);
    }
  }
  function pose(key, x = 0, z = 0) {
    const bone = bones[key]; if (!bone) return;
    const state = boneStates.get(bone); bone.quaternion.copy(state.neutral);
    if (x) bone.quaternion.multiply(rotation.setFromAxisAngle(axisX, x));
    if (z) bone.quaternion.multiply(rotation.setFromAxisAngle(axisZ, z));
  }
  function play(clip, role, speed) {
    restoreOriginal(); normalizer.position.y = baseHeight;
    if (clip !== activeClip) {
      if (activeAction) activeAction.fadeOut(.18);
      activeAction = actions.get(clip); activeClip = clip;
      activeAction.reset();
      activeAction.setLoop(role === 'jump' ? THREE.LoopOnce : THREE.LoopRepeat, role === 'jump' ? 1 : Infinity);
      activeAction.clampWhenFinished = role === 'jump';
      activeAction.setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(.18).play();
    }
    if (role === 'walk' || role === 'run') activeAction.timeScale = Math.max(.55, Math.min(1.8, speed / (role === 'run' ? 4.2 : 1.6)));
    else activeAction.timeScale = 1;
  }
  function update(dt, { moving = false, running = false, jumping = false, speed = running ? 4.2 : 1.6 } = {}) {
    if (disposed) return;
    const delta = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    phase += delta * (moving ? running ? 11.5 : 7.3 : 1.6);
    const role = jumping ? 'jump' : moving ? running ? 'run' : 'walk' : 'idle';
    const clip = namedClips[role] || (role === 'run' ? namedClips.walk : null);
    if (clip) {
      play(clip, role, Number.isFinite(speed) ? speed : 1.6);
      mixer.update(delta);
      return;
    }
    if (activeAction) { mixer.stopAllAction(); activeAction = null; activeClip = null; }
    restoreOriginal();
    if (rigged) {
      const swing = moving && !jumping ? Math.sin(phase) * (running ? .68 : .39) : 0;
      const knee = moving && !jumping ? (running ? .95 : .48) : 0;
      const breath = !moving && !jumping ? Math.sin(phase) * .012 : 0;
      pose('leftUpperLeg', jumping ? -.3 : swing);
      pose('rightUpperLeg', jumping ? -.22 : -swing);
      pose('leftLowerLeg', jumping ? .6 : Math.max(0, -Math.sin(phase)) * knee);
      pose('rightLowerLeg', jumping ? .48 : Math.max(0, Math.sin(phase)) * knee);
      pose('leftUpperArm', jumping ? -.48 : -swing * .75 + breath);
      pose('rightUpperArm', jumping ? -.48 : swing * .75 + breath);
      pose('leftLowerArm', running ? -.6 : -.13);
      pose('rightLowerArm', running ? -.6 : -.13);
      pose('spine', jumping ? .07 : moving && running ? .06 : breath * .45);
      normalizer.position.y = baseHeight + (moving && !jumping ? Math.abs(Math.sin(phase * 2)) * (running ? .024 : .012) : 0);
    } else normalizer.position.y = baseHeight;
  }
  update(0, {});
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(source); }
    disposeObject(source);
    group.removeFromParent(); group.clear();
  }
  return { group, update, dispose, triangles, animations: clipNames, method: 'glb', limitations, rigged };
}

function inspectBinaryGltf(buffer) {
  if (buffer.byteLength < 20) throw new Error('ファイルが短すぎるため、GLB・VRMとして読み込めません。');
  const view = new DataView(buffer);
  if (view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2) throw new Error('glTF 2.0のバイナリ形式（GLB・VRM）を選んでください。');
  if (view.getUint32(8,true) !== buffer.byteLength) throw new Error('モデルファイルの長さが正しくありません。再度書き出してください。');
  const length = view.getUint32(12,true);
  if (view.getUint32(16,true) !== 0x4e4f534a || length > buffer.byteLength - 20) throw new Error('モデルのJSONデータが破損しています。');
  try { return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)).replace(/\0+$/,'')); }
  catch { throw new Error('モデルのJSONデータを読み込めません。'); }
}

function estimateTriangles(json) {
  const perMesh = (json.meshes || []).map(mesh => (mesh.primitives || []).reduce((sum, p) => {
    const accessor = json.accessors?.[p.indices ?? p.attributes?.POSITION];
    const count = accessor?.count || 0, mode = p.mode ?? 4;
    return sum + (mode === 4 ? Math.floor(count/3) : mode === 5 || mode === 6 ? Math.max(0,count-2) : 0);
  },0));
  let total=0, nodes=0;
  for (const node of json.nodes || []) if (Number.isInteger(node.mesh)) { total += perMesh[node.mesh] || 0; nodes++; }
  return nodes ? total : perMesh.reduce((a,b)=>a+b,0);
}

function identifyHumanoid(source, gltf, json) {
  const result = {}, byIndex = new Map();
  source.traverse(object => {
    const nodeIndex = gltf.parser?.associations?.get(object)?.nodes;
    if (Number.isInteger(nodeIndex)) byIndex.set(nodeIndex,object);
  });
  const vrm0 = json.extensions?.VRM?.humanoid?.humanBones || [];
  for (const item of vrm0) if (byIndex.has(item.node)) result[item.bone] = byIndex.get(item.node);
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones || {};
  for (const [key,item] of Object.entries(vrm1)) if (byIndex.has(item.node)) result[key] = byIndex.get(item.node);
  const rules = {
    hips: /(?:hips|pelvis)$/,
    spine: /(?:spine|spine0|spine1|chest)$/,
    leftUpperLeg: /(?:(?:left|l)(?:upperleg|upleg|thigh)|(?:upperleg|upleg|thigh)(?:left|l))$/,
    rightUpperLeg: /(?:(?:right|r)(?:upperleg|upleg|thigh)|(?:upperleg|upleg|thigh)(?:right|r))$/,
    leftLowerLeg: /(?:(?:left|l)(?:lowerleg|leg|calf|shin)|(?:lowerleg|leg|calf|shin)(?:left|l))$/,
    rightLowerLeg: /(?:(?:right|r)(?:lowerleg|leg|calf|shin)|(?:lowerleg|leg|calf|shin)(?:right|r))$/,
    leftUpperArm: /(?:(?:left|l)(?:upperarm|arm)|(?:upperarm|arm)(?:left|l))$/,
    rightUpperArm: /(?:(?:right|r)(?:upperarm|arm)|(?:upperarm|arm)(?:right|r))$/,
    leftLowerArm: /(?:(?:left|l)(?:lowerarm|forearm)|(?:lowerarm|forearm)(?:left|l))$/,
    rightLowerArm: /(?:(?:right|r)(?:lowerarm|forearm)|(?:lowerarm|forearm)(?:right|r))$/
  };
  source.traverse(object => {
    if (!object.isBone) return;
    const name = (object.name || '').toLowerCase().replace(/[^a-z0-9]/g,'');
    for (const [key,regex] of Object.entries(rules)) if (!result[key] && regex.test(name)) result[key]=object;
  });
  return result;
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) { texture.dispose(); if (typeof texture.source?.data?.close === 'function') texture.source.data.close(); }
  for (const material of materials) material.dispose();
}
