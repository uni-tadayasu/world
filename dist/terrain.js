/**
 * Public Mapzen Terrarium DEM tiles, decoded entirely in the browser.
 * https://registry.opendata.aws/terrain-tiles/
 * A DEM is approximate terrain elevation, not a survey or a building model.
 */
const TILE_SIZE = 256;
const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;
const MAX_LATITUDE = 85.05112878;
const MAX_CACHE_TILES = 8;
const tileCache = new Map();
const TERRAIN_ORIGIN = new URL('/api/terrain',typeof location!=='undefined'&&location.hostname.endsWith('.chatgpt.site')?location.origin:'https://machi-life.hisa-0128-1996.chatgpt.site').href;

const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const wrap = (v,n) => ((v%n)+n)%n;
const cancelled = () => new DOMException('標高データの読み込みを中止しました。','AbortError');

function touchCache(key,value) {
  tileCache.delete(key);
  tileCache.set(key,value);
  while(tileCache.size>MAX_CACHE_TILES)tileCache.delete(tileCache.keys().next().value);
}

function readTile(zoom,x,y,signal) {
  const count=2**zoom;
  x=wrap(x,count);
  y=clamp(y,0,count-1);
  const key=`${zoom}/${x}/${y}`;
  if(signal?.aborted)return Promise.reject(cancelled());
  if(tileCache.has(key)) {
    const cached=tileCache.get(key);
    touchCache(key,cached);
    return Promise.resolve(cached);
  }
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.crossOrigin='anonymous';
    let settled=false;
    const cleanup=()=>{
      clearTimeout(timer);
      image.onload=null;
      image.onerror=null;
      signal?.removeEventListener('abort',onAbort);
    };
    const fail=error=>{
      if(settled)return;
      settled=true;cleanup();image.src='';reject(error);
    };
    const onAbort=()=>fail(cancelled());
    const timer=setTimeout(()=>fail(new Error('標高タイルの応答が10秒以内に届きませんでした。通信状況を確認して、もう一度お試しください。')),10000);
    signal?.addEventListener('abort',onAbort,{once:true});
    image.onerror=()=>fail(new Error('公開されている標高タイルを取得できませんでした。通信・配信元・CORS制限のいずれかにより読み込めません。'));
    image.onload=()=>{
      if(settled)return;
      if(signal?.aborted){fail(cancelled());return;}
      let canvas;
      try {
        canvas=document.createElement('canvas');
        canvas.width=TILE_SIZE;canvas.height=TILE_SIZE;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx)throw new Error('標高データの画像を読み取るCanvasを作成できませんでした。');
        ctx.drawImage(image,0,0,TILE_SIZE,TILE_SIZE);
        const rgba=ctx.getImageData(0,0,TILE_SIZE,TILE_SIZE).data;
        const heights=new Float32Array(TILE_SIZE*TILE_SIZE);
        let valid=0,min=Infinity,max=-Infinity;
        for(let i=0;i<heights.length;i++) {
          const p=i*4;
          if(rgba[p+3]===0){heights[i]=NaN;continue;}
          const elevation=rgba[p]*256+rgba[p+1]+rgba[p+2]/256-32768;
          heights[i]=elevation;valid++;
          min=Math.min(min,elevation);max=Math.max(max,elevation);
        }
        if(!valid)throw new Error('この地域のタイルに有効な標高データがありません。');
        const decoded={key,zoom,x,y,heights,min,max};
        touchCache(key,decoded);
        settled=true;cleanup();resolve(decoded);
      } catch(error) {
        const detail=error?.name==='SecurityError'
          ?'画像の読み取りが配信元のCORS設定で制限されています。'
          :error?.message||'画像を解析できませんでした。';
        fail(new Error(`標高データを読み取れませんでした。${detail}`));
      } finally {
        if(canvas){canvas.width=0;canvas.height=0;}
      }
    };
    image.src=`${TERRAIN_ORIGIN}/${zoom}/${x}/${y}.png`;
  });
}

/**
 * @param {Object} options
 * @param {number} options.latitude Latitude in decimal degrees.
 * @param {number} options.longitude Longitude in decimal degrees.
 * @param {number} [options.radius=450] Loaded square half-width, 1–450 metres.
 * @param {Function} [options.onProgress] Receives {stage,loaded,total,message}.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{heightAt:Function,baseElevation:number,sourceInfo:Object,dispose:Function}>}
 */
export async function loadTerrain({latitude,longitude,radius=450,onProgress,signal}={}) {
  latitude=Number(latitude);longitude=Number(longitude);radius=Number(radius);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90)
    throw new Error('標高データを取得する緯度・経度が正しくありません。');
  if(!Number.isFinite(radius)||radius<=0||radius>450)
    throw new Error('標高データの取得半径は1〜450mで指定してください。');
  if(signal?.aborted)throw cancelled();
  const requestedLatitude=latitude;
  latitude=clamp(latitude,-MAX_LATITUDE,MAX_LATITUDE);
  longitude=wrap(longitude+180,360)-180;
  const cosLatitude=Math.max(.001,Math.cos(latitude*DEG));
  const localTiles=new Map();
  const progress=(loaded,total,message)=>{
    if(typeof onProgress==='function')onProgress({stage:'elevation',loaded,total,message});
  };
  // x is east and z is south, consistent with a north-up geographic map.
  function worldPixel(x,z,zoom) {
    const n=TILE_SIZE*2**zoom;
    const lon=longitude+x/(EARTH_RADIUS*cosLatitude)/DEG;
    const lat=clamp(latitude-z/EARTH_RADIUS/DEG,-MAX_LATITUDE,MAX_LATITUDE)*DEG;
    return {
      x:(lon+180)/360*n,
      y:clamp((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*n,0,n-1.000001)
    };
  }
  function coverage(zoom) {
    const points=[worldPixel(-radius,-radius,zoom),worldPixel(radius,-radius,zoom),worldPixel(-radius,radius,zoom),worldPixel(radius,radius,zoom)];
    const n=2**zoom;
    // One pixel of margin keeps bilinear sampling continuous at tile seams.
    const minX=Math.floor((Math.min(...points.map(p=>p.x))-1)/TILE_SIZE);
    const maxX=Math.floor((Math.max(...points.map(p=>p.x))+1)/TILE_SIZE);
    const minY=clamp(Math.floor((Math.min(...points.map(p=>p.y))-1)/TILE_SIZE),0,n-1);
    const maxY=clamp(Math.floor((Math.max(...points.map(p=>p.y))+1)/TILE_SIZE),0,n-1);
    return {minX,maxX,minY,maxY,count:(maxX-minX+1)*(maxY-minY+1)};
  }
  let zoom=14,area=coverage(zoom);
  // High latitudes cover more Mercator pixels. Prefer z14, then z13,
  // reducing further only when required to enforce the four-tile limit.
  while(area.count>4&&zoom>0){zoom--;area=coverage(zoom);}
  const requests=[],tileCount=2**zoom;
  for(let y=area.minY;y<=area.maxY;y++)for(let x=area.minX;x<=area.maxX;x++)requests.push({x:wrap(x,tileCount),y});
  const unique=[...new Map(requests.map(t=>[`${zoom}/${t.x}/${t.y}`,t])).values()];
  let loaded=0;
  progress(0,unique.length,'実際の地形の標高を読み込んでいます…');
  await Promise.all(unique.map(async tile=>{
    const data=await readTile(zoom,tile.x,tile.y,signal);
    if(signal?.aborted)throw cancelled();
    localTiles.set(data.key,data);
    loaded++;
    progress(loaded,unique.length,`標高データ ${loaded} / ${unique.length}`);
  }));
  if(signal?.aborted)throw cancelled();
  const pixelHeight=(px,py)=>{
    const total=TILE_SIZE*tileCount;
    px=wrap(px,total);py=clamp(py,0,total-1);
    const tx=Math.floor(px/TILE_SIZE),ty=Math.floor(py/TILE_SIZE);
    const tile=localTiles.get(`${zoom}/${tx}/${ty}`);
    if(!tile)throw new Error('読み込み範囲内の標高タイルが見つかりません。');
    const value=tile.heights[(py%TILE_SIZE)*TILE_SIZE+(px%TILE_SIZE)];
    if(!Number.isFinite(value))throw new Error('この地点には有効な標高値がありません。');
    return value;
  };
  function absoluteHeight(x,z) {
    const p=worldPixel(clamp(x,-radius,radius),clamp(z,-radius,radius),zoom);
    const px=Math.floor(p.x),py=Math.floor(p.y),fx=p.x-px,fy=p.y-py;
    const a=pixelHeight(px,py),b=pixelHeight(px+1,py),c=pixelHeight(px,py+1),d=pixelHeight(px+1,py+1);
    return(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  }
  const baseElevation=absoluteHeight(0,0);
  // Validate the whole sampled patch before returning: a missing DEM area must
  // be reported to the caller rather than failing later in a render loop.
  for(let iz=0;iz<=12;iz++)for(let ix=0;ix<=12;ix++)absoluteHeight(-radius+2*radius*ix/12,-radius+2*radius*iz/12);
  let disposed=false;
  const sourceInfo={
    label:'Mapzen Terrain Tiles · 近似的な地形標高（DEM）',
    provider:'Mapzen Terrain Tiles / AWS Open Data',
    url:'https://registry.opendata.aws/terrain-tiles/',
    attribution:'標高: Mapzen Terrain Tiles / AWS Open Data · USGS（SRTM / GMTED2010 / 3DEP）· NOAA（ETOPO1）· 地域別クレジット',
    attributionUrl:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    encoding:'Terrarium: R × 256 + G + B / 256 − 32768 m',
    zoom,
    tileCount:unique.length,
    radius,
    latitude,
    longitude,
    latitudeClamped:requestedLatitude!==latitude,
    sampleSpacingMetres:2*Math.PI*EARTH_RADIUS*cosLatitude/(TILE_SIZE*tileCount),
    limitation:'広域の地形データによる近似です。測量精度・最新地形・建物の高さを保証するものではありません。範囲外は取得範囲の端の高さを使用します。'
  };
  return {
    heightAt(x,z) {
      if(disposed)throw new Error('標高データは解放されています。');
      if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('標高を取得する座標が正しくありません。');
      return absoluteHeight(x,z)-baseElevation;
    },
    baseElevation,
    sourceInfo,
    dispose() {disposed=true;localTiles.clear();}
  };
}
