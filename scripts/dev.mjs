import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,statSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const root=process.cwd();
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const port=Number(arg('--port','4173')),host=arg('--host','0.0.0.0');
const build=spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});if(build.status)process.exit(build.status);
mkdirSync(path.join(root,'.sites-runtime'),{recursive:true});
const sqlite=new DatabaseSync(path.join(root,'.sites-runtime/preview.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
  if(!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){
    sqlite.exec(readFileSync(path.join('drizzle',file),'utf8'));
    sqlite.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(file);
  }
}
const prepared=(sql,values=[])=>({bind:(...args)=>prepared(sql,args),async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});
const DB={prepare:sql=>prepared(sql),async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const filepath=path.join(root,'dist/server/index.js'),stamp=statSync(filepath).mtimeMs;
    const {default:worker}=await import(pathToFileURL(filepath).href+'?v='+stamp);
    const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(v)headers.set(k,Array.isArray(v)?v.join(','):v);}
    // Preview does not fabricate a hosted identity or accept an injected auth header.
    headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=await worker.fetch(request,{DB},{waitUntil:p=>p.catch(console.error)});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Preview error');}
}).listen(port,host,()=>console.log(`MACHI LIFE Worker preview at http://${host}:${port}`));
