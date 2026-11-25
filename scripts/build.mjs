import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dist=path.join(root,'dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
const assets={};
async function walk(dir,prefix='') {for(const file of await readdir(dir,{withFileTypes:true})){if(['server','.openai','.DS_Store'].includes(file.name))continue;const rel=prefix+'/'+file.name,full=path.join(dir,file.name);if(file.isDirectory())await walk(full,rel);else{const bytes=await readFile(full);assets[rel]={data:bytes.toString('base64'),type:types[path.extname(file.name)]||'application/octet-stream',etag:'"'+createHash('sha256').update(bytes).digest('hex').slice(0,24)+'"'};}}}
await walk(dist);
const social=(await readFile(path.join(root,'worker/social.js'),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
const entry=(await readFile(path.join(root,'worker/index.js'),'utf8')).replace(/^import\s+\{handleSocial\}\s+from\s+'\.\/social\.js';\s*/,'');
await mkdir(path.join(dist,'server'),{recursive:true});
await writeFile(path.join(dist,'server/index.js'),'const STATIC_ASSETS='+JSON.stringify(assets)+';\n'+social+'\n'+entry);
await mkdir(path.join(dist,'.openai'),{recursive:true});
const hosting=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
delete hosting.static;hosting.d1='DB';hosting.r2=null;
await writeFile(path.join(dist,'.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n');
console.log('Built self-contained Worker with '+Object.keys(assets).length+' static assets and D1 social API.');
