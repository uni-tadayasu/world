import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSocial} from '../worker/social.js';

function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const file of ['0000_social','0001_profile','0002_device_sessions'])db.exec(readFileSync(new URL(`../drizzle/${file}.sql`,import.meta.url),'utf8'));
  const prepare=(sql,values=[])=>({sql,values,bind:(...next)=>prepare(sql,next),async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}});
  const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const results=statements.map(({sql,values})=>{const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};});db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}};
  async function api(route,{cookie,method='GET',data,headers={},origin='https://www.omoji-z.com'}={}){
    const requestHeaders={...headers};if(cookie)requestHeaders.Cookie=cookie;if(data!==undefined)requestHeaders['Content-Type']='application/json';
    const response=await handleSocial(new Request(origin+'/api/social'+route,{method,headers:requestHeaders,body:data===undefined?undefined:JSON.stringify(data)}),env);
    return {status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0],setCookie:response.headers.get('Set-Cookie')};
  }
  const connect=async(options={})=>{const result=await api('/me',options);assert.equal(result.status,200,JSON.stringify(result.data));return {...result,user:result.data.user};};
  const mutate=(browser,route,data={},method='POST')=>api(route,{cookie:browser.cookie,method,data:{expectedUserId:browser.user.id,...data}});
  return {db,api,connect,mutate};
}

test('automatic browser sessions use protected random cookies, hashed storage and stable renewal',async t=>{
  const {db,api,connect}=fixture(t),browser=await connect();
  assert.equal(browser.data.connected,true);assert.equal(browser.data.identityKind,'device');
  assert.match(browser.setCookie,/^__Host-machi-device=[a-f0-9]{64};/);
  for(const attr of ['Secure','HttpOnly','SameSite=Strict','Path=/','Max-Age=15552000'])assert.ok(browser.setCookie.includes(attr));
  const token=browser.cookie.split('=')[1],saved=db.prepare('SELECT * FROM device_sessions').get();
  assert.notEqual(saved.token_hash,token);assert.match(saved.token_hash,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(browser.data).includes(token));assert.ok(!('auth_id' in browser.user));
  const again=await connect({cookie:browser.cookie});assert.equal(again.user.id,browser.user.id);assert.equal(again.setCookie,null);
  db.prepare('UPDATE device_sessions SET expires_at=?').run(Date.now()+1000);
  const renewed=await connect({cookie:browser.cookie});assert.equal(renewed.cookie,browser.cookie);assert.equal(renewed.user.id,browser.user.id);
  assert.ok(db.prepare('SELECT expires_at FROM device_sessions').get().expires_at>Date.now()+179*86400000);
  assert.equal((await api('/state',{cookie:browser.cookie})).status,200);
});

test('forged, expired and native-account credentials cannot select another owner',async t=>{
  const {db,api,connect}=fixture(t);
  db.prepare('INSERT INTO profiles(id,auth_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('legacy','native-old','M-OLD','以前の人',1,1);
  const browser=await connect({headers:{'oai-authenticated-user-id':'native-old'}});
  assert.notEqual(browser.user.id,'legacy');assert.equal(browser.user.name,'旅人');
  assert.equal((await api('/state',{headers:{'oai-authenticated-user-id':'native-old'}})).status,401);
  assert.equal((await api('/state',{cookie:'__Host-machi-device='+'a'.repeat(64)})).data.code,'session_required');
  assert.equal((await api('/state',{cookie:'__Host-machi-device='+browser.user.id})).status,401);
  db.prepare('UPDATE device_sessions SET expires_at=0 WHERE user_id=?').run(browser.user.id);
  assert.equal((await api('/state',{cookie:browser.cookie})).status,401);
  const replacement=await connect({cookie:browser.cookie});assert.notEqual(replacement.user.id,browser.user.id);
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get('legacy').name,'以前の人');
  assert.ok(db.prepare('SELECT id FROM profiles WHERE id=?').get(browser.user.id),'expired data remains stored');
});

test('CSRF checks include automatic session creation and work on both public hosts',async t=>{
  const {db,api,connect,mutate}=fixture(t);
  assert.equal((await api('/me',{headers:{Origin:'https://attacker.test'}})).status,403);
  assert.equal((await api('/me',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await api('/me',{headers:{'Sec-Fetch-Site':'same-site'}})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM profiles').get().n,0);
  for(const origin of ['https://www.omoji-z.com','https://machi-life.hisa-0128-1996.chatgpt.site']){
    const browser=await connect({origin,headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}});
    assert.equal((await api('/messages?channel=global',{cookie:browser.cookie,method:'POST',data:{expectedUserId:browser.user.id,text:'blocked'},headers:{Origin:'https://attacker.test'},origin})).status,403);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});

test('every mutation rejects missing or stale displayed identities before changing data',async t=>{
  const {db,api,connect}=fixture(t),a=await connect(),b=await connect();
  for(const [route,method]of [['/messages?channel=global','POST'],['/profile','POST'],['/home','POST'],['/belongings','POST'],['/friends/request','POST'],['/friends/respond','POST'],['/friends/remove','POST'],['/organizations','POST'],['/organizations/join','POST'],['/organizations/leave','POST'],['/block','POST'],['/block','DELETE'],['/report','POST'],['/voice/join','POST'],['/voice/leave','POST'],['/voice/signal','POST']]){
    const result=await api(route,{cookie:b.cookie,method,data:{expectedUserId:a.user.id}});
    assert.equal(result.status,409,route);assert.match(result.data.code,/identity_changed$/);
  }
  assert.equal((await api('/messages?channel=global',{cookie:a.cookie,method:'POST',data:{text:'no owner'}})).status,409);
  assert.equal((await api('/state',{cookie:b.cookie,headers:{'X-Machi-User-Id':a.user.id}})).data.code,'session_identity_changed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM organizations').get().n,0);
});

test('anonymous chat keeps sanitization, sender ownership, message limits, block and report',async t=>{
  const {db,api,connect,mutate}=fixture(t),a=await connect(),b=await connect();
  const sent=await mutate(a,'/messages?channel=global',{text:' \u0000こんにちは <script>test</script> ',sender_id:b.user.id,userId:b.user.id});
  assert.equal(sent.status,201);assert.equal(sent.data.message.user.id,a.user.id);assert.equal(sent.data.message.text,'こんにちは <script>test</script>');
  assert.equal((await mutate(a,'/messages?channel=global',{text:'x'.repeat(501)})).status,400);
  for(let i=0;i<7;i++)assert.equal((await mutate(a,'/messages?channel=global',{text:'test '+i})).status,201);
  assert.equal((await mutate(a,'/messages?channel=global',{text:'over rate'})).data.code,'message_rate_limit');
  const read=await api('/messages?channel=global',{cookie:b.cookie});assert.equal(read.data.messages.length,8);assert.equal(read.data.messages[0].mine,false);
  assert.equal((await mutate(b,'/report',{messageId:sent.data.message.id,reason:'テスト用の通報理由です'})).status,200);
  assert.equal((await mutate(b,'/block',{userId:a.user.id})).status,200);
  assert.equal((await api('/messages?channel=global',{cookie:b.cookie})).data.messages.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reports').get().n,1);
});

test('browser identities can use friendship, private channels, organizations and guarded voice',async t=>{
  const {api,connect,mutate}=fixture(t),a=await connect(),b=await connect(),c=await connect();
  assert.equal((await mutate(a,'/messages?channel=dm:'+b.user.id,{text:'not friends'})).status,403);
  assert.equal((await mutate(a,'/friends/request',{code:b.user.code})).status,200);
  const request=(await api('/state',{cookie:b.cookie})).data.friends.incoming[0];
  assert.equal((await mutate(b,'/friends/respond',{requestId:request.requestId,accept:true})).status,200);
  assert.equal((await mutate(a,'/messages?channel=dm:'+b.user.id,{text:'private test'})).status,201);
  assert.equal((await api('/messages?channel=dm:'+a.user.id,{cookie:c.cookie})).status,403);
  const organization=(await mutate(a,'/organizations',{name:'テスト組織',description:'local fixture'})).data.organization;
  assert.equal((await api('/messages?channel=org:'+organization.id,{cookie:b.cookie})).status,403);
  assert.equal((await mutate(b,'/organizations/join',{id:organization.id})).status,200);
  assert.equal((await mutate(b,'/messages?channel=org:'+organization.id,{text:'organization test'})).status,201);
  assert.equal((await mutate(a,'/voice/join',{channel:'global'})).status,200);
  assert.equal((await mutate(b,'/voice/join',{channel:'global'})).status,200);
  const signal=await mutate(a,'/voice/signal',{channel:'global',to:b.user.id,type:'offer',data:{type:'offer',sdp:'v=0\r\n'+'a='.repeat(9000)}});
  assert.equal(signal.status,200,'a valid-sized SDP larger than 16 KB must retain the voice endpoint budget');
  assert.equal((await api('/voice/leave',{cookie:b.cookie,method:'POST',data:{channel:'global',expectedUserId:a.user.id}})).status,409);
  assert.equal((await api('/voice/poll?channel=global&since=0',{cookie:b.cookie})).status,200,'stale A cleanup must not remove B presence');
});

test('session creation is rate limited and separate browsers never share an identity by IP',async t=>{
  const {api,connect}=fixture(t),headers={'CF-Connecting-IP':'198.51.100.7'},ids=new Set();
  for(let i=0;i<10;i++){const browser=await connect({headers});ids.add(browser.user.id);}
  assert.equal(ids.size,10);
  assert.equal((await api('/me',{headers})).data.code,'session_rate_limit');
});
