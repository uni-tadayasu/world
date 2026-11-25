import test from 'node:test';
import assert from 'node:assert/strict';
import {createSponsorsPage,SPONSOR_OFFER,safeCheckoutUrl,safeSponsorUrl} from '../dist/sponsors.js';
import {createSponsorAdmin} from '../dist/sponsor-admin.js';

const NOW=1795600000000,DAY=86400000,KEY='client-test-admin-key-only-in-memory-123456789';
const MERCHANT={sellerName:'試験用の運営者',representative:'試験 担当',address:'試験データの住所です（公開・実決済には使用しません）',phone:'0312345678',email:'contact@sponsor-fixture.example',paymentMethods:['カード'],paymentTiming:'決済画面でお支払いが確定した時点'};
// A synthetic URL, used only with injected navigation; never contacted.
const CHECKOUT='https://buy.stripe.com/abc123ABCfixture987';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function dom(){
  const elements=new Map();function node(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,value:'',className:'',listeners:new Map(),addEventListener(event,callback){this.listeners.set(event,callback);},removeEventListener(event,callback){if(this.listeners.get(event)===callback)this.listeners.delete(event);},scrollIntoView(){}});return elements.get(id);}
  return {node,querySelector:selector=>selector.startsWith('#')?node(selector.slice(1)):null,querySelectorAll:()=>[]};
}
const publicSnapshot=patch=>({offer:{...SPONSOR_OFFER},enabled:false,disabledReason:'販売準備中',checkoutUrl:null,merchant:null,listings:[],serverTime:NOW,...patch});
const listing=patch=>({id:'sponsor-1',sponsorName:'試験用のスポンサー',url:'https://sponsor-fixture.example/',message:'試験用の紹介文',startsAt:NOW-DAY,endsAt:NOW+29*DAY,...patch});
function publicHarness({snapshot=publicSnapshot(),fetcher,...options}={}){
  const root=dom(),requests=[],navigations=[];let current=snapshot;
  const page=createSponsorsPage(root,{href:'https://machi-life.hisa-0128-1996.chatgpt.site/sponsors.html',navigate:url=>navigations.push(url),fetcher:async(url,init)=>{requests.push({url,...init});return fetcher?fetcher(url,init):Response.json(current);},...options});
  return {root,page,requests,navigations,setSnapshot:value=>{current=value;}};
}

test('sponsor sales stay disabled without verified server readiness and terms acknowledgement',async t=>{
  const h=publicHarness();t.after(()=>h.page.dispose());await h.page.load();assert.equal(h.page.getState().ready,false);assert.equal(h.page.setTermsAcknowledged(true),false);assert.equal(h.page.checkout(),false);
  assert.equal(h.root.node('sponsor-buy').disabled,true);assert.equal(h.root.node('sponsor-buy').textContent,'販売準備中');assert.equal(h.navigations.length,0);assert.ok(h.requests.every(request=>request.method==='GET'));
});

test('valid live checkout opens only after consent and cannot open twice',async t=>{
  const h=publicHarness({snapshot:publicSnapshot({enabled:true,checkoutUrl:CHECKOUT,merchant:MERCHANT})});t.after(()=>h.page.dispose());await h.page.load();assert.equal(h.page.getState().ready,true);assert.equal(h.page.checkout(),false);assert.equal(h.root.node('sponsor-buy').disabled,true);
  assert.equal(h.page.setTermsAcknowledged(true),true);assert.equal(h.root.node('sponsor-buy').disabled,false);assert.equal(h.page.checkout(),true);assert.equal(h.page.checkout(),false);assert.deepEqual(h.navigations,[CHECKOUT]);assert.equal(h.requests.filter(x=>x.method!=='GET').length,0);
});

test('checkout rejects a changed offer, missing merchant disclosures and unsafe URLs even when enabled is true',async()=>{
  const ready=publicSnapshot({enabled:true,checkoutUrl:CHECKOUT,merchant:MERCHANT});
  for(const patch of [{offer:{...SPONSOR_OFFER,amount:3301}},{offer:{...SPONSOR_OFFER,currency:'usd'}},{offer:{...SPONSOR_OFFER,reviewDays:30}},{merchant:{}},{merchant:{...MERCHANT,email:''}},{merchant:{...MERCHANT,paymentMethods:[]}},{merchant:{...MERCHANT,paymentTiming:''}},{checkoutUrl:'https://buy.stripe.com.attacker.example/abc123'},{checkoutUrl:'https://buy.stripe.com/test_abc123'},{checkoutUrl:'https://attacker.example/abc123'},{checkoutUrl:'javascript:alert(1)'}]){
    const h=publicHarness({snapshot:{...ready,...patch}});try{assert.equal(await h.page.load(),false);assert.equal(h.page.setTermsAcknowledged(true),false);assert.equal(h.page.checkout(),false);assert.equal(h.navigations.length,0);}finally{h.page.dispose();}
  }
  for(const value of ['http://buy.stripe.com/abc123','https://buyer:secret@buy.stripe.com/abc123','https://buy.stripe.com:8443/abc123','https://buy.stripe.com/abc123?redirect=https://attacker.example','https://buy.stripe.com/abc123#fragment'])assert.equal(safeCheckoutUrl(value),null);
  for(const value of ['javascript:alert(1)','http://public.example','https://127.0.0.1/','https://0x7f000001/','https://local.host.local/','https://host.internal/','https://127.0.0.1.nip.io@localhost/','https://private.home/'])assert.equal(safeSponsorUrl(value),null);
});

test('an old enabled response cannot re-enable sales after a newer disabled snapshot',async t=>{
  const first=deferred(),entered=deferred();let count=0;const h=publicHarness({fetcher:()=>{count++;if(count===1){entered.resolve();return first.promise;}return Response.json(publicSnapshot());}});t.after(()=>h.page.dispose());
  const old=h.page.load();await entered.promise;assert.equal(await h.page.load(),true);first.resolve(Response.json(publicSnapshot({enabled:true,checkoutUrl:CHECKOUT,merchant:MERCHANT})));assert.equal(await old,false);assert.equal(h.page.getState().ready,false);assert.equal(h.page.checkout(),false);
});

test('every valid active sponsor is displayed, with escaped content and safe website links',async t=>{
  const valid=Array.from({length:125},(_,i)=>listing({id:'sponsor-'+i,sponsorName:'スポンサー'+i}));valid.push(listing({id:'emoji-name',sponsorName:'🌳'.repeat(60)}),listing({id:'escaped-name',sponsorName:'<img src=x onerror=alert(1)>',message:'<script>bad()</script>'}));
  const invalid=[listing({id:'expired',endsAt:NOW}),listing({id:'future',startsAt:NOW+1}),listing({id:'private',url:'https://127.0.0.1/'}),listing({id:'script',url:'javascript:alert(1)'})];
  const h=publicHarness({snapshot:publicSnapshot({listings:[...valid,...invalid]})});t.after(()=>h.page.dispose());await h.page.load();assert.equal(h.page.getState().listings.length,127);const html=h.root.node('sponsor-directory-cards').innerHTML;
  assert.ok(html.includes('スポンサー124'),'the 101st and later paid listings cannot be silently truncated');assert.ok(html.includes('🌳'.repeat(60)));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('rel="sponsored noopener noreferrer"'));assert.equal((html.match(/広告 \/ SPONSOR/g)||[]).length,127);
});

test('a checkout return URL never claims payment success before authoritative receipt confirmation',async t=>{
  let status='awaiting_confirmation';const h=publicHarness({href:'https://machi-life.hisa-0128-1996.chatgpt.site/sponsors.html?session_id=cs_live_clientFixture1234&paid=true&success=true',fetcher:url=>Response.json(url.includes('/order?')?{status,amount:3300,currency:'jpy',sponsorName:null,startsAt:null,endsAt:null}:publicSnapshot())});t.after(()=>h.page.dispose());await h.page.start();
  assert.equal(h.page.getState().receipt.status,'awaiting_confirmation');assert.ok(h.root.node('sponsor-receipt-message').textContent.includes('完了は確定しません'));assert.equal(h.root.node('sponsor-directory-cards').innerHTML,'');assert.ok(h.requests.every(request=>request.method==='GET'));
  status='paid_pending_review';assert.equal(await h.page.loadReceipt(),true);assert.ok(h.root.node('sponsor-receipt-message').textContent.includes('お支払いを確認'));assert.equal(h.root.node('sponsor-directory-cards').innerHTML,'','receipt reads must not fulfill a listing');
  status='review_overdue';await h.page.loadReceipt();assert.ok(h.root.node('sponsor-receipt-message').textContent.includes('掲載は開始していません'));assert.ok(!h.root.node('sponsor-receipt-message').textContent.includes('返金が完了'));
});

test('failed or malformed receipt reads do not imply a paid order or offer an automatic repurchase',async t=>{
  let bad=false;const h=publicHarness({href:'https://machi-life.hisa-0128-1996.chatgpt.site/sponsors.html?session_id=cs_live_clientFixture1234',fetcher:url=>url.includes('/order?')?bad?Response.json({status:'paid',amount:3300,currency:'jpy'}):Response.json({error:'missing webhook'},{status:503}):Response.json(publicSnapshot())});t.after(()=>h.page.dispose());await h.page.start();assert.equal(h.page.getState().receipt,null);assert.ok(h.page.getState().receiptError);assert.equal(h.navigations.length,0);
  bad=true;assert.equal(await h.page.loadReceipt(),false);assert.equal(h.page.getState().receipt,null);assert.ok(h.page.getState().receiptError.includes('完了したとは判断できません'));assert.equal(h.requests.filter(request=>request.method!=='GET').length,0);
});

test('public disposal cancels pending reads and removes interactive listeners',async()=>{
  const entered=deferred(),result=deferred(),h=publicHarness({fetcher:()=>{entered.resolve();return result.promise;}});const starting=h.page.start();await entered.promise;h.page.dispose();result.resolve(Response.json(publicSnapshot({enabled:true,checkoutUrl:CHECKOUT,merchant:MERCHANT})));await starting;
  assert.equal(h.page.getState().ready,false);assert.equal(h.page.checkout(),false);assert.equal(h.root.node('sponsor-buy').listeners.size,0);assert.equal(h.navigations.length,0);
});

function adminOrder(patch={}){return {id:'sp_clientfixture001',status:'paid_pending_review',sponsorName:'試験用スポンサー',url:'https://sponsor-fixture.example/',message:'試験用の紹介文',amount:3300,currency:'jpy',paidAt:NOW,startsAt:null,endsAt:null,createdAt:NOW,updatedAt:NOW,reviewDeadlineAt:NOW+7*DAY,hold:false,holdReasons:[],contentValid:true,paymentVerified:true,paymentStatus:'paid',canApprove:true,canReject:true,canPause:false,sessionId:'cs_live_clientFixture1234',paymentIntentId:'pi_clientFixture1234',...patch};}
function adminHarness({intercept,orderPatch,...options}={}){
  const root=dom(),requests=[];let item=adminOrder(orderPatch);
  const snapshot=()=>({orders:[structuredClone(item)],serverTime:NOW,offer:{...SPONSOR_OFFER},enabled:false,disabledReason:'販売準備中'});
  function serve(url,init){if(init.method==='GET')return Response.json(snapshot());const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body).sort(),['expectedStatus','expectedUpdatedAt']);if(body.expectedStatus!==item.status||body.expectedUpdatedAt!==item.updatedAt)return Response.json({error:'状態が変わりました。',code:'sponsor_stale_state'},{status:409});const action=url.split('/').at(-1);if(action==='approve'){item={...item,status:'approved',startsAt:item.startsAt??NOW,endsAt:item.endsAt??NOW+30*DAY,canApprove:false,canPause:true,updatedAt:item.updatedAt+1};}else if(action==='reject'){item={...item,status:'refund_required',canApprove:false,canReject:false,canPause:false,updatedAt:item.updatedAt+1};}else if(action==='pause'){item={...item,status:'paused',canApprove:true,canPause:false,updatedAt:item.updatedAt+1};}else assert.fail('unexpected sponsor action');return Response.json({order:structuredClone(item),duplicate:false,serverTime:NOW});}
  const page=createSponsorAdmin(root,{fetcher:async(url,init)=>{requests.push({url,...init});const custom=intercept?await intercept({url,init,serve:()=>serve(url,init)}):undefined;return custom??serve(url,init);},...options});page.start();
  return {root,page,requests,setOrder:patch=>{item=adminOrder(patch);},snapshot};
}

test('admin credentials are sent only as headers after explicit connection and are cleared on disconnect',async t=>{
  const h=adminHarness();t.after(()=>h.page.dispose());assert.equal(h.requests.length,0);assert.equal(await h.page.connect('short'),false);assert.equal(h.requests.length,0);h.root.node('sponsor-admin-token').value=KEY;
  assert.equal(await h.page.connect(KEY),true);assert.equal(h.root.node('sponsor-admin-token').value,'');assert.equal(h.page.getState().connected,true);assert.ok(!JSON.stringify(h.page.getState()).includes(KEY));
  for(const request of h.requests){assert.equal(request.url,'/api/sponsors/admin');assert.equal(request.headers.Authorization,'Bearer '+KEY);assert.equal(request.credentials,'same-origin');assert.ok(!request.url.includes(KEY));assert.equal(request.body,undefined);}
  h.page.disconnect();assert.equal(h.page.getState().connected,false);assert.equal(h.page.getState().orders.length,0);assert.equal(await h.page.load(),false);assert.equal(h.root.node('sponsor-admin-workspace').hidden,true);
});

test('admin approval is confirmed once and reconciles with a fresh server read',async t=>{
  const h=adminHarness();t.after(()=>h.page.dispose());await h.page.connect(KEY);assert.equal(h.page.requestAction('sp_clientfixture001','approve'),true);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  const action=h.page.confirmAction(),duplicate=h.page.confirmAction();assert.equal(await duplicate,false);assert.equal(await action,true);assert.equal(h.page.getState().orders[0].status,'approved');assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.requests.filter(x=>x.method==='GET').length,2);assert.ok(h.root.node('sponsor-admin-orders').innerHTML.includes('注文金額'));assert.ok(h.root.node('sponsor-admin-summary').innerHTML.includes('表示中の記録にある支払総額'));
});

test('admin rejects without claiming or making a Stripe refund and cannot approve an unverified payment',async t=>{
  const h=adminHarness({orderPatch:{hold:true,holdReasons:['refund'],paymentVerified:false,canApprove:true,contentValid:false}});t.after(()=>h.page.dispose());await h.page.connect(KEY);assert.equal(h.page.requestAction('sp_clientfixture001','approve'),false);assert.equal(h.page.requestAction('sp_clientfixture001','reject'),true);assert.ok(h.root.node('sponsor-admin-confirm-message').textContent.includes('実際の返金はStripeで別途'));
  assert.equal(await h.page.confirmAction(),true);assert.equal(h.page.getState().orders[0].status,'refund_required');assert.ok(h.page.getState().notice.includes('実際の返金はStripeで処理'));assert.ok(h.requests.every(request=>request.url.startsWith('/api/sponsors/admin')));assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});

test('an unresolved admin mutation cannot be blindly repeated before a fresh state read',async t=>{
  let lose=true;const h=adminHarness({intercept:({init,serve})=>{if(init.method==='POST'&&lose){lose=false;serve();throw new TypeError('connection lost after commit');}}});t.after(()=>h.page.dispose());await h.page.connect(KEY);h.page.requestAction('sp_clientfixture001','approve');assert.equal(await h.page.confirmAction(),false);
  assert.equal(h.page.getState().needsRefresh,true);assert.equal(h.page.requestAction('sp_clientfixture001','approve'),false);assert.equal(await h.page.confirmAction(),false);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
  assert.equal(await h.page.load(),true);assert.equal(h.page.getState().orders[0].status,'approved');assert.equal(h.page.getState().needsRefresh,false);assert.equal(h.page.requestAction('sp_clientfixture001','approve'),false);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});

test('admin authorization failure removes sensitive records and pending confirmations',async t=>{
  const h=adminHarness({intercept:({init})=>init.method==='POST'?Response.json({error:'expired'},{status:401}):undefined});t.after(()=>h.page.dispose());await h.page.connect(KEY);h.page.requestAction('sp_clientfixture001','approve');assert.equal(await h.page.confirmAction(),false);
  assert.equal(h.page.getState().connected,false);assert.deepEqual(h.page.getState().orders,[]);assert.equal(h.page.getState().confirmation,null);assert.equal(h.page.getState().needsRefresh,false);assert.equal(h.root.node('sponsor-admin-workspace').hidden,true);assert.equal(await h.page.load(),false);
});

test('late admin responses after disconnect cannot reconnect or expose records',async t=>{
  const entered=deferred(),result=deferred();const h=adminHarness({intercept:({init})=>{if(init.method==='GET'){entered.resolve();return result.promise;}}});t.after(()=>h.page.dispose());const connecting=h.page.connect(KEY);await entered.promise;h.page.disconnect();result.resolve(Response.json(h.snapshot()));assert.equal(await connecting,false);
  assert.equal(h.page.getState().connected,false);assert.equal(h.page.getState().orders.length,0);assert.equal(h.root.node('sponsor-admin-workspace').hidden,true);assert.equal(h.root.node('sponsor-admin-token').value,'');
});

test('a confirmed admin change followed by read failure requires refresh and never replays the mutation',async t=>{
  let post=false,fail=true;const h=adminHarness({intercept:({init})=>{if(init.method==='POST')post=true;else if(post&&fail){fail=false;return Response.json({error:'temporary'},{status:503});}}});t.after(()=>h.page.dispose());await h.page.connect(KEY);h.page.requestAction('sp_clientfixture001','approve');assert.equal(await h.page.confirmAction(),false);
  assert.equal(h.page.getState().needsRefresh,true);assert.ok(h.page.getState().error.includes('操作の受付は確認'));assert.equal(h.page.requestAction('sp_clientfixture001','pause'),false);assert.equal(await h.page.load(),true);assert.equal(h.page.getState().orders[0].status,'approved');assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
  assert.equal(h.page.requestAction('sp_clientfixture001','pause'),true);assert.ok(h.root.node('sponsor-admin-confirm-message').textContent.includes('運営都合で掲載を提供できない場合は全額返金'));
});

test('an operator cannot apply an old confirmation to another operator’s changed listing',async t=>{
  const h=adminHarness();t.after(()=>h.page.dispose());await h.page.connect(KEY);h.page.requestAction('sp_clientfixture001','approve');
  h.setOrder({status:'paused',updatedAt:NOW+2,startsAt:NOW-10*DAY,endsAt:NOW+20*DAY,canApprove:true,canPause:false});
  assert.equal(await h.page.confirmAction(),false);assert.equal(h.page.getState().needsRefresh,true);assert.equal(h.page.getState().confirmation,null);assert.equal(await h.page.confirmAction(),false);
  const oldPost=h.requests.find(request=>request.method==='POST');assert.deepEqual(JSON.parse(oldPost.body),{expectedStatus:'paid_pending_review',expectedUpdatedAt:NOW});assert.equal(h.requests.filter(request=>request.method==='POST').length,1);
  await h.page.load();assert.equal(h.page.getState().orders[0].status,'paused');assert.equal(h.page.requestAction('sp_clientfixture001','approve'),true);assert.ok(h.root.node('sponsor-admin-confirm-message').textContent.includes('終了日時は延長しません'));
  assert.equal(await h.page.confirmAction(),true);const posts=h.requests.filter(request=>request.method==='POST');assert.equal(posts.length,2);assert.deepEqual(JSON.parse(posts[1].body),{expectedStatus:'paused',expectedUpdatedAt:NOW+2});assert.equal(h.page.getState().orders[0].endsAt,NOW+20*DAY);
});
