// Real SQLite, fake verified-provider receipts. No funds or external APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSocial} from '../worker/social.js';
import {createExchangeService} from '../worker/exchange.js';

function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());
  for(const file of ['0000_social','0001_profile','0002_device_sessions','0003_exchange','0004_exchange_sandbox','0005_reward_treasury'])db.exec(readFileSync(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8'));
  const prepare=(sql,values=[])=>({sql,values,bind:(...next)=>prepare(sql,next),async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}});
  const database={prepare,async batch(statements){db.exec('BEGIN');try{const results=await Promise.all(statements.map(s=>s.run()));db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  // A string flag or env-bound object cannot activate the production handler.
  const env={DB:database,EXCHANGE_ENABLED:'true',EXCHANGE_PROVIDER:'test-provider',PROVIDER:{quote(){throw new Error('HTTP must not call a provider');}}};
  async function api(route,{cookie,method='GET',data,headers={}}={}){
    const h={...headers};if(cookie)h.Cookie=cookie;if(data!==undefined)h['Content-Type']='application/json';
    const result=await handleSocial(new Request('https://www.omoji-z.com/api/social'+route,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data)}),env);
    return {status:result.status,data:await result.json(),cookie:result.headers.get('Set-Cookie')?.split(';')[0]};
  }
  const connect=async()=>{const r=await api('/me');assert.equal(r.status,200);return {cookie:r.cookie,id:r.data.user.id};};
  const post=(user,route,data={},headers={})=>api(route,{cookie:user.cookie,method:'POST',headers,data:{expectedUserId:user.id,...data}});
  let clock=1000000,sequence=0,quoteSequence=0;
  const receipts=new Map(),provider={id:'fixture-provider',async verifyRewardEvent(envelope){return receipts.get(envelope?.reference)||null;},async quote({userId,asset,points}){return {providerId:this.id,quoteId:'provider-quote-'+(++quoteSequence),asset,points,receiveSatoshis:321,feeSatoshis:7,expiresAt:clock+60000};},async verifyDestination({userId,asset,reference}){return {verified:true,userId,asset,reference};}};
  const service=createExchangeService({db:database,provider,now:()=>clock,id:()=> 'fixture-'+(++sequence)});
  const receipt=(userId,points,eventId='reward-'+receipts.size)=>{const reference='receipt-'+receipts.size;receipts.set(reference,{verified:true,confirmed:true,providerId:provider.id,eventId,userId,points,receiptRef:reference});return {reference,points:999999999999,userId:'forged-client-owner'};};
  const credit=(userId,points,eventId)=>service.creditConfirmedReward(receipt(userId,points,eventId));
  const quote=(userId,points)=>service.createQuote(userId,{points,asset:'BTC'});
  const reserve=(userId,quoteId,key='request-key-'+sequence)=>service.createRequest(userId,{quoteId,idempotencyKey:key,destinationRef:'verified-destination'});
  const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  const invariant=userId=>{
    const account=db.prepare('SELECT * FROM exchange_accounts WHERE user_id=?').get(userId)||{confirmed_points:0,reserved_points:0};
    const sums=db.prepare('SELECT coalesce(sum(points_delta),0) confirmed,coalesce(sum(reserved_delta),0) reserved FROM exchange_ledger WHERE user_id=?').get(userId);
    assert.equal(account.confirmed_points,sums.confirmed);assert.equal(account.reserved_points,sums.reserved);assert.ok(account.reserved_points>=0&&account.reserved_points<=account.confirmed_points);
  };
  return {db,database,env,api,connect,post,service,provider,receipts,receipt,credit,quote,reserve,count,invariant,setTime:value=>{clock=value;},time:()=>clock};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code,'expected '+code);

test('production starts at zero and stays unavailable despite flags or client game money',async t=>{
  const f=fixture(t),a=await f.connect(),snapshot=await f.api('/exchange',{cookie:a.cookie});
  assert.equal(snapshot.status,200);assert.equal(snapshot.data.userId,a.id);assert.equal(snapshot.data.available,false);assert.equal(snapshot.data.mode,'preparing');assert.equal(snapshot.data.asset,'BTC');assert.deepEqual(snapshot.data.balance,{confirmedPoints:0,availablePoints:0,reservedPoints:0});assert.deepEqual(snapshot.data.requests,[]);assert.match(snapshot.data.message,/実際の交換・送金はできません/);
  assert.equal(f.count('exchange_accounts'),0,'reading does not invent an initial credit');
  for(const route of ['/exchange/quote','/exchange/requests','/exchange/requests/fake/cancel']){
    const result=await f.post(a,route,{points:12000,money:999999999,gameMoney:12000,balance:999999,confirmedPoints:99999,provider:'connected',enabled:true,asset:'ETH',save:{money:999999}});
    assert.equal(result.status,503);assert.equal(result.data.code,'exchange_unavailable');
  }
  for(const route of ['/exchange/credit','/exchange/reward','/exchange/provider/webhook'])assert.equal((await f.post(a,route,{points:12000,verified:true,confirmed:true})).status,404);
  assert.equal(f.count('exchange_accounts'),0);assert.equal(f.count('exchange_reward_events'),0);assert.equal(f.count('exchange_quotes'),0);assert.equal(f.count('exchange_requests'),0);assert.equal(f.count('exchange_ledger'),0);
});

test('public sandbox completes the rehearsal while live balances and real funding remain zero',async t=>{
  const f=fixture(t),a=await f.connect();
  const initial=await f.api('/exchange',{cookie:a.cookie});
  assert.equal(initial.data.program.canPay,false);assert.equal(initial.data.program.policyStatus,'draft');
  assert.equal(initial.data.program.region,'JP');assert.equal(initial.data.program.minimumAge,18);
  assert.equal(initial.data.program.treasury.confirmedSatoshis,0);
  assert.equal(initial.data.program.readiness.find(x=>x.code==='destination').status,'deferred');
  const refill=await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'public-refill-001',money:Infinity,points:999999999,mode:'live'});
  assert.equal(refill.status,200);assert.equal(refill.data.balance.availablePoints,10000);
  assert.equal(refill.data.mode,'sandbox');assert.equal(refill.data.network,'simulation');assert.equal(refill.data.realValue,false);
  const quote=await f.post(a,'/exchange/sandbox/quote',{points:1000});assert.equal(quote.status,200);
  const body={quoteId:quote.data.quote.id,idempotencyKey:'public-request-001'};
  const created=await f.post(a,'/exchange/sandbox/requests',body);assert.equal(created.status,200);
  const replay=await f.post(a,'/exchange/sandbox/requests',body);assert.equal(replay.data.request.id,created.data.request.id);assert.equal(replay.data.duplicate,true);
  const finished=await f.post(a,'/exchange/sandbox/requests/'+created.data.request.id+'/complete');
  assert.equal(finished.status,200);assert.equal(finished.data.request.status,'simulated_paid');assert.equal(finished.data.balance.confirmedPoints,9000);assert.equal(finished.data.balance.reservedPoints,0);
  const live=await f.api('/exchange',{cookie:a.cookie});assert.equal(live.data.balance.confirmedPoints,0);assert.equal(live.data.program.treasury.confirmedSatoshis,0);assert.equal(live.data.available,false);
  for(const table of ['exchange_accounts','exchange_reward_events','exchange_quotes','exchange_requests','exchange_ledger'])assert.equal(f.count(table),0,table+' must remain unchanged');
  assert.equal((await f.post(a,'/exchange/requests',{quoteId:quote.data.quote.id,idempotencyKey:'no-mode-crossing'})).status,503);
});

test('sandbox HTTP retains cookie, owner and origin protection for every mutation',async t=>{
  const f=fixture(t),a=await f.connect(),b=await f.connect();
  assert.equal((await f.api('/exchange/sandbox')).status,401);
  assert.equal((await f.api('/exchange/sandbox/refill',{cookie:a.cookie,method:'POST',data:{idempotencyKey:'missing-owner'}})).status,409);
  assert.equal((await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'cross-origin-001'},{Origin:'https://attacker.test'})).status,403);
  assert.equal((await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'wrong-owner-001'},{'X-Machi-User-Id':b.id})).status,409);
  await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'owner-refill-001'});
  const q=await f.post(a,'/exchange/sandbox/quote',{points:1000});
  assert.equal((await f.post(b,'/exchange/sandbox/requests',{quoteId:q.data.quote.id,idempotencyKey:'other-owner-001'})).status,404);
  const own=await f.post(a,'/exchange/sandbox/requests',{quoteId:q.data.quote.id,idempotencyKey:'own-request-001'});
  assert.equal((await f.post(b,'/exchange/sandbox/requests/'+own.data.request.id+'/complete')).status,404);
  const other=await f.api('/exchange/sandbox?userId='+a.id,{cookie:b.cookie});assert.equal(other.data.userId,b.id);assert.equal(other.data.balance.confirmedPoints,0);
});

test('sandbox write attempts are limited independently of valueless balances',async t=>{
  t.mock.method(Date,'now',()=>1795615200000);
  const f=fixture(t),a=await f.connect();
  for(let i=0;i<60;i++)assert.equal((await f.post(a,'/exchange/sandbox/not-an-action')).status,404);
  const limited=await f.post(a,'/exchange/sandbox/refill',{idempotencyKey:'limited-refill-001'});
  assert.equal(limited.status,429);assert.equal(limited.data.code,'exchange_rate_limit');
  assert.equal((await f.api('/exchange/sandbox',{cookie:a.cookie})).status,200,'reading remains available to reconcile previous actions');
});

test('HTTP keeps existing cookie identity, expected owner and CSRF guard; owner query cannot select another balance',async t=>{
  const f=fixture(t),a=await f.connect(),b=await f.connect();await f.credit(a.id,500);
  assert.equal((await f.api('/exchange')).status,401);assert.equal((await f.api('/exchange',{headers:{'oai-authenticated-user-id':a.id}})).status,401);
  assert.equal((await f.api('/exchange',{cookie:b.cookie,headers:{'X-Machi-User-Id':a.id}})).data.code,'session_identity_changed');
  assert.equal((await f.post(b,'/exchange/quote',{expectedUserId:a.id})).status,409);assert.equal((await f.api('/exchange/requests',{cookie:b.cookie,method:'POST',data:{points:1}})).status,409);
  assert.equal((await f.post(a,'/exchange/quote',{}, {Origin:'https://attacker.test'})).status,403);
  const other=await f.api('/exchange?userId='+a.id,{cookie:b.cookie});assert.equal(other.data.userId,b.id);assert.equal(other.data.balance.availablePoints,0);
  const funded=await f.api('/exchange',{cookie:a.cookie});assert.equal(funded.data.balance.confirmedPoints,500);assert.equal(funded.data.available,false);assert.equal((await f.post(a,'/exchange/requests',{points:1})).status,503);f.invariant(a.id);
});

test('only verified confirmed provider receipt values can credit; simultaneous delivery is idempotent',async t=>{
  const f=fixture(t),a=await f.connect(),envelope=f.receipt(a.id,700,'event-one');
  await rejects(f.service.creditConfirmedReward({reference:'unknown',verified:true,confirmed:true,points:90000,userId:a.id}),'exchange_reward_unverified');
  const results=await Promise.all(Array.from({length:8},()=>f.service.creditConfirmedReward(envelope)));
  assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(f.count('exchange_reward_events'),1);assert.equal(f.count('exchange_ledger'),1);assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:700,availablePoints:700,reservedPoints:0});
  f.receipts.set('conflict',{...f.receipts.get(envelope.reference),points:701});await rejects(f.service.creditConfirmedReward({reference:'conflict'}),'exchange_reward_conflict');
  const b=await f.connect();f.receipts.set('other-owner',{...f.receipts.get(envelope.reference),userId:b.id});await rejects(f.service.creditConfirmedReward({reference:'other-owner'}),'exchange_reward_conflict');assert.equal((await f.service.getBalance(b.id)).confirmedPoints,0);f.invariant(a.id);
});

test('unconfirmed, noninteger or overflowing reward events leave the account and ledger unchanged',async t=>{
  const f=fixture(t),a=await f.connect();
  for(const points of [0,-1,1.5,NaN,Infinity,'100',1000000000001])await rejects(f.credit(a.id,points),'exchange_invalid_amount');
  for(const fields of [{verified:false},{confirmed:false},{providerId:'unrecognized-provider'}]){const envelope=f.receipt(a.id,2);Object.assign(f.receipts.get(envelope.reference),fields);await rejects(f.service.creditConfirmedReward(envelope),'exchange_reward_unverified');}
  assert.equal(f.count('exchange_reward_events'),0);await f.credit(a.id,1000000000000,'at-limit');await rejects(f.credit(a.id,1,'above-limit'),'exchange_balance_limit');assert.equal(f.count('exchange_reward_events'),1);assert.equal(f.count('exchange_ledger'),1);f.invariant(a.id);
});

test('quotes use provider integer units and real expiry without an invented conversion rate',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,1000);const q=await f.quote(a.id,400);
  assert.equal(q.receiveSatoshis,321);assert.equal(q.feeSatoshis,7);assert.equal(q.expiresAt,f.time()+60000);assert.equal(q.points,400);assert.equal(f.count('exchange_quotes'),1);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);
  await rejects(f.service.createQuote(a.id,{points:1,asset:'ETH'}),'exchange_asset_unsupported');await rejects(f.quote(a.id,1001),'exchange_insufficient_balance');
  const original=f.provider.quote;for(const patch of [{providerId:'wrong'},{asset:'ETH'},{points:399},{receiveSatoshis:1.5},{feeSatoshis:-1},{expiresAt:f.time()},{expiresAt:f.time()+16*60000}]){
    f.provider.quote=async input=>({...await original.call(f.provider,input),...patch});await assert.rejects(f.quote(a.id,400));assert.equal(f.count('exchange_quotes'),1);
  }f.provider.quote=original;f.invariant(a.id);
});

test('repeated request IDs, repeated quotes and mismatched retry payloads cannot reserve twice',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,1000);const q=await f.quote(a.id,400);
  const results=await Promise.all(Array.from({length:6},()=>f.reserve(a.id,q.id,'same-request-key')));assert.equal(new Set(results.map(r=>r.request.id)).size,1);assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(f.count('exchange_requests'),1);assert.equal((await f.service.getBalance(a.id)).reservedPoints,400);
  await rejects(f.reserve(a.id,q.id,'other-request-key'),'exchange_quote_used');const q2=await f.quote(a.id,100);await rejects(f.reserve(a.id,q2.id,'same-request-key'),'exchange_idempotency_conflict');
  await rejects(f.service.createRequest(a.id,{quoteId:q.id,idempotencyKey:'same-request-key',destinationRef:'other-destination'}),'exchange_idempotency_conflict');
  assert.equal(f.count('exchange_requests'),1);assert.equal(f.count('exchange_ledger'),2);f.invariant(a.id);
});

test('concurrent separate reservations cannot overspend and concurrent cancellation releases exactly once',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,1000);const quotes=await Promise.all(Array.from({length:4},()=>f.quote(a.id,800)));
  const results=await Promise.allSettled(quotes.map((q,i)=>f.reserve(a.id,q.id,'concurrent-key-'+i))),winners=results.filter(r=>r.status==='fulfilled');
  assert.equal(winners.length,1);for(const failed of results.filter(r=>r.status==='rejected'))assert.equal(failed.reason.code,'exchange_insufficient_balance');assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:1000,availablePoints:200,reservedPoints:800});assert.equal(f.count('exchange_requests'),1);f.invariant(a.id);
  const requestId=winners[0].value.request.id,cancels=await Promise.all(Array.from({length:6},()=>f.service.cancelRequest(a.id,requestId)));assert.equal(cancels.filter(c=>!c.duplicate).length,1);assert.ok(cancels.every(c=>c.request.status==='cancelled'));
  assert.deepEqual(await f.service.getBalance(a.id),{confirmedPoints:1000,availablePoints:1000,reservedPoints:0});assert.equal(f.count('exchange_ledger'),3);assert.equal((await f.service.cancelRequest(a.id,requestId)).duplicate,true);f.invariant(a.id);
});

test('expiry is checked again at atomic reservation after asynchronous destination verification',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,1000);const q=await f.quote(a.id,400),original=f.provider.verifyDestination;
  f.provider.verifyDestination=async input=>{f.setTime(q.expiresAt);return original(input);};await rejects(f.reserve(a.id,q.id),'exchange_quote_expired');assert.equal(f.count('exchange_requests'),0);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);f.invariant(a.id);
  f.provider.verifyDestination=()=>{throw new Error('expired quote must not reach destination verification');};await rejects(f.reserve(a.id,q.id),'exchange_quote_expired');
});

test('quotes, request history, cancellation and verified destinations stay bound to one device owner',async t=>{
  const f=fixture(t),a=await f.connect(),b=await f.connect();await f.credit(a.id,1000);await f.credit(b.id,300);const q=await f.quote(a.id,400);
  await rejects(f.reserve(b.id,q.id),'exchange_quote_not_found');const verify=f.provider.verifyDestination;
  f.provider.verifyDestination=async input=>({...await verify(input),userId:b.id});await rejects(f.reserve(a.id,q.id),'exchange_destination_unverified');f.provider.verifyDestination=verify;
  const saved=await f.reserve(a.id,q.id);await rejects(f.service.getRequest(b.id,saved.request.id),'exchange_request_not_found');await rejects(f.service.cancelRequest(b.id,saved.request.id),'exchange_request_not_found');assert.deepEqual(await f.service.getRequests(b.id),[]);
  const history=await f.api('/exchange/requests?userId='+a.id,{cookie:b.cookie});assert.deepEqual(history.data,{userId:b.id,requests:[]});const own=await f.api('/exchange/requests',{cookie:a.cookie});assert.equal(own.data.requests.length,1);assert.equal(own.data.requests[0].id,saved.request.id);
  for(const privateValue of ['verified-destination','fixture-provider','idempotency_key','destination_ref','provider_quote_id'])assert.ok(!JSON.stringify(own.data).includes(privateValue));f.invariant(a.id);f.invariant(b.id);
});

test('SQLite constraints and immutable audit rows prevent fractional balances and reopened cancellations',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,1000);const q=await f.quote(a.id,400),saved=await f.reserve(a.id,q.id);
  for(const sql of ['UPDATE exchange_accounts SET confirmed_points=-1','UPDATE exchange_accounts SET confirmed_points=1.5','UPDATE exchange_accounts SET reserved_points=1001','UPDATE exchange_ledger SET points_delta=999','DELETE FROM exchange_ledger','DELETE FROM exchange_reward_events','UPDATE exchange_quotes SET points=1','UPDATE exchange_requests SET user_id=\'forged\''])assert.throws(()=>f.db.exec(sql),sql);
  await f.service.cancelRequest(a.id,saved.request.id);assert.throws(()=>f.db.exec("UPDATE exchange_requests SET status='reserved'"));assert.throws(()=>f.db.exec('DELETE FROM exchange_requests'));assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);f.invariant(a.id);
});

test('ledger insert failures roll back credit, reservation and cancellation as whole statements',async t=>{
  const f=fixture(t),a=await f.connect();
  const block=kind=>f.db.exec("CREATE TRIGGER fixture_ledger_failure BEFORE INSERT ON exchange_ledger WHEN NEW.kind='"+kind+"' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");
  const unblock=()=>f.db.exec('DROP TRIGGER fixture_ledger_failure');
  block('credit');await rejects(f.credit(a.id,1000),'exchange_storage_unavailable');assert.equal(f.count('exchange_accounts'),0);assert.equal(f.count('exchange_reward_events'),0);assert.equal(f.count('exchange_ledger'),0);unblock();
  await f.credit(a.id,1000);const q=await f.quote(a.id,400);block('reserve');await rejects(f.reserve(a.id,q.id),'exchange_storage_unavailable');assert.equal(f.count('exchange_requests'),0);assert.equal((await f.service.getBalance(a.id)).reservedPoints,0);unblock();
  const saved=await f.reserve(a.id,q.id);block('release');await rejects(f.service.cancelRequest(a.id,saved.request.id),'exchange_storage_unavailable');assert.equal((await f.service.getRequest(a.id,saved.request.id)).status,'reserved');assert.equal((await f.service.getBalance(a.id)).reservedPoints,400);unblock();
  await f.service.cancelRequest(a.id,saved.request.id);f.invariant(a.id);
});

test('no-provider domain cannot create credit, quote or request even when a confirmed account exists',async t=>{
  const f=fixture(t),a=await f.connect();await f.credit(a.id,500);const closed=createExchangeService({db:f.database,provider:null});
  await rejects(closed.creditConfirmedReward({verified:true,confirmed:true,userId:a.id,points:99}),'exchange_unavailable');await rejects(closed.createQuote(a.id,{points:1}),'exchange_unavailable');await rejects(closed.createRequest(a.id,{}),'exchange_unavailable');assert.deepEqual(await closed.getBalance(a.id),{confirmedPoints:500,availablePoints:500,reservedPoints:0});f.invariant(a.id);
});
