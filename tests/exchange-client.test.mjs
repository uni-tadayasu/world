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
