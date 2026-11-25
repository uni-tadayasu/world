// Real SQLite exercises the isolated simulation. No wallets or external APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSandboxExchangeService,handleSandboxExchangeRequest,SANDBOX_EXCHANGE_POLICY} from '../worker/exchange-sandbox.js';

const POLICY=SANDBOX_EXCHANGE_POLICY;
const LIVE_TABLES=['exchange_accounts','exchange_reward_events','exchange_quotes','exchange_requests','exchange_ledger'];
const sandboxSQL=()=>readFileSync(new URL('../drizzle/0004_exchange_sandbox.sql',import.meta.url),'utf8');
function fixture(t,{migrateSandbox=true}={}){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());
  for(const name of ['0000_social','0001_profile','0002_device_sessions','0003_exchange'])db.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
  if(migrateSandbox)db.exec(sandboxSQL());
  const prepare=(sql,values=[])=>({sql,values,bind:(...next)=>prepare(sql,next),async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});
  const database={prepare};let clock=1000000,sequence=0,userSequence=0,keySequence=0;
  const service=createSandboxExchangeService({db:database,now:()=>clock,id:()=> 'sandbox-fixture-'+(++sequence)});
  const user=()=>{const id='user-'+(++userSequence);db.prepare('INSERT INTO profiles(id,auth_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,'fixture:'+id,'M-'+id,'旅人',clock,clock);return {id};};
  const api=async(owner,path,{method='GET',data}={})=>{const response=await handleSandboxExchangeRequest({db:database,user:owner,path,method,now:clock,data});return {status:response.status,headers:response.headers,data:await response.json()};};
  const post=(owner,path,data={})=>api(owner,path,{method:'POST',data:{expectedUserId:owner.id,...data}});
  const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  const refill=(owner,key='refill-key-'+(++keySequence))=>service.refill(owner.id,{idempotencyKey:key});
  const quote=(owner,points=1000)=>service.createQuote(owner.id,{points});
  const reserve=(owner,quoteId,key='request-key-'+(++keySequence))=>service.createRequest(owner.id,{quoteId,idempotencyKey:key});
  const liveSnapshot=()=>Object.fromEntries(LIVE_TABLES.map(name=>[name,db.prepare('SELECT * FROM '+name).all()]));
  const seedLive=owner=>{
    db.prepare('INSERT INTO exchange_reward_events(provider_id,event_id,user_id,points,receipt_ref,created_at) VALUES(?,?,?,?,?,?)').run('fixture-provider','seed',owner.id,500,'receipt-seed',clock);
    db.prepare('INSERT INTO exchange_quotes(id,user_id,provider_id,provider_quote_id,asset,points,receive_satoshis,fee_satoshis,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('live-quote',owner.id,'fixture-provider','provider-quote','BTC',200,150,5,clock,clock+300000);
    db.prepare('INSERT INTO exchange_requests(id,user_id,quote_id,idempotency_key,destination_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('live-request',owner.id,'live-quote','live-request-key','verified-fixture-destination','reserved',clock,clock);
  };
  const invariant=owner=>{
    const a=db.prepare('SELECT * FROM exchange_sandbox_accounts WHERE user_id=?').get(owner.id)||{confirmed_points:0,reserved_points:0};
    const l=db.prepare('SELECT coalesce(sum(points_delta),0) confirmed,coalesce(sum(reserved_delta),0) reserved FROM exchange_sandbox_ledger WHERE user_id=?').get(owner.id);
    const r=db.prepare("SELECT coalesce(sum(q.points),0) total FROM exchange_sandbox_requests r JOIN exchange_sandbox_quotes q ON q.id=r.quote_id WHERE r.user_id=? AND r.status='reserved'").get(owner.id);
    assert.equal(a.confirmed_points,l.confirmed);assert.equal(a.reserved_points,l.reserved);assert.equal(a.reserved_points,r.total);assert.ok(a.reserved_points>=0&&a.reserved_points<=a.confirmed_points);assert.ok(a.confirmed_points<=POLICY.balanceLimitPoints);
  };
  return {db,database,service,user,api,post,count,refill,quote,reserve,liveSnapshot,seedLive,invariant,time:()=>clock,setTime:value=>{clock=value;},advance:(ms=POLICY.refillCooldownMs)=>{clock+=ms;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code,'expected '+code);
const markers=(value,user)=>{assert.equal(value.userId,user.id);assert.equal(value.mode,'sandbox');assert.equal(value.network,'simulation');assert.equal(value.realValue,false);};

test('sandbox migration preserves existing live balances, reservations and ledger; state starts empty',async t=>{
  const f=fixture(t,{migrateSandbox:false}),a=f.user();f.seedLive(a);const before=f.liveSnapshot();f.db.exec(sandboxSQL());
  assert.deepEqual(f.liveSnapshot(),before);
  const response=await f.api(a,'/exchange/sandbox');assert.equal(response.status,200);markers(response.data,a);
  assert.deepEqual(response.data.balance,{confirmedPoints:0,availablePoints:0,reservedPoints:0});assert.deepEqual(response.data.requests,[]);assert.deepEqual(response.data.policy,POLICY);assert.equal(response.data.serverTime,f.time());assert.equal(response.data.destination,'検証用の受取先');assert.equal(f.count('exchange_sandbox_accounts'),0);f.invariant(a);
});

test('refill always credits fixed valueless points, ignores forged money and never touches live tables',async t=>{
  const f=fixture(t),a=f.user();f.seedLive(a);const before=f.liveSnapshot();
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('sandbox must not access any network');};t.after(()=>{globalThis.fetch=originalFetch;});
  const result=await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'fixed-refill-key',points:900000000000,money:900000000000,confirmedPoints:900000000000,mode:'live',realValue:true,network:'bitcoin',destination:'bc1-do-not-use',provider:'connected'});
  assert.equal(result.status,200);markers(result.data,a);assert.equal(result.data.balance.availablePoints,10000);
  const q=await f.post(a,'/exchange/sandbox/quote',{points:3000});markers(q.data,a);assert.equal(q.data.quote.receiveSatoshis,3000);assert.equal(q.data.quote.feeSatoshis,0);assert.equal(q.data.quote.network,'simulation');
  const request=await f.post(a,'/exchange/sandbox/requests',{quoteId:q.data.quote.id,idempotencyKey:'simulation-request'});markers(request.data,a);
  const paid=await f.post(a,'/exchange/sandbox/requests/'+request.data.request.id+'/complete');markers(paid.data,a);assert.equal(paid.data.request.status,'simulated_paid');assert.equal(paid.data.balance.confirmedPoints,7000);assert.equal(paid.data.request.destination,'検証用の受取先');assert.ok(!('txid' in paid.data.request));assert.ok(!('transactionId' in paid.data.request));
  f.advance();await f.refill(a);const q2=await f.quote(a,2000),r2=await f.reserve(a,q2.id);await f.service.cancelRequest(a.id,r2.request.id);
  assert.deepEqual(f.liveSnapshot(),before);f.invariant(a);
});

test('same refill key retried concurrently credits only once and distinct keys respect cooldown',async t=>{
  const f=fixture(t),a=f.user();
  const same=await Promise.all(Array.from({length:8},()=>f.refill(a,'same-refill-key')));
  assert.equal(same.filter(r=>!r.duplicate).length,1);assert.equal(f.count('exchange_sandbox_refills'),1);assert.equal(f.count('exchange_sandbox_ledger'),1);assert.equal((await f.service.getBalance(a.id)).confirmedPoints,10000);
  const blocked=await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'new-refill-key'});assert.equal(blocked.status,429);assert.equal(blocked.data.code,'sandbox_refill_cooldown');assert.equal(blocked.headers.get('Retry-After'),'2');
  f.advance(1499);await rejects(f.refill(a,'still-too-soon'),'sandbox_refill_cooldown');f.advance(1);
  const different=await Promise.allSettled(Array.from({length:6},(_,i)=>f.refill(a,'parallel-refill-'+i)));
  assert.equal(different.filter(r=>r.status==='fulfilled').length,1);for(const r of different.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'sandbox_refill_cooldown');
  assert.equal((await f.service.getBalance(a.id)).confirmedPoints,20000);f.invariant(a);
});

test('refill may repeat after cooldown, is bounded by the documented numeric cap, and never accepts a custom amount',async t=>{
  const f=fixture(t),a=f.user();for(let i=0;i<12;i++){await f.refill(a);f.advance();}assert.equal((await f.service.getBalance(a.id)).confirmedPoints,120000);f.invariant(a);
  // Set up only the boundary fixture; this is not a production funding path.
  f.db.prepare('UPDATE exchange_sandbox_accounts SET confirmed_points=? WHERE user_id=?').run(POLICY.balanceLimitPoints-10000,a.id);
  await f.refill(a);assert.equal((await f.service.getBalance(a.id)).confirmedPoints,POLICY.balanceLimitPoints);f.advance();
  await rejects(f.refill(a),'sandbox_balance_limit');assert.equal((await f.service.getBalance(a.id)).confirmedPoints,POLICY.balanceLimitPoints);
  assert.throws(()=>f.db.exec('UPDATE exchange_sandbox_accounts SET confirmed_points=1000000000001'));
  assert.throws(()=>f.db.exec('UPDATE exchange_sandbox_accounts SET confirmed_points=1.5'));
});

test('quote is fixed at one simulated sat per MR, integer bounded and expires after exactly five minutes',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);
  for(const points of [0,-1,999,1000.5,NaN,Infinity,'1000',1000001])await rejects(f.quote(a,points),'sandbox_invalid_amount');
  const q=await f.quote(a,2500);assert.equal(q.receiveSatoshis,2500);assert.equal(q.feeSatoshis,0);assert.equal(q.expiresAt-q.createdAt,300000);assert.equal(q.realValue,false);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);
  await rejects(f.quote(a,11000),'sandbox_insufficient_balance');f.setTime(q.expiresAt);
  await rejects(f.reserve(a,q.id),'sandbox_quote_expired');assert.equal(f.count('exchange_sandbox_requests'),0);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);
  assert.throws(()=>f.db.prepare("INSERT INTO exchange_sandbox_requests(id,user_id,quote_id,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,'reserved',?,?)").run('expired-sql',a.id,q.id,'expired-sql-key',f.time(),f.time()),/sandbox_quote_expired/);f.invariant(a);
});

test('request retry reserves once; replaying another quote conflicts and quote reuse is rejected',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);const q=await f.quote(a,4000);
  const requests=await Promise.all(Array.from({length:8},()=>f.reserve(a,q.id,'same-request-key')));
  assert.equal(requests.filter(r=>!r.duplicate).length,1);assert.equal(new Set(requests.map(r=>r.request.id)).size,1);assert.equal(f.count('exchange_sandbox_requests'),1);assert.equal((await f.service.getBalance(a.id)).reservedPoints,4000);
  await rejects(f.reserve(a,q.id,'different-key'),'sandbox_quote_used');const q2=await f.quote(a,1000);
  await rejects(f.reserve(a,q2.id,'same-request-key'),'sandbox_idempotency_conflict');
  assert.equal((await f.service.getBalance(a.id)).availablePoints,6000);f.invariant(a);
});

test('competing requests cannot reserve more points than the available balance',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);const quotes=await Promise.all(Array.from({length:4},()=>f.quote(a,8000)));
  const results=await Promise.allSettled(quotes.map((q,i)=>f.reserve(a,q.id,'overspend-key-'+i)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const result of results.filter(r=>r.status==='rejected'))assert.equal(result.reason.code,'sandbox_insufficient_balance');
  assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:10000,availablePoints:2000,reservedPoints:8000});assert.equal(f.count('exchange_sandbox_requests'),1);f.invariant(a);
});

test('explicit simulated completion consumes reserved points exactly once across concurrent retries',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);const q=await f.quote(a,3500),r=await f.reserve(a,q.id);
  assert.equal(r.request.status,'reserved');assert.equal(r.request.canCancel,true);assert.equal(r.request.canComplete,true);
  const results=await Promise.all(Array.from({length:8},()=>f.service.completeRequest(a.id,r.request.id)));
  assert.equal(results.filter(v=>!v.duplicate).length,1);for(const v of results){assert.equal(v.request.status,'simulated_paid');assert.equal(v.request.canCancel,false);assert.equal(v.request.canComplete,false);assert.equal(v.request.realValue,false);}
  assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:6500,availablePoints:6500,reservedPoints:0});assert.equal(f.db.prepare("SELECT COUNT(*) n FROM exchange_sandbox_ledger WHERE kind='simulated_payment'").get().n,1);
  assert.equal((await f.service.completeRequest(a.id,r.request.id)).duplicate,true);await rejects(f.service.cancelRequest(a.id,r.request.id),'sandbox_request_state');f.invariant(a);
});

test('cancellation returns the reservation exactly once and completed/cancelled requests cannot be reopened',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);const q=await f.quote(a,4500),r=await f.reserve(a,q.id);
  const results=await Promise.all(Array.from({length:8},()=>f.service.cancelRequest(a.id,r.request.id)));
  assert.equal(results.filter(v=>!v.duplicate).length,1);assert.equal((await f.service.getRequest(a.id,r.request.id)).status,'cancelled');assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:10000,availablePoints:10000,reservedPoints:0});
  await rejects(f.service.completeRequest(a.id,r.request.id),'sandbox_request_state');assert.throws(()=>f.db.exec("UPDATE exchange_sandbox_requests SET status='reserved'"),/sandbox_invalid_transition/);f.invariant(a);
});

test('concurrent cancel and complete choose one terminal result without double release or debit',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);
  for(const order of ['complete-first','cancel-first']){
    const q=await f.quote(a,2500),r=await f.reserve(a,q.id),before=await f.service.getBalance(a.id);
    const actions=order==='complete-first'?[()=>f.service.completeRequest(a.id,r.request.id),()=>f.service.cancelRequest(a.id,r.request.id)]:[()=>f.service.cancelRequest(a.id,r.request.id),()=>f.service.completeRequest(a.id,r.request.id)];
    const outcomes=await Promise.allSettled(actions.map(fn=>fn()));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const rejected=outcomes.find(x=>x.status==='rejected');assert.equal(rejected.reason.code,'sandbox_request_state');
    const final=await f.service.getRequest(a.id,r.request.id),after=await f.service.getBalance(a.id);assert.ok(['cancelled','simulated_paid'].includes(final.status));assert.equal(after.reservedPoints,0);assert.equal(after.confirmedPoints,before.confirmedPoints-(final.status==='simulated_paid'?2500:0));f.invariant(a);
  }
});

test('every read and mutation is scoped to its owner; payload owner cannot select another account',async t=>{
  const f=fixture(t),a=f.user(),b=f.user();await f.refill(a,'shared-refill-key');await f.refill(b,'shared-refill-key');
  const q=await f.quote(a,4000);await rejects(f.reserve(b,q.id),'sandbox_quote_not_found');const r=await f.reserve(a,q.id);
  await rejects(f.service.getRequest(b.id,r.request.id),'sandbox_request_not_found');await rejects(f.service.cancelRequest(b.id,r.request.id),'sandbox_request_not_found');await rejects(f.service.completeRequest(b.id,r.request.id),'sandbox_request_not_found');
  const forbidden=await f.post(b,'/exchange/sandbox/requests/'+r.request.id+'/complete',{userId:a.id});assert.equal(forbidden.status,404);
  const snapshot=await f.api(b,'/exchange/sandbox');markers(snapshot.data,b);assert.deepEqual(snapshot.data.requests,[]);assert.equal(snapshot.data.balance.confirmedPoints,10000);assert.equal((await f.service.getBalance(a.id)).reservedPoints,4000);f.invariant(a);f.invariant(b);
});

test('ledger insertion failures roll back refill, reservation, cancellation and simulated payment',async t=>{
  const f=fixture(t),a=f.user();
  const block=kind=>f.db.exec("CREATE TRIGGER fixture_sandbox_failure BEFORE INSERT ON exchange_sandbox_ledger WHEN NEW.kind='"+kind+"' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  const unblock=()=>f.db.exec('DROP TRIGGER fixture_sandbox_failure');
  block('credit');await rejects(f.refill(a),'sandbox_storage_unavailable');assert.equal(f.count('exchange_sandbox_refills'),0);assert.equal(f.count('exchange_sandbox_accounts'),0);assert.equal(f.count('exchange_sandbox_ledger'),0);unblock();
  await f.refill(a);const q=await f.quote(a,2000);block('reserve');await rejects(f.reserve(a,q.id),'sandbox_storage_unavailable');assert.equal(f.count('exchange_sandbox_requests'),0);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);unblock();
  const r=await f.reserve(a,q.id);block('release');await rejects(f.service.cancelRequest(a.id,r.request.id),'sandbox_storage_unavailable');assert.equal((await f.service.getRequest(a.id,r.request.id)).status,'reserved');assert.equal((await f.service.getBalance(a.id)).reservedPoints,2000);unblock();
  block('simulated_payment');await rejects(f.service.completeRequest(a.id,r.request.id),'sandbox_storage_unavailable');assert.equal((await f.service.getRequest(a.id,r.request.id)).status,'reserved');assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:10000,availablePoints:8000,reservedPoints:2000});unblock();
  await f.service.completeRequest(a.id,r.request.id);assert.equal((await f.service.getBalance(a.id)).confirmedPoints,8000);f.invariant(a);
});

test('SQL rejects forged simulation data and makes quotes, events and ledger immutable',async t=>{
  const f=fixture(t),a=f.user();await f.refill(a);const q=await f.quote(a,2000),r=await f.reserve(a,q.id);
  for(const sql of [
    'UPDATE exchange_sandbox_accounts SET reserved_points=10001',
    'UPDATE exchange_sandbox_accounts SET confirmed_points=-1',
    'UPDATE exchange_sandbox_refills SET points=90000',
    'DELETE FROM exchange_sandbox_refills',
    'UPDATE exchange_sandbox_quotes SET points=1000',
    'DELETE FROM exchange_sandbox_quotes',
    "UPDATE exchange_sandbox_requests SET user_id='someone-else'",
    "UPDATE exchange_sandbox_requests SET status='paid'",
    'DELETE FROM exchange_sandbox_requests',
    'UPDATE exchange_sandbox_ledger SET points_delta=20000',
    'DELETE FROM exchange_sandbox_ledger'
  ])assert.throws(()=>f.db.exec(sql),sql);
  assert.equal((await f.service.getRequest(a.id,r.request.id)).status,'reserved');f.invariant(a);
});

test('all successful HTTP mutations include the simulation marker, owner and fresh balance',async t=>{
  const f=fixture(t),a=f.user();
  const refill=await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'http-refill-key'});assert.equal(refill.status,200);markers(refill.data,a);
  const q=await f.post(a,'/exchange/sandbox/quote',{points:1500});assert.equal(q.status,200);markers(q.data,a);assert.ok(q.data.balance);
  const request=await f.post(a,'/exchange/sandbox/requests',{quoteId:q.data.quote.id,idempotencyKey:'http-reserve-key'});assert.equal(request.status,200);markers(request.data,a);assert.equal(request.data.balance.reservedPoints,1500);
  const cancelled=await f.post(a,'/exchange/sandbox/requests/'+request.data.request.id+'/cancel');assert.equal(cancelled.status,200);markers(cancelled.data,a);assert.equal(cancelled.data.balance.reservedPoints,0);
  const q2=await f.post(a,'/exchange/sandbox/quote',{points:1000}),r2=await f.post(a,'/exchange/sandbox/requests',{quoteId:q2.data.quote.id,idempotencyKey:'http-reserve-key-2'});
  const completed=await f.post(a,'/exchange/sandbox/requests/'+r2.data.request.id+'/complete');assert.equal(completed.status,200);markers(completed.data,a);assert.equal(completed.data.balance.confirmedPoints,9000);
  const state=await f.api(a,'/exchange/sandbox');markers(state.data,a);assert.equal(state.data.requests.length,2);assert.equal((await f.api(a,'/exchange/sandbox/missing')).status,404);assert.equal((await f.post(a,'/exchange/sandbox/credit',{points:1000000})).status,404);assert.equal((await f.post(a,'/exchange/sandbox/refill',{})).data.code,'sandbox_invalid_input');f.invariant(a);
});
