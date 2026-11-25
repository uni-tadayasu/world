import {handleSocial} from './social.js';

const SECURITY = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'geolocation=(self), microphone=(self), camera=(), gamepad=(self), fullscreen=(self)',
  'Cross-Origin-Resource-Policy':'same-origin',
};

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
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
    const asset=STATIC_ASSETS[path];
    if(!asset)return new Response('Not found',{status:404,headers:SECURITY});
    const headers={...SECURITY,'Content-Type':asset.type,'Cache-Control':path.endsWith('.html')?'no-cache':'public, max-age=3600','ETag':asset.etag};
    if(request.headers.get('If-None-Match')===asset.etag)return new Response(null,{status:304,headers});
    const binary=atob(asset.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Response(request.method==='HEAD'?null:bytes,{headers});
  }
};
