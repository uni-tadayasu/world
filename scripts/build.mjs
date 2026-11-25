import {readdir,readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dist=path.join(root,'dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
const assets={},media={};
// Keep the existing GitHub Pages main/root source compatible with the same game.
// Do not use <base>: navigation and the manifest must stay under /world/.
async function syncPagesRoot(){
  const source=await readFile(path.join(dist,'index.html'),'utf8');
  const rootIndex=source
    .replace(/<script>if\(location\.hostname==='uni-tadayasu\.github\.io'\)\{location\.replace\('[^']*'\+location\.search\+location\.hash\);\}<\/script>/, '<script>location.replace("https://machi-life.hisa-0128-1996.chatgpt.site/"+location.search+location.hash);</script>')
    .replace(/((?:src|href)=["'])\.\/([^"']+\.(?:js|css)(?:[?#][^"']*)?)(["'])/g,'$1./dist/$2$3')
    .replace(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(_,open,json,close)=>{
      const map=JSON.parse(json);
      for(const [name,url] of Object.entries(map.imports||{}))if(typeof url==='string'&&url.startsWith('./'))map.imports[name]='./dist/'+url.slice(2);
      return open+JSON.stringify(map)+close;
    })
    .replace(/href=["']\.\/["']/g,'href="/world/"');
  await writeFile(path.join(root,'index.html'),rootIndex);
  const about=(await readFile(path.join(dist,'about.html'),'utf8'))
    .replace(/href=["']\.\/["']/g,'href="https://machi-life.hisa-0128-1996.chatgpt.site/"')
    .replace(/href=["']\.\/vendor\//g,'href="./dist/vendor/');
  await writeFile(path.join(root,'about.html'),about);
  // Sponsor sales and receipts require the Worker. Legacy Pages URLs point to
  // the same live service rather than rendering a checkout without its API.
  for(const name of ['sponsors.html','sponsor-terms.html','commerce.html']){
    const target='https://machi-life.hisa-0128-1996.chatgpt.site/'+name;
    await writeFile(path.join(root,name),'<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url='+target+'"><title>まち｜オンライン版へ移動</title><link rel="canonical" href="'+target+'"><script>location.replace('+JSON.stringify(target)+'+location.search+location.hash);</script></head><body><p><a href="'+target+'">オンライン版を開く</a></p></body></html>\n');
  }
  for(const name of ['favicon.svg','favicon-32.png','apple-touch-icon.png','icon-192.png','icon-512.png','ogp.png','social-card.svg','manifest.webmanifest','robots.txt','sitemap.xml'])await copyFile(path.join(dist,name),path.join(root,name));
}
await syncPagesRoot();
async function walk(dir,prefix='') {for(const file of await readdir(dir,{withFileTypes:true})){if(['server','.openai','.DS_Store'].includes(file.name)||file.name.startsWith('__qa-'))continue;const rel=prefix+'/'+file.name,full=path.join(dir,file.name);if(file.isDirectory())await walk(full,rel);else if(path.extname(file.name)==='.mp3'){media[rel]={url:'https://raw.githubusercontent.com/uni-tadayasu/world/main/dist'+rel};}else{const bytes=await readFile(full);assets[rel]={data:bytes.toString('base64'),type:types[path.extname(file.name)]||'application/octet-stream',etag:'"'+createHash('sha256').update(bytes).digest('hex').slice(0,24)+'"'};}}}
await walk(dist);
// A fresh document references a fresh module URL namespace. Relative imports and
// lazy assets inherit it, so a previous hour-long browser cache cannot keep the
// old location loader alive after a deployment.
const revision=createHash('sha256').update(JSON.stringify(Object.entries(assets).map(([name,asset])=>[name,asset.etag]))).digest('hex').slice(0,16);
const prefix='/_assets/'+revision+'/';
for(const name of Object.keys(assets).filter(name=>name.endsWith('.html'))){
const html=Buffer.from(assets[name].data,'base64').toString('utf8')
  .replace(/((?:src|href)=["'])\.\/([^"']+\.(?:js|css)(?:[?#][^"']*)?)(["'])/g,(_,before,name,after)=>before+prefix+name+after)
  .replace(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(_,open,json,close)=>{
    const map=JSON.parse(json);for(const [name,url] of Object.entries(map.imports||{}))if(typeof url==='string'&&url.startsWith('./'))map.imports[name]=prefix+url.slice(2);return open+JSON.stringify(map)+close;
  });
const htmlBytes=Buffer.from(html);
assets[name]={...assets[name],data:htmlBytes.toString('base64'),etag:'"'+createHash('sha256').update(htmlBytes).digest('hex').slice(0,24)+'"'};
}
const sandboxExchange=(await readFile(path.join(root,'worker/exchange-sandbox.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const rewardTreasury=(await readFile(path.join(root,'worker/reward-treasury.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const exchange=(await readFile(path.join(root,'worker/exchange.js'),'utf8')).replace(/^import\s+\{[^}]+\}\s+from\s+'\.\/(?:exchange-sandbox|reward-treasury)\.js';\s*/gm,'').replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const social=(await readFile(path.join(root,'worker/social.js'),'utf8')).replace(/^import\s+\{handleExchangeRequest\}\s+from\s+'\.\/exchange\.js';\s*/gm,'').replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const world=(await readFile(path.join(root,'worker/world.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const sponsors=(await readFile(path.join(root,'worker/sponsors.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const entry=(await readFile(path.join(root,'worker/index.js'),'utf8')).replace(/^import\s+\{handle(?:Social|World|Sponsors)\}\s+from\s+'\.\/(?:social|world|sponsors)\.js';\s*/gm,'');
await mkdir(path.join(dist,'server'),{recursive:true});
await writeFile(path.join(dist,'server/index.js'),'const STATIC_ASSETS='+JSON.stringify(assets)+';\nconst STATIC_MEDIA='+JSON.stringify(media)+';\nconst handleSandboxExchangeRequest=(()=>{\n'+sandboxExchange+'\nreturn handleSandboxExchangeRequest;\n})();\nconst {createRewardTreasuryService,REWARD_TREASURY_POLICY}=(()=>{\n'+rewardTreasury+'\nreturn {createRewardTreasuryService,REWARD_TREASURY_POLICY};\n})();\nconst handleExchangeRequest=(()=>{\n'+exchange+'\nreturn handleExchangeRequest;\n})();\nconst handleSponsors=(()=>{\n'+sponsors+'\nreturn handleSponsors;\n})();\n'+social+'\n'+world+'\n'+entry);
await mkdir(path.join(dist,'.openai'),{recursive:true});
const hosting=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
delete hosting.static;hosting.d1='DB';hosting.r2=null;
await writeFile(path.join(dist,'.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n');
console.log('Built self-contained Worker with '+Object.keys(assets).length+' static assets and D1 social API.');
