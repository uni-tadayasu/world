import test from 'node:test';
import assert from 'node:assert/strict';
import {createExchange} from '../dist/exchange.js';

function harness(options={}){
  const shell={innerHTML:'',isConnected:true,querySelector:()=>({addEventListener(){}})},requests=[];
  const exchange=createExchange({openPanel:()=>({querySelector:()=>shell}),getGameMoney:()=>999999999,hosted:true,sessionReader:async()=>({user:{id:'device-A'}}),
    fetcher:async(url,init)=>{requests.push({url,...init});return Response.json({userId:'device-A',available:false,mode:'preparing',asset:'BTC',balance:{confirmedPoints:0,availablePoints:0,reservedPoints:0},requests:[]});},...options});
  return {exchange,shell,requests};
}

test('exchange reads only authoritative rewards and never submits game money or a payout',async()=>{
  const {exchange,shell,requests}=harness();exchange.open();await exchange.sync();
  assert.equal(exchange.getState().available,false);assert.equal(exchange.getState().balance.availablePoints,0);
  assert.ok(shell.innerHTML.includes('¥999,999,999'));assert.ok(shell.innerHTML.includes('換金対象外'));assert.ok(shell.innerHTML.includes('現在、実際の交換・送金はできません'));
  for(const request of requests){assert.equal(request.method,'GET');assert.equal(request.url,'/api/social/exchange');assert.equal(request.credentials,'same-origin');assert.equal(request.headers['X-Machi-User-Id'],'device-A');assert.equal(request.body,undefined);}
  assert.ok(!/<input|<textarea|<form/i.test(shell.innerHTML),'preparation does not collect a wallet or private key');exchange.dispose();
});

test('a changed browser identity or malformed balance never appears as a valid amount',async()=>{
  for(const result of [
    {userId:'device-B',balance:{confirmedPoints:100,availablePoints:100,reservedPoints:0},requests:[]},
    {userId:'device-A',balance:{confirmedPoints:10,availablePoints:10,reservedPoints:5},requests:[]},
    {userId:'device-A',balance:{confirmedPoints:1,availablePoints:NaN,reservedPoints:0},requests:[]}
  ]){
    const {exchange,shell}=harness({fetcher:async()=>Response.json(result)});exchange.open();assert.equal(await exchange.sync(),false);
    assert.equal(exchange.getState().balance,null);assert.equal(exchange.getState().accountId,null);assert.ok(exchange.getState().error);assert.ok(shell.innerHTML.includes('—'));exchange.dispose();
  }
});

test('closing the screen invalidates a delayed identity response and cannot reopen it',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r),{exchange,shell,requests}=harness({sessionReader:()=>pending});
  exchange.open();const request=exchange.sync(),before=shell.innerHTML;exchange.close();resolve({user:{id:'device-A'}});await request;
  assert.equal(requests.length,0);assert.equal(shell.innerHTML,before);assert.equal(exchange.getState().balance,null);exchange.dispose();
});

test('offline development makes no financial API call and explains the online entry',()=>{
  const {exchange,shell,requests}=harness({hosted:false,sessionReader:()=>{throw new Error('must not connect');}});exchange.open();
  assert.equal(requests.length,0);assert.ok(shell.innerHTML.includes('オンライン版を開く'));assert.equal(exchange.getState().balance,null);exchange.dispose();
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function sandboxHarness({intercept,...options}={}){
  const shell={innerHTML:'',isConnected:true,querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]},requests=[];
  let clock=1700000000000,owner='device-A',counter=0,keyCounter=0,confirmed=0,reserved=0;
  const quotes=new Map(),items=new Map(),refills=new Set(),submissions=new Map();
  const policy={refillPoints:10000,minimumPoints:1000,maximumPoints:1000000,balanceLimitPoints:1000000000000,refillCooldownMs:1500,rateSatoshisPerPoint:1,quoteTtlMs:300000};
  const balance=()=>({confirmedPoints:confirmed,availablePoints:confirmed-reserved,reservedPoints:reserved});
  const view=item=>({...item,canCancel:item.status==='reserved',canComplete:item.status==='reserved'});
  const common=extra=>({userId:owner,mode:'sandbox',network:'simulation',realValue:false,balance:balance(),...extra});
  function serve(url,init,body){
    if(url==='/api/social/exchange')return Response.json({userId:owner,available:false,mode:'preparing',asset:'BTC',balance:{confirmedPoints:333,availablePoints:333,reservedPoints:0},requests:[],program:{name:'MACHI REWARDS',region:'JP',minimumAge:18,policyStatus:'draft',pointsPerSatoshi:1,dailyRewardPoints:100,minimumWithdrawalPoints:10000,maximumWithdrawalPoints:100000,treasury:{confirmedSatoshis:0,allocatedSatoshis:0,availableSatoshis:0,status:'unfunded'},readiness:[{code:'funding_missing',status:'blocked',message:'支払い原資は未入金です。'}],canPay:false}});
    const path=url.slice('/api/social/exchange/sandbox'.length);
    if(init.method==='GET'&&path==='')return Response.json(common({policy,serverTime:clock,requests:[...items.values()].map(view)}));
    if(path==='/refill'){
      if(!refills.has(body.idempotencyKey)){refills.add(body.idempotencyKey);confirmed+=policy.refillPoints;}
      return Response.json(common({}));
    }
    if(path==='/quote'){
      const quote={id:'quote-'+(++counter),points:body.points,receiveSatoshis:body.points,feeSatoshis:0,createdAt:clock,expiresAt:clock+policy.quoteTtlMs};quotes.set(quote.id,quote);return Response.json(common({quote}));
    }
    if(path==='/requests'){
      if(submissions.has(body.idempotencyKey))return Response.json(common({request:view(items.get(submissions.get(body.idempotencyKey)))}));
      const quote=quotes.get(body.quoteId);assert.ok(quote);
      const item={id:'request-'+(++counter),points:quote.points,receiveSatoshis:quote.receiveSatoshis,status:'reserved',createdAt:clock,updatedAt:clock};items.set(item.id,item);submissions.set(body.idempotencyKey,item.id);reserved+=quote.points;
      return Response.json(common({request:view(item)}));
    }
    const match=path.match(/^\/requests\/([^/]+)\/(cancel|complete)$/);assert.ok(match,'only simulation routes may change data');
    const item=items.get(match[1]);assert.ok(item);
    if(item.status==='reserved'){reserved-=item.points;if(match[2]==='complete'){confirmed-=item.points;item.status='simulated_paid';}else item.status='cancelled';item.updatedAt=clock;}
    return Response.json(common({request:view(item)}));
  }
  const exchange=createExchange({openPanel:()=>({querySelector:()=>shell}),getGameMoney:()=>999999999,hosted:true,sessionReader:async()=>({user:{id:owner}}),now:()=>clock,keyFactory:()=>`client-test-operation-${++keyCounter}`,
    fetcher:async(url,init)=>{
      const body=init.body?JSON.parse(init.body):undefined;requests.push({url,...init,parsedBody:body});
      const run=()=>serve(url,init,body),custom=intercept?await intercept({url,init,body,serve:run}):undefined;return custom??run();
    },...options});
  return {exchange,shell,requests,policy,setOwner:value=>{owner=value;},advance:ms=>{clock+=ms;},async openSandbox(){exchange.open();await exchange.sync();return exchange.selectTab('sandbox');}};
}

test('actual rewards show draft conditions without a destination form or executable payout',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());h.exchange.open();assert.equal(await h.exchange.sync(),true);
  assert.ok(h.shell.innerHTML.includes('運用案'));assert.ok(h.shell.innerHTML.includes('支払い原資は未入金'));assert.ok(h.shell.innerHTML.includes('実際の交換・送金はできません'));
  assert.equal(h.exchange.getState().balance.availablePoints,333);assert.ok(!/<input|<textarea|<form/i.test(h.shell.innerHTML));
  assert.equal(await h.exchange.refill(),false);assert.equal(await h.exchange.createQuote(1000),false);assert.equal(await h.exchange.confirmRequest(),false);
  assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
});

test('simulation replenishes, quotes, reserves and completes only after separate explicit operations',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());assert.equal(await h.openSandbox(),true);
  assert.ok(h.shell.innerHTML.includes('検証専用・換金不可・実際のBTCは送金されません'));
  assert.ok(h.shell.innerHTML.includes('検証資金は何度でも補充できます（保有上限あり）'));
  assert.equal(await h.exchange.refill(),true);assert.equal(h.exchange.getState().balance.availablePoints,10000);
  assert.equal(await h.exchange.createQuote(3000),true);assert.ok(h.shell.innerHTML.includes('検証用の受取先'));assert.ok(h.shell.innerHTML.includes('3,000 検証satoshi'));
  assert.equal(h.exchange.getState().requests.length,0,'a quote is not an application');
  assert.equal(await h.exchange.confirmRequest(),true);let state=h.exchange.getState();assert.equal(state.requests[0].status,'reserved');assert.equal(state.balance.availablePoints,7000);assert.equal(state.balance.reservedPoints,3000);
  assert.equal(h.requests.filter(x=>x.url.endsWith('/complete')).length,0,'completion must never be automatic');
  assert.equal(await h.exchange.completeRequest(state.requests[0].id),true);state=h.exchange.getState();assert.equal(state.requests[0].status,'simulated_paid');assert.equal(state.balance.confirmedPoints,7000);assert.equal(state.balance.reservedPoints,0);
  assert.ok(h.shell.innerHTML.includes('実際の送金は行っていません'));assert.equal(await h.exchange.cancelRequest(state.requests[0].id),false);
  for(const request of h.requests.filter(x=>x.method==='POST')){assert.ok(request.url.startsWith('/api/social/exchange/sandbox/'));assert.equal(request.headers['X-Machi-User-Id'],'device-A');assert.equal(request.parsedBody.expectedUserId,'device-A');assert.equal(request.credentials,'same-origin');assert.equal(request.parsedBody.money,undefined);assert.equal(request.parsedBody.destination,undefined);}
  assert.equal(await h.exchange.selectTab('actual'),true);assert.equal(h.exchange.getState().balance.availablePoints,333,'simulation never modifies actual reward display');assert.ok(!h.shell.innerHTML.includes('検証申請を受付済み'));
});

test('simulation cancellation returns the reserved amount once and cannot complete a cancelled request',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());await h.openSandbox();await h.exchange.refill();await h.exchange.createQuote(2500);await h.exchange.confirmRequest();const id=h.exchange.getState().requests[0].id;
  assert.equal(await h.exchange.cancelRequest(id),true);assert.deepEqual(h.exchange.getState().balance,{confirmedPoints:10000,availablePoints:10000,reservedPoints:0});assert.equal(h.exchange.getState().requests[0].status,'cancelled');
  const posts=h.requests.filter(x=>x.method==='POST').length;assert.equal(await h.exchange.cancelRequest(id),false);assert.equal(await h.exchange.completeRequest(id),false);assert.equal(h.requests.filter(x=>x.method==='POST').length,posts);
});

test('double confirmation creates one simulation request and holds one reservation',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());await h.openSandbox();await h.exchange.refill();await h.exchange.createQuote(1000);
  const first=h.exchange.confirmRequest(),second=h.exchange.confirmRequest();assert.equal(await second,false);assert.equal(await first,true);
  assert.equal(h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/requests')).length,1);assert.equal(h.exchange.getState().balance.reservedPoints,1000);
});

test('lost simulation response requires state lookup before same-key confirmation, without another reservation',async t=>{
  let lose=true;const h=sandboxHarness({intercept:({url,init,serve})=>{if(lose&&init.method==='POST'&&url.endsWith('/requests')){lose=false;serve();throw new TypeError('network lost after commit');}}});t.after(()=>h.exchange.dispose());
  await h.openSandbox();await h.exchange.refill();await h.exchange.createQuote(3000);assert.equal(await h.exchange.confirmRequest(),false);
  assert.equal(h.exchange.getState().retryPending,true);assert.equal(h.exchange.getState().balance,null);assert.equal(await h.exchange.refill(),false);assert.equal(await h.exchange.retryLastOperation(),false);
  assert.equal(await h.exchange.sync(),true);assert.equal(h.exchange.getState().requests.length,1);assert.equal(h.exchange.getState().retryReady,true);
  assert.equal(await h.exchange.retryLastOperation(),true);assert.equal(h.exchange.getState().retryPending,false);assert.equal(h.exchange.getState().requests.length,1);assert.equal(h.exchange.getState().balance.reservedPoints,3000);
  const posts=h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/requests'));assert.equal(posts.length,2);assert.equal(posts[0].parsedBody.idempotencyKey,posts[1].parsedBody.idempotencyKey);assert.equal(posts[0].body,posts[1].body);
});

test('closing a committed operation ignores its delayed UI response and preserves a safe same-key check',async t=>{
  const entered=deferred(),release=deferred();let hold=true;
  const h=sandboxHarness({intercept:({url,init,serve})=>{if(hold&&init.method==='POST'&&url.endsWith('/refill')){hold=false;const response=serve();entered.resolve();return release.promise.then(()=>response);}}});t.after(()=>h.exchange.dispose());await h.openSandbox();
  const action=h.exchange.refill();await entered.promise;h.exchange.close();const hidden=h.shell.innerHTML;release.resolve();assert.equal(await action,false);assert.equal(h.shell.innerHTML,hidden);assert.equal(h.exchange.getState().balance,null);
  h.exchange.open();await h.exchange.sync();await h.exchange.selectTab('sandbox');assert.equal(h.exchange.getState().balance.confirmedPoints,10000);assert.equal(h.exchange.getState().retryReady,true);
  assert.equal(await h.exchange.retryLastOperation(),true);assert.equal(h.exchange.getState().balance.confirmedPoints,10000);
  const posts=h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/refill'));assert.equal(posts.length,2);assert.equal(posts[0].parsedBody.idempotencyKey,posts[1].parsedBody.idempotencyKey);
});

test('changing tabs discards a delayed simulation read and clears its quote',async t=>{
  const entered=deferred(),release=deferred();let hold=true;
  const h=sandboxHarness({intercept:({url,init,serve})=>{if(hold&&init.method==='GET'&&url.endsWith('/sandbox')){hold=false;const response=serve();entered.resolve();return release.promise.then(()=>response);}}});t.after(()=>h.exchange.dispose());
  h.exchange.open();await h.exchange.sync();const sandbox=h.exchange.selectTab('sandbox');await entered.promise;await h.exchange.selectTab('actual');release.resolve();assert.equal(await sandbox,false);
  assert.equal(h.exchange.getState().tab,'actual');assert.equal(h.exchange.getState().balance.availablePoints,333);assert.ok(!h.shell.innerHTML.includes('検証資金を補充する'));
  await h.exchange.selectTab('sandbox');await h.exchange.refill();await h.exchange.createQuote(1000);assert.ok(h.exchange.getState().quote);await h.exchange.selectTab('actual');assert.equal(h.exchange.getState().quote,null);
});

test('a changed device identity before mutation sends no application and hides old funds',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());await h.openSandbox();await h.exchange.refill();await h.exchange.createQuote(1000);h.setOwner('device-B');
  assert.equal(await h.exchange.confirmRequest(),false);assert.equal(h.exchange.getState().accountId,null);assert.equal(h.exchange.getState().balance,null);assert.equal(h.exchange.getState().quote,null);assert.ok(h.exchange.getState().error.includes('接続が変わった'));
  assert.equal(h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/requests')).length,0);
});

test('real-value or malformed simulation responses never enable a simulation mutation',async()=>{
  for(const patch of [{network:'bitcoin'},{realValue:true},{realValue:undefined},{mode:'live'},{balance:{confirmedPoints:1,availablePoints:2,reservedPoints:0}}]){
    const h=sandboxHarness({intercept:async({url,init,serve})=>{if(init.method==='GET'&&url.endsWith('/sandbox'))return Response.json({...await serve().json(),...patch});}});
    try{assert.equal(await h.openSandbox(),false);assert.equal(h.exchange.getState().balance,null);assert.equal(await h.exchange.refill(),false);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);}finally{h.exchange.dispose();}
  }
});

test('an untrusted successful mutation response is treated as unresolved and cannot be blindly repeated',async()=>{
  for(const patch of [{userId:'device-B'},{network:'bitcoin'},{realValue:true},{balance:{confirmedPoints:10,availablePoints:20,reservedPoints:0}}]){
    const h=sandboxHarness({intercept:async({url,init,serve})=>{if(init.method==='POST'&&url.endsWith('/refill'))return Response.json({...await serve().json(),...patch});}});
    try{await h.openSandbox();assert.equal(await h.exchange.refill(),false);assert.equal(h.exchange.getState().retryPending,true);assert.equal(h.exchange.getState().balance,null);assert.equal(await h.exchange.refill(),false);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);}finally{h.exchange.dispose();}
  }
});

test('expired quotes and invalid quantities do not become simulation applications',async t=>{
  const h=sandboxHarness();t.after(()=>h.exchange.dispose());await h.openSandbox();await h.exchange.refill();
  for(const value of ['0','1000.5','1e4','-1000','1000001','9007199254740992','12000'])assert.equal(await h.exchange.createQuote(value),false);
  assert.equal(h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/quote')).length,0);
  await h.exchange.createQuote(1000);h.advance(h.policy.quoteTtlMs+1);assert.equal(await h.exchange.confirmRequest(),false);assert.ok(h.exchange.getState().error.includes('期限'));assert.equal(h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/requests')).length,0);
});

test('a definitive server rejection leaves no ambiguous retry and never changes displayed balances',async t=>{
  const h=sandboxHarness({intercept:({url,init})=>{if(init.method==='POST'&&url.endsWith('/refill'))return Response.json({error:'少し待ってから補充してください。',code:'sandbox_refill_cooldown'},{status:429});}});t.after(()=>h.exchange.dispose());await h.openSandbox();
  assert.equal(await h.exchange.refill(),false);assert.equal(h.exchange.getState().retryPending,false);assert.equal(h.exchange.getState().balance.availablePoints,0);assert.ok(h.shell.innerHTML.includes('少し待ってから補充してください'));
});

test('a rejected retry cannot resolve an earlier committed operation or enable a fresh key',async t=>{
  let attempts=0;const h=sandboxHarness({intercept:({url,init,serve})=>{if(init.method==='POST'&&url.endsWith('/refill')){attempts++;if(attempts===1){serve();throw new TypeError('response lost after commit');}if(attempts===2)return Response.json({error:'少し待ってください。',code:'rate_limit'},{status:429});}}});t.after(()=>h.exchange.dispose());await h.openSandbox();
  assert.equal(await h.exchange.refill(),false);await h.exchange.sync();assert.equal(h.exchange.getState().balance.confirmedPoints,10000);assert.equal(await h.exchange.retryLastOperation(),false);
  assert.equal(h.exchange.getState().retryPending,true,'a later 429 does not establish the first POST outcome');assert.equal(h.exchange.getState().retryReady,false);assert.equal(h.exchange.getState().balance,null);assert.equal(await h.exchange.refill(),false);assert.equal(attempts,2);
  await h.exchange.sync();assert.equal(await h.exchange.retryLastOperation(),true);assert.equal(h.exchange.getState().balance.confirmedPoints,10000);assert.equal(h.exchange.getState().retryPending,false);
  const keys=h.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/refill')).map(x=>x.parsedBody.idempotencyKey);assert.equal(keys.length,3);assert.equal(new Set(keys).size,1);
});

test('server identity invalidation after the session preflight discards all prior account state',async()=>{
  for(const [status,code] of [[409,'session_identity_changed'],[401,'session_required'],[503,'session_unavailable']]){
    const h=sandboxHarness({intercept:({url,init})=>{if(init.method==='POST'&&url.endsWith('/requests'))return Response.json({error:'接続が更新されました。',code},{status});}});
    try{await h.openSandbox();await h.exchange.refill();await h.exchange.createQuote(1000);assert.ok(h.exchange.getState().quote);assert.equal(await h.exchange.confirmRequest(),false);
      const state=h.exchange.getState();assert.equal(state.accountId,null);assert.equal(state.balance,null);assert.equal(state.quote,null);assert.equal(state.retryPending,false);assert.equal(state.retryReady,false);assert.equal(state.requests.length,0);assert.ok(state.error.includes('接続が変わった'));assert.equal(await h.exchange.refill(),false);
    }finally{h.exchange.dispose();}
  }
  let lost=true;const h=sandboxHarness({intercept:({url,init,serve})=>{if(init.method==='POST'&&url.endsWith('/refill')){if(lost){lost=false;serve();throw new TypeError('lost');}return Response.json({error:'接続が更新されました。',code:'session_identity_changed'},{status:409});}}});
  try{await h.openSandbox();await h.exchange.refill();await h.exchange.sync();assert.equal(h.exchange.getState().retryPending,true);assert.equal(await h.exchange.retryLastOperation(),false);assert.equal(h.exchange.getState().retryPending,false);assert.equal(h.exchange.getState().accountId,null);assert.equal(h.exchange.getState().balance,null);}finally{h.exchange.dispose();}
});
