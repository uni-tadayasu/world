import {readDeviceSession} from './device-session.js';
import {isOnlineHost,getOnlineOrigin} from './site-config.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const points=value=>integer(value)?value.toLocaleString('ja-JP'):'—';
const token=value=>typeof value==='string'&&value.length>0&&value.length<=160&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const requestLabels={reserved:'検証申請を受付済み',cancelled:'検証申請を取り消しました',simulated_paid:'送金完了の検証済み'};
const actualLabels={pending:'受付済み',reserved:'残高を確保済み',review:'確認中',approved:'承認済み',cancelled:'取り消し',rejected:'受付不可',submitted:'送金処理中',paid:'処理済み',completed:'処理済み'};
const realBlocked='現在、実際の交換・送金はできません。';
const sandboxNotice='検証専用・換金不可・実際のBTCは送金されません。';
const validBalance=balance=>balance&&['confirmedPoints','availablePoints','reservedPoints'].every(key=>integer(balance[key]))&&balance.availablePoints+balance.reservedPoints===balance.confirmedPoints;
const sameSandbox=result=>result?.mode==='sandbox'&&result.network==='simulation'&&result.realValue===false;
const dateText=value=>integer(value)?new Date(value).toLocaleString('ja-JP'):'—';
const identityInvalid=failure=>failure?.identityChanged||failure?.status===401||['session_identity_changed','session_required','session_unavailable'].includes(failure?.code);

/** The real ledger is read-only. Simulation always uses separate server routes. */
export function createExchange({openPanel,getGameMoney=()=>0,hosted=isOnlineHost(),sessionReader=readDeviceSession,fetcher=(...args)=>fetch(...args),keyFactory=()=>crypto.randomUUID(),now=()=>Date.now()}={}){
  let shell=null,visible=false,disposed=false,tab='actual',sequence=0,controller=null,loading=false,mutating=false,error='',notice='',accountId=null,data=null,amount='1000',quote=null,quoteTimer=null,serverOffset=0;
  let activeOperation=null,retryOperation=null,retryReady=false;
  if(typeof document!=='undefined'&&!document.querySelector('link[data-machi-exchange]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./exchange.css',import.meta.url).href;link.dataset.machiExchange='';document.head.append(link);}
  const busy=()=>loading||mutating;
  const serverNow=()=>now()+serverOffset;
  const disabled=value=>value?'disabled':'';
  function clearQuote(){quote=null;clearTimeout(quoteTimer);quoteTimer=null;}
  function invalidate(){
    if(activeOperation?.sent&&activeOperation.kind!=='quote'){retryOperation=activeOperation;retryReady=false;}
    sequence++;controller?.abort();controller=null;activeOperation=null;loading=false;mutating=false;data=null;accountId=null;clearQuote();
  }
  function bind(selector,event,action){shell.querySelector(selector)?.addEventListener(event,action);}
  function bindAll(selector,event,action){for(const element of shell.querySelectorAll?.(selector)||[])element.addEventListener(event,()=>action(element));}
  function balanceMarkup(sandbox){
    const balance=data?.balance,gameMoney=getGameMoney();
    return `<div class="exchange-balances ${sandbox?'exchange-balances-sandbox':''}">${sandbox?'':`<div><small>ゲーム内の所持金</small><strong>${Number.isFinite(gameMoney)?'¥'+Math.floor(Math.max(0,gameMoney)).toLocaleString('ja-JP'):'—'}</strong><span>生活で使う通貨 · 換金対象外</span></div>`}<div><small>${sandbox?'検証用の残高':'交換対象の報酬'}</small><strong>${points(balance?.availablePoints)}<em> ${sandbox?'検証MR':'pt'}</em></strong><span>${sandbox?'実際の報酬とは別のテストデータ':'サーバーで確認された分のみ'}</span></div><div><small>${sandbox?'検証申請で予約中':'申請中の報酬'}</small><strong>${points(balance?.reservedPoints)}<em> ${sandbox?'検証MR':'pt'}</em></strong><span>${sandbox?'取消で戻り、完了の検証で消費します':'重複して使用できない残高'}</span></div></div>`;
  }
  function actualMarkup(){
    const program=data?.program;
    const plan=program&&typeof program==='object'?`<section class="exchange-program"><div class="exchange-section-heading"><h4>${esc(program.name||'MACHI REWARDS')}</h4><span class="exchange-status">運用案</span></div><p>以下は運用開始に向けた設計値です。実際の報酬の付与や交換は、開始条件が整ってから案内します。</p><dl><div><dt>対象地域の案</dt><dd>${program.region==='JP'?'日本':esc(program.region||'確認中')}</dd></div><div><dt>年齢条件の案</dt><dd>${integer(program.minimumAge)?points(program.minimumAge)+'歳以上':'確認中'}</dd></div><div><dt>1日の報酬上限案</dt><dd>${points(program.dailyRewardPoints)} MR</dd></div><div><dt>交換数量の設計</dt><dd>${points(program.pointsPerSatoshi)} MR / 1 satoshi</dd></div><div><dt>1回の申請範囲案</dt><dd>${points(program.minimumWithdrawalPoints)}〜${points(program.maximumWithdrawalPoints)} MR</dd></div><div><dt>支払い原資の状態</dt><dd>${program.treasury?.status==='unfunded'?'未入金':program.canPay===false?'利用開始前':'確認中'}</dd></div></dl>${Array.isArray(program.readiness)&&program.readiness.length?`<ul class="exchange-readiness">${program.readiness.slice(0,12).map(item=>`<li>${esc(item.message||'開始条件を確認しています。')}</li>`).join('')}</ul>`:''}</section>`:'';
    return `<section class="exchange-heading"><span class="exchange-currency" aria-hidden="true">₿</span><div><span class="exchange-status">準備中</span><h3>実際の報酬を確認する</h3><p>サーバーで確認した報酬と、交換申請の記録です。</p></div></section><div class="exchange-notice"><strong>${realBlocked}</strong><p>運営条件と支払い原資、送金接続の準備を進めています。送金先は後から設定するため、今はアドレスを入力する必要はありません。</p></div>${balanceMarkup(false)}${plan}<p class="section-label">実際の交換申請の履歴</p>${data?.requests?.length?`<div class="exchange-history">${data.requests.map(item=>`<div><span><strong>${esc(actualLabels[item.status]||'確認中')}</strong><small>${esc(typeof item.id==='string'?item.id.slice(0,40):'')}</small></span><span>${points(item.points)} pt</span></div>`).join('')}</div>`:`<div class="exchange-empty">${data?'実際の交換申請はまだありません。':'記録を確認すると、申請履歴がここに表示されます。'}</div>`}<p class="exchange-footnote">初期の所持金、セーブの読み込み、端末上で増えたお金は、交換対象へ加算されません。「動作確認」で補充した残高も実際の報酬には移せません。この画面では秘密鍵やシードフレーズを入力しないでください。</p>`;
  }
  function sandboxMarkup(){
    const policy=data?.policy,locked=busy()||!data||!!retryOperation,expired=!!quote&&quote.expiresAt<=serverNow();
    const history=data?.requests?.length?`<div class="exchange-history exchange-sandbox-history">${data.requests.map(item=>`<article><div class="exchange-history-title"><strong>${esc(requestLabels[item.status])}</strong><span>${points(item.points)} 検証MR</span></div><p>${dateText(item.createdAt)}<br><span class="exchange-reference">${esc(item.id)}</span></p><p>検証上の受取数量：${points(item.receiveSatoshis)} 検証satoshi<br>受取先：検証用の受取先</p>${item.status==='reserved'?`<div class="button-row">${item.canComplete?`<button class="secondary-btn" data-exchange-complete="${esc(item.id)}" ${disabled(locked)}>送金完了をシミュレーション</button>`:''}${item.canCancel?`<button class="secondary-btn" data-exchange-cancel="${esc(item.id)}" ${disabled(locked)}>検証申請を取り消す</button>`:''}</div>`:''}${item.status==='simulated_paid'?'<p class="exchange-simulation-note">処理の検証が完了しました。実際の送金は行っていません。</p>':''}</article>`).join('')}</div>`:'<div class="exchange-empty">検証申請はまだありません。補充した検証資金で、見積から申請まで試せます。</div>';
    return `<section class="exchange-heading"><span class="exchange-currency exchange-test-symbol" aria-hidden="true">TEST</span><div><span class="exchange-status">動作確認</span><h3>交換の流れを試す</h3><p>補充、見積、申請、取消、完了までの操作を確認できます。</p></div></section><div class="exchange-notice exchange-test-notice"><strong>${sandboxNotice}</strong><p>検証資金は何度でも補充できます（保有上限あり）。本番の原資、報酬、送金先とはつながっていません。</p></div>${balanceMarkup(true)}<section class="exchange-test-step"><div class="exchange-section-heading"><h4>検証資金を補充する</h4><span>1回 ${points(policy?.refillPoints)} 検証MR</span></div><p>保有上限は ${points(policy?.balanceLimitPoints)} 検証MRです。実際のお金やBTCを増やす操作ではありません。</p><button class="secondary-btn" data-exchange-refill ${disabled(locked)}>検証資金を補充する</button></section><section class="exchange-test-step"><h4>検証用の見積を作る</h4><p>申請できる範囲：${points(policy?.minimumPoints)}〜${points(policy?.maximumPoints)} 検証MR</p><div class="exchange-amount-row"><label for="exchange-test-points">申請する検証MR</label><input id="exchange-test-points" inputmode="numeric" type="text" autocomplete="off" value="${esc(amount)}" ${disabled(locked||!!quote)}><button class="secondary-btn" data-exchange-quote ${disabled(locked||!!quote)}>検証用の見積を確認</button></div>${quote?`<div class="exchange-confirm" aria-label="検証申請の確認"><h4>検証申請の内容</h4><dl><div><dt>使用する検証残高</dt><dd>${points(quote.points)} 検証MR</dd></div><div><dt>検証上の受取数量</dt><dd>${points(quote.receiveSatoshis)} 検証satoshi</dd></div><div><dt>検証上の手数料</dt><dd>${points(quote.feeSatoshis)} 検証satoshi</dd></div><div><dt>受取先</dt><dd>検証用の受取先</dd></div><div><dt>ネットワーク</dt><dd>シミュレーションのみ</dd></div><div><dt>見積の有効期限</dt><dd>${dateText(quote.expiresAt)}</dd></div></dl><p>${expired?'見積の期限が切れました。数量を確認して、新しい見積を作ってください。':sandboxNotice}</p><div class="button-row"><button class="primary-btn" data-exchange-confirm ${disabled(locked||expired)}>この内容で検証申請を確定</button><button class="secondary-btn" data-exchange-discard ${disabled(busy())}>数量を変更する</button></div></div>`:''}</section><section class="exchange-test-step"><h4>検証申請の履歴</h4><p>申請後に、取消または送金完了のシミュレーションを選べます。自動で完了にはなりません。</p>${history}</section><p class="exchange-footnote">検証残高・検証履歴は、このブラウザの接続に紐づくテストデータです。Cookieの削除や別端末では同じ記録を開けない場合があります。検証画面ではBTCアドレスや秘密鍵の入力は不要です。</p>`;
  }
  function render(){
    if(!visible||!shell?.isConnected||disposed)return;
    const sandbox=tab==='sandbox';
    shell.innerHTML=`<div class="exchange-tabs" role="tablist" aria-label="報酬画面"><button role="tab" aria-selected="${!sandbox}" data-exchange-tab="actual">実際の報酬</button><button role="tab" aria-selected="${sandbox}" data-exchange-tab="sandbox">動作確認</button></div><div class="exchange-tab-content" role="tabpanel" aria-label="${sandbox?'動作確認':'実際の報酬'}">${sandbox?sandboxMarkup():actualMarkup()}<div class="exchange-connection"><p class="exchange-state ${error?'exchange-error':''}" role="status">${esc(loading?'記録を確認しています…':mutating?'検証操作を処理しています…':error||notice||(!hosted?'記録の確認はオンライン版で利用できます。':data?'このブラウザの記録を確認しました。':'記録を読み込んでください。'))}</p><div class="button-row"><button class="secondary-btn" data-exchange-refresh ${disabled(busy()||!hosted)}>${loading?'確認しています…':'記録を更新する'}</button>${sandbox&&retryOperation?`<button class="secondary-btn" data-exchange-retry ${disabled(busy()||!retryReady||!data)}>前の操作の結果を確認</button>`:''}${!hosted?`<a class="secondary-btn" href="${esc(getOnlineOrigin())}">オンライン版を開く</a>`:''}</div>${sandbox&&retryOperation?'<p class="exchange-footnote">通信が途切れた操作があります。先に記録を更新し、その操作の結果を確認してください。新しい申請として自動再送することはありません。</p>':''}</div></div>`;
    bindAll('[data-exchange-tab]','click',element=>void selectTab(element.dataset.exchangeTab));
    bind('[data-exchange-refresh]','click',()=>void sync());
    bind('[data-exchange-refill]','click',()=>void refill());
    bind('#exchange-test-points','input',event=>{amount=event.target.value;});
    bind('[data-exchange-quote]','click',()=>void createQuote());
    bind('[data-exchange-confirm]','click',()=>void confirmRequest());
    bind('[data-exchange-discard]','click',()=>{clearQuote();notice='';error='';render();});
    bind('[data-exchange-retry]','click',()=>void retryLastOperation());
    bindAll('[data-exchange-cancel]','click',element=>void cancelRequest(element.dataset.exchangeCancel));
    bindAll('[data-exchange-complete]','click',element=>void completeRequest(element.dataset.exchangeComplete));
  }
  function checkIdentity(result,owner){if(result?.userId!==owner)throw new Error('このブラウザの保存先が変わりました。記録を更新してください。');}
  function checkSandboxRequest(item){
    if(!item||!token(item.id)||!integer(item.points)||item.points<1||!integer(item.receiveSatoshis)||!Object.hasOwn(requestLabels,item.status)||!integer(item.createdAt)||!integer(item.updatedAt)||typeof item.canCancel!=='boolean'||typeof item.canComplete!=='boolean'||(item.status!=='reserved'&&(item.canCancel||item.canComplete)))throw new Error('検証申請の記録を確認できませんでした。');
    return item;
  }
  function checkRead(result,owner,currentTab){
    checkIdentity(result,owner);
    if(!validBalance(result.balance)||!Array.isArray(result.requests))throw new Error('報酬の記録を確認できませんでした。');
    if(currentTab==='sandbox'){
      const p=result.policy;
      if(!sameSandbox(result)||!p||!['refillPoints','minimumPoints','maximumPoints','balanceLimitPoints','refillCooldownMs','rateSatoshisPerPoint','quoteTtlMs'].every(key=>integer(p[key]))||p.minimumPoints<1||p.refillPoints<1||p.rateSatoshisPerPoint!==1||p.minimumPoints>p.maximumPoints||p.maximumPoints>p.balanceLimitPoints||p.quoteTtlMs<1||!integer(result.serverTime))throw new Error('検証用の記録を確認できませんでした。実際の残高とは混ぜずに停止しました。');
      result.requests.slice(0,50).forEach(checkSandboxRequest);serverOffset=result.serverTime-now();
    }else if(result.mode!=='preparing'||result.available!==false)throw new Error('実際の報酬の準備状況を確認できませんでした。');
    return {...result,requests:result.requests.slice(0,50)};
  }
  async function readResponse(response){
    let result;try{result=await response.json();}catch{const failure=new Error('サーバーの応答を確認できませんでした。記録を更新してください。');failure.uncertain=true;throw failure;}
    if(!response.ok){const failure=new Error(typeof result?.error==='string'?result.error:'操作を完了できませんでした。記録を更新してください。');failure.uncertain=response.status>=500;failure.definitive=response.status<500;failure.status=response.status;failure.code=result?.code;throw failure;}
    return result;
  }
  async function sync(){
    if(disposed||!visible||!hosted||mutating)return false;
    controller?.abort();clearQuote();const request=++sequence,current=new AbortController(),currentTab=tab;controller=current;loading=true;error='';notice='';data=null;accountId=null;retryReady=false;render();
    const timer=setTimeout(()=>current.abort(),12000);
    try{
      const session=await sessionReader({signal:current.signal});if(request!==sequence||!visible)return false;
      const owner=session.user?.id;if(!token(owner))throw new Error('このブラウザの接続を確認できませんでした。');
      if(retryOperation&&retryOperation.owner!==owner)retryOperation=null;
      const response=await fetcher('/api/social/exchange'+(currentTab==='sandbox'?'/sandbox':''),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','X-Machi-User-Id':owner},signal:current.signal});
      const result=await readResponse(response);if(request!==sequence||!visible||tab!==currentTab)return false;
      data=checkRead(result,owner,currentTab);accountId=owner;retryReady=!!retryOperation&&currentTab==='sandbox';
      if(retryReady)notice='前の操作後の記録を取得しました。「前の操作の結果を確認」から確認を続けられます。';
      return true;
    }catch(failure){if(request===sequence&&visible){data=null;accountId=null;if(identityInvalid(failure)){retryOperation=null;retryReady=false;}error=failure.name==='AbortError'?'通信が時間切れになりました。もう一度、記録を更新してください。':failure.message;}return false;}
    finally{clearTimeout(timer);if(request===sequence){loading=false;controller=null;render();}}
  }
  function requireSandbox(){return visible&&!disposed&&hosted&&tab==='sandbox'&&!busy()&&accountId&&sameSandbox(data)&&validBalance(data.balance);}
  function showError(message){error=message;notice='';render();return false;}
  function newOperation(kind,path,body,expected={}){return {kind,path,body,expected,owner:accountId,sent:false};}
  function rememberQuote(value){
    clearQuote();quote=value;const remaining=Math.max(0,Math.min(2147483647,value.expiresAt-serverNow()));
    quoteTimer=setTimeout(()=>{quoteTimer=null;if(visible&&tab==='sandbox'&&quote===value)render();},remaining+1);
  }
  async function mutate(operation,{retry=false}={}){
    if(!requireSandbox()||operation.owner!==accountId||(!retry&&retryOperation))return false;
    if(retry&&(!retryReady||retryOperation!==operation))return false;
    const owner=accountId,request=++sequence,current=new AbortController();let attemptSent=false;controller=current;activeOperation=operation;mutating=true;error='';notice='';retryReady=false;render();
    const timer=setTimeout(()=>current.abort(),12000);
    try{
      const session=await sessionReader({signal:current.signal});if(request!==sequence||!visible||tab!=='sandbox')return false;
      if(session.user?.id!==owner){data=null;accountId=null;retryOperation=null;clearQuote();throw Object.assign(new Error('このブラウザの保存先が変わりました。操作を止めました。記録を更新してください。'),{identityChanged:true});}
      operation.sent=true;attemptSent=true;
      const response=await fetcher('/api/social/exchange/sandbox'+operation.path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json','X-Machi-User-Id':owner},body:JSON.stringify({...operation.body,expectedUserId:owner}),signal:current.signal});
      const result=await readResponse(response);if(request!==sequence||!visible||tab!=='sandbox')return false;
      checkIdentity(result,owner);if(!sameSandbox(result)||!validBalance(result.balance))throw Object.assign(new Error('検証操作の応答を確認できませんでした。記録を更新してください。'),{uncertain:true});
      if(operation.kind==='quote'){
        const q=result.quote;
        if(!q||!token(q.id)||!integer(q.points)||q.points!==operation.body.points||!integer(q.receiveSatoshis)||q.receiveSatoshis!==q.points||q.feeSatoshis!==0||!integer(q.createdAt)||!integer(q.expiresAt)||q.expiresAt<=q.createdAt||q.expiresAt-q.createdAt>data.policy.quoteTtlMs||q.expiresAt<=serverNow())throw new Error('検証用の見積を確認できませんでした。新しい見積を作ってください。');
        rememberQuote({...q});notice='検証申請の内容を確認してください。まだ申請は確定していません。';
      }else if(operation.kind==='refill'){
        clearQuote();notice='検証資金を補充しました。実際のお金やBTCは増えていません。';
      }else{
        const item=checkSandboxRequest(result.request);
        if(operation.expected.id&&item.id!==operation.expected.id)throw Object.assign(new Error('検証申請の応答が一致しません。記録を更新してください。'),{uncertain:true});
        if(operation.expected.points&&(item.points!==operation.expected.points||item.receiveSatoshis!==operation.expected.receiveSatoshis))throw Object.assign(new Error('確認した見積と検証申請が一致しません。記録を更新してください。'),{uncertain:true});
        data={...data,requests:[item,...data.requests.filter(row=>row.id!==item.id)].slice(0,50)};clearQuote();
        notice=operation.kind==='complete'?'送金完了までの検証が完了しました。実際のBTCは送金していません。':operation.kind==='cancel'?'検証申請を取り消しました。予約していた検証残高を戻しました。':'検証申請を受け付けました。履歴から取消または完了のシミュレーションを選べます。';
      }
      data={...data,balance:{...result.balance}};retryOperation=null;return true;
    }catch(failure){
      if(request===sequence&&visible){
        clearQuote();const identityLost=identityInvalid(failure),uncertain=!identityLost&&(retry||(attemptSent&&failure.definitive!==true));
        if(identityLost){data=null;accountId=null;retryOperation=null;retryReady=false;error='このブラウザの接続が変わったため、古い残高と操作を閉じました。記録を更新してください。';}
        else if(uncertain&&operation.kind!=='quote'){retryOperation=operation;retryReady=false;data=null;accountId=null;error='前の検証操作の結果はまだ確定できません。記録を更新してから、前の操作の結果を確認してください。';}
        else{if(retryOperation===operation)retryOperation=null;error=failure.name==='AbortError'?'接続が時間切れになりました。記録を更新してから試してください。':failure.message;}
      }
      return false;
    }finally{clearTimeout(timer);if(request===sequence){mutating=false;activeOperation=null;controller=null;render();}}
  }
  function refill(){if(!requireSandbox()||retryOperation)return Promise.resolve(false);return mutate(newOperation('refill','/refill',{idempotencyKey:keyFactory()}));}
  function createQuote(value=amount){
    if(!requireSandbox()||retryOperation)return Promise.resolve(false);
    amount=String(value);const number=/^[1-9][0-9]{0,15}$/.test(amount)?Number(amount):NaN,p=data.policy;
    if(!integer(number)||number<p.minimumPoints||number>p.maximumPoints)return Promise.resolve(showError(`検証MRは ${points(p.minimumPoints)}〜${points(p.maximumPoints)} の整数で入力してください。`));
    if(number>data.balance.availablePoints)return Promise.resolve(showError('検証用の利用可能残高が不足しています。先に検証資金を補充してください。'));
    clearQuote();return mutate(newOperation('quote','/quote',{points:number}));
  }
  function confirmRequest(){
    if(!requireSandbox()||retryOperation||!quote)return Promise.resolve(false);
    if(quote.expiresAt<=serverNow())return Promise.resolve(showError('見積の期限が切れました。数量を確認して、新しい見積を作ってください。'));
    return mutate(newOperation('request','/requests',{quoteId:quote.id,idempotencyKey:keyFactory()},{points:quote.points,receiveSatoshis:quote.receiveSatoshis}));
  }
  function requestAction(kind,requestId){
    if(!requireSandbox()||retryOperation)return Promise.resolve(false);
    const item=data.requests.find(row=>row.id===requestId),allowed=kind==='cancel'?item?.canCancel:item?.canComplete;
    if(!item||item.status!=='reserved'||!allowed||!token(requestId))return Promise.resolve(false);
    return mutate(newOperation(kind,'/requests/'+encodeURIComponent(requestId)+'/'+kind,{}, {id:requestId}));
  }
  function cancelRequest(requestId){return requestAction('cancel',requestId);}
  function completeRequest(requestId){return requestAction('complete',requestId);}
  function retryLastOperation(){if(!retryOperation||!retryReady)return Promise.resolve(false);return mutate(retryOperation,{retry:true});}
  async function selectTab(next){
    if(disposed||!visible||!['actual','sandbox'].includes(next)||next===tab)return false;
    invalidate();tab=next;error='';notice='';render();return hosted?sync():true;
  }
  function open(){if(disposed)return;invalidate();visible=true;tab='actual';error='';notice='';const body=openPanel('報酬と暗号資産への交換','REWARDS & EXCHANGE','<div id="exchange-content"></div>');shell=body.querySelector('#exchange-content');render();if(hosted)void sync();}
  function close(){invalidate();visible=false;error='';notice='';shell=null;}
  function dispose(){close();retryOperation=null;disposed=true;}
  return {open,close,sync,selectTab,refill,createQuote,confirmRequest,cancelRequest,completeRequest,retryLastOperation,dispose,getState:()=>({tab,loading,mutating,error,notice,accountId,available:false,balance:data?.balance?{...data.balance}:null,quote:quote?{...quote}:null,requests:data?.requests?.map(item=>({...item}))||[],retryPending:!!retryOperation,retryReady})};
}
