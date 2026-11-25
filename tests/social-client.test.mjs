import assert from 'node:assert/strict';
import test from 'node:test';
import {initSocial} from '../dist/social.js';

class ElementStub{
  constructor(){this.innerHTML='';this.isConnected=true;this.dataset={};this.listeners=new Map();this.scrollTop=0;this.scrollHeight=0;this.clientHeight=300;}
  addEventListener(type,handler){this.listeners.set(type,handler);}
  removeEventListener(type){this.listeners.delete(type);}
  append(){}
  remove(){this.isConnected=false;}
  setAttribute(){}
  contains(element){return !!element;}
  getClientRects(){return [{}];}
  querySelector(){return null;}
  querySelectorAll(){return [];}
}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const me={id:'self',name:'自分',code:'M-SELF',version:1};
const friend={id:'friend',name:'友達',code:'M-FRIEND'};
const history=[
  {id:90,user:friend,text:'PRIVATE_RECEIVED',createdAt:1,mine:false},
  {id:91,user:me,text:'PRIVATE_SENT',createdAt:2,mine:true},
];

async function scenario(run){
  const names=['document','window','location','localStorage','fetch'];
  const originals=new Map(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const shell=new ElementStub(),list=new ElementStub(),body=new ElementStub(),requests=[],notices=[];
  shell.querySelector=selector=>selector==='.social-messages'?list:null;
  body.querySelector=selector=>selector==='.machi-social'?shell:null;
  const document={activeElement:null,querySelector:()=>null,createElement:()=>new ElementStub(),head:new ElementStub(),body:new ElementStub()};
  const window=new EventTarget(),location={origin:'https://machi-life.hisa-0128-1996.chatgpt.site',href:'https://machi-life.hisa-0128-1996.chatgpt.site/'};
  let blocked=false,stateFailure=false,stateGate=null,currentUser=me,conflict=false;
  const fetch=async(url,options={})=>{
    requests.push(url);assert.equal(options.credentials,'same-origin');
    if(url==='/api/social/me')return response({connected:true,identityKind:'device',signedIn:true,user:currentUser});
    if(url==='/api/social/state'){
      if(stateGate)await stateGate;
      if(stateFailure)return response({error:'temporary state failure'},503);
      return response({user:currentUser,friends:{incoming:[],outgoing:[],accepted:blocked?[]:[{user:friend}]},organizations:[],blocks:blocked?[friend]:[]});
    }
    if(url==='/api/social/block'&&options.method==='POST'){
      const sent=JSON.parse(options.body);assert.equal(sent.userId,'friend');assert.equal(sent.expectedUserId,'self');assert.equal(options.headers['X-Machi-User-Id'],'self');
      if(conflict)return response({error:'このブラウザの保存先が変わりました。',code:'session_identity_changed'},409);
      blocked=true;return response({ok:true});
    }
    if(url.startsWith('/api/social/messages?')){
      const query=new URL(url,'https://test.invalid').searchParams;
      if(query.get('channel')==='dm:friend')return response({messages:history});
      return response({messages:[{id:1,user:me,text:'PUBLIC_ONLY',createdAt:1,mine:true}]});
    }
    throw new Error('unexpected request '+url);
  };
  for(const [key,value]of Object.entries({document,window,location,localStorage:{getItem:()=>null},fetch}))Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});
  const social=initSocial({openPanel:()=>body,toast:value=>notices.push(value)});
  const click=(action,data={})=>{const button={dataset:{action,...data},tagName:'BUTTON',isConnected:true,disabled:false};return shell.listeners.get('click')({target:{closest:()=>button}});};
  try{
    social.open();
    for(let i=0;i<20&&!list.innerHTML.includes('PUBLIC_ONLY');i++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.ok(list.innerHTML.includes('PUBLIC_ONLY'),'initial public history loaded');
    await click('dm',{user:'friend'});assert.ok(list.innerHTML.includes('PRIVATE_SENT'));
    assert.ok(!shell.innerHTML.includes('signin-with-chatgpt'));assert.ok(!shell.innerHTML.includes('ログイン'));
    await run({shell,list,requests,notices,click,failState(){stateFailure=true;},switchBrowserIdentity(){currentUser={...me,id:'new-device',name:'新しい端末の住人'};conflict=true;},holdState(){let release;stateGate=new Promise(resolve=>{release=resolve;});return release;}});
  }finally{social.dispose();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('blocking a DM peer clears private history and resets the public cursor',()=>scenario(async({shell,list,requests,notices,click})=>{
  await click('block-user',{user:'friend'});
  assert.ok(!list.innerHTML.includes('PRIVATE_SENT'));assert.ok(!list.innerHTML.includes('PRIVATE_RECEIVED'));
  assert.ok(list.innerHTML.includes('PUBLIC_ONLY'));
  assert.ok(shell.innerHTML.includes('街の広場にメッセージ'));
  const messageRequests=requests.filter(url=>url.startsWith('/api/social/messages?'));
  assert.equal(messageRequests.at(-1),'/api/social/messages?channel=global&since=0');
  assert.ok(notices.at(-1).includes('街の広場へ戻りました'));
}));

test('private history disappears before a slow or failed state refresh',()=>scenario(async({shell,list,click,holdState,failState})=>{
  const release=holdState(),pending=click('block-user',{user:'friend'});
  // Advance the successful block response; /state remains deliberately pending.
  for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(shell.innerHTML.includes('街の広場にメッセージ'));
  assert.ok(!list.innerHTML.includes('PRIVATE_SENT'));assert.ok(!list.innerHTML.includes('PRIVATE_RECEIVED'));
  failState();release();await pending;
  assert.ok(shell.innerHTML.includes('temporary state failure'));
  assert.ok(!list.innerHTML.includes('PRIVATE_SENT'));assert.ok(!list.innerHTML.includes('PRIVATE_RECEIVED'));
}));

test('a browser identity conflict offers reconnect without login and clears the old conversation',()=>scenario(async({shell,list,click,switchBrowserIdentity})=>{
  switchBrowserIdentity();await click('block-user',{user:'friend'});
  assert.ok(shell.innerHTML.includes('もう一度接続'));
  assert.ok(!shell.innerHTML.includes('signin-with-chatgpt'));assert.ok(!shell.innerHTML.includes('ログイン'));
  await click('retry-connect');
  assert.ok(shell.innerHTML.includes('新しい端末の住人'));
  assert.ok(list.innerHTML.includes('PUBLIC_ONLY'));assert.ok(!list.innerHTML.includes('PRIVATE_SENT'));
}));
