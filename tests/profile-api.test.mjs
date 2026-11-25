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
const deviceCookies=new Map(),deviceIds=new Map();
async function api(auth,route,method='GET',data,extraHeaders={}){
  if(auth&&route!=='/me'&&!deviceCookies.has(auth))await api(auth,'/me');
  const headers={...extraHeaders};if(auth&&deviceCookies.has(auth))headers.Cookie=deviceCookies.get(auth);
  if(data!==undefined){headers['Content-Type']='application/json';data={expectedUserId:deviceIds.get(auth),...data};}
  const response=await handleSocial(new Request('https://machi.test/api/social'+route,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
  if(auth&&response.headers.has('Set-Cookie'))deviceCookies.set(auth,response.headers.get('Set-Cookie').split(';')[0]);
  const result=await response.json();if(auth&&route==='/me'&&result.user)deviceIds.set(auth,result.user.id);return {httpStatus:response.status,...result};
}
async function ok(auth,route,method='GET',data){const result=await api(auth,route,method,data);assert(result.httpStatus<300,JSON.stringify(result));return result;}
const privateKeys=['auth_id','authId','email','emailAddress','showName','version','updatedAt'];
function publicOnly(value){for(const key of privateKeys)assert(!Object.hasOwn(value,key),`public profile leaked ${key}`);}
try{
  execute([],fs.readFileSync(new URL('../drizzle/0000_social.sql',import.meta.url),'utf8'));
  execute([{sql:'INSERT INTO profiles(id,auth_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',params:['legacy','native-legacy','M-LEGACY0001','以前の住人',1000,1000]}]);
  execute([],fs.readFileSync(new URL('../drizzle/0001_profile.sql',import.meta.url),'utf8'));
  execute([],fs.readFileSync(new URL('../drizzle/0002_device_sessions.sql',import.meta.url),'utf8'));
  const legacy=execute([{sql:'SELECT name,title,avatar_icon,profile_version FROM profiles WHERE id=?',params:['legacy']}])[0].results[0];
  assert.equal(legacy.name,'以前の住人');assert.equal(legacy.title,'街の住人');assert.equal(legacy.avatar_icon,'leaf');assert.equal(legacy.profile_version,0);
  const browser=(await api('new-browser','/me','GET',undefined,{'oai-authenticated-user-id':'native-legacy'})).user;
  assert.notEqual(browser.id,'legacy');assert.equal(browser.name,'旅人','old account data must not be silently imported');
  assert.equal((await api(null,'/profile')).httpStatus,401);
  assert.equal((await api(null,'/profile','POST',{name:'無断変更'})).httpStatus,401);
  const a=(await ok('private-A','/me')).user,b=(await ok('private-B','/me')).user;
  assert.equal(a.name,'旅人');assert(!JSON.stringify(a).includes('private-A'));
  // A login change between identity lookup and save must not copy personal
  // objects or a private room into the newly signed-in account.
  const roomA={version:1,floor:'#112233',wall:'#445566',items:[]};
  const roomB={version:1,floor:'#778899',wall:'#aabbcc',items:[]};
  const itemsA=[{id:'plant-A',type:'plant',name:'Aの植物',color:'#64875b',condition:70,stored:false}];
  const itemsB=[{id:'chair-B',type:'chair',name:'Bの椅子',color:'#9d7b59',condition:90,stored:true}];
  await ok('private-A','/home','POST',{layout:roomA,expectedUserId:a.id});
  await ok('private-B','/home','POST',{layout:roomB,expectedUserId:b.id});
  await ok('private-A','/belongings','POST',{items:itemsA,expectedUserId:a.id});
  await ok('private-B','/belongings','POST',{items:itemsB,expectedUserId:b.id});
  assert.equal((await api('private-B','/home','POST',{layout:roomA,expectedUserId:a.id})).code,'home_identity_changed');
  assert.equal((await api('private-B','/belongings','POST',{items:itemsA,expectedUserId:a.id})).code,'belongings_identity_changed');
  const returnedRoom=await ok('private-B','/home'),returnedItems=await ok('private-B','/belongings');
  assert.equal(returnedRoom.userId,b.id);assert.deepEqual(returnedRoom.layout,roomB);
  assert.equal(returnedItems.userId,b.id);assert.deepEqual(returnedItems.items,itemsB);
  assert.deepEqual((await ok('private-A','/home')).layout,roomA);
  assert.deepEqual((await ok('private-A','/belongings')).items,itemsA);
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
  console.log('PASS: migration preserves existing profiles; browser cookie identity and CSRF enforcement; room and belongings account-switch guards; Unicode lengths; private/public field separation; validation without mutation; optimistic concurrency; updated social summaries; block-aware profile viewing.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
