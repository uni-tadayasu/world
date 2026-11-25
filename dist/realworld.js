import {getOnlineOrigin} from './site-config.js';
import {createMaterialLibrary,createVegetationDetail,surfaceMeters} from './materials.js';
import {createTraffic} from './traffic.js';
import {createWalkSurfaceIndex} from './walk-surfaces.js';
import {createObjectCollisionIndex,createBoxCollider,createCylinderCollider} from './object-collisions.js';
import {createPolygonCoverage,joinedStripPolygons,drapedSurfaceGeometry,verticalSkirtGeometry,facadePanelGeometry} from './world-geometry.js';
/* Real street geometry from OpenStreetMap. Facades and interiors remain game representations. */
const ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const CACHE_KEY = 'machi-realworld-osm-v2';
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
    const canonical=getOnlineOrigin();
    const origin=typeof location!=='undefined'?location.origin:'';
    const proxyOrigin=origin===canonical?origin:canonical;
    const params=new URLSearchParams({lat:options.latitude.toFixed(7),lon:options.longitude.toFixed(7),radius:String(options.radius),v:'2'});
    const proxyUrl=`${proxyOrigin}/api/world?${params}`;
    const lat=options.latitude.toFixed(7),lon=options.longitude.toFixed(7),r=options.radius,around=`(around:${r},${lat},${lon})`;
    const query=`[out:json][timeout:8][maxsize:33554432];(`+
      `way${around}["building"];way${around}["building:part"];way${around}["highway"];way${around}["leisure"];way${around}["landuse"];`+
      `way${around}["natural"~"^(water|wood|scrub|wetland|beach)$"];way${around}["waterway"];`+
      `relation${around}["type"="multipolygon"]["natural"="water"];`+
      `node${around}["shop"];node${around}["amenity"];node${around}["entrance"];node${around}["natural"="tree"];node${around}["highway"="street_lamp"];);out geom;`;
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
  const colliders=[], interactables=[], buildings=[], audioSources=[],mapFeatures={roads:[],areas:[],streetObjects:[],origin:{x:0,z:0}};
  const resources={geometries:new Set(),materials:new Set(),textures:new Set()};
  const bounds={minX:-radius,maxX:radius,minZ:-radius,maxZ:radius};
  const walkSurfaces=createWalkSurfaceIndex({bounds}),sampleGround=walkSurfaces.sampleGround;
  const cosLat=Math.max(.015,Math.cos(latitude*Math.PI/180));
  const toLocal=(lat,lon)=>({x:wrappedLon(lon-longitude)*Math.PI/180*EARTH_RADIUS*cosLat,z:-(lat-latitude)*Math.PI/180*EARTH_RADIUS});
  const toGeo=(x,z)=>({latitude:latitude-z/EARTH_RADIUS*180/Math.PI,longitude:normalizeLon(longitude+x/(EARTH_RADIUS*cosLat)*180/Math.PI)});
  const rawHeight=typeof terrain==='function'?terrain:typeof terrain?.heightAt==='function'?terrain.heightAt.bind(terrain):()=>0;
  const terrainHeight=(x,z)=>{const n=rawHeight(x,z);return Number.isFinite(n)?n:0;};
  const material=(color,extra={},kind='stone')=>library.material(kind,color,{roughness:.83,...extra});
  const wallPalette=['#d9d2c2','#c9c7bb','#b9b6a8','#dedbcf','#d7c5ad','#c0b5a6','#c6c9c2','#d2cdc0'].map(c=>material(c,{},'plaster'));
  const roofPalette=['#626762','#73716a','#88877d','#5e6967'].map(c=>material(c,{},'concrete'));
  const asphalt=material('#484c4b',{},'asphalt'), sidewalk=material('#bdbbb1',{},'paving'), pathMat=material('#b4ad96',{},'stone'), waterMat=material('#527d84',{metalness:.18,roughness:.21},'water');
  const windowMat=material('#425765',{roughness:.16,metalness:.3,emissive:'#8b693f',emissiveIntensity:.04},'glass');
  const darkWindowMat=material('#26353d',{roughness:.2,metalness:.28},'glass'),windowReveal=material('#434b4b',{},'concrete'),foundationMat=material('#8e9089',{},'concrete'),curbMat=material('#c4c3b9',{},'concrete');
  const lampGlow=material('#ede0b4',{emissive:'#ffcf80',emissiveIntensity:.05,roughness:.3},'glass');
  const railMat=material('#4d5f59',{metalness:.3,roughness:.6},'metal'),frameMat=material('#78817b',{metalness:.3,roughness:.5},'metal'),sillMat=material('#c8c7bc'),roadPaint=material('#e0ded0',{roughness:.97});
  const leafMat=material('#6f8751',{},'foliage'), trunkMat=material('#675747',{},'bark'),benchWood=material('#8c7154',{},'wood');
  const taggedMaterials=new Map();
  const materialKinds={brick:['brick','#ad7c66'],wood:['wood','#967753'],timber:['wood','#967753'],concrete:['concrete','#bdbdb5'],cement:['concrete','#bdbdb5'],stone:['stone','#aaa79d'],sandstone:['stone','#c8b796'],limestone:['stone','#c9c5b5'],plaster:['plaster','#d7d2c8'],glass:['glass','#87a1a7'],metal:['metal','#8b9598'],steel:['metal','#90989a'],aluminium:['metal','#a6aeb0'],zinc:['metal','#8c9998'],copper:['metal','#9b9276'],roof_tiles:['tile','#9f6850'],tile:['tile','#9f6850'],slate:['tile','#59656c'],tar_paper:['asphalt','#474e4d'],asphalt:['asphalt','#59615f'],thatch:['grass','#b6a071']};
  function mappedMaterial(tags,prefix,fallback){
    const rawColor=String(tags[`${prefix}:colour`]||tags[`${prefix}:color`]||'').trim().toLowerCase(),colorName=rawColor.replace(/[_\s]/g,'');
    const color=/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(rawColor)?rawColor:Object.hasOwn(THREE.Color.NAMES,colorName)?colorName:null;
    const materialTag=String(tags[`${prefix}:material`]||'').toLowerCase(),spec=materialKinds[materialTag];
    if(!color&&!spec)return {material:fallback,color:null,materialTag:null};
    const kind=spec?.[0]||'stone',tint=color||spec[1],key=`${kind}:${tint}`;
    if(!taggedMaterials.has(key))taggedMaterials.set(key,material(tint,{},kind));
    return {material:taggedMaterials.get(key),color,materialTag:spec?materialTag:null};
  }
  function roadMaterial(tags,fallback){
    const surfaces={paving_stones:['paving','#b5b1a0'],concrete:['concrete','#bfc0b6'],'concrete:plates':['concrete','#b8b9b0'],cobblestone:['stone','#9e9b8d'],sett:['paving','#a4a294'],gravel:['stone','#9e9986'],fine_gravel:['stone','#b0a88d'],compacted:['stone','#aaa187'],dirt:['stone','#978165'],earth:['stone','#978165'],sand:['stone','#c3b492'],grass:['grass','#82976a'],wood:['wood','#957a57'],asphalt:['asphalt','#484c4b']};
    const spec=surfaces[tags.surface];if(!spec)return fallback;
    const key=`road:${tags.surface}`;if(!taggedMaterials.has(key))taggedMaterials.set(key,material(spec[1],{},spec[0]));return taggedMaterials.get(key);
  }
  const batches=new Map(), instances=new Map();
  function addGeometry(geometry,materials){
    const geo=geometry.index?geometry.toNonIndexed():geometry;
    const pos=geo.attributes.position,norm=geo.attributes.normal,uv=geo.attributes.uv;
    const groups=geo.groups.length?geo.groups:[{start:0,count:pos.count,materialIndex:0}];
    for(const section of groups){
      const mat=Array.isArray(materials)?materials[section.materialIndex||0]:materials;
      let bucket=batches.get(mat.uuid);if(!bucket){bucket={mat,p:[],n:[],uv:[]};batches.set(mat.uuid,bucket);}
      const end=Math.min(pos.count,section.start+section.count),meters=surfaceMeters(mat);
      for(let i=section.start;i<end;i++){
        const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),nx=norm?.getX(i)||0,ny=norm?norm.getY(i):1,nz=norm?.getZ(i)||0;
        bucket.p.push(x,y,z);bucket.n.push(nx,ny,nz);
        // One metre has the same texel scale on roads, land and every facade.
        const horizontal=Math.abs(ny)>.55,tangentLength=Math.hypot(nx,nz)||1;
        bucket.uv.push((horizontal?x:(x*nz-z*nx)/tangentLength)/meters.x,(horizontal?z:y)/meters.y);
      }
    }
    if(geo!==geometry)geo.dispose();geometry.dispose();
  }
  const unitBox=new THREE.BoxGeometry(1,1,1),unitCylinder=library.cylinder();
  resources.geometries.add(unitBox);
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
  function roofProfile(points,tags,totalHeight,minHeight){
    const shape=tags['roof:shape'],statedHeight=numberTag(tags['roof:height']);
    // A mapped roof shape without a usable rise remains flat; missing dimensions
    // are never promoted to surveyed geometry. All heights include the roof.
    if(!['gabled','skillion','pyramidal'].includes(shape)||!(statedHeight>0&&statedHeight<totalHeight-minHeight-1))return null;
    if(shape==='pyramidal'){
      let turn=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length],cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x);if(Math.abs(cross)<1e-5)continue;if(turn&&Math.sign(cross)!==turn)return null;turn=Math.sign(cross);}
      return {shape,height:statedHeight,center:polygonCentroid(points)};
    }
    let longest=0,axis={x:1,z:0};for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b.x-a.x,b.z-a.z);if(length>longest){longest=length;axis={x:(b.x-a.x)/length,z:(b.z-a.z)/length};}}
    let across=tags['roof:orientation']==='across'?axis:{x:-axis.z,z:axis.x};
    const compass={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315},direction=String(tags['roof:direction']??'').trim().toUpperCase();
    const angle=Object.hasOwn(compass,direction)?compass[direction]:direction!==''&&/^\d+(\.\d+)?$/.test(direction)?Number(direction):null;
    if(angle!==null&&angle<=360)across={x:Math.sin(angle*Math.PI/180),z:-Math.cos(angle*Math.PI/180)};
    const project=p=>p.x*across.x+p.z*across.z,values=points.map(project),low=Math.min(...values),high=Math.max(...values),mid=(low+high)/2;
    if(high-low<.1)return null;
    const at=p=>statedHeight*Math.max(0,Math.min(1,shape==='skillion'?(high-project(p))/(high-low):1-Math.abs(project(p)-mid)/((high-low)/2)));
    const sections=shape==='gabled'?[clipAtRoofRidge(points,project,mid,1),clipAtRoofRidge(points,project,mid,-1)]:[points];
    return {shape,height:statedHeight,at,project,mid,sections};
  }
  function clipAtRoofRidge(points,project,mid,sign){
    const out=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],da=(project(a)-mid)*sign,db=(project(b)-mid)*sign;if(da>=-1e-8)out.push(a);if((da>1e-8&&db<-1e-8)||(da<-1e-8&&db>1e-8)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}return out;
  }
  function addMappedRoof(points,profile,base,roof,wall){
    if(profile.shape==='pyramidal'){
      const p=[],uv=[],center=profile.center;for(let i=0;i<points.length;i++){let a=points[i],b=points[(i+1)%points.length];if((b.x-a.x)*(center.z-a.z)-(b.z-a.z)*(center.x-a.x)>0)[a,b]=[b,a];p.push(a.x,base,a.z,b.x,base,b.z,center.x,base+profile.height,center.z);uv.push(a.x/3,a.z/3,b.x/3,b.z/3,center.x/3,center.z/3);}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();addGeometry(geo,roof);return;
    }
    for(const section of profile.sections){if(section.length<3)continue;const geo=new THREE.ShapeGeometry(polygonShape(section));geo.rotateX(-Math.PI/2);const attr=geo.attributes.position;for(let i=0;i<attr.count;i++)attr.setY(i,base+profile.at({x:attr.getX(i),z:attr.getZ(i)}));geo.computeVertexNormals();addGeometry(geo,roof);}
    const p=[],uv=[],orientation=Math.sign(polygonArea(points))||1;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],edge=[a];
      if(profile.shape==='gabled'){const da=profile.project(a)-profile.mid,db=profile.project(b)-profile.mid;if(da*db<-1e-8){const t=da/(da-db);edge.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}edge.push(b);
      for(let j=1;j<edge.length;j++){let c=edge[j-1],d=edge[j];if(orientation<0)[c,d]=[d,c];const ch=profile.at(c),dh=profile.at(d);if(ch+dh<1e-8)continue;const verts=[[c,0],[c,ch],[d,0],[d,0],[c,ch],[d,dh]];for(const [v,h] of verts){p.push(v.x,base+h,v.z);uv.push(Math.hypot(v.x-c.x,v.z-c.z)/3,h/3);}}
    }
    if(p.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();addGeometry(geo,wall);}
  }
  function areaMesh(points,holes,mat,offset=.02,surface=null){
    if(points.length<3)return;
    const source=new THREE.ShapeGeometry(polygonShape(points,holes));source.rotateX(-Math.PI/2);
    const triangles=[],position=source.attributes.position,index=source.index;
    for(let i=0;i<(index?.count||position.count);i+=3){const face=[];for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;face.push({x:position.getX(k),z:position.getZ(k)});}triangles.push(face);}
    source.dispose();surfacePolygons(triangles,mat,offset,surface,12);
  }
  function surfacePolygons(polygons,mat,offset,surface=null,maxEdge=6){
    if(!polygons.length)return;
    const geometry=drapedSurfaceGeometry(THREE,polygons,terrainHeight,{offset,maxEdge});
    if(surface)walkSurfaces.addGeometry(geometry,surface);addGeometry(geometry,mat);
  }
  function ribbon(points,width,mat,offset=.045,surface=null){
    const occupied=createPolygonCoverage(),polygons=[];
    for(const p of joinedStripPolygons(points,-width/2,width/2)){polygons.push(...occupied.subtract(p));occupied.add(p);}
    surfacePolygons(polygons,mat,offset,surface);occupied.clear();
  }
  function stairRibbon(points,width,id){
    // OSM locates the stairway; only available elevation can establish its rise.
    // Individual tread heights/counts remain a rendering estimate, not a survey.
    if(!terrain){ribbon(points,width,pathMat,.049,{kind:'path',id});return 0;}
    let treadCount=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),rise=terrainHeight(b.x,b.z)-terrainHeight(a.x,a.z);
      if(length<.05)continue;
      if(Math.abs(rise)<.08){ribbon([a,b],width,pathMat,.049,{kind:'path',id});continue;}
      const count=Math.min(400,Math.max(1,Math.ceil(Math.abs(rise)/.16))),nx=-dz/length*width/2,nz=dx/length*width/2,p=[],uv=[];
      const vertex=(v,y)=>{p.push(v.x,y,v.z);uv.push(v.x/2,v.z/2);};
      let previousHeight=null;
      for(let j=0;j<count;j++){
        const aa={x:a.x+dx*j/count,z:a.z+dz*j/count},bb={x:a.x+dx*(j+1)/count,z:a.z+dz*(j+1)/count};
        const corners=[{x:aa.x+nx,z:aa.z+nz},{x:aa.x-nx,z:aa.z-nz},{x:bb.x+nx,z:bb.z+nz},{x:bb.x-nx,z:bb.z-nz}];
        const height=Math.max(...corners.map(c=>terrainHeight(c.x,c.z)))+.049;
        for(const k of [0,2,1,1,2,3])vertex(corners[k],height);
        // Vertical risers are visible, but cannot be returned as walking support.
        const low=previousHeight??Math.min(...corners.slice(0,2).map(c=>terrainHeight(c.x,c.z)));
        vertex(corners[0],height);vertex(corners[1],height);vertex(corners[0],low);vertex(corners[0],low);vertex(corners[1],height);vertex(corners[1],low);
        previousHeight=height;treadCount++;
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();walkSurfaces.addGeometry(geo,{kind:'steps',id});addGeometry(geo,pathMat);
    }
    return treadCount;
  }
  // Elevations are relative to the starting location; no added absolute elevation offset.
  const groundGeo=new THREE.PlaneGeometry(radius*2,radius*2,96,96);groundGeo.rotateX(-Math.PI/2);
  const groundPos=groundGeo.attributes.position;
  for(let i=0;i<groundPos.count;i++)groundPos.setY(i,terrainHeight(groundPos.getX(i),groundPos.getZ(i))-.015);
  groundGeo.computeVertexNormals();resources.geometries.add(groundGeo);
  walkSurfaces.addGeometry(groundGeo,{kind:'terrain',id:'elevation-mesh'});
  const groundMaterial=material('#a19f8e',{},'grass'),groundMeters=surfaceMeters(groundMaterial),groundUV=groundGeo.attributes.uv;
  for(let i=0;i<groundPos.count;i++)groundUV.setXY(i,groundPos.getX(i)/groundMeters.x,groundPos.getZ(i)/groundMeters.y);
  const ground=new THREE.Mesh(groundGeo,groundMaterial);ground.receiveShadow=true;group.add(ground);
  const nodes=data.elements.filter(e=>e.type==='node'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)).map(e=>({...e,point:toLocal(e.lat,e.lon)}));
  const ways=data.elements.filter(e=>e.type==='way'&&Array.isArray(e.geometry)&&e.geometry.length>1).map(e=>({...e,points:cleanPoints(e.geometry.map(p=>toLocal(p.lat,p.lon))),linePoints:e.geometry.map(p=>toLocal(p.lat,p.lon))}));
  const insideCoverage=p=>Math.abs(p.x)<=radius+80&&Math.abs(p.z)<=radius+80;
  let areaCount=0, inferredHeightCount=0, mappedHeightCount=0, windowCount=0, detailedWindowCount=0, sceneryTrees=0,stairwayCount=0,renderedTreadCount=0,mappedAppearanceCount=0,mappedRoofCount=0,mappedRoadSurfaceCount=0,sidewalkCount=0,foundationCount=0;
  const greenAreas=[], waterAreas=[];
  const areaMats=new Map();
  function drawArea(points,holes,tags,id){
    points=clipPolygon(points,bounds);holes=holes.map(h=>clipPolygon(h,bounds)).filter(h=>h.length>=3);
    if(points.length<3)return;
    const isWater=tags.natural==='water'||['riverbank','dock'].includes(tags.waterway)||['reservoir','basin'].includes(tags.landuse);
    const isGreen=tags.leisure==='park'||tags.leisure==='garden'||['wood','scrub','wetland'].includes(tags.natural)||['forest','grass','meadow','recreation_ground','village_green','allotments','orchard'].includes(tags.landuse);
    const color=isWater?'#527d84':isGreen?(tags.natural==='wood'||tags.landuse==='forest'?'#62754a':tags.landuse==='meadow'?'#879562':'#829366'):tags.natural==='beach'?'#c6bda1':['farmland','farmyard'].includes(tags.landuse)?'#aaa581':['industrial','commercial','retail'].includes(tags.landuse)?'#a8aaa4':['pitch','playground','sports_centre'].includes(tags.leisure)?'#789c83':'#b8b8a6';
    const kind=isGreen?'grass':['industrial','commercial','retail','residential'].includes(tags.landuse)?'concrete':'stone',key=color+kind;
    let mat=areaMats.get(key);if(!mat){mat=isWater?waterMat:material(color,{},kind);areaMats.set(key,mat);}
    areaMesh(points,holes,mat,isWater?.035:.018,isWater?null:{kind:isGreen?'grass':'area',id});
    mapFeatures.areas.push({id,points,holes,color,water:isWater,landuse:tags.landuse||tags.leisure||tags.natural||null});areaCount++;
    if(isGreen)greenAreas.push({points,holes,id,tags});
    if(isWater){waterAreas.push({points,holes});const box=polygonBounds(points);colliders.push({...box,id,polygon:points,holes,type:'water',minY:-Infinity,maxY:Math.max(...points.map(p=>terrainHeight(p.x,p.z)))+.037,support:false,vertical:false});const center=polygonCentroid(points);audioSources.push({id,kind:'water',x:center.x,y:terrainHeight(center.x,center.z)+.04,z:center.z,radius:Math.min(80,Math.max(20,Math.sqrt(Math.abs(polygonArea(points))))),gain:.3,seed:hashId(id)});}
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
  // Join complete mapped centre lines first, then remove covered junction faces.
  // The spatial indices avoid a full roads × roads scan in dense city centres.
  const roadRecords=[],networkCoverage=createPolygonCoverage(),roadCoverage=createPolygonCoverage(),sidewalkCoverage=createPolygonCoverage(),buildingCoverage=createPolygonCoverage();
  for(const way of ways){
    const t=way.tags||{};
    if((t.building&&t.building!=='no'||t['building:part']&&t['building:part']!=='no')&&isClosedWay(way)&&way.points.length>=3){
      const points=way.points,triangles=THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(p.x,p.z)),[]);
      for(const face of triangles)buildingCoverage.add(face.map(i=>points[i]),{id:way.id});
    }
    if(t.highway&&!['construction','proposed'].includes(t.highway)&&t.tunnel!=='yes'&&t.location!=='underground'){
      const roadType=t.highway,width=roadWidth(t),pedestrian=['footway','path','pedestrian','cycleway','steps','bridleway'].includes(roadType);
      const fragments=clipPolyline(way.linePoints,bounds);
      for(let part=0;part<fragments.length;part++){
        const points=fragments[part],id=`osm-way-${way.id}-${part}`,polygons=joinedStripPolygons(points,-width/2,width/2);
        const road={id,name:t.name||'',points,width,type:roadType,inferredWidth:!t.width,oneWay:t.oneway||'no',foot:t.foot||'',footway:t.footway||'',bridge:t.bridge==='yes',layer:numberTag(t.layer),sidewalk:t.sidewalk||'',surface:t.surface||null};
        mapFeatures.roads.push(road);roadRecords.push({road,t,points,id,width,pedestrian,polygons});
        for(const polygon of polygons)networkCoverage.add(polygon,{id,pedestrian});
      }
    }else if(['river','stream','canal','drain','ditch'].includes(t.waterway)){
      const width=Math.max(.6,Math.min(numberTag(t.width)||({river:12,canal:8,stream:2.4,drain:1.5,ditch:1}[t.waterway]),80));
      const fragments=clipPolyline(way.linePoints,bounds);
      for(let part=0;part<fragments.length;part++){
        const points=fragments[part],id=`osm-way-${way.id}-${part}`;ribbon(points,width,waterMat,.037);
        mapFeatures.areas.push({id,points,color:'#527d84',line:true,width,water:true});
        let soundIndex=0;
        for(let i=1;i<points.length&&soundIndex<32;i++){const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(length/35));for(let j=0;j<count&&soundIndex<32;j++){const ratio=(j+.5)/count,x=a.x+(b.x-a.x)*ratio,z=a.z+(b.z-a.z)*ratio;audioSources.push({id:`${id}-water-${soundIndex++}`,kind:'water',x,y:terrainHeight(x,z)+.04,z,radius:28,gain:.26,seed:hashId(way.id)});}}
      }
    }
  }
  const roadPriority={motorway:0,trunk:1,primary:2,secondary:3,tertiary:4,residential:5,unclassified:6,living_street:7,service:8};
  const orderedRoads=[...roadRecords].sort((a,b)=>(a.pedestrian?20:roadPriority[a.road.type]??9)-(b.pedestrian?20:roadPriority[b.road.type]??9)||b.width-a.width||a.id.localeCompare(b.id));
  for(const {road,t,points,id,width,pedestrian,polygons} of orderedRoads){
    const visible=[];for(const polygon of polygons){visible.push(...roadCoverage.subtract(polygon));roadCoverage.add(polygon,{id});}
    if(road.type==='steps'){const count=stairRibbon(points,width,id);stairwayCount++;renderedTreadCount+=count;road.stairElevation=count?'terrain-estimate':'unavailable';}
    else{const mappedSidewalk=pedestrian&&t.footway==='sidewalk',fallback=mappedSidewalk?sidewalk:pedestrian?pathMat:asphalt,finish=roadMaterial(t,fallback);if(finish!==fallback)mappedRoadSurfaceCount++;surfacePolygons(visible,finish,mappedSidewalk?.18:pedestrian?.049:.059,{kind:mappedSidewalk?'sidewalk':pedestrian?'path':'road',id});}
  }
  for(const {road,t,points,id,width,pedestrian} of roadRecords){
    const omitSidewalk=pedestrian||['no','none','separate'].includes(t.sidewalk)||['motorway','trunk','motorway_link','trunk_link'].includes(road.type)||(road.type==='service'&&!t.sidewalk)||t.foot==='no';
    if(!omitSidewalk)for(const side of [-1,1]){
      // Positive offset is left of the direction of the mapped way.
      const sideName=side>0?'left':'right',other=side>0?'right':'left';
      if(t.sidewalk===other||['no','separate'].includes(t[`sidewalk:${sideName}`]))continue;
      const declared=numberTag(t[`sidewalk:${sideName}:width`])||numberTag(t['sidewalk:both:width']),pavementWidth=Math.max(.6,Math.min(4,declared||1.5));
      const inner=side*width/2,outer=side*(width/2+pavementWidth),walk=[],curbs=[];
      for(const polygon of joinedStripPolygons(points,inner,outer))for(const roadFree of networkCoverage.subtract(polygon))for(const lotFree of buildingCoverage.subtract(roadFree)){
        walk.push(...sidewalkCoverage.subtract(lotFree));sidewalkCoverage.add(lotFree,{id});
      }
      if(!walk.length)continue;
      surfacePolygons(walk,sidewalk,.18,{kind:'sidewalk',id});sidewalkCount++;
      for(const polygon of joinedStripPolygons(points,inner,inner+side*.14))for(const roadFree of networkCoverage.subtract(polygon))curbs.push(...buildingCoverage.subtract(roadFree));
      // A real 12 cm rendered rise, with the same top triangles used by walking.
      surfacePolygons(curbs,curbMat,.182,{kind:'curb',id});
      addGeometry(verticalSkirtGeometry(THREE,curbs,(x,z)=>terrainHeight(x,z)+.182,(x,z)=>terrainHeight(x,z)+.047),curbMat);
      road.sidewalkWidth??={};road.sidewalkWidth[sideName]=pavementWidth;road.sidewalkHeight=.121;road.inferredSidewalk=!t.sidewalk||!declared;
    }
    // Decorative dashes stop before junctions and follow the actual slope.
    if(!pedestrian&&width>=6&&road.type!=='service')for(let j=1;j<points.length;j++){
      const a=points[j-1],b=points[j],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<8)continue;
      for(let d=3;d<len-3;d+=8){const x=a.x+dx*d/len,z=a.z+dz*d/len,dxm=dx/len*1.2,dzm=dz/len*1.2;
        if([-2,0,2].some(delta=>networkCoverage.contains({x:x+dx/len*delta,z:z+dz/len*delta},entry=>entry.id!==id)))continue;
        ribbon([{x:x-dxm,z:z-dzm},{x:x+dxm,z:z+dzm}],.095,roadPaint,.065);
      }
    }
  }
  networkCoverage.clear();roadCoverage.clear();sidewalkCoverage.clear();buildingCoverage.clear();
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
    const hash=hashId(way.id),wallAppearance=mappedMaterial(t,'building',wallPalette[hash%wallPalette.length]),roofAppearance=mappedMaterial(t,'roof',roofPalette[hash%roofPalette.length]),wall=wallAppearance.material,roof=roofAppearance.material;
    if(wallAppearance.color||wallAppearance.materialTag||roofAppearance.color||roofAppearance.materialTag)mappedAppearanceCount++;
    const profile=roofProfile(polygon,t,height,minHeight),wallHeight=height-minHeight-(profile?.height||0);
    const geometry=new THREE.ShapeGeometry(polygonShape(polygon));geometry.rotateX(-Math.PI/2);geometry.translate(0,baseY+wallHeight,0);addGeometry(geometry,roof);
    // The plinth reaches the local terrain along every footprint edge. Its floor
    // elevation is an estimate; min_height parts retain their mapped clearance.
    if(minHeight<.05){addGeometry(verticalSkirtGeometry(THREE,[polygon],()=>baseY,(x,z)=>terrainHeight(x,z)-.12),foundationMat);foundationCount++;}
    if(profile){addMappedRoof(polygon,profile,baseY+wallHeight,roof,wall);mappedRoofCount++;}
    const isPart=!t.building&&Boolean(t['building:part']);
    const poi=nodes.find(n=>(n.tags?.shop||n.tags?.amenity)&&pointInPolygon(n.point,polygon));
    const combined={...(poi?.tags||{}),...t};
    const type=classifyBuilding(combined);
    const actualName=t.name||poi?.tags?.name||t['addr:housename'];
    const name=actualName||({home:'住宅',cafe:'飲食店',market:'店舗',office:'建物',gallery:'文化施設',bookstore:'書店'}[type]);
    const record={id:`osm-way-${way.id}`,name,type,interiorId:type,x:center.x,z:center.z,w:box.maxX-box.minX,d:box.maxZ-box.minZ,mapColor:wall.color.getStyle(),polygon,height,heightSource,baseY,tags:combined,osmId:way.id,actualName:Boolean(actualName),entrance:null,appearance:{wallColour:wallAppearance.color,wallMaterial:wallAppearance.materialTag,roofColour:roofAppearance.color,roofMaterial:roofAppearance.materialTag,roofShape:profile?.shape||'flat',roofHeight:profile?.height||0,roofShapeSource:profile?'mapped':t['roof:shape']==='flat'?'mapped':'simplified',facade:'procedural recessed openings',foundation:minHeight<.05?'terrain skirt estimate':'mapped clearance'}};
    // A conservative solid volume keeps falling/jumping bodies outside the
    // building. Pitched roofs use their peak as support until exact roof
    // triangle contact is available; this is disclosed in source metadata.
    const collider={...box,id:record.id,polygon,type:'building',buildingId:record.id,minY:minHeight>.05?baseY:Math.min(baseY,...polygon.map(p=>terrainHeight(p.x,p.z)))-.12,maxY:baseY+height-minHeight,support:true,vertical:true};colliders.push(collider);
    if(!isPart){buildingRecords.push(record);audioSources.push({id:record.id,kind:'building-'+type,x:center.x,y:baseY+1.5,z:center.z,radius:Math.max(16,Math.min(45,Math.hypot(record.w,record.d)/2+8)),gain:.12,seed:hash});}
    const facadeOpenings=[];
    // Facade windows are deliberately generic; actual footprint and height tags remain intact.
    if(height>=4&&!['shed','garage','garages','warehouse','roof'].includes(t.building)){
      const floors=Math.min(18,Math.floor((wallHeight-1)/3.05)),orientation=Math.sign(polygonArea(polygon))||1;
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<3)continue;
        const columns=Math.min(25,Math.floor((len-1.1)/3)),nx=dz/len*orientation,nz=-dx/len*orientation,yaw=Math.atan2(dx,dz)-Math.PI/2;
        if(Math.hypot(center.x,center.z)<180){const x=(a.x+b.x)/2+nx*.025,z=(a.z+b.z)/2+nz*.025;instance(unitBox,sillMat,x,baseY+wallHeight-.12,z,len,.2,.14,yaw);instance(unitBox,roof,x,baseY+.18,z,len,.35,.1,yaw);}
        for(let col=0;col<columns&&windowCount<10000;col++)for(let floor=0;floor<floors&&windowCount<10000;floor++){
          const ratio=(col+1)/(columns+1),x=a.x+dx*ratio,z=a.z+dz*ratio,w=Math.min(1.4,len/(columns+1)*.56),v=1.8+floor*3.05,y=baseY+v;
          // Leave a ground-floor entrance bay and do not cut windows below a hillside.
          if(floor===0&&Math.abs(ratio-.5)*len<1.1||y-.675<terrainHeight(x,z)+.25)continue;
          (facadeOpenings[i]??=[]).push({u0:ratio*len-w/2,u1:ratio*len+w/2,y0:v-.675,y1:v+.675,depth:.16});
          const glass=(hash+col*17+floor*7+i*13)%5<2?windowMat:darkWindowMat;
          instance(unitBox,windowReveal,x-nx*.18,y,z-nz*.18,w+.06,1.4,.04,yaw);
          instance(unitBox,glass,x-nx*.135,y,z-nz*.135,w,1.35,.035,yaw);windowCount++;
          if(Math.hypot(x,z)<125&&detailedWindowCount<2400){const tx=dx/len,tz=dz/len,fx=x+nx*.025,fz=z+nz*.025;for(const side of [-1,1]){instance(unitBox,frameMat,fx+tx*side*(w/2+.025),y,fz+tz*side*(w/2+.025),.065,1.48,.12,yaw);instance(unitBox,frameMat,fx,y+side*.71,fz,w+.12,.065,.12,yaw);}instance(unitBox,frameMat,x-nx*.08,y,z-nz*.08,.04,1.35,.07,yaw);instance(unitBox,sillMat,x+nx*.075,y-.735,z+nz*.075,w+.25,.1,.32,yaw);detailedWindowCount++;}
        }
      }
    }
    const facade=facadePanelGeometry(THREE,polygon,baseY,wallHeight,facadeOpenings);addGeometry(facade.walls,wall);addGeometry(facade.reveals,windowReveal);
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
      const yaw=Math.atan2(entrance.normal.x,entrance.normal.z),y=sampleGround(doorX,doorZ)?.height??terrainHeight(doorX,doorZ),nx=entrance.normal.x,nz=entrance.normal.z,tx=nz,tz=-nx;
      instance(unitBox,railMat,doorX,y+1.2,doorZ,1.08,2.4,.12,yaw);
      instance(unitBox,windowMat,doorX+nx*.075,y+1.28,doorZ+nz*.075,.86,2.08,.04,yaw);
      instance(unitBox,frameMat,doorX+tx*.28+nx*.13,y+1.05,doorZ+tz*.28+nz*.13,.035,.36,.065,yaw);
      const thresholdX=doorX+nx*.2,thresholdZ=doorZ+nz*.2;
      instance(unitBox,sillMat,thresholdX,y+.05,thresholdZ,1.36,.1,.48,yaw);
      walkSurfaces.addRect({x:thresholdX,z:thresholdZ,width:1.36,depth:.48,height:y+.1,yaw},{kind:'threshold',id:'door-'+record.id});
      if(['cafe','market','bookstore'].includes(record.type)&&Math.hypot(doorX,doorZ)<180){instance(unitBox,railMat,doorX+nx*.38,y+2.52,doorZ+nz*.38,1.65,.09,.9,yaw);instance(unitBox,sillMat,doorX,y+2.56,doorZ,1.75,.12,.16,yaw);}
      audioSources.push({id:'door-'+record.id,kind:'door',x:doorX,y:y+1.2,z:doorZ,radius:4,gain:.3,ambient:false,seed:hashId(record.id)});
    }
  }
  // Mapped trees plus modest visual vegetation only inside mapped green areas.
  const clearPoint=(p,margin=.38)=>!colliders.some(c=>pointBlocked(p,c,margin));
  function tree(x,z,id,scale=1){
    const y=sampleGround(x,z)?.height??terrainHeight(x,z),seed=hashId(id),variant=seed%3,rotation=(seed%360)*Math.PI/180;
    treeRecords.push({x,z,y,scale,seed,variant,rotation,canopyY:4.6*scale});
    instance(library.treeBranches(variant),trunkMat,x,y,z,scale,scale,scale,rotation);
    instance(library.treeCanopy(variant),leafMat,x,y,z,scale,scale,scale,rotation);
    colliders.push(createCylinderCollider({id:'tree-'+id,type:'tree',x,z,radius:.2*scale,minY:y,maxY:y+4.85*scale,support:true,vertical:true}));
    audioSources.push({id:'tree-'+id,kind:'tree',x,y:y+3.7*scale,z,radius:16+scale*3,gain:.18,seed});
    sceneryTrees++;
  }
  for(const node of nodes.filter(n=>n.tags?.natural==='tree').slice(0,450))if(insideCoverage(node.point)&&clearPoint(node.point,.2)&&nearestRoadDistance(node.point,mapFeatures.roads)>.25){const height=numberTag(node.tags?.height);tree(node.point.x,node.point.z,'osm-'+node.id,height?Math.max(.45,Math.min(5,height/6)):.85+(hashId(node.id)%35)/100);}
  for(const area of greenAreas){
    // A mapped meadow or lawn is not evidence for trees. Only wooded/park land
    // gets disclosed procedural planting; roads, buildings and water stay clear.
    if(!['wood','scrub'].includes(area.tags.natural)&&!['forest','orchard'].includes(area.tags.landuse)&&!['park','garden'].includes(area.tags.leisure))continue;
    const box=polygonBounds(area.points),areaSize=Math.abs(polygonArea(area.points));
    let state=hashId(area.id)||1,planted=0;const count=Math.min(22,Math.floor(areaSize/240));
    for(let attempt=0;attempt<count*12&&planted<count&&sceneryTrees<650;attempt++){
      state=(state*1664525+1013904223)>>>0;const x=box.minX+(state/4294967296)*(box.maxX-box.minX);
      state=(state*1664525+1013904223)>>>0;const z=box.minZ+(state/4294967296)*(box.maxZ-box.minZ),p={x,z};
      if(!insideCoverage(p)||!pointInPolygon(p,area.points)||area.holes.some(h=>pointInPolygon(p,h))||!clearPoint(p,2))continue;
      if(nearestRoadDistance(p,mapFeatures.roads)<4)continue;
      tree(x,z,`${area.id}-plant-${attempt}`,.8+(state%40)/100);planted++;
    }
  }
  // Only objects explicitly present in the map become street furniture.
  for(const node of nodes){
    if(mapFeatures.streetObjects.length>=240)break;
    const t=node.tags||{},kind=t.highway==='street_lamp'?'streetlight':({bench:'bench',waste_basket:'bin',drinking_water:'fountain',bicycle_parking:'bicycle-parking'}[t.amenity]);
    if(!kind||!insideCoverage(node.point)||!clearPoint(node.point,.3)||nearestRoadDistance(node.point,mapFeatures.roads)<.25)continue;
    const {x,z}=node.point,y=sampleGround(x,z)?.height??terrainHeight(x,z),seed=hashId(node.id);
    let nearest=null,distance=Infinity;
    for(const road of mapFeatures.roads)for(let i=1;i<road.points.length;i++){const p=closestOnSegment(node.point,road.points[i-1],road.points[i]),d=Math.hypot(p.x-x,p.z-z);if(d<distance){distance=d;nearest=p;}}
    const stated=Number(t.direction),yaw=t.direction&&Number.isFinite(stated)?stated*Math.PI/180:nearest?Math.atan2(nearest.x-x,nearest.z-z):0;
    const point=(dx,dz)=>({x:x+Math.cos(yaw)*dx+Math.sin(yaw)*dz,z:z-Math.sin(yaw)*dx+Math.cos(yaw)*dz});
    const box=(mat,dx,dy,dz,w,h,d)=>{const p=point(dx,dz);instance(unitBox,mat,p.x,y+dy,p.z,w,h,d,yaw);};
    let width=.5,depth=.5,objectHeight=1;
    if(kind==='bench'){
      width=1.8;depth=.62;objectHeight=.98;
      for(let slat=0;slat<4;slat++)box(benchWood,0,.47,-.22+slat*.14,1.8,.07,.11);
      for(let slat=0;slat<3;slat++)box(benchWood,0,.67+slat*.12,-.29,1.8,.09,.055);
      for(const side of [-1,1]){box(railMat,side*.64,.24,0,.065,.48,.5);box(railMat,side*.64,.7,-.3,.055,.55,.055);}
    }else if(kind==='streetlight'){
      objectHeight=Math.max(2.5,Math.min(16,numberTag(t.height)||5.5));width=depth=.25;
      instance(unitCylinder,railMat,x,y+objectHeight/2,z,.055,objectHeight,.055);
      box(railMat,0,objectHeight,.28,.065,.075,.6);box(railMat,0,objectHeight,.58,.42,.1,.32);box(lampGlow,0,objectHeight-.065,.58,.34,.035,.24);
    }else if(kind==='bin'){
      objectHeight=.85;box(railMat,0,.41,0,.42,.78,.42);box(windowReveal,0,.82,0,.45,.09,.45);box(sillMat,0,.64,.215,.2,.07,.025);
    }else if(kind==='fountain'){
      objectHeight=.85;box(foundationMat,0,.38,0,.35,.76,.35);box(railMat,0,.8,0,.45,.1,.38);box(railMat,0,.91,-.05,.025,.16,.025);
    }else{
      width=2.1;depth=.55;objectHeight=.65;
      for(let rack=0;rack<3;rack++){const p=point((rack-1)*.72,0);for(const side of [-1,1]){const q=point((rack-1)*.72,side*.24);instance(unitCylinder,railMat,q.x,y+.3,q.z,.023,.6,.023);}instance(unitBox,railMat,p.x,y+.62,p.z,.045,.045,.5,yaw);}
    }
    const id='osm-node-'+node.id;mapFeatures.streetObjects.push({id,osmId:node.id,kind,x,y,z,width,depth,height:objectHeight,yaw,appearance:'procedural from mapped object type'});
    audioSources.push({id,kind,x,y:y+objectHeight*.5,z,radius:kind==='fountain'?8:4,gain:kind==='fountain'?.1:.25,ambient:kind==='fountain',seed});
    const solid=(part,dx,dz,w,d,bottom,top,support=true)=>{const p=point(dx,dz);colliders.push(createBoxCollider({id:id+'-'+part,objectId:id,type:'street-furniture',x:p.x,z:p.z,width:w,depth:d,yaw,minY:y+bottom,maxY:y+top,support}));};
    if(kind==='bench'){
      solid('seat',0,-.01,1.8,.53,.435,.505);solid('back',0,-.29,1.8,.055,.625,.955);
      for(const side of [-1,1]){solid('leg-'+side,side*.64,0,.065,.5,0,.48,false);solid('backpost-'+side,side*.64,-.3,.055,.055,.425,.975,false);}
    }else if(kind==='streetlight')colliders.push(createCylinderCollider({id,objectId:id,type:'streetlight',x,z,radius:.07,minY:y,maxY:y+objectHeight,support:true,vertical:true}));
    else if(kind==='bin')solid('body',0,0,.45,.45,.02,.865);
    else if(kind==='fountain'){solid('base',0,0,.35,.35,0,.76);solid('basin',0,0,.45,.38,.75,.85);solid('tap',0,-.05,.025,.025,.83,.99,false);}
    else for(let rack=0;rack<3;rack++){for(const side of [-1,1])solid(`post-${rack}-${side}`,(rack-1)*.72,side*.24,.046,.046,0,.6,false);solid('rail-'+rack,(rack-1)*.72,0,.045,.5,.5975,.6425,false);}
  }
  // Batch static meshes by material. Geometry stays geographically exact in metre coordinates.
  for(const b of batches.values()){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));geo.computeBoundingSphere();resources.geometries.add(geo);
    const mesh=new THREE.Mesh(geo,b.mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  for(const b of instances.values()){
    const mesh=new THREE.InstancedMesh(b.geo,b.mat,b.matrices.length);for(let i=0;i<b.matrices.length;i++)mesh.setMatrixAt(i,b.matrices[i]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
  }
  const traffic=createTraffic(THREE,{roads:mapFeatures.roads,colliders,terrainHeight:(x,z)=>sampleGround(x,z)?.height??terrainHeight(x,z),bounds,quality:'high',leftHandTraffic:latitude>=24&&latitude<=46&&longitude>=122&&longitude<=146});
  group.add(traffic.group);interactables.push(...traffic.interactables);
  const collisionIndex=createObjectCollisionIndex({colliders,getDynamic:traffic.getCollisionObjects});
  const clearSpawn=(p,radius=.38)=>{const ground=sampleGround(p.x,p.z);return Boolean(ground&&!collisionIndex.isBlocked(p.x,p.z,radius,ground.height,1.75));};
  let spawnPoint={x:0,z:0};
  if(!clearSpawn(spawnPoint,.55)){
    let found=false;
    for(let d=.75;d<=Math.min(radius-3,150)&&!found;d+=.75){
      const samples=Math.max(24,Math.ceil(d*4));
      for(let k=0;k<samples;k++){const angle=k/samples*Math.PI*2,p={x:Math.sin(angle)*d,z:Math.cos(angle)*d};if(clearSpawn(p,.55)){spawnPoint=p;found=true;break;}}
    }
    if(!found){const first=interactables.find(i=>clearSpawn(i.position,.55));if(first)spawnPoint={x:first.position.x,z:first.position.z};}
  }
  if(!clearSpawn(spawnPoint,.5)){collisionIndex.dispose();traffic.dispose();walkSurfaces.dispose();library.dispose();for(const geometry of resources.geometries)geometry.dispose();for(const mat of resources.materials)mat.dispose();throw new Error('この取得範囲内に歩ける屋外の開始位置を見つけられませんでした。近くの屋外地点を選んでください。');}
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
  if(offset>.5)notes.push(`取得した現在地が建物・水域・物体などに重なるため、開始位置を約${Math.round(offset)}m先の屋外へ移しています。元の現在地は地図の印で示します。`);
  if(!buildings.length&&!mapFeatures.roads.length)notes.push('この範囲の道路・建物は地図に記録されていないか、取得範囲に含まれていません。');
  if(stairwayCount)notes.push(renderedTreadCount?'地図にある階段は取得した地形の高低差から段を描画しています。段数・段高は実測値ではありません。':'地図に階段の記録がありますが、利用できる高低差がないため平面で表示しています。');
  if(mapFeatures.roads.some(road=>road.bridge||road.layer))notes.push('橋や立体交差の道路面高は地表の標高データだけでは確定できないため、上下の重なりを正確に再現できない場合があります。');
  if(mappedAppearanceCount||mappedRoofCount||mappedRoadSurfaceCount)notes.push('記録のある建物の外壁・屋根の色と素材、寸法がある単純な屋根形状、道路の舗装種別を反映しています。素材の細部はゲーム用の表現です。');
  if(sidewalkCount||foundationCount)notes.push('歩道の位置・幅に記録がない部分、縁石の段差、建物の基礎・窓・玄関の細部は地図と地形に合わせた描画上の推定です。実際の外観を撮影・測量したものではありません。');
  if(colliders.some(c=>c.type==='building'))notes.push('屋根への落下と建物の下面への接触は簡易的な立体形状で判定します。屋根の支持高さは建物の最大高さで、斜屋根に沿う精密な歩行には対応していません。');
  if(mapFeatures.streetObjects.length)notes.push('地図に記録されたベンチ・街灯などをその位置に配置しています。個々の形や向きは記録がない場合にゲーム用の形状を使用しています。');
  const vegetation=createVegetationDetail(THREE,{trees:treeRecords,heightAt:(x,z)=>sampleGround(x,z)?.height??terrainHeight(x,z),quality:'high'});group.add(vegetation.group);
  notes.push(traffic.sourceInfo.note);
  let observer={x:spawn.x,z:spawn.z},disposed=false;
  const sourceInfo={
    source:'OpenStreetMap',attribution:'© OpenStreetMap contributors',licenseUrl:'https://www.openstreetmap.org/copyright',endpoint:ENDPOINT,
    dataTimestamp:data.osm3s?.timestamp_osm_base||null,coverageMeters:radius,radius,buildingCount:buildings.length,roadCount:mapFeatures.roads.length,areaCount,
    mappedHeightCount,inferredHeightCount,terrain:terrain?'elevation':'flat',terrainSource,spawnOffsetMeters:offset,origin:{x:0,z:0},stairwayCount,renderedTreadCount,mappedAppearanceCount,mappedRoofCount,mappedRoadSurfaceCount,sidewalkCount,foundationCount,mappedStreetObjectCount:mapFeatures.streetObjects.length,
    traffic:traffic.sourceInfo,rendering:'metre-scale PBR, joined roads, raised curbs, recessed facades and open leaf canopies',facades:'procedural recessed openings; not surveyed facades',buildingContacts:'conservative solid footprint volume; roof support uses maximum height, underside respects min_height',roadGeometry:'connected, non-overlapping polygon surfaces',roadMarkings:'procedural decoration, not observed road markings',interiors:'game templates',vegetation:'mapped trees and disclosed planting only within mapped wooded/park land',audio:'game-generated spatial sound; not field recordings of this location',note:notes.join(' '),cached:false
  };
  function dispose(){if(disposed)return;disposed=true;audioSources.length=0;collisionIndex.dispose();traffic.dispose();vegetation.dispose();walkSurfaces.dispose();library.dispose();group.removeFromParent();group.clear();for(const geo of resources.geometries)geo.dispose();for(const mat of resources.materials)mat.dispose();for(const t of resources.textures)t.dispose();}
  function update(dt,hour=12,focus,playerBody=null){if(disposed)return;if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.z))observer=focus;const night=hour<6||hour>=18;windowMat.emissiveIntensity=night?1.25:.035;lampGlow.emissiveIntensity=night?2.4:.035;traffic.update(dt,hour,observer,playerBody);vegetation.update(observer);}
  function getAudioSources(){
    if(disposed)return [];
    const moving=traffic.snapshot();
    return audioSources.concat(moving.cars.map(car=>({...car,id:'traffic-'+car.id,kind:'vehicle',radius:48,gain:.3,seed:hashId(car.id)})),moving.people.map(person=>({...person,id:'traffic-'+person.id,kind:'person',y:person.y+.7,radius:10,gain:.1,seed:hashId(person.id)})));
  }
  function setQuality(tier){library.setQuality(tier);for(const child of group.children)if(child.isMesh)library.updateGeometry(child);traffic.setQuality(tier);vegetation.setQuality(tier);}
  update(0,12,observer,{x:spawn.x,y:sampleGround(spawn.x,spawn.z)?.height??terrainHeight(spawn.x,spawn.z),z:spawn.z,radius:.32,height:1.75});
  return {group,colliders,collisionIndex,interactables,buildings,bounds,spawn,sampleGround,update,radius,label:'現在地の街',geo:{latitude,longitude},toGeo,toLocal,terrainHeight,sourceInfo,dispose,setQuality,audioSources,getAudioSources,trafficStats:traffic.getStats,trafficSnapshot:traffic.snapshot,real:true,mapFeatures,originMarker:{x:0,z:0,spawnOffsetMeters:offset}};
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
