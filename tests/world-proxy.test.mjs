// Run with: node tests/world-proxy.test.mjs. All upstream requests are mocked.
import assert from 'node:assert/strict';

const native='https://machi-life.hisa-0128-1996.chatgpt.site';
const asia='https://ovp.dresel.systems/api-as/interpreter';
const worldwide='https://overpass.private.coffee/api/interpreter';
const original={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
let serial=0,passed=0;
const fresh=()=>import(`../worker/world.js?test=${serial++}`);
const request=(query='lat=35.6812&lon=139.7671&radius=250',options={})=>new Request(`${native}/api/world?${query}`,options);
const json=(value={elements:[]},status=200)=>Response.json(value,{status});
async function scenario(name,fn){await fn();passed++;console.log('PASS: '+name);}

try{
  await scenario('Japan uses regional provider first; cache separates radius and preserves CORS',async()=>{
    const {handleWorld,worldQuery}=await fresh(),calls=[];
    fetch=async(url,options)=>{calls.push({url,options});return json();};
    const response=await handleWorld(request());assert.equal(response.status,200);assert.equal(response.headers.get('X-World-Provider'),'dresel-asia');
    assert.equal(calls.length,1);assert.equal(calls[0].url,asia);assert.equal(calls[0].options.method,'POST');
    assert(calls[0].options.headers['User-Agent'].includes('MACHI-LIFE/'));
    const query=calls[0].options.body.get('data');assert(query.includes('(around:275,35.681200,139.767100)'));assert(query.includes('[timeout:17]'));assert(query.includes('out geom'));
    assert(worldQuery(35,139,150).includes('(around:150,35.000000,139.000000)'));
    assert(worldQuery(35,139,150).includes('["highway"="street_lamp"]'));
    const hit=await handleWorld(request(undefined,{headers:{Origin:'https://uni-tadayasu.github.io'}}));
    assert.equal(hit.headers.get('X-World-Cache'),'hit');assert.equal(hit.headers.get('Access-Control-Allow-Origin'),'https://uni-tadayasu.github.io');assert.equal(calls.length,1);
    const head=await handleWorld(request(undefined,{method:'HEAD'}));assert.equal(await head.text(),'');assert.equal(calls.length,1);
    await handleWorld(request('lat=35.6812&lon=139.7671&radius=150'));assert.equal(calls.length,2);
    await handleWorld(request('lat=35.6812&lon=139.7671'));assert.equal(calls.length,2,'omitted radius defaults to cached 250 m');
  });

  await scenario('temporary regional failure falls back once, retaining actual source',async()=>{
    const {handleWorld}=await fresh(),calls=[];
    fetch=async url=>{calls.push(url);return url===asia?json({error:'temporary'},503):json();};
    const response=await handleWorld(request());assert.equal(response.status,200);assert.deepEqual(calls,[asia,worldwide]);assert.equal(response.headers.get('X-World-Provider'),'private.coffee');
  });

  await scenario('rate and policy rejections never switch provider',async()=>{
    for(const status of [429,406,400,404]){
      const {handleWorld}=await fresh(),calls=[];fetch=async url=>{calls.push(url);return json({},status);};
      const response=await handleWorld(request());assert.equal(response.status,[429,406].includes(status)?429:502);assert.equal(calls.length,1);
      if([429,406].includes(status))assert.equal(response.headers.get('Retry-After'),'30');
    }
  });

  await scenario('network, invalid JSON and incomplete Overpass responses can use one fallback',async()=>{
    for(const failure of ['network','json','remark']){
      const {handleWorld}=await fresh();let calls=0;
      fetch=async()=>{calls++;if(calls>1)return json();if(failure==='network')throw new TypeError('offline');if(failure==='json')return new Response('<html>gateway</html>');return json({remark:'runtime error: Query timed out',elements:[]});};
      const response=await handleWorld(request());assert.equal(response.status,200);assert.equal(calls,2);
    }
  });

  await scenario('each provider has an abort deadline; no unbounded timeout loop',async()=>{
    const {handleWorld}=await fresh(),timers=new Map(),calls=[];let id=0;
    globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;};globalThis.clearTimeout=key=>timers.delete(key);
    fetch=(url,{signal})=>{calls.push(url);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}));};
    try{
      const result=handleWorld(request());await Promise.resolve();assert.equal(timers.size,1);
      assert.equal([...timers.values()][0].ms,19500);[...timers.values()][0].fn();
      for(let i=0;i<5;i++)await Promise.resolve();assert.equal(calls.length,2);assert.equal(timers.size,1);[...timers.values()][0].fn();
      const response=await result;assert.equal(response.status,503);assert.equal(calls.length,2);assert.equal(timers.size,0);
    }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;}
  });

  await scenario('global locations use worldwide service and never Japan-only endpoint',async()=>{
    const {handleWorld}=await fresh(),calls=[];fetch=async url=>{calls.push(url);return json();};
    assert.equal((await handleWorld(request('lat=48.8566&lon=2.3522&radius=150'))).status,200);assert.deepEqual(calls,[worldwide]);
  });

  await scenario('invalid origin, method, coordinates, radius and terrain tiles never reach upstream',async()=>{
    const {handleWorld}=await fresh();fetch=()=>{throw new Error('validation made an upstream request');};
    for(const query of ['', 'lat=&lon=139','lat=35&lon=','lat=NaN&lon=139','lat=86&lon=139','lat=35&lon=181','lat=35&lon=139&radius=49','lat=35&lon=139&radius=451','lat=35&lon=139&radius=abc'])assert.equal((await handleWorld(request(query))).status,400,query);
    assert.equal((await handleWorld(request(undefined,{headers:{Origin:'https://unrelated.example'}}))).status,403);
    assert.equal((await handleWorld(request(undefined,{method:'POST'}))).status,405);
    assert.equal((await handleWorld(request(undefined,{method:'OPTIONS',headers:{Origin:'https://uni-tadayasu.github.io'}}))).status,204);
    for(const path of ['/api/terrain/16/0/0.png','/api/terrain/0/1/0.png','/api/terrain/-1/0/0.png','/api/terrain/14/no/0.png'])assert.equal((await handleWorld(new Request(native+path))).status,400);
  });

  await scenario('same map request is shared; distinct in-flight requests are bounded',async()=>{
    const {handleWorld}=await fresh(),pending=[];
    fetch=()=>new Promise(resolve=>pending.push(resolve));
    const first=handleWorld(request()),same=handleWorld(request());
    const others=[1,2,3].map(n=>handleWorld(request(`lat=${35+n/100}&lon=139&radius=150`)));
    assert.equal(pending.length,4);assert.equal((await handleWorld(request('lat=36&lon=139&radius=150'))).status,429);
    pending.forEach(resolve=>resolve(json()));const responses=await Promise.all([first,same,...others]);assert(responses.every(r=>r.status===200));
  });

  await scenario('memory cache evicts by the 16 MiB byte budget before reaching eight entries',async()=>{
    const {handleWorld}=await fresh();let calls=0;
    const payload=JSON.stringify({elements:[],generator:'x'.repeat(6*1024*1024)});
    fetch=async()=>{calls++;return new Response(payload,{headers:{'Content-Type':'application/json'}});};
    const point=n=>request(`lat=${35+n/100}&lon=139&radius=150`);
    for(const n of [1,2,3])assert.equal((await handleWorld(point(n))).headers.get('X-World-Cache'),'miss');
    assert.equal(calls,3);
    for(const n of [2,3])assert.equal((await handleWorld(point(n))).headers.get('X-World-Cache'),'hit');
    assert.equal(calls,3,'the two most recently stored 6 MiB maps fit');
    assert.equal((await handleWorld(point(1))).headers.get('X-World-Cache'),'miss');
    assert.equal(calls,4,'oldest map was evicted even with only three distinct entries');
  });

  await scenario('valid responses above 8 MiB bypass memory caching, counting UTF-8 bytes',async()=>{
    const {handleWorld}=await fresh();let calls=0;
    const payload=JSON.stringify({elements:[],generator:'街'.repeat(3*1024*1024)});
    assert(payload.length<8*1024*1024);assert(new TextEncoder().encode(payload).byteLength>8*1024*1024);
    fetch=async()=>{calls++;return new Response(payload,{headers:{'Content-Type':'application/json'}});};
    for(let n=0;n<2;n++){const response=await handleWorld(request());assert.equal(response.status,200);assert.equal(response.headers.get('X-World-Cache'),'miss');}
    assert.equal(calls,2,'large valid map remains usable, but is not retained in isolate memory');
  });

  await scenario('terrain proxy uses bounded fixed URL and cross-origin image headers',async()=>{
    const {handleWorld}=await fresh();let received;
    fetch=async(url,options)=>{received={url,options};return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});};
    const response=await handleWorld(new Request(native+'/api/terrain/14/14553/6452.png',{headers:{Origin:'https://uni-tadayasu.github.io'}}));
    assert.equal(response.status,200);assert.equal(received.url,'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/14553/6452.png');assert(received.options.signal instanceof AbortSignal);
    assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://uni-tadayasu.github.io');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'cross-origin');
  });
  console.log(`PASS: ${passed} world proxy scenarios.`);
}finally{Object.assign(globalThis,original);}
