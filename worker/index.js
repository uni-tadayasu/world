import {handleSocial} from './social.js';
import {handleWorld} from './world.js';

const SECURITY = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'geolocation=(self), microphone=(self), camera=(), gamepad=(self), fullscreen=(self)',
  'Cross-Origin-Resource-Policy':'same-origin',
};

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/api/world'||url.pathname.startsWith('/api/terrain/')){
      try{return await handleWorld(request,env,ctx);}catch{return Response.json({error:'地図の中継に接続できませんでした。狭い範囲で再試行してください。'},{status:503,headers:{...SECURITY,'Access-Control-Allow-Origin':'https://uni-tadayasu.github.io','Cache-Control':'no-store'}});}
    }
    if(url.pathname.startsWith('/api/social')){
      // State-changing requests are accepted only from this app's browser origin.
      const origin=request.headers.get('Origin');
      if(!['GET','HEAD','OPTIONS'].includes(request.method)&&origin&&origin!==url.origin){
        return Response.json({error:'このサイトから操作してください。'},{status:403,headers:{...SECURITY,'Cache-Control':'no-store'}});
      }
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:SECURITY});
      try { const response=await handleSocial(request,env); if(response){const headers=new Headers(response.headers);Object.entries(SECURITY).forEach(([k,v])=>headers.set(k,v));headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});} }
      catch(e){console.error('Social request failed',e?.message);return Response.json({error:'接続に失敗しました。時間をおいて再度お試しください。'},{status:503,headers:{...SECURITY,'Cache-Control':'no-store'}});}
      return Response.json({error:'見つかりません。'},{status:404,headers:SECURITY});
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...SECURITY,Allow:'GET, HEAD'}});
    let path;try{path=decodeURIComponent(url.pathname);}catch{return new Response('Bad request',{status:400});}
    if(path==='/'||path==='/index.html')path='/index.html';
    if(STATIC_MEDIA[path]){
      const media=STATIC_MEDIA[path],range=request.headers.get('Range');
      if(range&&!/^bytes=\d*-\d*$/.test(range))return new Response(null,{status:416,headers:SECURITY});
      try{const upstream=await fetch(media.url,{method:request.method,headers:range?{Range:range}:{}});if(!upstream.ok)return new Response('Audio unavailable',{status:503,headers:{...SECURITY,'Cache-Control':'no-store'}});const headers=new Headers({...SECURITY,'Content-Type':'audio/mpeg','Cache-Control':'public, max-age=3600'});for(const key of ['Content-Length','Content-Range','Accept-Ranges','ETag'])if(upstream.headers.has(key))headers.set(key,upstream.headers.get(key));return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});}catch{return new Response('Audio unavailable',{status:503,headers:{...SECURITY,'Cache-Control':'no-store'}});}
    }
    const asset=STATIC_ASSETS[path];
    if(!asset)return new Response('Not found',{status:404,headers:SECURITY});
    const headers={...SECURITY,'Content-Type':asset.type,'Cache-Control':path.endsWith('.html')?'no-cache':'public, max-age=3600','ETag':asset.etag};
    if(request.headers.get('If-None-Match')===asset.etag)return new Response(null,{status:304,headers});
    const binary=atob(asset.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Response(request.method==='HEAD'?null:bytes,{headers});
  }
};
