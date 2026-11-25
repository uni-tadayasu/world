import {SPONSOR_STATUSES,validSponsorOffer,safeSponsorUrl} from './sponsors.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const date=value=>integer(value)&&value<=8640000000000000?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未確定';
const isRefund=item=>['refund_required','review_overdue','review_expired'].includes(item.status);
const statusLabel=item=>({awaiting_confirmation:'支払い確認待ち',payment_pending:'支払い手続き中',paid_pending_review:'審査待ち',approved:'掲載中',expired:'掲載終了',paused:'停止中',refund_required:'返金要対応',review_overdue:'審査期限超過',review_expired:'審査期限超過',payment_hold:'支払い確認中',payment_failed:'支払い未完了'}[item.status]||'確認が必要');
function validOrder(item){
  if(!item||!validId(item.id)||typeof item.status!=='string'||!integer(item.amount)||item.currency!=='jpy'||typeof item.sponsorName!=='string'||Array.from(item.sponsorName).length>60||typeof item.message!=='string'||Array.from(item.message).length>80||!['canApprove','canReject','canPause'].every(key=>typeof item[key]==='boolean')||typeof item.contentValid!=='boolean'||typeof item.hold!=='boolean'||!Array.isArray(item.holdReasons)||!integer(item.createdAt)||!integer(item.updatedAt))throw new Error('掲載記録の形式を確認できませんでした。記録を更新してください。');
  return {...item,url:safeSponsorUrl(item.url),holdReasons:item.holdReasons.filter(value=>typeof value==='string').slice(0,20)};
}

/** Administrative credentials stay in this closure and never enter URLs/storage. */
export function createSponsorAdmin(root,{fetcher=(...args)=>fetch(...args)}={}){
  const get=id=>root.querySelector('#'+id),set=(id,value)=>{const node=get(id);if(node)node.textContent=value;},listeners=[],listen=(id,event,fn)=>{const element=get(id);element?.addEventListener(event,fn);if(element)listeners.push([element,event,fn]);};
  let token='',disposed=false,sequence=0,controller=null,loading=false,mutating=false,data=null,error='',notice='',filter='all',confirmation=null,needsRefresh=false;
  const busy=()=>loading||mutating;
  function clear(){sequence++;controller?.abort();controller=null;token='';data=null;loading=false;mutating=false;confirmation=null;needsRefresh=false;const input=get('sponsor-admin-token');if(input)input.value='';}
  const allowed=(item,action)=>!!item&&Object.hasOwn(SPONSOR_STATUSES,item.status)&&(action==='approve'?item.canApprove&&item.contentValid&&item.paymentVerified===true&&!item.hold:action==='reject'?item.canReject:action==='pause'?item.canPause:false);
  function render(){
    if(disposed)return;const connected=!!data&&!!token,access=get('sponsor-admin-access'),workspace=get('sponsor-admin-workspace');if(access)access.hidden=connected;if(workspace)workspace.hidden=!connected;
    set('sponsor-admin-state',loading?'掲載記録を取得しています…':mutating?'操作を処理し、最新の記録を確認しています…':error||notice||(connected?'この画面の接続中だけ、運営操作を利用できます。':'運営用アクセスキーを入力すると、記録を取得できます。'));
    const state=get('sponsor-admin-state');if(state)state.className='sp-admin-state'+(error?' sp-error':'');const connect=get('sponsor-admin-connect');if(connect)connect.disabled=busy();const input=get('sponsor-admin-token');if(input)input.disabled=busy();const refresh=get('sponsor-admin-refresh');if(refresh)refresh.disabled=busy();
    if(!connected)return;
    set('sponsor-admin-sales-status',data.enabled?'スポンサー掲載のお申し込みを受け付けています。':'現在は販売準備中です。購入は受け付けていません。');
    const paid=data.orders.filter(item=>integer(item.paidAt)&&item.paidAt>0).reduce((sum,item)=>sum+item.amount,0),stats=[['表示中の記録にある支払総額',Number.isSafeInteger(paid)?paid.toLocaleString('ja-JP')+'円':'確認が必要'],['審査待ち',data.orders.filter(item=>item.status==='paid_pending_review').length+'件'],['掲載中',data.orders.filter(item=>item.status==='approved').length+'件'],['返金の対応が必要',data.orders.filter(isRefund).length+'件']];
    const summary=get('sponsor-admin-summary');if(summary)summary.innerHTML=stats.map(([label,value])=>`<div><small>${label}</small><strong>${value}</strong></div>`).join('');
    const confirmationPanel=get('sponsor-admin-confirm');if(confirmationPanel)confirmationPanel.hidden=!confirmation;
    if(confirmation){set('sponsor-admin-confirm-title',confirmation.action==='approve'?'掲載を承認しますか':confirmation.action==='reject'?'掲載を却下しますか':'掲載を停止しますか');set('sponsor-admin-confirm-message',confirmation.message);}
    for(const id of ['sponsor-admin-confirm-action','sponsor-admin-cancel-action']){const element=get(id);if(element)element.disabled=busy()||needsRefresh;}
    const visible=data.orders.filter(item=>filter==='all'||filter==='review'&&item.status==='paid_pending_review'||filter==='approved'&&item.status==='approved'||filter==='paused'&&item.status==='paused'||filter==='refund'&&isRefund(item)||filter==='hold'&&(item.hold||['payment_hold','awaiting_confirmation','payment_pending','payment_failed'].includes(item.status)));
    const list=get('sponsor-admin-orders');if(list)list.innerHTML=visible.length?visible.map(item=>`<article class="sp-admin-order"><div class="sp-admin-order-head"><h3>${esc(item.sponsorName||'掲載名を確認中')}</h3><span class="sp-status ${item.status==='approved'?'sp-status-live':isRefund(item)||item.hold?'sp-status-alert':'sp-status-muted'}">${esc(statusLabel(item))}</span></div><p class="sp-admin-order-id">記録ID：${esc(item.id)}</p><p class="sp-admin-order-message">${esc(item.message||'紹介文なし')}</p>${item.url?`<a class="sp-admin-order-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a>`:'<p class="sp-secondary">掲載先URLは確認が必要です。</p>'}<dl><div><dt>注文金額</dt><dd>${item.amount.toLocaleString('ja-JP')}円</dd></div><div><dt>支払確認</dt><dd>${date(item.paidAt)}</dd></div><div><dt>審査期限</dt><dd>${date(item.reviewDeadlineAt)}</dd></div><div><dt>掲載期間</dt><dd>${date(item.startsAt)}<br>${date(item.endsAt)}</dd></div></dl>${item.hold||item.holdReasons.length?`<div class="sp-admin-holds">確認が必要な項目があります。<ul>${item.holdReasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul></div>`:''}${isRefund(item)?'<p class="sp-secondary">返金が必要な状態です。実際の返金はStripeで別途処理してください。ここでは返金完了に変更しません。</p>':''}<div class="sp-admin-actions">${allowed(item,'approve')?`<button class="sp-button sp-button-primary" data-sponsor-order="${esc(item.id)}" data-sponsor-action="approve" ${busy()||needsRefresh?'disabled':''}>${item.status==='paused'?'掲載を再開する':'掲載を承認する'}</button>`:''}${allowed(item,'reject')?`<button class="sp-button sp-button-secondary" data-sponsor-order="${esc(item.id)}" data-sponsor-action="reject" ${busy()||needsRefresh?'disabled':''}>却下・返金要対応にする</button>`:''}${allowed(item,'pause')?`<button class="sp-button sp-button-secondary" data-sponsor-order="${esc(item.id)}" data-sponsor-action="pause" ${busy()||needsRefresh?'disabled':''}>掲載を停止する</button>`:''}</div><p class="sp-admin-order-references">決済記録：${esc(item.sessionId||'未確認')}<br>支払いID：${esc(item.paymentIntentId||'未確認')}</p></article>`).join(''):'<div class="sp-empty">この条件に該当する記録はありません。</div>';
    for(const element of root.querySelectorAll?.('[data-sponsor-action]')||[])element.addEventListener('click',()=>requestAction(element.dataset.sponsorOrder,element.dataset.sponsorAction));
  }
  async function responseData(response){let result;try{result=await response.json();}catch{throw new Error('サーバーの応答を確認できませんでした。記録を更新してください。');}if(!response.ok){const failure=new Error(response.status===401||response.status===403?'運営用の接続を確認できませんでした。アクセスキーを確認してください。':response.status===503?'運営用機能の準備状況を確認できませんでした。時間をおいてお試しください。':'操作を受け付けられませんでした。記録を更新して現在の状態をご確認ください。');failure.status=response.status;throw failure;}return result;}
  function validateSnapshot(result){if(!result||!validSponsorOffer(result.offer)||typeof result.enabled!=='boolean'||!Array.isArray(result.orders)||!integer(result.serverTime))throw new Error('運営用の記録を確認できませんでした。');return {...result,orders:result.orders.map(validOrder)};}
  async function fetchSnapshot(auth,signal){const response=await fetcher('/api/sponsors/admin',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+auth},signal});return validateSnapshot(await responseData(response));}
  async function load(){
    if(disposed||!token||mutating)return false;controller?.abort();const current=new AbortController(),request=++sequence,auth=token;controller=current;loading=true;error='';confirmation=null;render();const timer=setTimeout(()=>current.abort(),12000);
    try{const result=await fetchSnapshot(auth,current.signal);if(disposed||request!==sequence||auth!==token)return false;data=result;needsRefresh=false;return true;}
    catch(failure){if(!disposed&&request===sequence){if(failure.status===401||failure.status===403){token='';data=null;confirmation=null;needsRefresh=false;}else needsRefresh=true;error=failure.name==='AbortError'?'接続が時間切れになりました。記録を更新してください。':failure.message;}return false;}
    finally{clearTimeout(timer);if(!disposed&&request===sequence){loading=false;controller=null;render();}}
  }
  async function connect(value){
    if(disposed||busy())return false;const proposed=typeof value==='string'?value.trim():'';clear();error='';notice='';
    if(!/^[\x21-\x7e]{32,512}$/.test(proposed)){error='運営用アクセスキーの形式を確認してください。';render();return false;}
    token=proposed;render();return load();
  }
  function requestAction(id,action){
    if(disposed||!data||!token||busy()||needsRefresh||!['approve','reject','pause'].includes(action))return false;
    const item=data.orders.find(order=>order.id===id);if(!allowed(item,action))return false;
    const details=action==='approve'?(item.status==='paused'?'元の掲載期間内で掲載を再開します。終了日時は延長しません。':'掲載内容を確認し、承認して掲載を開始します。開始日から30日間の掲載となります。'):action==='reject'?'この掲載を却下し、返金要対応として記録します。実際の返金はStripeで別途行ってください。この操作だけでは返金されません。':'スポンサー一覧への掲載を停止します。停止による自動延長はありません。運営都合で掲載を提供できない場合は全額返金の対象です。';
    confirmation={id,action,status:item.status,updatedAt:item.updatedAt,message:`${item.sponsorName||'掲載名を確認中'}\n${details}`};error='';notice='';render();get('sponsor-admin-confirm')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});return true;
  }
  function cancelAction(){if(busy())return false;confirmation=null;render();return true;}
  async function confirmAction(){
    if(disposed||!confirmation||!data||!token||busy()||needsRefresh)return false;
    const chosen={...confirmation},item=data.orders.find(order=>order.id===chosen.id);if(!allowed(item,chosen.action)||item.status!==chosen.status||item.updatedAt!==chosen.updatedAt){confirmation=null;needsRefresh=true;error='掲載の状態が変わりました。記録を更新してから操作してください。';render();return false;}
    const request=++sequence,current=new AbortController(),auth=token;controller=current;mutating=true;error='';notice='';render();const timer=setTimeout(()=>current.abort(),15000);let confirmed=false;
    try{const response=await fetcher('/api/sponsors/admin/'+encodeURIComponent(chosen.id)+'/'+chosen.action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify({expectedStatus:chosen.status,expectedUpdatedAt:chosen.updatedAt}),signal:current.signal});const result=await responseData(response);if(disposed||request!==sequence||auth!==token)return false;
      const updated=validOrder(result.order),expected={approve:'approved',reject:'refund_required',pause:'paused'}[chosen.action];if(updated.id!==chosen.id||updated.status!==expected)throw new Error('操作後の状態を確認できませんでした。記録を更新してください。');
      confirmed=true;data={...data,orders:data.orders.map(order=>order.id===updated.id?updated:order)};confirmation=null;
      const latest=await fetchSnapshot(auth,current.signal);if(disposed||request!==sequence||auth!==token)return false;data=latest;needsRefresh=false;notice=chosen.action==='reject'?'返金要対応として記録しました。実際の返金はStripeで処理してください。':chosen.action==='pause'?'掲載を停止し、最新の記録を取得しました。':'掲載を承認し、最新の記録を取得しました。';return true;
    }catch(failure){if(!disposed&&request===sequence){confirmation=null;if(failure.status===401||failure.status===403){token='';data=null;needsRefresh=false;error='運営用の接続が失効しました。アクセスキーを確認して接続し直してください。';}else{needsRefresh=true;error=confirmed?'操作の受付は確認しましたが、一覧を更新できませんでした。「記録を更新する」から最新の状態をご確認ください。':'操作結果を確定できませんでした。新しく操作をやり直す前に、「記録を更新する」から状態をご確認ください。';}}return false;}
    finally{clearTimeout(timer);if(!disposed&&request===sequence){mutating=false;controller=null;render();}}
  }
  function disconnect(){clear();error='';notice='接続を終了し、アクセスキーを破棄しました。';render();}
  function start(){listen('sponsor-admin-connect','click',()=>void connect(get('sponsor-admin-token')?.value));listen('sponsor-admin-token','keydown',event=>{if(event.key==='Enter'){event.preventDefault();void connect(event.target.value);}});listen('sponsor-admin-refresh','click',()=>void load());listen('sponsor-admin-disconnect','click',disconnect);listen('sponsor-admin-confirm-action','click',()=>void confirmAction());listen('sponsor-admin-cancel-action','click',cancelAction);listen('sponsor-admin-filter','change',event=>{filter=event.target.value;render();});render();}
  function dispose(){clear();disposed=true;for(const [element,event,fn]of listeners)element.removeEventListener?.(event,fn);listeners.length=0;}
  return {start,connect,load,requestAction,cancelAction,confirmAction,disconnect,dispose,getState:()=>({connected:!!token&&!!data,loading,mutating,error,notice,needsRefresh,confirmation:confirmation?{id:confirmation.id,action:confirmation.action}:null,orders:data?.orders.map(item=>({...item}))||[]})};
}
if(typeof document!=='undefined'){const root=document.getElementById('sponsor-admin-app');if(root){let page;const mount=()=>{page=createSponsorAdmin(root);page.start();};mount();globalThis.addEventListener?.('pagehide',()=>{page?.dispose();page=null;});globalThis.addEventListener?.('pageshow',event=>{if(event.persisted&&!page)mount();});}}
