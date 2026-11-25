// Real SQLite + locally signed, synthetic Stripe snapshots only. These tests
// never contact Stripe, charge a card, create a refund, or credit game rewards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSponsorshipService,handleSponsors,SPONSOR_OFFER} from '../worker/sponsors.js';

const DAY=86400000,ORIGIN='https://www.omoji-z.com',OFFER=SPONSOR_OFFER.id;
const SECRET='whsec_OnlyForUnitTesting0123456789',ADMIN='unit-test-only-sponsor-admin-0123456789';
const ACCOUNT='acct_UnitTestAccount',LINK='plink_UnitTestLink';
const merchant={sellerName:'テスト用商店',representative:'試験 太郎',address:'東京都試験区試験町1丁目2番3号',phone:'03-5826-9041',email:'test@merchant-fixture.jp',contactUrl:'https://merchant-fixture.jp/contact',paymentMethods:['テスト用決済方法'],paymentTiming:'テスト用の申込時払い'};
const CONFIG={SPONSOR_STRIPE_WEBHOOK_SECRET:SECRET,SPONSOR_STRIPE_ACCOUNT_ID:ACCOUNT,SPONSOR_STRIPE_PAYMENT_LINK_ID:LINK,SPONSOR_STRIPE_PAYMENT_LINK_URL:'https://buy.stripe.com/UnitTestOnly123456789',SPONSOR_ADMIN_TOKEN:ADMIN,SPONSOR_MERCHANT_JSON:JSON.stringify(merchant),SPONSOR_SALES_ENABLED:'true',SPONSOR_TAX_REVIEWED:'true'};
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code,'expected '+code);
const migration=name=>readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8');
const schema=()=>migration('0006_sponsorships');
function fixture(t,{finance=false,migrate=true}={}){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());
  if(finance)for(const name of ['0000_social','0001_profile','0002_device_sessions','0003_exchange','0004_exchange_sandbox','0005_reward_treasury'])db.exec(migration(name));
  if(migrate)db.exec(schema());
  let hook=null;
  const prepare=(sql,values=[])=>({bind:(...next)=>prepare(sql,next),async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){if(hook)await hook(sql,values);const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});
  const database={prepare},env={...CONFIG,DB:database};let clock=Math.floor(Date.now()/1000)*1000,sequence=0;
  const makeService=patch=>createSponsorshipService({db:database,env:{...env,...patch},now:()=>clock});
  const service=makeService();
  const checkout=(suffix='00000001',patch={})=>({id:'cs_live_UnitTestSession'+suffix,object:'checkout.session',livemode:true,payment_link:LINK,payment_intent:'pi_UnitTest'+suffix,metadata:{offer:OFFER},mode:'payment',status:'complete',payment_status:'paid',amount_subtotal:3300,amount_total:3300,currency:'jpy',total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},allow_promotion_codes:false,shipping_cost:null,shipping_address_collection:null,shipping_options:[],discounts:[],custom_fields:[{key:'sponsor_name',type:'text',text:{value:'試験用のお店'}},{key:'sponsor_url',type:'text',text:{value:'https://sponsor-fixture.jp/shop'}},{key:'sponsor_message',type:'text',text:{value:'この文字列はテスト専用です'}}],customer_details:{email:'private-buyer@hidden.test',name:'非公開の購入者'},...patch});
  const charge=(suffix='00000001',patch={})=>({id:'ch_UnitTest'+suffix,object:'charge',livemode:true,payment_intent:'pi_UnitTest'+suffix,metadata:{offer:OFFER},amount:3300,amount_captured:3300,amount_refunded:0,currency:'jpy',paid:true,captured:true,disputed:false,status:'succeeded',billing_details:{name:'非公開のカード購入者'},...patch});
  const event=(type,data,patch={})=>({id:'evt_UnitTest'+String(++sequence).padStart(8,'0'),object:'event',livemode:true,created:Math.floor(clock/1000),type,data:{object:data},...patch});
  const request=(value,options={})=>{
    const raw=options.raw??JSON.stringify(value),timestamp=options.timestamp??Math.floor(clock/1000),signature=createHmac('sha256',options.secret??SECRET).update(timestamp+'.').update(raw).digest('hex');
    return new Request(ORIGIN+'/api/sponsors/stripe-webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':options.signature??`t=${timestamp},v1=${signature}`,...options.headers},body:raw});
  };
  const deliver=(value,options={})=>service.receiveWebhook(request(value,options));
  const pay=async(suffix='00000001')=>{await deliver(event('checkout.session.completed',checkout(suffix)));await deliver(event('charge.succeeded',charge(suffix)));return (await service.getAdmin()).orders.find(order=>order.sessionId==='cs_live_UnitTestSession'+suffix);};
  const api=async(path='',options={},settings=env)=>{const response=await handleSponsors(new Request(ORIGIN+'/api/sponsors'+path,options),settings);return response?{status:response.status,headers:response.headers,data:await response.json()}:null;};
  const expected=order=>({expectedStatus:order.status,expectedUpdatedAt:order.updatedAt});
  const act=async(id,action,version)=>service.act(id,action,version??expected(await service.getAdminOrder(id)));
  const admin=async(path='',body)=>{if(path&&body===undefined)body=expected(await service.getAdminOrder(path.split('/')[1]));return api('/admin'+path,{method:path?'POST':'GET',headers:{Authorization:'Bearer '+ADMIN,Origin:ORIGIN,'Content-Type':'application/json'},...(path?{body:JSON.stringify(body)}:{})});};
  const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
  return {db,database,env,service,makeService,checkout,charge,event,request,deliver,pay,api,admin,act,expected,count,time:()=>clock,setTime:at=>{clock=at;},advance:ms=>{clock+=ms;},hook:fn=>{hook=fn;}};
}

test('checkout readiness requires every verified configuration value; default contains no fake checkout',async t=>{
  const f=fixture(t),empty=await f.makeService({SPONSOR_MERCHANT_JSON:'',SPONSOR_STRIPE_PAYMENT_LINK_URL:''}).getPublic();
  assert.equal(empty.enabled,false);assert.equal(empty.checkoutUrl,null);assert.equal(empty.merchant,null);assert.deepEqual(empty.listings,[]);assert.deepEqual(empty.offer,SPONSOR_OFFER);
  for(const key of Object.keys(CONFIG)){
    const response=await f.makeService({[key]:''}).getPublic();assert.equal(response.enabled,false,key);assert.equal(response.checkoutUrl,null,key);assert.equal(typeof response.disabledReason,'string');
  }
  for(const url of ['https://evil.test/stripe','https://buy.stripe.com/test_123456789','http://buy.stripe.com/123','https://buy.stripe.com/abc?x=1','https://user:pass@buy.stripe.com/abc','https://buy.stripe.com/abc#def'])assert.equal((await f.makeService({SPONSOR_STRIPE_PAYMENT_LINK_URL:url}).getPublic()).enabled,false,url);
  const ready=await f.service.getPublic();assert.equal(ready.enabled,true);assert.equal(ready.checkoutUrl,CONFIG.SPONSOR_STRIPE_PAYMENT_LINK_URL);assert.deepEqual(ready.merchant,merchant);assert.equal(ready.disabledReason,null);
});

test('merchant placeholders, invalid disclosures, missing methods or timing cannot activate sales',async t=>{
  const f=fixture(t);
  for(const patch of [{sellerName:'確認中'},{representative:'未設定'},{address:'later'},{address:'サンプル住所です'},{phone:'00000000000'},{phone:'1234567890'},{phone:'090<script>'},{email:''},{email:'test@example.com'},{email:'invalid-address'},{contactUrl:'http://merchant-fixture.jp'},{paymentMethods:[]},{paymentMethods:['TODO']},{paymentMethods:['card','card']},{paymentMethods:Array(13).fill('method')},{paymentTiming:''},{paymentTiming:'未設定'}]){
    const value=await f.makeService({SPONSOR_MERCHANT_JSON:JSON.stringify({...merchant,...patch})}).getPublic();assert.equal(value.enabled,false,JSON.stringify(patch));assert.equal(value.merchant,null);assert.equal(value.checkoutUrl,null);
  }
  const noContact={...merchant};delete noContact.contactUrl;assert.equal((await f.makeService({SPONSOR_MERCHANT_JSON:JSON.stringify(noContact)}).getPublic()).enabled,true);
});

test('raw webhook signatures are verified before processing or replay detection',async t=>{
  const f=fixture(t),event=f.event('checkout.session.completed',f.checkout());
  await rejects(f.deliver(event,{secret:'whsec_WrongSecretForTesting123'}),'sponsor_signature_invalid');
  const original=f.request(event),header=original.headers.get('Stripe-Signature');
  await rejects(f.deliver(event,{raw:JSON.stringify({...event,id:'evt_TamperedEvent'}),signature:header}),'sponsor_signature_invalid');
  for(const delta of [-301,301])await rejects(f.deliver(event,{timestamp:Math.floor(f.time()/1000)+delta}),'sponsor_signature_expired');
  await rejects(f.deliver(event,{signature:'t='+Math.floor(f.time()/1000)+',v0='+'0'.repeat(64)}),'sponsor_signature_invalid');
  await rejects(f.deliver(event,{signature:header+',t='+Math.floor(f.time()/1000)}),'sponsor_signature_invalid');
  assert.equal(f.count('sponsor_events'),0);
  assert.equal((await f.deliver(event,{signature:header+',v1='+'0'.repeat(64)+',secret=ignored,destination=ignored'})).duplicate,false);
  await rejects(f.deliver(event,{secret:'whsec_BadReplaySecret01234567'}),'sponsor_signature_invalid');
  assert.equal((await f.deliver(event)).duplicate,true);assert.equal(f.count('sponsor_events'),1);
});

test('live mode and matching account context are mandatory; direct-account events may omit account',async t=>{
  const f=fixture(t);
  for(const patch of [{livemode:false},{account:'acct_AnotherAccount'},{context:'acct_AnotherAccount'},{created:Math.floor(f.time()/1000)+301}])await assert.rejects(f.deliver(f.event('checkout.session.completed',f.checkout(),patch)),error=>error.status===400);
  await rejects(f.deliver(f.event('checkout.session.completed',f.checkout('00000001',{livemode:false}))),'sponsor_event_invalid');
  await f.deliver(f.event('checkout.session.completed',f.checkout(),{account:ACCOUNT,context:ACCOUNT}));
  await f.deliver(f.event('checkout.session.completed',f.checkout('00000002')));assert.equal(f.count('sponsor_orders'),2);
});

test('signed historical events continue when new sales, merchant disclosure and admin access are disabled',async t=>{
  const f=fixture(t),stopped=f.makeService({SPONSOR_SALES_ENABLED:'false',SPONSOR_MERCHANT_JSON:'',SPONSOR_TAX_REVIEWED:'false',SPONSOR_ADMIN_TOKEN:''});
  await stopped.receiveWebhook(f.request(f.event('checkout.session.completed',f.checkout())));assert.equal(f.count('sponsor_orders'),1);assert.equal((await stopped.getPublic()).enabled,false);
  await rejects(f.makeService({SPONSOR_STRIPE_WEBHOOK_SECRET:''}).receiveWebhook(f.request(f.event('charge.succeeded',f.charge()))),'sponsor_webhook_unconfigured');
});

test('only allowlisted fixed-price payment link and exact paid offer are accepted, including inclusive tax',async t=>{
  const f=fixture(t);const wrong=f.event('checkout.session.completed',f.checkout('00000001',{payment_link:'plink_AnotherProduct'}));assert.deepEqual(await f.deliver(wrong),{received:true,ignored:true});assert.equal(f.count('sponsor_events'),0);
  for(const patch of [{metadata:{offer:'another'}},{mode:'subscription'},{status:'open'},{currency:'usd'},{amount_total:3299},{amount_total:3301},{allow_promotion_codes:true},{total_details:{amount_discount:1,amount_shipping:0,amount_tax:0}},{total_details:{amount_discount:0,amount_shipping:1,amount_tax:0}},{shipping_cost:{amount_total:0}},{shipping_address_collection:{allowed_countries:['JP']}},{shipping_options:[{}]},{discounts:[{}]}])await rejects(f.deliver(f.event('checkout.session.completed',f.checkout('00000001',patch))),'sponsor_offer_mismatch');
  await f.deliver(f.event('checkout.session.completed',f.checkout('00000001',{amount_subtotal:3000,total_details:{amount_discount:0,amount_shipping:0,amount_tax:300}})));
  assert.equal((await f.service.getAdmin()).orders[0].amount,3300);assert.equal(f.count('sponsor_orders'),1);
});

test('a paid checkout never publishes automatically and requires captured offer charge before approval',async t=>{
  const f=fixture(t);await f.deliver(f.event('checkout.session.completed',f.checkout()));
  let order=(await f.service.getAdmin()).orders[0];assert.equal(order.status,'paid_pending_review');assert.equal(order.paymentVerified,false);assert.equal(order.canApprove,false);assert.equal(order.startsAt,null);assert.deepEqual((await f.service.getPublic()).listings,[]);
  await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');
  await f.deliver(f.event('charge.succeeded',f.charge()));order=await f.service.getAdminOrder(order.id);assert.equal(order.paymentVerified,true);assert.equal(order.canApprove,true);
  const approved=await f.act(order.id,'approve');assert.equal(approved.order.status,'approved');assert.equal(approved.order.endsAt-approved.order.startsAt,30*DAY);assert.equal((await f.service.getPublic()).listings.length,1);
});

test('unrelated product charges never enter sponsor accounting or verify a purchase',async t=>{
  const f=fixture(t);await f.deliver(f.event('checkout.session.completed',f.checkout()));
  for(const metadata of [{},{offer:'another-product'}]){const result=await f.deliver(f.event('charge.succeeded',f.charge('00000001',{metadata,amount:500000,amount_captured:500000})));assert.equal(result.ignored,true);}
  assert.equal(f.count('sponsor_charges'),0);assert.equal((await f.service.getAdmin()).orders[0].paymentVerified,false);
  const refunded=f.charge('00000009',{metadata:{offer:'another-product'},amount:9999999,amount_captured:9999999,amount_refunded:1});await f.deliver(f.event('charge.refunded',refunded));
  assert.equal(f.count('sponsor_charges'),0);const hold=f.db.prepare("SELECT * FROM sponsor_events WHERE effect='hold'").get();assert.equal(hold.amount,null);assert.equal(hold.currency,null);assert.equal(hold.charge_id,refunded.id);assert.equal(f.count('sponsor_payment_holds'),1);
});

test('unpaid and failed asynchronous checkouts cannot be approved; confirmed payment is monotonic',async t=>{
  const f=fixture(t),pending=f.checkout('00000001',{payment_status:'unpaid',payment_intent:null});
  await f.deliver(f.event('checkout.session.completed',pending));let order=(await f.service.getAdmin()).orders[0];assert.equal(order.status,'payment_pending');assert.equal(order.canApprove,false);assert.equal(order.canReject,false);
  await f.deliver(f.event('checkout.session.async_payment_failed',{...pending,payment_intent:'pi_UnitTest00000001'}));order=await f.service.getAdminOrder(order.id);assert.equal(order.status,'payment_failed');
  await rejects(f.deliver(f.event('checkout.session.async_payment_succeeded',pending)),'sponsor_payment_invalid');
  await f.deliver(f.event('checkout.session.async_payment_succeeded',f.checkout()));await f.deliver(f.event('charge.succeeded',f.charge()));order=await f.service.getAdminOrder(order.id);assert.equal(order.status,'paid_pending_review');assert.equal(order.canApprove,true);const paidAt=order.paidAt;
  f.advance(1000);await f.deliver(f.event('checkout.session.async_payment_failed',{...pending,payment_intent:'pi_UnitTest00000001'}));await f.deliver(f.event('checkout.session.completed',pending));order=await f.service.getAdminOrder(order.id);assert.equal(order.status,'paid_pending_review');assert.equal(order.paidAt,paidAt);
});

test('capture, currency and full amount must match; charge facts cannot be reassigned to another payment',async t=>{
  const f=fixture(t);await f.deliver(f.event('checkout.session.completed',f.checkout()));const order=(await f.service.getAdmin()).orders[0];
  for(const [suffix,patch]of [['00000010',{captured:false,amount_captured:0}],['00000011',{paid:false,status:'failed'}],['00000012',{amount:3200,amount_captured:3200}],['00000013',{currency:'usd'}]])await f.deliver(f.event('charge.succeeded',f.charge(suffix,{payment_intent:'pi_UnitTest00000001',...patch})));
  assert.equal((await f.service.getAdminOrder(order.id)).canApprove,false);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');
  await f.deliver(f.event('charge.succeeded',f.charge()));await rejects(f.deliver(f.event('charge.updated',f.charge('00000001',{payment_intent:'pi_AnotherPayment'}))),'sponsor_event_conflict');assert.equal(f.count('sponsor_charges'),5);
});

test('unsafe URLs, injected or excessive listing text remain blocked paid requests without raw content',async t=>{
  const f=fixture(t),cases=[{field:0,value:'<script>alert(1)</script>'},{field:0,value:'x'.repeat(61)},{field:2,value:'x'.repeat(81)},{field:2,value:'text\u202ehidden'},{field:1,value:'javascript:alert(1)'},{field:1,value:'https://127.0.0.1/x'},{field:1,value:'https://[::1]/x'},{field:1,value:'https://0x7f000001/x'},{field:1,value:'https://admin.local/x'},{field:1,value:'https://user:secret@sponsor-fixture.jp/'},{field:1,value:'https://sponsor-fixture.jp:8080/'}];
  for(let i=0;i<cases.length;i++){
    const {field,value}=cases[i],suffix=String(i+1).padStart(8,'0'),session=f.checkout(suffix);session.custom_fields[field].text.value=value;await f.deliver(f.event('checkout.session.completed',session));await f.deliver(f.event('charge.succeeded',f.charge(suffix)));
    const order=(await f.service.getAdmin()).orders.find(item=>item.sessionId===session.id);assert.equal(order.contentValid,false,value);assert.equal(order.canApprove,false);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');assert.equal((await f.act(order.id,'reject')).order.status,'refund_required');
  }
  const raw=JSON.stringify(f.db.prepare('SELECT * FROM sponsor_events').all());assert.ok(!raw.includes('<script>'));assert.ok(!raw.includes('user:secret'));assert.deepEqual((await f.service.getPublic()).listings,[]);
});

test('duplicate or unexpected custom fields cannot bypass review validation',async t=>{
  const f=fixture(t);for(const [i,fields]of [[],[{key:'unexpected',type:'text',text:{value:'anything'}}],[{key:'sponsor_name',type:'text',text:{value:'店'}},{key:'sponsor_name',type:'text',text:{value:'他店'}}]].entries()){
    await f.deliver(f.event('checkout.session.completed',f.checkout(String(i).padStart(8,'0'),{custom_fields:fields})));
  }
  for(const order of (await f.service.getAdmin()).orders){assert.equal(order.contentValid,false);assert.equal(order.canApprove,false);}
});

test('duplicate event deliveries and distinct events for one session create one order atomically',async t=>{
  const f=fixture(t),value=f.event('checkout.session.completed',f.checkout());const results=await Promise.all(Array.from({length:8},()=>f.deliver(value)));
  assert.equal(results.filter(item=>!item.duplicate).length,1);assert.equal(f.count('sponsor_events'),1);assert.equal(f.count('sponsor_orders'),1);assert.equal(f.count('sponsor_audit'),1);
  await Promise.all(Array.from({length:6},()=>f.deliver(f.event('checkout.session.completed',f.checkout()))));assert.equal(f.count('sponsor_orders'),1);assert.equal(f.count('sponsor_audit'),1);
  await rejects(f.deliver({...value,created:value.created-1}),'sponsor_event_conflict');assert.equal(f.count('sponsor_events'),7);
});

test('signed retry with different JSON formatting and delivery counters retains business idempotency',async t=>{
  const f=fixture(t),value=f.event('checkout.session.completed',f.checkout(),{pending_webhooks:2});await f.deliver(value);
  f.advance(1000);const retry={...value,pending_webhooks:0,request:{id:'req_ChangedDeliveryEnvelope'}};
  assert.equal((await f.deliver(retry,{raw:JSON.stringify(retry,null,2)})).duplicate,true);assert.equal(f.count('sponsor_events'),1);assert.equal(f.count('sponsor_orders'),1);
  const changed=structuredClone(retry);changed.data.object.custom_fields[0].text.value='変更された掲載名';await rejects(f.deliver(changed),'sponsor_event_conflict');assert.equal(f.count('sponsor_orders'),1);
});

test('a payment intent cannot fund two listings and session content or intent cannot be changed on replay',async t=>{
  const f=fixture(t);await f.pay();const count=f.count('sponsor_events');
  await rejects(f.deliver(f.event('checkout.session.completed',f.checkout('00000002',{payment_intent:'pi_UnitTest00000001'}))),'sponsor_event_conflict');
  await rejects(f.deliver(f.event('checkout.session.completed',f.checkout('00000001',{payment_intent:'pi_AnotherPayment'}))),'sponsor_event_conflict');
  const changed=f.checkout();changed.custom_fields[0].text.value='別の掲載名';await rejects(f.deliver(f.event('checkout.session.completed',changed)),'sponsor_event_conflict');
  assert.equal(f.count('sponsor_orders'),1);assert.equal(f.count('sponsor_events'),count);
});

test('all refund and dispute variants place permanent holds even when delivered before payment',async t=>{
  const f=fixture(t),types=['refund.created','refund.updated','refund.failed','charge.refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_reinstated'];
  for(let i=0;i<types.length;i++){
    const type=types[i],suffix=String(i+1).padStart(8,'0'),dispute=type.startsWith('charge.dispute.'),data={id:(dispute?'du_':'re_')+'UnitTest'+suffix,object:dispute?'dispute':'refund',payment_intent:'pi_UnitTest'+suffix,charge:'ch_UnitTest'+suffix,status:dispute?'won':'failed'};
    await f.deliver(f.event(type,data));const order=await f.pay(suffix);assert.equal(order.status,'payment_hold');assert.equal(order.hold,true);assert.equal(order.canApprove,false);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');
    const rejected=await f.act(order.id,'reject');assert.equal(rejected.order.status,'refund_required');assert.equal(rejected.order.hold,true);assert.equal((await f.act(order.id,'reject')).duplicate,true);
  }
  assert.deepEqual((await f.service.getPublic()).listings,[]);assert.equal(f.count('sponsor_payment_holds'),types.length);
});

test('charge-only refund before checkout is correlated before approval; charge-only dispute after approval removes listing',async t=>{
  const f=fixture(t);await f.deliver(f.event('refund.created',{id:'re_ChargeOnlyUnitTest',object:'refund',charge:'ch_UnitTest00000001',payment_intent:null}));await f.deliver(f.event('checkout.session.completed',f.checkout()));let order=(await f.service.getAdmin()).orders[0];
  assert.equal(order.paymentVerified,false);assert.equal(order.canApprove,false);await f.deliver(f.event('charge.succeeded',f.charge()));order=await f.service.getAdminOrder(order.id);assert.equal(order.status,'payment_hold');assert.equal(order.hold,true);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');
  const second=await f.pay('00000002');await f.act(second.id,'approve');assert.equal((await f.service.getPublic()).listings.length,1);
  await f.deliver(f.event('charge.dispute.created',{id:'du_ChargeOnlyUnitTest',object:'dispute',charge:'ch_UnitTest00000002',payment_intent:null,livemode:true,status:'needs_response'}));assert.deepEqual((await f.service.getPublic()).listings,[]);assert.equal((await f.service.getAdminOrder(second.id)).status,'payment_hold');
});

test('partial refunds and older refund snapshots permanently hide an approved order',async t=>{
  const f=fixture(t),order=await f.pay();await f.act(order.id,'approve');f.advance(1000);
  await f.deliver(f.event('charge.updated',f.charge('00000001',{amount_refunded:1}),{created:Math.floor(f.time()/1000)-10}));assert.equal((await f.service.getAdminOrder(order.id)).hold,true);assert.deepEqual((await f.service.getPublic()).listings,[]);
  await f.deliver(f.event('charge.updated',f.charge()));assert.equal((await f.service.getAdminOrder(order.id)).hold,true);assert.deepEqual((await f.service.getPublic()).listings,[]);
});

test('approval retries start one fixed period, pause/resume never extends it and expiry is enforced on reads',async t=>{
  const f=fixture(t),order=await f.pay();const approvals=await Promise.all(Array.from({length:8},()=>f.act(order.id,'approve')));assert.equal(approvals.filter(value=>!value.duplicate).length,1);
  const {startsAt,endsAt}=approvals[0].order;assert.equal(startsAt,f.time());assert.equal(endsAt,startsAt+30*DAY);assert.equal(f.db.prepare("SELECT count(*) n FROM sponsor_audit WHERE to_state='approved'").get().n,1);
  f.advance(2*DAY);const pauses=await Promise.all(Array.from({length:4},()=>f.act(order.id,'pause')));assert.equal(pauses.filter(value=>!value.duplicate).length,1);assert.deepEqual((await f.service.getPublic()).listings,[]);
  f.advance(10*DAY);const resumed=await f.act(order.id,'approve');assert.equal(resumed.order.startsAt,startsAt);assert.equal(resumed.order.endsAt,endsAt);assert.equal((await f.service.getPublic()).listings.length,1);
  f.setTime(endsAt);assert.equal((await f.service.getAdminOrder(order.id)).status,'expired');assert.deepEqual((await f.service.getPublic()).listings,[]);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');
});

test('unreviewed payment at seven days cannot be silently approved; delayed delivery retains original deadline',async t=>{
  const f=fixture(t),order=await f.pay();f.setTime(order.paidAt+7*DAY);let current=await f.service.getAdminOrder(order.id);assert.equal(current.status,'review_overdue');assert.equal(current.canApprove,false);assert.equal(current.canReject,true);await rejects(f.act(order.id,'approve'),'sponsor_action_blocked');assert.equal((await f.act(order.id,'reject')).order.status,'refund_required');
  const old=Math.floor((f.time()-8*DAY)/1000);await f.deliver(f.event('checkout.session.completed',f.checkout('00000002'),{created:old}));await f.deliver(f.event('charge.succeeded',f.charge('00000002'),{created:old}));current=(await f.service.getAdmin()).orders.find(row=>row.sessionId.endsWith('00000002'));assert.equal(current.status,'review_overdue');assert.equal(current.canApprove,false);
});

test('hold received between operator preflight and update atomically blocks approval',async t=>{
  const f=fixture(t),order=await f.pay();let injected=false;
  f.hook(async sql=>{if(!injected&&sql.startsWith('UPDATE sponsor_orders AS o')){injected=true;await f.deliver(f.event('refund.created',{id:'re_RacingUnitTest',object:'refund',payment_intent:order.paymentIntentId,charge:null}));}});
  await rejects(f.act(order.id,'approve'),'sponsor_stale_state');assert.equal((await f.service.getAdminOrder(order.id)).status,'payment_hold');assert.deepEqual((await f.service.getPublic()).listings,[]);assert.equal(f.db.prepare("SELECT count(*) n FROM sponsor_audit WHERE to_state='approved'").get().n,0);
});

test('simultaneous approval and rejection honor one confirmed version and force the other operator to refresh',async t=>{
  const f=fixture(t),order=await f.pay(),expected=f.expected(order);const outcomes=await Promise.allSettled([f.act(order.id,'approve',expected),f.act(order.id,'reject',expected)]);
  assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal(outcomes.find(value=>value.status==='rejected').reason.code,'sponsor_stale_state');
  await f.act(order.id,'reject');assert.equal((await f.service.getAdminOrder(order.id)).status,'refund_required');assert.deepEqual((await f.service.getPublic()).listings,[]);
});

test('same-millisecond state versions prevent stale approve from undoing another operator pause',async t=>{
  const f=fixture(t),order=await f.pay(),oldExpected=f.expected(order),at=f.time();
  const approved=(await f.act(order.id,'approve',oldExpected)).order;assert.ok(approved.updatedAt>order.updatedAt);
  const paused=(await f.act(order.id,'pause',f.expected(approved))).order;assert.ok(paused.updatedAt>approved.updatedAt);assert.equal(f.time(),at);
  await rejects(f.act(order.id,'approve',oldExpected),'sponsor_stale_state');assert.equal((await f.service.getAdminOrder(order.id)).status,'paused');assert.deepEqual((await f.service.getPublic()).listings,[]);
  const resumed=(await f.act(order.id,'approve',f.expected(paused))).order;assert.equal(resumed.startsAt,approved.startsAt);assert.equal(resumed.endsAt,approved.endsAt);assert.ok(resumed.updatedAt>paused.updatedAt);
});

test('fulfillment/audit/hold failures roll back the complete event or admin mutation for safe redelivery',async t=>{
  const f=fixture(t),value=f.event('checkout.session.completed',f.checkout());
  f.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON sponsor_audit BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");await rejects(f.deliver(value),'sponsor_storage_unavailable');assert.equal(f.count('sponsor_events'),0);assert.equal(f.count('sponsor_orders'),0);f.db.exec('DROP TRIGGER fixture_audit_failure');await f.deliver(value);await f.deliver(f.event('charge.succeeded',f.charge()));const order=(await f.service.getAdmin()).orders[0];
  f.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON sponsor_audit WHEN NEW.to_state='approved' BEGIN SELECT RAISE(ABORT,'fixture approval failure'); END;");await rejects(f.act(order.id,'approve'),'sponsor_storage_unavailable');assert.equal((await f.service.getAdminOrder(order.id)).status,'paid_pending_review');assert.equal((await f.service.getAdminOrder(order.id)).startsAt,null);f.db.exec('DROP TRIGGER fixture_audit_failure');
  const refund=f.event('charge.refunded',f.charge('00000001',{amount_refunded:3300})),events=f.count('sponsor_events');f.db.exec("CREATE TRIGGER fixture_hold_failure BEFORE INSERT ON sponsor_payment_holds BEGIN SELECT RAISE(ABORT,'fixture hold failure'); END;");await rejects(f.deliver(refund),'sponsor_storage_unavailable');assert.equal(f.count('sponsor_events'),events);assert.equal(f.db.prepare('SELECT amount_refunded FROM sponsor_charges').get().amount_refunded,0);assert.equal(f.count('sponsor_payment_holds'),0);f.db.exec('DROP TRIGGER fixture_hold_failure');await f.deliver(refund);assert.equal((await f.service.getAdminOrder(order.id)).hold,true);
});

test('database prevents changing submitted content, resetting dates, clearing holds or deleting audit history',async t=>{
  const f=fixture(t),order=await f.pay();await f.act(order.id,'approve');await f.deliver(f.event('refund.created',{id:'re_ImmutableUnitTest',object:'refund',payment_intent:order.paymentIntentId,charge:null}));
  for(const sql of ["UPDATE sponsor_orders SET sponsor_name='another'",'UPDATE sponsor_orders SET amount=3301','UPDATE sponsor_orders SET starts_at=starts_at+1,ends_at=ends_at+1',"UPDATE sponsor_orders SET state='paid_pending_review',starts_at=NULL,ends_at=NULL",'UPDATE sponsor_orders SET payment_intent_id=NULL','DELETE FROM sponsor_orders','UPDATE sponsor_events SET event_at=0','DELETE FROM sponsor_events','DELETE FROM sponsor_charges',"UPDATE sponsor_payment_holds SET reason='refund_failed'",'DELETE FROM sponsor_payment_holds','UPDATE sponsor_audit SET created_at=0','DELETE FROM sponsor_audit'])assert.throws(()=>f.db.exec(sql),undefined,sql);
});

test('HTTP public responses reveal only minimal order state and never purchaser data, credentials or raw webhooks',async t=>{
  const f=fixture(t),order=await f.pay(),response=await f.api('/order?session_id='+order.sessionId);
  assert.equal(response.status,200);assert.deepEqual(Object.keys(response.data).sort(),['amount','currency','endsAt','sponsorName','startsAt','status'].sort());assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  await f.act(order.id,'approve');const catalog=await f.api();const serialized=JSON.stringify(catalog.data);for(const secret of [SECRET,ADMIN,order.sessionId,order.paymentIntentId,'private-buyer','非公開'])assert.ok(!serialized.includes(secret),secret);
  const stored=JSON.stringify(['sponsor_events','sponsor_orders','sponsor_charges','sponsor_payment_holds','sponsor_audit'].map(table=>f.db.prepare('SELECT * FROM '+table).all()));assert.ok(!stored.includes('private-buyer'));assert.ok(!stored.includes('非公開'));assert.ok(!stored.includes('customer_details'));
  assert.equal((await f.api('/order?session_id=cs_live_UnknownUnitTest123')).data.status,'awaiting_confirmation');assert.equal((await f.api('/order?session_id=cs_test_invalid')).status,400);
  assert.equal(await handleSponsors(new Request(ORIGIN+'/unrelated'),f.env),null);
});

test('HTTP admin needs configured bearer token and same-origin JSON mutations; cookies and body overrides do not authorize',async t=>{
  const f=fixture(t),order=await f.pay(),path='/admin/'+order.id+'/approve';
  assert.equal((await f.api('/admin')).status,401);assert.equal((await f.api('/admin',{headers:{Cookie:'admin=true'}})).status,401);assert.equal((await f.api('/admin',{headers:{Authorization:'Bearer '+'x'.repeat(40)}})).status,401);
  assert.equal((await f.api('/admin',{headers:{Authorization:'Bearer '+ADMIN}},{...f.env,SPONSOR_ADMIN_TOKEN:''})).status,503);
  for(const headers of [{Authorization:'Bearer '+ADMIN,'Content-Type':'application/json'},{Authorization:'Bearer '+ADMIN,'Content-Type':'application/json',Origin:'https://attacker.invalid'},{Authorization:'Bearer '+ADMIN,'Content-Type':'application/json',Origin:ORIGIN,'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.api(path,{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await f.api(path,{method:'POST',headers:{Authorization:'Bearer '+ADMIN,Origin:ORIGIN,'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await f.admin('/'+order.id+'/approve',{amount:1,sponsorName:'changed'})).status,400);
  assert.equal((await f.admin('/'+order.id+'/approve',{})).status,400);
  assert.equal((await f.admin('/'+order.id+'/approve',{expectedStatus:order.status,expectedUpdatedAt:order.updatedAt-1})).data.code,'sponsor_stale_state');
  assert.equal((await f.admin('/'+order.id+'/approve')).data.order.status,'approved');assert.equal((await f.admin('/'+order.id+'/approve')).data.duplicate,true);assert.equal((await f.admin()).data.orders.length,1);
});

test('HTTP webhook is origin-independent but refuses oversized, malformed or wrongly signed payloads',async t=>{
  const f=fixture(t),event=f.event('checkout.session.completed',f.checkout());let request=f.request(event,{headers:{Origin:'https://stripe-webhook.test'}});let response=await handleSponsors(request,f.env);assert.equal(response.status,200);
  request=f.request(event,{raw:'{broken-json'});response=await handleSponsors(request,f.env);assert.equal(response.status,400);assert.equal((await response.json()).code,'sponsor_event_invalid');
  request=f.request(event,{raw:'x'.repeat(262145)});response=await handleSponsors(request,f.env);assert.equal(response.status,413);assert.equal(f.count('sponsor_orders'),1);
  assert.equal((await f.api('/stripe-webhook')).status,405);assert.equal((await f.api('',{},{})).status,503);
});

test('admin list uses one D1 query even with 200 orders and includes correlated hold reasons',async t=>{
  const f=fixture(t);
  for(let i=1;i<=200;i++)await f.deliver(f.event('checkout.session.completed',f.checkout(String(i).padStart(8,'0'))));
  await f.deliver(f.event('refund.failed',{id:'re_QueryLimitFixture',object:'refund',payment_intent:'pi_UnitTest00000001',charge:null}));
  const prepare=f.database.prepare;let queries=0;f.database.prepare=(...args)=>{queries++;return prepare(...args);};
  const result=await f.service.getAdmin();assert.equal(result.orders.length,200);assert.equal(queries,1);assert.deepEqual(result.orders.find(row=>row.paymentIntentId==='pi_UnitTest00000001').holdReasons,['refund_failed']);
});

test('sponsorship schema and all fulfillment actions never change real reward, treasury or sandbox balances',async t=>{
  const f=fixture(t,{finance:true,migrate:false});
  f.db.prepare('INSERT INTO profiles(id,auth_id,code,created_at,updated_at) VALUES(?,?,?,?,?)').run('sponsor-isolation-user','sponsor-isolation-auth','sponsor-code',f.time(),f.time());
  f.db.prepare('INSERT INTO exchange_reward_events(provider_id,event_id,user_id,points,receipt_ref,created_at) VALUES(?,?,?,?,?,?)').run('test-only-verifier','isolation-reward','sponsor-isolation-user',500,'test-fixture',f.time());
  f.db.prepare('INSERT INTO reward_treasury_funding(receipt_id,provider_id,asset,network,amount_satoshis,destination_ref,confirmations,created_at) VALUES(?,?,?,?,?,?,?,?)').run('a'.repeat(64)+':0','test-only-verifier','BTC','bitcoin',1200,'test-only-destination',6,f.time());
  f.db.prepare('INSERT INTO exchange_sandbox_refills(id,user_id,idempotency_key,points,created_at) VALUES(?,?,?,?,?)').run('test-only-refill','sponsor-isolation-user','test-refill-idempotency',10000,f.time());
  const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'exchange_%' OR name LIKE 'reward_treasury_%') ORDER BY name").all().map(row=>row.name),snapshot=()=>Object.fromEntries(tables.map(table=>[table,f.db.prepare('SELECT * FROM '+table).all()])),before=snapshot();
  f.db.exec(schema());assert.deepEqual(snapshot(),before);
  const fetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Sponsorship must not call an external financial API');};t.after(()=>{globalThis.fetch=fetch;});
  const order=await f.pay();await f.act(order.id,'approve');await f.act(order.id,'pause');await f.act(order.id,'approve');await f.deliver(f.event('refund.created',{id:'re_FinanceIsolation',object:'refund',payment_intent:order.paymentIntentId,charge:null}));await f.act(order.id,'reject');
  assert.deepEqual(snapshot(),before);assert.equal((await f.service.getPublic()).listings.length,0);
});
