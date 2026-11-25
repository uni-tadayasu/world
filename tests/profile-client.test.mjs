// Run with: node tests/profile-client.test.mjs. No browser or external requests.
import assert from 'node:assert/strict';
import {createProfile,profileAvatarMarkup} from '../dist/profile.js';
const map=new Map();let denyStorage=false;
globalThis.localStorage={getItem:key=>map.get(key)??null,setItem(key,value){if(denyStorage)throw new Error('quota');map.set(key,String(value));},removeItem:key=>map.delete(key)};
globalThis.location={origin:'https://static.example',href:'https://static.example/'};
const guestKey='machi.profile.guest.v1',cacheKey=id=>'machi.profile.device.'+id+'.v1';
const controllers=[];const create=options=>{const controller=createProfile(options);controllers.push(controller);return controller;};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const waitFor=async predicate=>{for(let i=0;i<50&&!predicate();i++)await pause();assert.ok(predicate(),'asynchronous request must start');};
try{
  localStorage.setItem('machi.life.v1',JSON.stringify({name:'以前の名前'}));
  const guest=create();assert.equal(guest.getState().name,'以前の名前');assert.equal(guest.getState().scope,'guest');
  assert((await guest.save({name:'端末の住人',bio:'ゲスト専用の紹介',avatarIcon:'sun',showName:false})).ok);
  assert.equal(guest.getState().version,1);const durableGuest=localStorage.getItem(guestKey);
  const returned=guest.getState();returned.name='勝手に書き換え';assert.equal(guest.getState().name,'端末の住人');
  assert.equal((await guest.save({name:'長'.repeat(25)})).ok,false);assert.equal(localStorage.getItem(guestKey),durableGuest);
  denyStorage=true;assert.equal((await guest.save({name:'保存失敗'})).ok,false);denyStorage=false;
  assert.equal(guest.getState().name,'端末の住人');assert.equal(localStorage.getItem(guestKey),durableGuest);
  const anotherTab=create();assert((await guest.save({name:'別タブの更新'})).ok);
  const conflict=await anotherTab.save({name:'古い画面の更新'});assert.equal(conflict.code,'profile_conflict');assert.equal(anotherTab.getState().name,'別タブの更新');
  const guestSnapshot=localStorage.getItem(guestKey);const legacyAccountKey='machi.profile.account.A.v1',legacyAccount=JSON.stringify({format:1,accountId:'A',profile:{name:'以前の保存'},pending:null});localStorage.setItem(legacyAccountKey,legacyAccount);
  guest.dispose();anotherTab.dispose();
  localStorage.setItem(guestKey,'corrupted original');const corrupt=create();await corrupt.sync();assert.equal(localStorage.getItem(guestKey),'corrupted original');assert(corrupt.getState().error);corrupt.dispose();localStorage.setItem(guestKey,guestSnapshot);

  location.origin='https://machi-life.hisa-0128-1996.chatgpt.site';location.href=location.origin+'/';
  const defaultProfile=id=>({id,code:'M-'+id,name:'旅人',tagline:'',bio:'',title:'街の住人',accent:'#2e6b54',avatarIcon:'leaf',showName:true,version:0,updatedAt:1});
  const accounts={A:defaultProfile('A'),B:{...defaultProfile('B'),name:'別のアカウント'}};let session='A',posts=[];
  globalThis.fetch=async(url,options={})=>{
    assert.equal(options.credentials,'same-origin');assert(url.startsWith('/api/social/'));
    if(url==='/api/social/me')return response(session?{connected:true,identityKind:'device',signedIn:true,user:accounts[session]}:{signedIn:false});
    if(url==='/api/social/profile'&&options.method==='POST'){
      const data=JSON.parse(options.body);posts.push({session,data});
      if(!session)return response({code:'auth_required',error:'ログインしてください。'},401);
      const current=accounts[session];
      if(data.expectedUserId!==current.id)return response({code:'profile_identity_changed',error:'アカウントが変わりました。'},409);
      if(data.expectedVersion!==current.version)return response({code:'profile_conflict',error:'新しいプロフィールがあります。',user:current},409);
      const {expectedUserId,expectedVersion,...fields}=data;accounts[session]={...current,...fields,version:current.version+1,updatedAt:Date.now()};
      return response({user:accounts[session]});
    }
    throw new Error('unexpected request: '+url);
  };
  const shell={innerHTML:'',isConnected:true,addEventListener(){},querySelector(){return null;}};
  const panel={querySelector(){return shell;}};
  const changes=[];const account=create({openPanel:()=>panel,onChange:state=>changes.push(state)});
  assert.equal(account.getState().name,'別タブの更新');assert.equal(account.getState().verified,false);
  assert.equal((await account.sync()).syncing,false);assert.equal(account.getState().scope,'device');assert.equal(account.getState().name,'旅人');assert.equal(account.getState().verified,true);assert.equal(posts.length,0,'guest values must never auto-publish');
  assert((await account.save({name:'<b>青</b>',tagline:'<script>alert(1)</script>',avatarIcon:'coffee',accent:'#445566'})).ok);
  assert.equal(posts[0].data.expectedUserId,'A');assert.equal(posts[0].data.expectedVersion,0);
  account.open();await account.sync();assert(shell.innerHTML.includes('&lt;b&gt;青&lt;/b&gt;'));assert(!/ログイン|アカウント|signin-with/.test(shell.innerHTML),'profile has no login controls');assert(shell.innerHTML.includes('ブラウザのデータを消去'));assert(!shell.innerHTML.includes('<script>alert(1)</script>'));
  const avatar=profileAvatarMarkup({accent:'red;position:fixed',avatarIcon:'" onload="alert(1)'},40);assert(!avatar.includes('position:fixed'));assert(!avatar.includes('onload'));assert(avatar.includes('#2e6b54'));
  assert.equal(localStorage.getItem(guestKey),guestSnapshot);
  const aSaved={...accounts.A};session='B';
  const switched=await account.save({name:'Aの保存するはずだった名前'});
  assert.equal(switched.code,'profile_identity_changed');await pause();await account.sync();
  assert.equal(account.getState().id,'B');assert.equal(account.getState().name,'別のアカウント');assert.deepEqual(accounts.A,aSaved);assert.equal(accounts.B.version,0);
  assert.equal(JSON.parse(localStorage.getItem(cacheKey('A'))).pending.values.name,'Aの保存するはずだった名前');
  assert.equal(JSON.parse(localStorage.getItem(cacheKey('B'))).pending,null);
  session='A';await account.sync();assert.equal(account.getState().id,'A');assert.equal(account.getState().pending,true);assert.equal(account.getState().name,aSaved.name);
  accounts.A={...accounts.A,name:'別の画面から更新',version:accounts.A.version+1};
  const stale=await account.save({name:'古い編集の続き'});assert.equal(stale.code,'profile_conflict');assert.equal(account.getState().name,'別の画面から更新');assert.equal(account.getState().pending,true);
  account.open({edit:true});await account.sync();assert(shell.innerHTML.includes('最新の内容を読み込む'),'stale drafts need an explicit reload action');
  assert((await account.save({name:'確認して保存'})).ok);assert.equal(account.getState().pending,false);
  session=null;await account.sync();assert.equal(account.getState().scope,'device');assert.equal(account.getState().name,'確認して保存');assert.ok(account.getState().error,'failed reconnection retains this browser identity');assert.equal(localStorage.getItem(guestKey),guestSnapshot);
  account.dispose();

  // A response after disposal must never become an account state or write its cache.
  let release;fetch=()=>new Promise(resolve=>{release=resolve;});const observed=[];
  const late=create({onChange:state=>observed.push(state)});const inFlight=late.sync();await waitFor(()=>typeof release==='function');late.dispose();const before=observed.length;
  release(response({connected:true,identityKind:'device',signedIn:true,user:{...defaultProfile('C'),name:'遅れた応答'}}));await inFlight;
  assert.equal(late.getState().scope,'guest');assert.equal(observed.length,before);assert.equal(localStorage.getItem(cacheKey('C')),null);

  // Switching identity during an awaited /me response must cancel a captured guest save.
  release=null;const gate=create();const syncing=gate.sync();const saving=gate.save({name:'ゲストの編集中の名前'});await waitFor(()=>typeof release==='function');release(response({connected:true,identityKind:'device',signedIn:true,user:accounts.B}));await syncing;
  assert.equal((await saving).code,'profile_identity_changed');assert.equal(gate.getState().id,'B');assert.equal(localStorage.getItem(guestKey),guestSnapshot);gate.dispose();
  release=null;const cancelled=create();const check=cancelled.sync(),write=cancelled.save({name:'閉じた後の編集'});await waitFor(()=>typeof release==='function');cancelled.dispose();release(response({signedIn:false}));await check;assert.equal((await write).ok,false);assert.equal(localStorage.getItem(guestKey),guestSnapshot);
  assert.equal(localStorage.getItem(legacyAccountKey),legacyAccount,'legacy account cache stays untouched');
  console.log('PASS: browser-local durability and migration; storage failure and cross-tab conflict; local/device separation; guarded browser identity changes; pending edits; concurrency conflicts; escaped cards; safe icon colors; late-response disposal.');
}finally{for(const controller of controllers)controller.dispose();}
