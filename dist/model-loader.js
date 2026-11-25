import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { identifyHumanoid, buildAutomaticHumanoid } from './model-rig.js';
import { createModelMotion } from './model-motion.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TRIANGLES = 2000000;

/** Load a self-contained binary glTF / VRM into the game's avatar adapter. */
export async function loadCharacterModel(THREE, fileOrArrayBuffer, { name = 'モデル', motionConfig = {} } = {}) {
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
  if (![...size,...center].every(Number.isFinite) || size.y < .00001 || size.y > 1e8) {
    disposeObject(source);
    throw new Error('モデルの大きさを取得できません。メッシュとスケールを確認してください。');
  }
  const scale = 1.75 / size.y;
  const group = new THREE.Group();
  group.name = name;
  const facing = new THREE.Group();
  // VRM 0 faces -Z; VRM 1 faces +Z. Generic GLB may override this in the UI.
  const defaultFacing = json.extensions?.VRM && !json.extensions?.VRMC_vrm ? 0 : 180;
  const config = { mode: ['auto','procedural','authored'].includes(motionConfig.mode) ? motionConfig.mode : 'auto', facing: Number.isFinite(motionConfig.facing) ? ((motionConfig.facing%360)+360)%360 : defaultFacing };
  facing.rotation.y = config.facing * Math.PI / 180;
  const normalizer = new THREE.Group();
  normalizer.scale.setScalar(scale);
  normalizer.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);
  normalizer.add(source); facing.add(normalizer); group.add(facing);
  group.updateMatrixWorld(true);
  const limitations = [];
  if (triangles > 500000) limitations.push('50万ポリゴン以上のため、端末によっては動作が重くなります。');
  if (buffer.byteLength > 25 * 1024 * 1024) limitations.push('ファイルが25MB以上あるため、スマートフォンでは読み込みに時間がかかる場合があります。');
  if (json.extensions?.VRM || json.extensions?.VRMC_vrm) limitations.push('VRMの揺れ物・表情プリセット・専用シェーダーは簡易表示です。');
  const clips = gltf.animations || [];
  const clipNames = clips.map((clip,index) => clip.name || `アニメーション ${index+1}`);
  let rig = identifyHumanoid(THREE, source, gltf, json, facing), autoRigged = false;
  function ensureRig(force=false) {
    if (rig.rigged) return true;
    const generated = buildAutomaticHumanoid(THREE, source, facing, {force});
    if (!generated) return false;
    rig = generated; autoRigged = true;
    limitations.push('骨格のないモデルに簡易骨格とスキンウェイトを生成しました。人型の立ち姿向けです。衣装・髪・特殊な体形では変形が不自然になる場合があります。');
    return true;
  }
  if (!rig.rigged) ensureRig(config.mode === 'procedural');
  if (rig.inferred) limitations.push('名称のない関節を位置と階層から推定しています。関節の位置が異なるモデルでは調整が必要です。');
  if (!rig.rigged && !clips.length) limitations.push('人型の骨格を判別できません。「骨格モーション」で簡易骨格の生成を試せます。四足動物・乗り物などの任意形状は専用の骨格またはアニメーションが必要です。');
  let disposed = false;
  const createMotion = () => createModelMotion(THREE, {source,group,facing,bones:rig.bones,clips,rigged:rig.rigged,frontSign:-1,mode:config.mode});
  let motion = createMotion();
  const motionSummary = () => config.mode==='authored' && clips.length ? '付属アニメーションを優先して再生' : autoRigged ? '自動生成した簡易骨格で待機・歩行・走行・ジャンプ' : rig.rigged
    ? clips.length && config.mode !== 'procedural' ? '付属モーション＋不足する動作を骨格で補完' : '骨格から待機・歩行・走行・ジャンプを生成'
    : clips.length ? '付属アニメーションを再生' : '人型を判別できません。骨格モーションを試すか、骨格付きモデルを読み込んでください';
  function update(dt,context={}) { if (!disposed) motion.update(dt,context); }
  function setMotionConfig(next={}) {
    if(disposed)return {...config};
    if(['auto','procedural','authored'].includes(next.mode)) {
      if(next.mode==='procedural' && !rig.rigged) {
        motion.dispose();ensureRig(true);motion=createMotion();
      }
      config.mode=next.mode;motion.setMode(config.mode);
    }
    if(Number.isFinite(next.facing)) { config.facing=((next.facing%360)+360)%360;facing.rotation.y=config.facing*Math.PI/180; }
    update(0,{});return {...config};
  }
  function dispose() {
    if(disposed)return;disposed=true;motion.dispose();
    // Includes an automatically generated skeleton outside the original scene.
    disposeObject(facing);group.removeFromParent();group.clear();
  }
  return {group,update,dispose,triangles,animations:clipNames,method:'glb',limitations,setMotionConfig,
    getMotionConfig:()=>({...config}),getMotionStatus:()=>motion.getStatus(),
    get rigged(){return rig.rigged;},get autoRigged(){return autoRigged;},get motionMode(){return config.mode;},get motionSummary(){return motionSummary();}};
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

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
  }
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) { texture.dispose(); if (typeof texture.source?.data?.close === 'function') texture.source.data.close(); }
  for (const material of materials) material.dispose();
}
