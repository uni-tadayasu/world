// Real SQLite with explicit test-only verifier fixtures. No wallet or transfers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createRewardTreasuryService,REWARD_TREASURY_POLICY} from '../worker/reward-treasury.js';

const outpoint=(n=1,vout=0)=>n.toString(16).padStart(64,'0')+':'+vout;
const rejects=(promise,code,status)=>assert.rejects(promise,error=>error.code===code&&(status===undefined||error.status===status),'expected '+code);

function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());
  for(const name of ['0000_social','0001_profile','0002_device_sessions','0003_exchange','0005_reward_treasury'])db.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
  let beforeFirst=null;
  const prepare=(sql,values=[])=>({bind:(...next)=>prepare(sql,next),async first(){if(beforeFirst)await beforeFirst(sql,values);return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});
  const database={prepare};let clock=Date.parse('2026-11-25T03:00:00Z'),sequence=0,userSequence=0;
  const receipts=new Map(),beneficiaries=new Map();
  const verifier={id:'treasury-fixture',async verifyFundingReceipt(envelope){return receipts.get(envelope?.reference)||null;},async verifyBeneficiary({beneficiaryRef}){return beneficiaries.get(beneficiaryRef)||null;}};
  const makeService=(overrides={})=>createRewardTreasuryService({db:database,verifier,now:()=>clock,id:()=> 'allocation-'+(++sequence),...overrides});
  const service=makeService();
  const user=()=>{const uid='device-'+(++userSequence);db.prepare('INSERT INTO profiles(id,auth_id,code,created_at,updated_at) VALUES(?,?,?,?,?)').run(uid,'auth-'+uid,'code-'+uid,clock,clock);return uid;};
  const receipt=(amountSatoshis,patch={})=>{
    const reference='funding-envelope-'+receipts.size;
    receipts.set(reference,{verified:true,providerId:verifier.id,asset:'BTC',network:'bitcoin',confirmations:6,receiptId:outpoint(receipts.size+1),amountSatoshis,destinationRef:'verified-treasury-wallet',...patch});
    return {reference,verified:true,amountSatoshis:999999999999,confirmations:999,receiptId:outpoint(999),destinationRef:'untrusted-client-wallet'};
  };
  const fund=(amount,patch)=>service.ingestConfirmedFunding(receipt(amount,patch));
  const beneficiary=(userId,subjectId='person-'+userId,patch={})=>{
    const beneficiaryRef='verified-beneficiary-'+beneficiaries.size;
    beneficiaries.set(beneficiaryRef,{verified:true,providerId:verifier.id,userId,beneficiaryRef,subjectId,country:'JP',ageOver18:true,expiresAt:clock+7*86400000,...patch});
    return {userId,beneficiaryRef};
  };
  const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  const points=userId=>db.prepare('SELECT confirmed_points FROM exchange_accounts WHERE user_id=?').get(userId)?.confirmed_points||0;
  const invariant=()=>{
    const pool=db.prepare('SELECT * FROM reward_treasury_pool WHERE id=1').get();
    const receiptsTotal=db.prepare('SELECT coalesce(sum(amount_satoshis),0) n FROM reward_treasury_funding').get().n;
    const allocationTotal=db.prepare('SELECT coalesce(sum(amount_satoshis),0) n FROM reward_treasury_allocations').get().n;
    const audit=db.prepare('SELECT coalesce(sum(confirmed_delta),0) c,coalesce(sum(allocated_delta),0) a FROM reward_treasury_audit').get();
    const trustedRewards=db.prepare("SELECT coalesce(sum(points),0) n FROM exchange_reward_events WHERE provider_id='machi-treasury'").get().n;
    assert.equal(pool.confirmed_satoshis,receiptsTotal);assert.equal(pool.confirmed_satoshis,audit.c);
    assert.equal(pool.allocated_satoshis,allocationTotal);assert.equal(pool.allocated_satoshis,audit.a);assert.equal(pool.allocated_satoshis,trustedRewards);
    assert.ok(pool.allocated_satoshis>=0&&pool.allocated_satoshis<=pool.confirmed_satoshis);
    for(const account of db.prepare('SELECT * FROM exchange_accounts').all()){
      const ledger=db.prepare('SELECT coalesce(sum(points_delta),0) c,coalesce(sum(reserved_delta),0) r FROM exchange_ledger WHERE user_id=?').get(account.user_id);
      assert.equal(account.confirmed_points,ledger.c);assert.equal(account.reserved_points,ledger.r);
    }
  };
  return {db,database,service,makeService,verifier,receipts,beneficiaries,user,receipt,fund,beneficiary,count,points,invariant,time:()=>clock,setTime:value=>{clock=value;},setBeforeFirst:callback=>{beforeFirst=callback;}};
}

test('real treasury starts unfunded; immutable draft policy and absent verifier never create money',async t=>{
  const f=fixture(t),uid=f.user(),closed=f.makeService({verifier:null});
  assert.deepEqual(await closed.getState(),{confirmedSatoshis:0,allocatedSatoshis:0,availableSatoshis:0,status:'unfunded'});
  assert.ok(Object.isFrozen(REWARD_TREASURY_POLICY));assert.equal(REWARD_TREASURY_POLICY.country,'JP');assert.equal(REWARD_TREASURY_POLICY.minimumAge,18);assert.equal(REWARD_TREASURY_POLICY.dailyRewardMR,100);assert.equal(REWARD_TREASURY_POLICY.satoshisPerMR,1);assert.equal(REWARD_TREASURY_POLICY.minWithdrawalMR,10000);assert.equal(REWARD_TREASURY_POLICY.maxWithdrawalMR,100000);assert.equal(REWARD_TREASURY_POLICY.status,'draft');
  assert.throws(()=>{REWARD_TREASURY_POLICY.dailyRewardMR=Infinity;});
  await rejects(closed.ingestConfirmedFunding({verified:true,amountSatoshis:1000000,network:'bitcoin'}),'reward_treasury_verifier_unavailable',503);
  await rejects(closed.creditDailyReward({userId:uid,beneficiaryRef:'client-confirmed',verified:true,ageOver18:true,unlimited:true}),'reward_treasury_verifier_unavailable',503);
  const incomplete=f.makeService({verifier:{id:'partial',verifyBeneficiary:async()=>({verified:true})}});
  await rejects(incomplete.creditDailyReward({userId:uid,beneficiaryRef:'client-confirmed'}),'reward_treasury_verifier_unavailable',503);
  assert.equal(f.count('reward_treasury_funding'),0);assert.equal(f.count('exchange_accounts'),0);assert.equal(f.count('exchange_reward_events'),0);f.invariant();
});

test('only verified receipt output is recorded and simultaneous funding delivery credits once',async t=>{
  const f=fixture(t);
  await rejects(f.service.ingestConfirmedFunding({verified:true,amountSatoshis:500,network:'bitcoin',confirmations:6,receiptId:outpoint(1)}),'reward_treasury_funding_unverified',403);
  const envelope=f.receipt(700),results=await Promise.all(Array.from({length:8},()=>f.service.ingestConfirmedFunding(envelope)));
  assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(f.count('reward_treasury_funding'),1);assert.equal(f.count('reward_treasury_audit'),1);assert.equal(f.count('exchange_reward_events'),0);
  assert.deepEqual(await f.service.getState(),{confirmedSatoshis:700,allocatedSatoshis:0,availableSatoshis:700,status:'funded'});
  const row=f.db.prepare('SELECT * FROM reward_treasury_funding').get();assert.equal(row.receipt_id,outpoint(1));assert.equal(row.destination_ref,'verified-treasury-wallet');assert.equal(row.amount_satoshis,700);f.invariant();
});

test('UTXO aliases and replayed confirmations cannot double-credit; changed funding details conflict',async t=>{
  const f=fixture(t),txid='abcdef1234567890'.repeat(4),envelope=f.receipt(800,{receiptId:txid.toUpperCase()+':0000000007'});
  await f.service.ingestConfirmedFunding(envelope);assert.equal(f.db.prepare('SELECT receipt_id FROM reward_treasury_funding').get().receipt_id,txid+':7');
  f.receipts.set('replay',{...f.receipts.get(envelope.reference),receiptId:txid+':7',confirmations:20});
  assert.equal((await f.service.ingestConfirmedFunding({reference:'replay'})).duplicate,true);
  for(const patch of [{amountSatoshis:801},{destinationRef:'different-wallet'}]){
    f.receipts.set('conflict',{...f.receipts.get(envelope.reference),...patch});await rejects(f.service.ingestConfirmedFunding({reference:'conflict'}),'reward_treasury_funding_conflict',409);
  }
  const other=f.makeService({verifier:{...f.verifier,id:'another-adapter',verifyFundingReceipt:async()=>({...f.receipts.get(envelope.reference),providerId:'another-adapter'})}});
  await rejects(other.ingestConfirmedFunding({}),'reward_treasury_funding_conflict',409);
  assert.equal(f.count('reward_treasury_funding'),1);assert.equal((await f.service.getState()).confirmedSatoshis,800);f.invariant();
});

test('wrong asset/network, insufficient confirmations, unsafe amounts and invalid outputs leave no funding',async t=>{
  const f=fixture(t);
  for(const patch of [{verified:false},{verified:'true'},{providerId:'wrong-provider'},{asset:'ETH'},{network:'testnet'},{network:'signet'},{confirmations:5},{confirmations:6.5},{confirmations:'6'},{confirmations:Infinity}])await rejects(f.fund(100,patch),'reward_treasury_funding_unverified',403);
  for(const amount of [0,-1,1.5,NaN,Infinity,'100',1000000000001])await rejects(f.fund(amount),'reward_treasury_invalid_amount',400);
  for(const receiptId of ['not-a-transaction','a'.repeat(63)+':0','g'.repeat(64)+':0',outpoint(1,-1),outpoint(1,4294967296),'a'.repeat(64)+':1e1','a'.repeat(64)+':+1','a'.repeat(64)+':1.5','a'.repeat(64)+': 1'])await rejects(f.fund(100,{receiptId}),'reward_treasury_invalid_receipt',400);
  await rejects(f.fund(100,{destinationRef:''}),'reward_treasury_invalid_input',400);
  assert.equal(f.count('reward_treasury_funding'),0);assert.equal(f.count('reward_treasury_audit'),0);f.invariant();
  await f.fund(1000000000000,{receiptId:outpoint(999,4294967295)});await rejects(f.fund(1),'reward_treasury_funding_limit',409);
  assert.equal(f.count('reward_treasury_funding'),1);assert.equal((await f.service.getState()).confirmedSatoshis,1000000000000);f.invariant();
});

test('recipient scope, Japanese residency, verified adulthood and expiry are enforced independently of client flags',async t=>{
  const f=fixture(t),uid=f.user();await f.fund(1000);
  await rejects(f.service.creditDailyReward({userId:uid,beneficiaryRef:'unrecognized',verified:true,country:'JP',ageOver18:true,subjectId:'client-person'}),'reward_treasury_beneficiary_unverified',403);
  for(const patch of [{verified:false},{providerId:'wrong'},{userId:'different-owner'},{beneficiaryRef:'different-reference'},{country:'US'},{country:'jp'},{ageOver18:false},{ageOver18:'true'},{expiresAt:f.time()}]){
    const claim=f.beneficiary(uid,undefined,patch);await rejects(f.service.creditDailyReward(claim),'reward_treasury_beneficiary_unverified',403);
  }
  await rejects(f.service.creditDailyReward(f.beneficiary(uid,undefined,{subjectId:''})),'reward_treasury_invalid_input',400);
  assert.equal(f.count('reward_treasury_allocations'),0);assert.equal(f.count('exchange_reward_events'),0);assert.equal(f.points(uid),0);f.invariant();
});

test('a verified daily reward needs real recorded budget and atomically credits exactly 100 MR once',async t=>{
  const f=fixture(t),uid=f.user(),claim=f.beneficiary(uid);
  await rejects(f.service.creditDailyReward(claim),'reward_treasury_insufficient_funding',409);assert.equal(f.count('exchange_reward_events'),0);
  await f.fund(100);const results=await Promise.all(Array.from({length:8},()=>f.service.creditDailyReward({...claim,points:999999,amountSatoshis:999999,unlimited:true})));
  assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(new Set(results.map(r=>r.allocation.id)).size,1);
  assert.equal(results[0].allocation.rewardMR,100);assert.equal(results[0].allocation.amountSatoshis,100);assert.equal(f.points(uid),100);
  assert.deepEqual(await f.service.getState(),{confirmedSatoshis:100,allocatedSatoshis:100,availableSatoshis:0,status:'funded'});
  assert.equal(f.count('exchange_reward_events'),1);assert.equal(f.count('exchange_ledger'),1);assert.equal(f.count('reward_treasury_audit'),2);
  assert.equal(f.db.prepare('SELECT provider_id FROM exchange_reward_events').get().provider_id,'machi-treasury');f.invariant();
});

test('one verified person cannot receive twice using separate device cookies or rotated beneficiary references',async t=>{
  const f=fixture(t),a=f.user(),b=f.user();await f.fund(1000);
  const claims=[f.beneficiary(a,'same-person'),f.beneficiary(b,'same-person')],results=await Promise.allSettled(claims.map(c=>f.service.creditDailyReward(c)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'reward_treasury_daily_claimed');assert.equal(rejected.reason.status,409);
  assert.equal(f.points(a)+f.points(b),100);assert.equal(f.count('reward_treasury_allocations'),1);assert.equal((await f.service.getState()).allocatedSatoshis,100);
  const winner=f.points(a)?a:b,loser=winner===a?b:a;
  assert.equal((await f.service.creditDailyReward(f.beneficiary(winner,'same-person'))).duplicate,true);
  await rejects(f.service.creditDailyReward(f.beneficiary(loser,'same-person')),'reward_treasury_daily_claimed',409);assert.equal(f.points(loser),0);f.invariant();
});

test('concurrent different people cannot allocate beyond confirmed funding; failed claims may retry after actual new funding',async t=>{
  const f=fixture(t);await f.fund(250);const claims=Array.from({length:8},()=>f.beneficiary(f.user()));
  const results=await Promise.allSettled(claims.map(c=>f.service.creditDailyReward(c)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'reward_treasury_insufficient_funding');
  assert.deepEqual(await f.service.getState(),{confirmedSatoshis:250,allocatedSatoshis:200,availableSatoshis:50,status:'funded'});assert.equal(f.count('exchange_reward_events'),2);f.invariant();
  const retry=claims[results.findIndex(r=>r.status==='rejected')];await f.fund(50);assert.equal((await f.service.creditDailyReward(retry)).duplicate,false);
  assert.deepEqual(await f.service.getState(),{confirmedSatoshis:300,allocatedSatoshis:300,availableSatoshis:0,status:'funded'});f.invariant();
});

test('daily uniqueness uses server JST midnight and never the caller date or UTC day',async t=>{
  const f=fixture(t),uid=f.user();await f.fund(1000);f.setTime(Date.parse('2026-11-25T14:59:59.999Z'));const claim=f.beneficiary(uid);
  const first=await f.service.creditDailyReward({...claim,date:'2099-01-01'});assert.equal(first.allocation.day,'2026-11-25');assert.equal((await f.service.creditDailyReward(claim)).duplicate,true);
  f.setTime(Date.parse('2026-11-25T15:00:00.000Z'));const next=await f.service.creditDailyReward(claim);assert.equal(next.duplicate,false);assert.equal(next.allocation.day,'2026-11-26');
  assert.equal(f.points(uid),200);assert.equal(f.count('reward_treasury_allocations'),2);f.invariant();
});

test('verification expiry and JST day are rechecked after asynchronous verification and storage reads',async t=>{
  const f=fixture(t),uid=f.user();await f.fund(1000);const claim=f.beneficiary(uid,undefined,{expiresAt:f.time()+1});
  const verify=f.verifier.verifyBeneficiary;f.verifier.verifyBeneficiary=async input=>{const response=await verify(input);f.setTime(response.expiresAt);return response;};
  await rejects(f.service.creditDailyReward(claim),'reward_treasury_beneficiary_unverified',403);assert.equal(f.count('reward_treasury_allocations'),0);f.verifier.verifyBeneficiary=verify;
  const short=f.beneficiary(uid,undefined,{expiresAt:f.time()+1});let advance=true;
  f.setBeforeFirst(sql=>{if(advance&&sql.includes('FROM reward_treasury_allocations')){advance=false;f.setTime(f.time()+1);}});
  await rejects(f.service.creditDailyReward(short),'reward_treasury_beneficiary_unverified',403);assert.equal(f.count('reward_treasury_allocations'),0);f.setBeforeFirst(null);
  f.setTime(Date.parse('2026-11-25T14:59:59.999Z'));const midnight=f.beneficiary(uid);await f.service.creditDailyReward(midnight);
  advance=true;f.setBeforeFirst(sql=>{if(advance&&sql.includes('FROM reward_treasury_allocations')){advance=false;f.setTime(Date.parse('2026-11-25T15:00:00.000Z'));}});
  const next=await f.service.creditDailyReward(midnight);assert.equal(next.duplicate,false);assert.equal(next.allocation.day,'2026-11-26');assert.equal(f.points(uid),200);f.invariant();
});

test('funding and reward audit failures roll back pool, allocation, exchange events and account together',async t=>{
  const f=fixture(t),uid=f.user(),claim=f.beneficiary(uid);
  const block=table=>f.db.exec('CREATE TRIGGER fixture_failure BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'fixture write failed'); END;");
  const unblock=()=>f.db.exec('DROP TRIGGER fixture_failure');
  block('reward_treasury_audit');await rejects(f.fund(1000),'reward_treasury_storage_unavailable',503);
  assert.equal(f.count('reward_treasury_funding'),0);assert.equal((await f.service.getState()).confirmedSatoshis,0);f.invariant();unblock();await f.fund(1000);
  for(const table of ['exchange_ledger','reward_treasury_audit']){
    block(table);await rejects(f.service.creditDailyReward(claim),'reward_treasury_storage_unavailable',503);unblock();
    assert.equal((await f.service.getState()).allocatedSatoshis,0);assert.equal(f.count('reward_treasury_allocations'),0);assert.equal(f.count('exchange_reward_events'),0);assert.equal(f.count('exchange_ledger'),0);assert.equal(f.count('exchange_accounts'),0);f.invariant();
  }
  await f.service.creditDailyReward(claim);assert.equal(f.points(uid),100);f.invariant();
});

test('an exchange-account limit failure cannot consume treasury budget or the daily entitlement',async t=>{
  const f=fixture(t),uid=f.user();await f.fund(1000);
  f.db.prepare('INSERT INTO exchange_reward_events(provider_id,event_id,user_id,points,receipt_ref,created_at) VALUES(?,?,?,?,?,?)').run('other-verified-fixture','existing-max',uid,1000000000000,'test-receipt',f.time());
  await rejects(f.service.creditDailyReward(f.beneficiary(uid)),'reward_treasury_reward_limit',409);
  assert.equal((await f.service.getState()).allocatedSatoshis,0);assert.equal(f.count('reward_treasury_allocations'),0);assert.equal(f.count('exchange_reward_events'),1);assert.equal(f.points(uid),1000000000000);f.invariant();
});

test('SQLite constraints and append-only records reject fractional budgets and edited or deleted evidence',async t=>{
  const f=fixture(t),uid=f.user();await f.fund(1000);await f.service.creditDailyReward(f.beneficiary(uid));
  for(const sql of [
    'UPDATE reward_treasury_pool SET confirmed_satoshis=-1','UPDATE reward_treasury_pool SET confirmed_satoshis=1000.5','UPDATE reward_treasury_pool SET allocated_satoshis=1001','DELETE FROM reward_treasury_pool',
    'UPDATE reward_treasury_funding SET amount_satoshis=999','DELETE FROM reward_treasury_funding','UPDATE reward_treasury_allocations SET reward_mr=999','DELETE FROM reward_treasury_allocations','UPDATE reward_treasury_audit SET confirmed_delta=999','DELETE FROM reward_treasury_audit'
  ])assert.throws(()=>f.db.exec(sql),sql);
  const clone=(day,expiry)=>f.db.prepare("INSERT INTO reward_treasury_allocations(id,provider_id,user_id,beneficiary_ref,subject_id,reward_day,country,age_over_18,verification_expires_at,policy_version,reward_mr,amount_satoshis,created_at) SELECT 'invalid-'||id,provider_id,user_id,beneficiary_ref,'another-person',?,'JP',1,?,policy_version,reward_mr,amount_satoshis,created_at FROM reward_treasury_allocations LIMIT 1").run(day,expiry);
  assert.throws(()=>clone('2099-01-01',f.time()+1000),/reward_treasury_invalid_day/);assert.throws(()=>clone('2026-11-25',f.time()),/reward_treasury_verification_expired/);
  assert.equal(f.count('reward_treasury_allocations'),1);f.invariant();
});

test('verification and storage failures are closed and do not expose adapter secrets',async t=>{
  const f=fixture(t),uid=f.user(),secret='not-for-client-output';
  f.verifier.verifyFundingReceipt=()=>{throw new Error(secret);};f.verifier.verifyBeneficiary=()=>{throw new Error(secret);};
  for(const call of [()=>f.service.ingestConfirmedFunding({}),()=>f.service.creditDailyReward({userId:uid,beneficiaryRef:'known'})])await assert.rejects(call(),error=>error.status===503&&error.code==='reward_treasury_verification_unavailable'&&!error.message.includes(secret));
  const broken=createRewardTreasuryService({db:{prepare(){throw new Error(secret);}}});await assert.rejects(broken.getState(),error=>error.status===503&&error.code==='reward_treasury_storage_unavailable'&&!error.message.includes(secret));
  assert.equal(f.count('reward_treasury_funding'),0);assert.equal(f.count('reward_treasury_allocations'),0);f.invariant();
});
