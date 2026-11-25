// Run with: node tests/profile-api.test.mjs (requires Python 3's built-in SQLite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {handleSocial} from '../worker/social.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'machi-profile-'));
const database=path.join(directory,'test.sqlite');
const python=String.raw`
import json,sqlite3,sys
data=json.load(sys.stdin)
db=sqlite3.connect(data['database']);db.row_factory=sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
if 'schema' in data:
 db.executescript(data['schema']);db.commit();print('{}');sys.exit(0)
out=[]
try:
 for stmt in data['statements']:
  cur=db.execute(stmt['sql'],stmt.get('params',[]))
  rows=[dict(row) for row in cur.fetchall()] if cur.description else []
  out.append({'results':rows,'success':True,'meta':{'changes':max(0,cur.rowcount),'last_row_id':cur.lastrowid}})
 db.commit();print(json.dumps(out))
except Exception as e:
 db.rollback();print(str(e),file=sys.stderr);sys.exit(1)
`;
function execute(statements,schema){
  const result=spawnSync('python3',['-c',python],{input:JSON.stringify({database,statements,schema}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
class Statement{
  constructor(sql,params=[]){this.sql=sql;this.params=params;}
  bind(...params){return new Statement(this.sql,params);}
  async first(column){const row=execute([this])[0].results[0]??null;return column?row?.[column]??null:row;}
  async all(){return execute([this])[0];}
  async run(){return execute([this])[0];}
}
const env={DB:{prepare:sql=>new Statement(sql),batch:async statements=>execute(statements)}};
async function api(auth,route,method='GET',data,extraHeaders={}){
  const headers={...extraHeaders};if(auth)headers['oai-authenticated-user-id']=auth;
  if(data!==undefined)headers['Content-Type']='application/json';
  const response=await handleSocial(new Request('https://machi.test/api/social'+route,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
  return {httpStatus:response.status,...await response.json()};
}
async function ok(auth,route,method='GET',data){const result=await api(auth,route,method,data);assert(result.httpStatus<300,JSON.stringify(result));return result;}
const privateKeys=['auth_id','authId','email','emailAddress','showName','version','updatedAt'];
function publicOnly(value){for(const key of privateKeys)assert(!Object.hasOwn(value,key),`public profile leaked ${key}`);}
try{
  execute([],fs.readFileSync(new URL('../drizzle/0000_social.sql',import.meta.url),'utf8'));
  execute([{sql:'INSERT INTO profiles(id,auth_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',params:['legacy','native-legacy','M-LEGACY0001','以前の住人',1000,1000]}]);
  execute([],fs.readFileSync(new URL('../drizzle/0001_profile.sql',import.meta.url),'utf8'));
  const legacy=(await ok('native-legacy','/me')).user;
  assert.equal(legacy.name,'以前の住人');assert.equal(legacy.title,'街の住人');assert.equal(legacy.avatarIcon,'leaf');assert.equal(legacy.showName,true);assert.equal(legacy.version,0);
  assert.equal((await api(null,'/profile')).httpStatus,401);
  assert.equal((await api(null,'/profile','POST',{name:'無断変更'})).httpStatus,401);
  const a=(await ok('private-A','/me')).user,b=(await ok('private-B','/me')).user;
  assert.equal(a.name,'旅人');assert(!JSON.stringify(a).includes('private-A'));
  assert.equal((await api('private-A','/profile','POST',{name:'変更',expectedUserId:b.id})).code,'profile_identity_changed');
  assert.equal((await ok('private-A','/me')).user.version,0);
  const values={name:'ねこ🐈'.repeat(8),tagline:'喫茶店と散歩が好きです',bio:'窓のそばで\r\n本を読んでいます。',title:'本のある暮らし',accent:'#AABBCC',avatarIcon:'book',showName:false};
  assert.equal(Array.from(values.name).length,24);
  const saved=(await ok('private-A','/profile','POST',{...values,expectedUserId:a.id,expectedVersion:0,userId:b.id})).user;
  assert.equal(saved.version,1);assert.equal(saved.name,values.name);assert.equal(saved.bio,'窓のそばで\n本を読んでいます。');assert.equal(saved.accent,'#aabbcc');assert.equal(saved.showName,false);
  assert.equal((await ok('private-B','/me')).user.name,'旅人','body ID must never select a different account');
  const stale=await api('private-A','/profile','POST',{name:'古い画面の変更',expectedVersion:0,expectedUserId:a.id});
  assert.equal(stale.httpStatus,409);assert.equal(stale.code,'profile_conflict');assert.deepEqual(stale.user,saved);
  const outcomes=await Promise.all(['同時更新１','同時更新２'].map(name=>api('private-A','/profile','POST',{name,expectedVersion:1,expectedUserId:a.id})));
  assert.deepEqual(outcomes.map(result=>result.httpStatus).sort(),[200,409],'one compare-and-set update must win');
  const current=(await ok('private-A','/me')).user;
  assert.equal(current.version,2);assert.equal(current.bio,saved.bio);assert.equal(current.title,saved.title);assert.equal(current.accent,saved.accent);assert.equal(current.showName,false);
  const invalid=[{name:'界'.repeat(25)},{name:''},{tagline:'a'.repeat(61)},{bio:'あ'.repeat(301)},{title:'管理者'},{accent:'#123'},{accent:'#123456;display:none'},{avatarIcon:'<svg>'},{showName:'false'},{expectedVersion:-1},{expectedVersion:1.5}];
  for(const patch of invalid){assert.equal((await api('private-A','/profile','POST',patch)).httpStatus,400,JSON.stringify(patch));assert.deepEqual((await ok('private-A','/me')).user,current,'invalid edit must leave row untouched');}
  const publicA=(await ok('private-B','/profile?userId='+a.id)).user;
  publicOnly(publicA);assert.equal(publicA.bio,current.bio);assert.equal(publicA.avatarIcon,'book');
  assert.equal((await api('private-A','/profile','POST',{name:'外部サイト'},{Origin:'https://attacker.test'})).httpStatus,403);
  const searched=(await ok('private-B','/users?q='+encodeURIComponent(current.name))).users[0];
  publicOnly(searched);assert.equal(searched.id,a.id);assert.equal(searched.accent,'#aabbcc');
  await ok('private-B','/friends/request','POST',{code:a.code});
  const request=(await ok('private-A','/state')).friends.incoming[0];
  await ok('private-A','/friends/respond','POST',{requestId:request.requestId,accept:true});
  const friend=(await ok('private-B','/state')).friends.accepted[0].user;
  publicOnly(friend);assert.equal(friend.id,a.id);assert.equal(friend.avatarIcon,'book');
  const message=(await ok('private-A','/messages?channel=global','POST',{text:'プロフィールのテスト'})).message;
  publicOnly(message.user);assert.equal(message.user.id,a.id);assert.equal(message.user.name,current.name);assert.equal(message.user.title,current.title);
  await ok('private-B','/block','POST',{userId:a.id});
  assert.equal((await api('private-B','/profile?userId='+a.id)).httpStatus,404);
  assert.equal((await api('private-A','/profile?userId='+b.id)).httpStatus,404);
  assert.equal((await ok('private-A','/profile')).isSelf,true);
  await ok('private-A','/profile','POST',{name:'一',expectedVersion:current.version});
  assert.equal((await ok('private-A','/me')).user.name,'一','one-character names are supported');
  console.log('PASS: migration preserves existing profiles; native identity and CSRF enforcement; Unicode lengths; private/public field separation; validation without mutation; optimistic concurrency; updated social summaries; block-aware profile viewing.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
