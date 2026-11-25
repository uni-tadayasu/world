const WORLD_ALLOWED_ORIGINS=new Set(['https://www.omoji-z.com','https://machi-life.hisa-0128-1996.chatgpt.site','https://uni-tadayasu.github.io']);
const WORLD_REQUESTS=new Map(),WORLD_MEMORY=new Map();
const WORLD_MEMORY_LIMIT=16*1024*1024,WORLD_MEMORY_ENTRY_LIMIT=8*1024*1024;
let worldMemoryBytes=0;
const WORLD_AGENT='MACHI-LIFE/4.0 (https://www.omoji-z.com/about.html)';
function worldForget(key){const cached=WORLD_MEMORY.get(key);if(!cached)return;worldMemoryBytes-=cached.bytes;WORLD_MEMORY.delete(key);}
function worldRemember(key,result,expiry){
  const bytes=new TextEncoder().encode(result.text).byteLength;
  worldForget(key);
  // A small entry count alone does not bound memory in densely mapped regions.
  // Large valid maps can still be returned and stored in the external edge cache.
  if(bytes>WORLD_MEMORY_ENTRY_LIMIT)return;
  while(WORLD_MEMORY.size&&(WORLD_MEMORY.size>=8||worldMemoryBytes+bytes>WORLD_MEMORY_LIMIT))worldForget(WORLD_MEMORY.keys().next().value);
  WORLD_MEMORY.set(key,{...result,bytes,expiry});worldMemoryBytes+=bytes;
}
function worldHeaders(request,extra={}){
  const origin=request.headers.get('Origin'),headers={'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Expose-Headers':'X-World-Provider, X-World-Cache','Vary':'Origin',...extra};
  if(origin&&(WORLD_ALLOWED_ORIGINS.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='GET, HEAD, OPTIONS';}
  return headers;
}
function worldError(request,message,status=503){return Response.json({error:message},{status,headers:worldHeaders(request,{'Cache-Control':'no-store',...(status===429?{'Retry-After':'30'}:{})})});}
export function worldQuery(latitude,longitude,radius){
  const around=`(around:${radius},${latitude.toFixed(6)},${longitude.toFixed(6)})`;
  return `[out:json][timeout:17][maxsize:25165824];(way${around}["building"];way${around}["building:part"];way${around}["highway"];way${around}["leisure"];way${around}["landuse"];way${around}["natural"~"^(water|wood|scrub|wetland|beach)$"];way${around}["waterway"];relation${around}["type"="multipolygon"]["natural"="water"];node${around}["shop"];node${around}["amenity"];node${around}["entrance"];node${around}["natural"="tree"];node${around}["highway"="street_lamp"];);out geom;`;
}
async function worldUpstream(latitude,longitude,radius){
  const providers=[{name:'private.coffee',url:'https://overpass.private.coffee/api/interpreter'}];
  // Use the regional service first in Japan. The worldwide service remains a
  // single fallback for transport failures or a temporary server outage.
  if(latitude>=20&&latitude<=50&&longitude>=120&&longitude<=155)providers.unshift({name:'dresel-asia',url:'https://ovp.dresel.systems/api-as/interpreter'});
  let last='地図の配信元に接続できませんでした。';
  for(const provider of providers){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),19500);
    try{
      const response=await fetch(provider.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':WORLD_AGENT,Accept:'application/json'},body:new URLSearchParams({data:worldQuery(latitude,longitude,radius)}),signal:controller.signal});
      if(response.status===429||response.status===406)return {error:'地図の配信元が混雑しています。30秒以上待ってから再試行してください。',status:429};
      if(response.status>=400&&response.status<500)return {error:`地図の配信元が取得を受け付けませんでした（${response.status}）。`,status:502};
      if(!response.ok){last='地図の配信元が一時的に応答できません。';continue;}
      if(Number(response.headers.get('Content-Length'))>24*1024*1024)return {error:'地図が大きすぎます。少し離れた場所を指定してください。',status:413};
      const text=await response.text();if(text.length>24*1024*1024)return {error:'地図データが取得上限を超えました。',status:413};
      let data;try{data=JSON.parse(text);}catch{last='地図の配信元から正しいデータが届きませんでした。';continue;}
      if(!Array.isArray(data.elements)||data.remark){last='地図の配信元で処理が完了しませんでした。';continue;}
      return {text,provider:provider.name};
    }catch(error){last=error.name==='AbortError'?'地図の配信元が時間内に応答しませんでした。':'地図の配信元との通信に失敗しました。';}
    finally{clearTimeout(timer);}
  }
  return {error:last,status:503};
}
export async function handleWorld(request,env,ctx={}){
  const url=new URL(request.url);if(url.pathname!=='/api/world'&&!url.pathname.startsWith('/api/terrain/'))return null;
  const origin=request.headers.get('Origin');if(origin&&!WORLD_ALLOWED_ORIGINS.has(origin)&&origin!==url.origin&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return worldError(request,'このゲームから地図を読み込んでください。',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:worldHeaders(request)});
  if(!['GET','HEAD'].includes(request.method))return worldError(request,'GETを使用してください。',405);
  if(url.pathname.startsWith('/api/terrain/')){
    const match=url.pathname.match(/^\/api\/terrain\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/);
    if(!match)return worldError(request,'標高タイルが正しくありません。',400);
    const [z,x,y]=match.slice(1).map(Number);if(z<0||z>15||x<0||y<0||x>=2**z||y>=2**z)return worldError(request,'標高タイルの範囲が正しくありません。',400);
    try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let upstream;try{upstream=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,{signal:controller.signal});}finally{clearTimeout(timer);}if(!upstream.ok)return worldError(request,'標高タイルを取得できませんでした。',503);return new Response(request.method==='HEAD'?null:upstream.body,{headers:worldHeaders(request,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'})});}catch{return worldError(request,'標高の配信元に接続できませんでした。',503);}
  }
  if(!url.searchParams.has('lat')||!url.searchParams.has('lon')||!url.searchParams.get('lat').trim()||!url.searchParams.get('lon').trim())return worldError(request,'緯度・経度を指定してください。',400);
  const latitude=Number(url.searchParams.get('lat')),longitude=Number(url.searchParams.get('lon')),radius=Number(url.searchParams.get('radius')||250);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180||!Number.isFinite(radius)||radius<50||radius>450)return worldError(request,'地図の取得範囲が正しくありません。',400);
  const lat=Math.round(latitude*10000)/10000,lon=Math.round(longitude*10000)/10000,r=Math.ceil(radius),key=`v2:${lat},${lon},${r}`,now=Date.now();
  const cacheRequest=new Request(url.origin+'/__world_cache/'+encodeURIComponent(key));
  let cached=WORLD_MEMORY.get(key);if(cached&&cached.expiry<=now){worldForget(key);cached=null;}
  if(!cached&&typeof caches!=='undefined'){try{const hit=await caches.default.match(cacheRequest);if(hit)cached={text:await hit.text(),provider:hit.headers.get('X-World-Provider'),expiry:now+60000};}catch{}}
  if(cached)return new Response(request.method==='HEAD'?null:cached.text,{headers:worldHeaders(request,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900','X-World-Provider':cached.provider,'X-World-Cache':'hit'})});
  if(!WORLD_REQUESTS.has(key)&&WORLD_REQUESTS.size>=4)return worldError(request,'地図の読み込みが混雑しています。少し待って再試行してください。',429);
  let task=WORLD_REQUESTS.get(key);if(!task){task=worldUpstream(lat,lon,r+25);WORLD_REQUESTS.set(key,task);}
  let result;try{result=await task;}finally{WORLD_REQUESTS.delete(key);}
  if(result.error)return worldError(request,result.error,result.status);
  const headers=worldHeaders(request,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900','X-World-Provider':result.provider,'X-World-Cache':'miss'});
  worldRemember(key,result,now+900000);
  if(typeof caches!=='undefined'){const cacheHeaders={'Content-Type':'application/json','Cache-Control':'public, max-age=900','X-World-Provider':result.provider};const saving=caches.default.put(cacheRequest,new Response(result.text,{headers:cacheHeaders})).catch(()=>{});ctx.waitUntil?.(saving);}
  return new Response(request.method==='HEAD'?null:result.text,{headers});
}
