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
    .replace(/((?:src|href)=["'])\.\/([^"']+\.(?:js|css)(?:[?#][^"']*)?)(["'])/g,'$1./dist/$2$3')
    .replace(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(_,open,json,close)=>{
      const map=JSON.parse(json);
      for(const [name,url] of Object.entries(map.imports||{}))if(typeof url==='string'&&url.startsWith('./'))map.imports[name]='./dist/'+url.slice(2);
      return open+JSON.stringify(map)+close;
    })
    .replace(/href=["']\.\/["']/g,'href="/world/"');
  await writeFile(path.join(root,'index.html'),rootIndex);
  const about=(await readFile(path.join(dist,'about.html'),'utf8'))
    .replace(/href=["']\.\/["']/g,'href="/world/"')
    .replace(/href=["']\.\/vendor\//g,'href="./dist/vendor/');
  await writeFile(path.join(root,'about.html'),about);
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
const html=Buffer.from(assets['/index.html'].data,'base64').toString('utf8')
  .replace(/((?:src|href)=["'])\.\/([^"']+\.(?:js|css)(?:[?#][^"']*)?)(["'])/g,(_,before,name,after)=>before+prefix+name+after)
  .replace(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(_,open,json,close)=>{
    const map=JSON.parse(json);for(const [name,url] of Object.entries(map.imports||{}))if(typeof url==='string'&&url.startsWith('./'))map.imports[name]=prefix+url.slice(2);return open+JSON.stringify(map)+close;
  });
const htmlBytes=Buffer.from(html);
assets['/index.html']={...assets['/index.html'],data:htmlBytes.toString('base64'),etag:'"'+createHash('sha256').update(htmlBytes).digest('hex').slice(0,24)+'"'};
const social=(await readFile(path.join(root,'worker/social.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const world=(await readFile(path.join(root,'worker/world.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const entry=(await readFile(path.join(root,'worker/index.js'),'utf8')).replace(/^import\s+\{handle(?:Social|World)\}\s+from\s+'\.\/(?:social|world)\.js';\s*/gm,'');
await mkdir(path.join(dist,'server'),{recursive:true});
await writeFile(path.join(dist,'server/index.js'),'const STATIC_ASSETS='+JSON.stringify(assets)+';\nconst STATIC_MEDIA='+JSON.stringify(media)+';\n'+social+'\n'+world+'\n'+entry);
await mkdir(path.join(dist,'.openai'),{recursive:true});
const hosting=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
delete hosting.static;hosting.d1='DB';hosting.r2=null;
await writeFile(path.join(dist,'.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n');
console.log('Built self-contained Worker with '+Object.keys(assets).length+' static assets and D1 social API.');
