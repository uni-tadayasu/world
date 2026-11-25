import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const dir of ['dist','worker'])for(const file of readdirSync(dir).filter(f=>f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});if(r.status)process.exit(r.status);}
const html=readFileSync('dist/index.html','utf8');
for(const file of ['main.js','style.css','favicon.svg'])if(!html.includes(file))throw new Error('Missing asset '+file);
console.log('All authored JavaScript parses; entry assets are linked.');
