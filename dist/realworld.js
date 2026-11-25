import {createMaterialLibrary,createVegetationDetail} from './materials.js';
import {createTraffic} from './traffic.js';
/* Real street geometry from OpenStreetMap. Facades and interiors remain game representations. */
const ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const CACHE_KEY = 'machi-realworld-osm-v1';
const CACHE_AGE = 24 * 60 * 60 * 1000;
const EARTH_RADIUS = 6378137;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

/** onProgress(message, fraction); bounded map snapshot, with one transport fallback only. */
export async function createRealWorld(THREE, { latitude, longitude, radius = 250, onProgress = () => {}, signal, terrain, terrainPromise } = {}) {
  const options = validateOptions({latitude, longitude, radius, terrain});
  // Attach a handler immediately while the independent map request starts. Root decides
  // whether unavailable elevation is an error or a flat-terrain fallback.
  const pendingTerrain=terrainPromise?Promise.resolve(terrainPromise).then(value=>({value}),error=>({error})):null;
  if (signal?.aborted) throw new DOMException('街の読み込みを中止しました。', 'AbortError');
  const key = `${options.latitude.toFixed(5)},${options.longitude.toFixed(5)},${options.radius}`;
  const cachedRow=readCache(key);let data=cachedRow?.data||null,cached=Boolean(data);
  let transport=cachedRow?.transport||'direct',provider=cachedRow?.provider||'private.coffee',endpoint=cachedRow?.endpoint||ENDPOINT;
  onProgress(cached ? '保存済みの実際の街データを開いています…' : '現在地周辺の道路・建物データを取得しています…', .1);
  if (!data) {
    const started=Date.now(),deadline=started+55000;
    const canonical='https://machi-life.hisa-0128-1996.chatgpt.site';
    const origin=typeof location!=='undefined'?location.origin:'';
    const proxyOrigin=origin===canonical?origin:canonical;
    const params=new URLSearchParams({lat:options.latitude.toFixed(7),lon:options.longitude.toFixed(7),radius:String(options.radius)});
    const proxyUrl=`${proxyOrigin}/api/world?${params}`;
    const lat=options.latitude.toFixed(7),lon=options.longitude.toFixed(7),r=options.radius,around=`(around:${r},${lat},${lon})`;
    const query=`[out:json][timeout:8][maxsize:33554432];(`+
      `way${around}["building"];way${around}["building:part"];way${around}["highway"];way${around}["leisure"];way${around}["landuse"];`+
      `way${around}["natural"~"^(water|wood|scrub|wetland|beach)$"];way${around}["waterway"];`+
      `relation${around}["type"="multipolygon"]["natural"="water"];`+
      `node${around}["shop"];node${around}["amenity"];node${around}["entrance"];node${around}["natural"="tree"];);out geom;`;
    async function request(url,init,timeoutMs){
      const controller=new AbortController();let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,timeoutMs));
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      try{
        if(signal?.aborted)throw new DOMException('街の読み込みを中止しました。','AbortError');
        const response=await fetch(url,{...init,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        if(response.status===429||response.status===406){const e=new Error(response.status===429?'地図サーバーが混み合っています。自動再試行はしていません。少し時間を置いてから、もう一度読み込んでください。':'地図サーバーがこのリクエストを受け付けませんでした。少し時間を置いてからお試しください。');e.status=response.status;throw e;}
        if(!response.ok){const e=new Error(`街データを取得できませんでした（HTTP ${response.status}）。時間を置いてからお試しください。`);e.status=response.status;throw e;}
        const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>MAX_RESPONSE_BYTES)throw new Error('この地域の地図データが大きすぎます。取得範囲を小さくしてください。');
        const text=await response.text();if(text.length>MAX_RESPONSE_BYTES)throw new Error('この地域の地図データが大きすぎます。取得範囲を小さくしてください。');
        let parsed;try{parsed=JSON.parse(text);}catch{throw new Error('地図サーバーから正しいデータを受け取れませんでした。時間を置いてからお試しください。');}
        if(parsed.remark)throw new Error('地図サーバーが処理を完了できませんでした。時間を置くか取得範囲を小さくしてください。');
        if(!Array.isArray(parsed.elements))throw new Error('道路・建物データの形式が正しくありません。');
        return {data:parsed,provider:response.headers.get('X-World-Provider')||null};
      }catch(error){
        if(signal?.aborted)throw new DOMException('街の読み込みを中止しました。','AbortError');
        if(timedOut){const e=new Error('地図データの応答が制限時間内に届きませんでした。取得範囲を小さくして、もう一度お試しください。');e.transportFailure=true;throw e;}
        if(error instanceof TypeError){const e=new Error('地図サーバーに接続できませんでした。通信状況をご確認ください。');e.transportFailure=true;throw e;}
        throw error;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    try{
      const result=await request(proxyUrl,{method:'GET',headers:{Accept:'application/json'}},45000);
      data=result.data;transport='proxy';provider=result.provider||'公開地図中継';endpoint=`${proxyOrigin}/api/world`;
    }catch(error){
      if(signal?.aborted||error.name==='AbortError')throw error;
      // Rate/policy responses are terminal. A single direct transport attempt is
      // reserved for an unreachable intermediary or its service-unavailable reply.
      if(!(error.transportFailure||error.status===503)||deadline-Date.now()<500)throw error;
      onProgress('地図の接続経路を切り替えています…',.28);
      const result=await request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}).toString()},Math.min(10000,deadline-Date.now()));
      data=result.data;transport='direct';provider='private.coffee';endpoint=ENDPOINT;
    }
    writeCache(key,data,{transport,provider,endpoint});
  }
  if(pendingTerrain){onProgress('街の地形データを組み合わせています…',.56);const result=await pendingTerrain;if(result.error)throw result.error;options.terrain=result.value;}
  if (signal?.aborted) throw new DOMException('街の読み込みを中止しました。','AbortError');
  onProgress('実際の建物の輪郭と道路を3Dに組み立てています…', .64);
  const world = buildRealWorldFromData(THREE, data, options);
  Object.assign(world.sourceInfo,{cached,provider,transport,endpoint});
  onProgress('現在地の街を読み込みました。',1);
  return world;
}

/** Separate pure geometry entry point for fixtures, cached snapshots, and deterministic verification. */
export function buildRealWorldFromData(THREE, data, input = {}) {
  const {latitude,longitude,radius,terrain} = validateOptions(input);
  if (!Array.isArray(data?.elements)) throw new Error('OpenStreetMapデータがありません。');
  const library=createMaterialLibrary(THREE,{quality:'high'}),treeRecords=[];
  const group = new THREE.Group(); group.name='現在地の街';
  const colliders=[], interactables=[], buildings=[], mapFeatures={roads:[],areas:[],origin:{x:0,z:0}};
  const resources={geometries:new Set(),materials:new Set(),textures:new Set()};
  const bounds={minX:-radius,maxX:radius,minZ:-radius,maxZ:radius};
  const cosLat=Math.max(.015,Math.cos(latitude*Math.PI/180));
  const toLocal=(lat,lon)=>({x:wrappedLon(lon-longitude)*Math.PI/180*EARTH_RADIUS*cosLat,z:-(lat-latitude)*Math.PI/180*EARTH_RADIUS});
  const toGeo=(x,z)=>({latitude:latitude-z/EARTH_RADIUS*180/Math.PI,longitude:normalizeLon(longitude+x/(EARTH_RADIUS*cosLat)*180/Math.PI)});
  const rawHeight=typeof terrain==='function'?terrain:typeof terrain?.heightAt==='function'?terrain.heightAt.bind(terrain):()=>0;
  const terrainHeight=(x,z)=>{const n=rawHeight(x,z);return Number.isFinite(n)?n:0;};
  const material=(color,extra={},kind='stone')=>{const m=library.material(kind,color,{roughness:.83,...extra});resources.materials.add(m);return m;};
  const wallPalette=['#d9d2c2','#c9c7bb','#b9b6a8','#dedbcf','#d7c5ad','#c0b5a6','#c6c9c2','#d2cdc0'].map(c=>material(c));
  const roofPalette=['#818e8a','#8c8d82','#a9aa9c','#71817e'].map(c=>material(c));
  const asphalt=material('#626d6b',{},'asphalt'), sidewalk=material('#c6c3b4',{},'paving'), pathMat=material('#b4b49b',{},'stone'), waterMat=material('#7da4a1',{metalness:.25,roughness:.2},'water');
  const windowMat=material('#73908e',{roughness:.18,metalness:.38,emissive:'#576c67',emissiveIntensity:.08},'glass');
  const railMat=material('#4d5f59',{metalness:.3,roughness:.6},'metal'),frameMat=material('#78817b',{metalness:.3,roughness:.5},'metal'),sillMat=material('#c8c7bc'),roadPaint=material('#e0ded0',{roughness:.97});
  const leafMat=material('#6e8754',{},'leaf'), trunkMat=material('#75664d',{},'bark');
  const batches=new Map(), instances=new Map();
  function addGeometry(geometry,materials){
    const geo=geometry.index?geometry.toNonIndexed():geometry;
    const pos=geo.attributes.position,norm=geo.attributes.normal,uv=geo.attributes.uv;
    const groups=geo.groups.length?geo.groups:[{start:0,count:pos.count,materialIndex:0}];
    for(const section of groups){
      const mat=Array.isArray(materials)?materials[section.materialIndex||0]:materials;
      let bucket=batches.get(mat.uuid);if(!bucket){bucket={mat,p:[],n:[],uv:[]};batches.set(mat.uuid,bucket);}
      const end=Math.min(pos.count,section.start+section.count);
      for(let i=section.start;i<end;i++){bucket.p.push(pos.getX(i),pos.getY(i),pos.getZ(i));bucket.n.push(norm?.getX(i)||0,norm?norm.getY(i):1,norm?.getZ(i)||0);bucket.uv.push(uv?.getX(i)||0,uv?.getY(i)||0);}
    }
    if(geo!==geometry)geo.dispose();geometry.dispose();
  }
  const unitBox=new THREE.BoxGeometry(1,1,1),unitSphere=library.sphere(true),unitCylinder=library.cylinder();
  resources.geometries.add(unitBox);resources.geometries.add(unitSphere);resources.geometries.add(unitCylinder);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),quaternion=new THREE.Quaternion(),euler=new THREE.Euler();
  function instance(geo,mat,x,y,z,sx,sy,sz,ry=0){
    const key=geo.uuid+'|'+mat.uuid;let b=instances.get(key);if(!b){b={geo,mat,matrices:[]};instances.set(key,b);}
    position.set(x,y,z);scale.set(sx,sy,sz);quaternion.setFromEuler(euler.set(0,ry,0));matrix.compose(position,quaternion,scale);b.matrices.push(matrix.clone());
  }
  function polygonShape(points,holes=[]){
    const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,-p.z)));
    for(const hole of holes)shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p.x,-p.z))));
    return shape;
  }
  function areaMesh(points,holes,mat,offset=.02){
    if(points.length<3)return;
    const geometry=new THREE.ShapeGeometry(polygonShape(points,holes));geometry.rotateX(-Math.PI/2);
    const attr=geometry.attributes.position;for(let i=0;i<attr.count;i++)attr.setY(i,terrainHeight(attr.getX(i),attr.getZ(i))+offset);
    geometry.computeVertexNormals();addGeometry(geometry,mat);
  }
  function ribbon(points,width,mat,offset=.045){
    const p=[],uv=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.05)continue;
      const nx=-dz/len*width/2,nz=dx/len*width/2,steps=Math.ceil(len/7);
      for(let j=0;j<steps;j++){
        const aa={x:a.x+dx*j/steps,z:a.z+dz*j/steps},bb={x:a.x+dx*(j+1)/steps,z:a.z+dz*(j+1)/steps};
        const corners=[{x:aa.x+nx,z:aa.z+nz},{x:aa.x-nx,z:aa.z-nz},{x:bb.x+nx,z:bb.z+nz},{x:bb.x-nx,z:bb.z-nz}];
        for(const k of [0,2,1,1,2,3]){const c=corners[k];p.push(c.x,terrainHeight(c.x,c.z)+offset,c.z);uv.push(c.x/5,c.z/5);}
      }
    }
    if(!p.length)return;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();addGeometry(geo,mat);
  }
  // Elevations are relative to the starting location; no added absolute elevation offset.
  const groundGeo=new THREE.PlaneGeometry(radius*2,radius*2,96,96);groundGeo.rotateX(-Math.PI/2);
  const groundPos=groundGeo.attributes.position;
  for(let i=0;i<groundPos.count;i++)groundPos.setY(i,terrainHeight(groundPos.getX(i),groundPos.getZ(i))-.015);
  groundGeo.computeVertexNormals();resources.geometries.add(groundGeo);
  const groundMaterial=material('#b5b7a1',{},'grass');library.apply(groundMaterial,'grass',{preserveMap:false,repeat:new THREE.Vector2(radius/4,radius/4)});
  const ground=new THREE.Mesh(groundGeo,groundMaterial);ground.receiveShadow=true;group.add(ground);
  const nodes=data.elements.filter(e=>e.type==='node'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)).map(e=>({...e,point:toLocal(e.lat,e.lon)}));
  const ways=data.elements.filter(e=>e.type==='way'&&Array.isArray(e.geometry)&&e.geometry.length>1).map(e=>({...e,points:cleanPoints(e.geometry.map(p=>toLocal(p.lat,p.lon))),linePoints:e.geometry.map(p=>toLocal(p.lat,p.lon))}));
  const insideCoverage=p=>Math.abs(p.x)<=radius+80&&Math.abs(p.z)<=radius+80;
  let areaCount=0, inferredHeightCount=0, mappedHeightCount=0, windowCount=0, detailedWindowCount=0, sceneryTrees=0;
  const greenAreas=[], waterAreas=[];
  const areaMats=new Map();
  function drawArea(points,holes,tags,id){
    points=clipPolygon(points,bounds);holes=holes.map(h=>clipPolygon(h,bounds)).filter(h=>h.length>=3);
    if(points.length<3)return;
    const isWater=tags.natural==='water'||['riverbank','dock'].includes(tags.waterway)||['reservoir','basin'].includes(tags.landuse);
    const isGreen=tags.leisure==='park'||tags.leisure==='garden'||['wood','scrub','wetland'].includes(tags.natural)||['forest','grass','meadow','recreation_ground','village_green','allotments','orchard'].includes(tags.landuse);
    const color=isWater?'#7da4a1':isGreen?'#8da078':tags.natural==='beach'?'#c6bda1':['farmland','farmyard'].includes(tags.landuse)?'#aaa581':['industrial','commercial','retail'].includes(tags.landuse)?'#bbb9aa':['pitch','playground','sports_centre'].includes(tags.leisure)?'#99ad8f':'#b8b8a6';
    let mat=areaMats.get(color);if(!mat){mat=isWater?waterMat:material(color);areaMats.set(color,mat);}
    areaMesh(points,holes,mat,isWater?.035:.018);
    mapFeatures.areas.push({id,points,holes,color,water:isWater});areaCount++;
    if(isGreen)greenAreas.push({points,holes,id});
    if(isWater){waterAreas.push({points,holes});const box=polygonBounds(points);colliders.push({...box,polygon:points,holes,type:'water'});}
  }
  for(const way of ways){
    const t=way.tags||{};if(t.building||t['building:part']||t.highway||!isClosedWay(way))continue;
    if(t.landuse||t.leisure||t.natural==='water'||t.natural==='wood'||t.natural==='scrub'||t.natural==='wetland'||t.natural==='beach'||t.waterway==='riverbank')drawArea(way.points,[],t,`osm-way-${way.id}`);
  }
  for(const relation of data.elements.filter(e=>e.type==='relation'&&e.tags?.type==='multipolygon'&&e.tags?.natural==='water')){
    const outer=joinRings((relation.members||[]).filter(m=>m.role!=='inner'&&m.geometry).map(m=>m.geometry.map(p=>toLocal(p.lat,p.lon))));
    const inner=joinRings((relation.members||[]).filter(m=>m.role==='inner'&&m.geometry).map(m=>m.geometry.map(p=>toLocal(p.lat,p.lon))));
    for(const ring of outer)drawArea(ring,inner.filter(h=>pointInPolygon(h[0],ring)),relation.tags,`osm-relation-${relation.id}`);
  }
  // Actual centre lines and tag-based widths. Unknown widths use an explicit rendering estimate.
  for(const way of ways){
    const t=way.tags||{};
    if(t.highway&&!['construction','proposed'].includes(t.highway)&&t.tunnel!=='yes'&&t.location!=='underground'){
      const roadType=t.highway,width=roadWidth(t),pedestrian=['footway','path','pedestrian','cycleway','steps','bridleway'].includes(roadType);
      const fragments=clipPolyline(way.linePoints,bounds);
      for(let part=0;part<fragments.length;part++){const points=fragments[part];
        mapFeatures.roads.push({id:`osm-way-${way.id}-${part}`,name:t.name||'',points,width,type:roadType,inferredWidth:!t.width,oneWay:t.oneway||'no',foot:t.foot||'',bridge:t.bridge==='yes',sidewalk:t.sidewalk||''});
        if(!pedestrian)ribbon(points,width+1.7,sidewalk,.037);
        ribbon(points,width,pedestrian?pathMat:asphalt,pedestrian?.049:.059);
        // Generic lane detail follows mapped geometry; it is decorative, not a record of local markings.
        if(!pedestrian&&width>=6&&roadType!=='service')for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz);if(len<8)continue;for(let d=3;d<len-3;d+=8){const x=a.x+dx*d/len,z=a.z+dz*d/len;instance(unitBox,roadPaint,x,terrainHeight(x,z)+.07,z,.095,.008,2.4,yaw);}}
      }
    }else if(['river','stream','canal','drain','ditch'].includes(t.waterway)){
      const width=numberTag(t.width)||({river:12,canal:8,stream:2.4,drain:1.5,ditch:1}[t.waterway]);
      for(const points of clipPolyline(way.linePoints,bounds)){ribbon(points,Math.max(.6,Math.min(width,80)),waterMat,.037);
        mapFeatures.areas.push({id:`osm-way-${way.id}`,points,color:'#7da4a1',line:true,width});}
    }
  }
  const buildingRecords=[];
  for(const way of ways){
    const t=way.tags||{};
    if((!t.building||t.building==='no')&&(!t['building:part']||t['building:part']==='no'))continue;
    if(way.points.length<3||!isClosedWay(way)||!way.points.some(insideCoverage))continue;
    const polygon=way.points,box=polygonBounds(polygon),center=polygonCentroid(polygon);
    if(Math.abs(polygonArea(polygon))<2)continue;
    const explicitHeight=numberTag(t.height)||numberTag(t['building:height']);
    const levels=numberTag(t['building:levels']);
    const fallbackHeight=['garage','garages','shed','hut','roof'].includes(t.building)?3.2:['apartments','commercial','office','hotel','hospital'].includes(t.building)?12:['industrial','warehouse','supermarket','retail'].includes(t.building)?7:6.5;
    const height=Math.max(2.2,Math.min(1500,explicitHeight||(levels?levels*3.05:fallbackHeight)));
    const heightSource=explicitHeight>1500?'estimated':explicitHeight?'height':levels?'levels':'estimated';heightSource==='estimated'?inferredHeightCount++:mappedHeightCount++;
    const minHeight=Math.max(0,Math.min(height-1,numberTag(t.min_height)||numberTag(t['building:min_level'])*3.05||0));
    const baseY=terrainHeight(center.x,center.z)+minHeight;
    const hash=hashId(way.id),wall=wallPalette[hash%wallPalette.length],roof=roofPalette[hash%roofPalette.length];
    const geometry=new THREE.ExtrudeGeometry(polygonShape(polygon),{depth:height-minHeight,bevelEnabled:false,steps:1,curveSegments:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(0,baseY,0);addGeometry(geometry,[roof,wall]);
    const isPart=!t.building&&Boolean(t['building:part']);
    const poi=nodes.find(n=>(n.tags?.shop||n.tags?.amenity)&&pointInPolygon(n.point,polygon));
    const combined={...(poi?.tags||{}),...t};
    const type=classifyBuilding(combined);
    const actualName=t.name||poi?.tags?.name||t['addr:housename'];
    const name=actualName||({home:'住宅',cafe:'飲食店',market:'店舗',office:'建物',gallery:'文化施設',bookstore:'書店'}[type]);
    const record={id:`osm-way-${way.id}`,name,type,interiorId:type,x:center.x,z:center.z,w:box.maxX-box.minX,d:box.maxZ-box.minZ,mapColor:wall.color.getStyle(),polygon,height,heightSource,baseY,tags:combined,osmId:way.id,actualName:Boolean(actualName),entrance:null};
    const collider={...box,polygon,type:'building',buildingId:record.id};colliders.push(collider);
    if(!isPart)buildingRecords.push(record);
    // Facade windows are deliberately generic; actual footprint and height tags remain intact.
    if(height>=4&&!['shed','garage','garages','warehouse','roof'].includes(t.building)){
      const floors=Math.min(18,Math.floor((height-minHeight-1)/3.05)),orientation=Math.sign(polygonArea(polygon))||1;
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<3)continue;
        const columns=Math.min(25,Math.floor((len-1.1)/3)),nx=dz/len*orientation,nz=-dx/len*orientation,yaw=Math.atan2(dx,dz)-Math.PI/2;
        if(Math.hypot(center.x,center.z)<180){const x=(a.x+b.x)/2+nx*.025,z=(a.z+b.z)/2+nz*.025;instance(unitBox,sillMat,x,baseY+height-minHeight-.12,z,len,.2,.14,yaw);instance(unitBox,roof,x,baseY+.18,z,len,.35,.1,yaw);}
        for(let col=0;col<columns&&windowCount<10000;col++)for(let floor=0;floor<floors&&windowCount<10000;floor++){
          const ratio=(col+1)/(columns+1),x=a.x+dx*ratio+nx*.035,z=a.z+dz*ratio+nz*.035;
          const w=Math.min(1.4,len/(columns+1)*.56),y=baseY+1.8+floor*3.05;instance(unitBox,windowMat,x,y,z,w,1.35,.075,yaw);windowCount++;
          if(Math.hypot(x,z)<125&&detailedWindowCount<2400){const tx=dx/len,tz=dz/len,fx=x+nx*.055,fz=z+nz*.055;for(const side of [-1,1]){instance(unitBox,frameMat,fx+tx*side*(w/2+.025),y,fz+tz*side*(w/2+.025),.065,1.48,.12,yaw);instance(unitBox,frameMat,fx,y+side*.71,fz,w+.12,.065,.12,yaw);}instance(unitBox,frameMat,fx,y,fz,.035,1.35,.1,yaw);instance(unitBox,sillMat,x+nx*.105,y-.77,z+nz*.105,w+.25,.1,.25,yaw);detailedWindowCount++;}
        }
      }
    }
  }
  // Match real entrance nodes when present; otherwise choose an accessible street-facing edge.
  const entranceNodes=nodes.filter(n=>n.tags?.entrance&&n.tags.entrance!=='no');
  for(const record of buildingRecords){
    const entrance=findEntrance(record,entranceNodes,mapFeatures.roads,colliders,bounds);
    record.entrance=entrance;
    buildings.push(record);
    if(entrance){
      interactables.push({id:'door-'+record.id,kind:'door',title:record.name,subtitle:'建物に入る（室内はゲーム用の再現）',position:new THREE.Vector3(entrance.x,terrainHeight(entrance.x,entrance.z),entrance.z),buildingId:record.id,interiorId:record.type,radius:3.3});
      // A restrained door insert communicates the interactable position without inventing signage.
      const doorX=entrance.edge.x+entrance.normal.x*.045,doorZ=entrance.edge.z+entrance.normal.z*.045;
      const yaw=Math.atan2(entrance.normal.x,entrance.normal.z),y=terrainHeight(doorX,doorZ),nx=entrance.normal.x,nz=entrance.normal.z,tx=nz,tz=-nx;
      instance(unitBox,railMat,doorX,y+1.2,doorZ,1.08,2.4,.12,yaw);
      instance(unitBox,windowMat,doorX+nx*.075,y+1.28,doorZ+nz*.075,.86,2.08,.04,yaw);
      instance(unitBox,frameMat,doorX+tx*.28+nx*.13,y+1.05,doorZ+tz*.28+nz*.13,.035,.36,.065,yaw);
      instance(unitBox,sillMat,doorX+nx*.12,y+.05,doorZ+nz*.12,1.22,.1,.34,yaw);
    }
  }
  // Mapped trees plus modest visual vegetation only inside mapped green areas.
  function tree(x,z,id,scale=1){
    const y=terrainHeight(x,z),h=3.2*scale;treeRecords.push({x,z,scale,seed:hashId(id),canopyY:h+1.05*scale});
    instance(unitCylinder,trunkMat,x,y+h/2,z,.12*scale,h,.12*scale);
    instance(unitSphere,leafMat,x,y+h+1.05*scale,z,1.65*scale,1.6*scale,1.55*scale);
    instance(unitSphere,leafMat,x+.65*scale,y+h+.7*scale,z-.4*scale,1.15*scale,1.15*scale,1.2*scale);
    sceneryTrees++;
  }
  for(const node of nodes.filter(n=>n.tags?.natural==='tree').slice(0,450))if(insideCoverage(node.point))tree(node.point.x,node.point.z,node.id,.85+(hashId(node.id)%35)/100);
  const clearPoint=(p,margin=.38)=>!colliders.some(c=>pointBlocked(p,c,margin));
  for(const area of greenAreas){
    const box=polygonBounds(area.points),areaSize=Math.abs(polygonArea(area.points));
    let state=hashId(area.id)||1,planted=0;const count=Math.min(22,Math.floor(areaSize/240));
    for(let attempt=0;attempt<count*12&&planted<count&&sceneryTrees<650;attempt++){
      state=(state*1664525+1013904223)>>>0;const x=box.minX+(state/4294967296)*(box.maxX-box.minX);
      state=(state*1664525+1013904223)>>>0;const z=box.minZ+(state/4294967296)*(box.maxZ-box.minZ),p={x,z};
      if(!insideCoverage(p)||!pointInPolygon(p,area.points)||area.holes.some(h=>pointInPolygon(p,h))||!clearPoint(p,2))continue;
      if(nearestRoadDistance(p,mapFeatures.roads)<4)continue;
      tree(x,z,attempt,.8+(state%40)/100);planted++;
    }
  }
  // Batch static meshes by material. Geometry stays geographically exact in metre coordinates.
  for(const b of batches.values()){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));geo.computeBoundingSphere();resources.geometries.add(geo);
    const mesh=new THREE.Mesh(geo,b.mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  for(const b of instances.values()){
    const mesh=new THREE.InstancedMesh(b.geo,b.mat,b.matrices.length);for(let i=0;i<b.matrices.length;i++)mesh.setMatrixAt(i,b.matrices[i]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
  }
  let spawnPoint={x:0,z:0};
  if(!clearPoint(spawnPoint,.55)){
    let found=false;
    for(let d=.75;d<=Math.min(radius-3,150)&&!found;d+=.75){
      const samples=Math.max(24,Math.ceil(d*4));
      for(let k=0;k<samples;k++){const angle=k/samples*Math.PI*2,p={x:Math.sin(angle)*d,z:Math.cos(angle)*d};if(clearPoint(p,.55)){spawnPoint=p;found=true;break;}}
    }
    if(!found){const first=interactables.find(i=>clearPoint(i.position,.55));if(first)spawnPoint={x:first.position.x,z:first.position.z};}
  }
  if(!clearPoint(spawnPoint,.5)){for(const geometry of resources.geometries)geometry.dispose();for(const mat of resources.materials)mat.dispose();throw new Error('この取得範囲内に歩ける屋外の開始位置を見つけられませんでした。近くの屋外地点を選んでください。');}
  const offset=Math.hypot(spawnPoint.x,spawnPoint.z);
  const spawn={...spawnPoint,yaw:0};
  const gpsMat=new THREE.MeshBasicMaterial({color:'#f2cb66',side:THREE.DoubleSide,transparent:true,opacity:.9});resources.materials.add(gpsMat);
  const gpsGeo=new THREE.RingGeometry(.72,1,40);resources.geometries.add(gpsGeo);
  const gpsMarker=new THREE.Mesh(gpsGeo,gpsMat);gpsMarker.rotation.x=-Math.PI/2;gpsMarker.position.set(0,terrainHeight(0,0)+.1,0);gpsMarker.name='取得した現在地';group.add(gpsMarker);
  mapFeatures.origin={x:0,z:0,spawnOffsetMeters:offset};
  const terrainSource=terrain?.sourceInfo||null;
  const notes=[
    '道路の位置・建物の輪郭はOpenStreetMapの記録に基づきます。',
    '外観・窓・記録のない高さや道路幅・室内はゲーム用の簡易表現です。',
    terrain?'地形は取得した標高データを補間した表現です。':'標高未取得のため、地形は平坦に表示しています。'
  ];
  if(offset>.5)notes.push(`取得した現在地が建物・水域内に重なるため、開始位置を約${Math.round(offset)}m先の屋外へ移しています。元の現在地は地図の印で示します。`);
  if(!buildings.length&&!mapFeatures.roads.length)notes.push('この範囲の道路・建物は地図に記録されていないか、取得範囲に含まれていません。');
  const traffic=createTraffic(THREE,{roads:mapFeatures.roads,colliders,terrainHeight:(x,z)=>terrainHeight(x,z)+.06,bounds,quality:'high',leftHandTraffic:latitude>=24&&latitude<=46&&longitude>=122&&longitude<=146});
  group.add(traffic.group);interactables.push(...traffic.interactables);
  const vegetation=createVegetationDetail(THREE,{trees:treeRecords,heightAt:terrainHeight,quality:'high'});group.add(vegetation.group);
  notes.push(traffic.sourceInfo.note);
  let observer={x:spawn.x,z:spawn.z},disposed=false;
  const sourceInfo={
    source:'OpenStreetMap',attribution:'© OpenStreetMap contributors',licenseUrl:'https://www.openstreetmap.org/copyright',endpoint:ENDPOINT,
    dataTimestamp:data.osm3s?.timestamp_osm_base||null,coverageMeters:radius,radius,buildingCount:buildings.length,roadCount:mapFeatures.roads.length,areaCount,
    mappedHeightCount,inferredHeightCount,terrain:terrain?'elevation':'flat',terrainSource,spawnOffsetMeters:offset,origin:{x:0,z:0},
    traffic:traffic.sourceInfo,rendering:'PBR surfaces, smooth canopies and nearby leaf geometry',facades:'procedural',roadMarkings:'procedural decoration, not observed road markings',interiors:'game templates',vegetation:'mapped trees and procedural planting within mapped green areas',note:notes.join(' '),cached:false
  };
  function dispose(){if(disposed)return;disposed=true;traffic.dispose();vegetation.dispose();library.dispose();group.removeFromParent();group.clear();for(const geo of resources.geometries)geo.dispose();for(const mat of resources.materials)mat.dispose();for(const t of resources.textures)t.dispose();}
  function update(dt,hour=12,focus){if(disposed)return;if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.z))observer=focus;windowMat.emissiveIntensity=hour<6||hour>=18?.34:.08;traffic.update(dt,hour,observer);vegetation.update(observer);}
  function setQuality(tier){library.setQuality(tier);for(const child of group.children)if(child.isMesh)library.updateGeometry(child);traffic.setQuality(tier);vegetation.setQuality(tier);}
  update(0,12,observer);
  return {group,colliders,interactables,buildings,bounds,spawn,update,radius,label:'現在地の街',geo:{latitude,longitude},toGeo,terrainHeight,sourceInfo,dispose,setQuality,trafficStats:traffic.getStats,trafficSnapshot:traffic.snapshot,real:true,mapFeatures,originMarker:{x:0,z:0,spawnOffsetMeters:offset}};
}

function validateOptions({latitude,longitude,radius=250,terrain}={}){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -85||latitude > 85||longitude < -180||longitude > 180)throw new Error('有効な緯度・経度を指定してください。極域はこの表示に対応していません。');
  return {latitude,longitude,radius:Math.round(Math.max(100,Math.min(450,Number.isFinite(radius)?radius:250))),terrain};
}
function readCache(key){
  try{const rows=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');return rows.find(r=>r.key===key&&Date.now()-r.savedAt<CACHE_AGE&&Array.isArray(r.data?.elements))||null;}catch{return null;}
}
function writeCache(key,data,source={}){
  try{
    let rows=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]').filter(r=>r.key!==key&&Date.now()-r.savedAt<CACHE_AGE);
    rows.unshift({key,savedAt:Date.now(),data,...source});rows=rows.slice(0,4);
    while(rows.length){try{localStorage.setItem(CACHE_KEY,JSON.stringify(rows));break;}catch{rows.pop();}}
  }catch{/* A blocked or full local store does not prevent the requested game session. */}
}
function normalizeLon(lon){return ((lon+180)%360+360)%360-180;}
function wrappedLon(delta){return normalizeLon(delta);}
function numberTag(value){
  if(value==null)return 0;const match=String(value).replace(',','.').match(/-?\d+(?:\.\d+)?/);if(!match)return 0;
  const n=Number(match[0]);return /\bft\b|feet|foot|'/.test(String(value))?n*.3048:n;
}
function hashId(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function cleanPoints(points){const out=[];for(const p of points)if(Number.isFinite(p.x)&&Number.isFinite(p.z)&&(!out.length||Math.hypot(p.x-out.at(-1).x,p.z-out.at(-1).z)>.02))out.push(p);if(out.length>2&&Math.hypot(out[0].x-out.at(-1).x,out[0].z-out.at(-1).z)<.1)out.pop();return out;}
function isClosedWay(way){return Boolean(way.nodes?.length>2&&way.nodes[0]===way.nodes.at(-1)||way.geometry?.length>2&&Math.abs(way.geometry[0].lat-way.geometry.at(-1).lat)<1e-8&&Math.abs(way.geometry[0].lon-way.geometry.at(-1).lon)<1e-8);}
function polygonBounds(points){let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}return {minX,maxX,minZ,maxZ};}
function polygonArea(points){let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.z-b.x*a.z;}return area/2;}
function polygonCentroid(points){let x=0,z=0,cross=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],c=a.x*b.z-b.x*a.z;x+=(a.x+b.x)*c;z+=(a.z+b.z)*c;cross+=c;}return Math.abs(cross)>1e-5?{x:x/(3*cross),z:z/(3*cross)}:{x:points.reduce((s,p)=>s+p.x,0)/points.length,z:points.reduce((s,p)=>s+p.z,0)/points.length};}
function pointInPolygon(p,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
function closestOnSegment(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz,t=len2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len2)):0;return {x:a.x+dx*t,z:a.z+dz*t};}
function distanceToSegment(p,a,b){const q=closestOnSegment(p,a,b);return Math.hypot(p.x-q.x,p.z-q.z);}
function pointBlocked(p,collider,margin=.35){
  if(p.x<collider.minX-margin||p.x>collider.maxX+margin||p.z<collider.minZ-margin||p.z>collider.maxZ+margin)return false;
  const polygon=collider.polygon;if(!polygon)return true;
  if(collider.holes?.some(h=>pointInPolygon(p,h)&&h.every((a,i)=>distanceToSegment(p,a,h[(i+1)%h.length])>margin)))return false;
  if(pointInPolygon(p,polygon))return true;
  return polygon.some((a,i)=>distanceToSegment(p,a,polygon[(i+1)%polygon.length])<margin);
}
function nearestRoadDistance(p,roads){let min=Infinity;for(const road of roads)for(let i=1;i<road.points.length;i++)min=Math.min(min,distanceToSegment(p,road.points[i-1],road.points[i])-road.width/2);return min;}
function roadWidth(tags){
  const width=numberTag(tags.width);if(width>0)return Math.max(.8,Math.min(55,width));
  const defaults={motorway:15,trunk:13,primary:10,secondary:8.5,tertiary:7,residential:5.4,unclassified:5,service:3.6,living_street:4.5,pedestrian:6,footway:2,path:1.4,cycleway:2.2,steps:1.8,track:3};
  const lanes=numberTag(tags.lanes);return lanes>0?Math.min(38,lanes*3.1+.6):defaults[tags.highway]||4;
}
function classifyBuilding(t){
  if(t.shop==='books'||t.amenity==='library')return 'bookstore';
  if(['cafe','restaurant','fast_food','bar','pub','food_court','ice_cream'].includes(t.amenity))return 'cafe';
  if(['museum','gallery','artwork'].includes(t.tourism)||['arts_centre','theatre','cinema','community_centre'].includes(t.amenity))return 'gallery';
  if(t.shop||['marketplace','pharmacy'].includes(t.amenity)||['retail','supermarket'].includes(t.building))return 'market';
  if(t.office||['office','commercial','industrial','warehouse','civic','public','school','university','hospital','train_station'].includes(t.building)||t.amenity)return 'office';
  return 'home';
}
function findEntrance(record,nodes,roads,colliders,bounds){
  const polygon=record.polygon,orientation=Math.sign(polygonArea(polygon))||1,candidates=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<1.1)continue;
    const normal={x:dz/len*orientation,z:-dx/len*orientation},mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
    candidates.push({edge:mid,normal,score:nearestRoadDistance(mid,roads)+Math.hypot(mid.x,mid.z)*.001,mapped:false});
    for(const node of nodes){if(distanceToSegment(node.point,a,b)>1.8)continue;const edge=closestOnSegment(node.point,a,b);candidates.push({edge,normal,score:-1000+Math.hypot(edge.x,edge.z)*.001,mapped:true});}
  }
  candidates.sort((a,b)=>a.score-b.score);
  for(const c of candidates)for(const offset of [1.35,1.95,2.8]){
    const p={x:c.edge.x+c.normal.x*offset,z:c.edge.z+c.normal.z*offset};
    if(p.x<bounds.minX+1||p.x>bounds.maxX-1||p.z<bounds.minZ+1||p.z>bounds.maxZ-1)continue;
    if(colliders.some(col=>pointBlocked(p,col,.4)))continue;
    return {...p,yaw:Math.atan2(c.normal.x,c.normal.z),edge:c.edge,normal:c.normal,mapped:c.mapped};
  }
  return null;
}
function joinRings(lines){
  const remaining=lines.map(cleanPoints).filter(l=>l.length>1),rings=[];
  const near=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<.5;
  while(remaining.length){
    let ring=remaining.shift(),changed=true;
    while(changed&&remaining.length){changed=false;for(let i=0;i<remaining.length;i++){
      let line=remaining[i];
      if(near(ring.at(-1),line[0]))ring.push(...line.slice(1));
      else if(near(ring.at(-1),line.at(-1)))ring.push(...line.slice(0,-1).reverse());
      else if(near(ring[0],line.at(-1)))ring.unshift(...line.slice(0,-1));
      else if(near(ring[0],line[0]))ring.unshift(...line.slice(1).reverse());
      else continue;
      remaining.splice(i,1);changed=true;break;
    }}
    ring=cleanPoints(ring);if(ring.length>=3)rings.push(ring);
  }
  return rings;
}

function clipPolyline(points,bounds){
  const fragments=[];let current=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z;let low=0,high=1,visible=true;
    for(const [p,q] of [[-dx,a.x-bounds.minX],[dx,bounds.maxX-a.x],[-dz,a.z-bounds.minZ],[dz,bounds.maxZ-a.z]]){
      if(Math.abs(p)<1e-12){if(q<0){visible=false;break;}continue;}
      const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high){visible=false;break;}
    }
    if(!visible){if(current.length>1)fragments.push(current);current=[];continue;}
    const start={x:a.x+dx*low,z:a.z+dz*low},end={x:a.x+dx*high,z:a.z+dz*high};
    if(current.length&&Math.hypot(current.at(-1).x-start.x,current.at(-1).z-start.z)>.05){fragments.push(current);current=[];}
    if(!current.length)current.push(start);current.push(end);
  }
  if(current.length>1)fragments.push(current);return fragments;
}
function clipPolygon(points,bounds){
  let result=points;
  for(const [axis,value,keepGreater] of [['x',bounds.minX,true],['x',bounds.maxX,false],['z',bounds.minZ,true],['z',bounds.maxZ,false]]){
    if(result.length<3)return [];const output=[];
    for(let i=0;i<result.length;i++){
      const a=result[i],b=result[(i+1)%result.length],insideA=keepGreater?a[axis]>=value:a[axis]<=value,insideB=keepGreater?b[axis]>=value:b[axis]<=value;
      if(insideA)output.push(a);
      if(insideA!==insideB){const t=(value-a[axis])/(b[axis]-a[axis]);output.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
    }
    result=output;
  }
  return cleanPoints(result);
}
