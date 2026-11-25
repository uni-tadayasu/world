const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const timestamp=value=>integer(value)&&value<=8640000000000000;
const date=value=>timestamp(value)?new Date(value).toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Tokyo'}):'確認中';
export const SPONSOR_OFFER=Object.freeze({id:'sponsor-directory-30d-v1',amount:3300,currency:'jpy',durationDays:30,reviewDays:7});
export function validSponsorOffer(offer){return !!offer&&Object.entries(SPONSOR_OFFER).every(([key,value])=>offer[key]===value);}
export function validPublicMerchant(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
  if(!['sellerName','representative','address','phone','email','paymentTiming'].every(key=>text(value[key],key==='paymentTiming'?200:600)))return false;
  if(value.email.length>254||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value.email))return false;
  if(!Array.isArray(value.paymentMethods)||value.paymentMethods.length<1||value.paymentMethods.length>12||value.paymentMethods.some(method=>!text(method,60)))return false;
  return value.contactUrl==null||value.contactUrl===''||!!safeSponsorUrl(value.contactUrl);
}
export function safeCheckoutUrl(value){
  if(typeof value!=='string'||value.length>500)return null;
  try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='buy.stripe.com'||url.username||url.password||url.port||url.search||url.hash||!/^\/[A-Za-z0-9]+$/.test(url.pathname))return null;return url.href;}catch{return null;}
}
export function safeSponsorUrl(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{const url=new URL(value),host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||host.endsWith('.')||host.startsWith('[')||/^(?:\d+\.){3}\d+$/.test(host)||/^(?:localhost|0)(?:\.|$)/.test(host)||/\.(?:localhost|local|internal|lan|home|test|invalid)$/.test(host))return null;return url.href;}catch{return null;}
}
export const SPONSOR_STATUSES=Object.freeze({
  awaiting_confirmation:{title:'支払いの確認を待っています',message:'決済画面から戻っただけでは、お支払いの完了は確定しません。支払いの記録が届いてから、状況を更新します。'},
  payment_pending:{title:'支払い手続き中です',message:'お支払いはまだ確定していません。お使いの支払方法の手続きを確認し、時間をおいて状況を更新してください。'},
  paid_pending_review:{title:'掲載内容を確認しています',message:'お支払いを確認しました。支払確認から7暦日以内に掲載内容を審査し、承認して掲載を開始した日から30日間掲載します。'},
  approved:{title:'スポンサー掲載中です',message:'掲載内容の確認が完了し、スポンサー一覧に掲載しています。掲載期間をご確認ください。'},
  expired:{title:'掲載期間が終了しました',message:'30日間の掲載期間が終了しました。継続課金や自動更新はありません。'},
  paused:{title:'掲載を停止しています',message:'現在、スポンサー一覧への掲載を停止しています。詳しい状況は運営へお問い合わせください。'},
  refund_required:{title:'返金の対応が必要な状態です',message:'この申請は掲載を開始せず、運営による返金対応が必要な状態として記録されています。この表示は返金完了を意味しません。'},
  review_overdue:{title:'審査期限を過ぎています',message:'期限内に審査が完了せず、掲載は開始していません。運営が返金の対応を確認します。'},
  review_expired:{title:'審査期限を過ぎています',message:'期限内に審査が完了せず、掲載は開始していません。運営が返金の対応を確認します。'},
  payment_hold:{title:'お支払いの記録を確認しています',message:'支払いの内容を確認するため、掲載を保留しています。重複して申し込まず、運営へお問い合わせください。'},
  payment_failed:{title:'お支払いは完了していません',message:'このお申し込みでは、お支払いの完了を確認できませんでした。支払方法の状況をご確認ください。'}
});

/** Public sales/listing UI. A redirect can only initiate a receipt read. */
export function createSponsorsPage(root,{fetcher=(...args)=>fetch(...args),href=globalThis.location?.href||'https://local.invalid/sponsors.html',navigate=url=>globalThis.location.assign(url)}={}){
  const get=id=>root.querySelector('#'+id),set=(id,value)=>{const node=get(id);if(node)node.textContent=value;};
  let disposed=false,sequence=0,receiptSequence=0,controller=null,receiptController=null,loading=false,receiptLoading=false,data=null,receipt=null,error='',receiptError='',acknowledged=false,navigating=false,receiptId=null;
  const listeners=[];const listen=(id,event,callback)=>{const element=get(id);element?.addEventListener(event,callback);if(element)listeners.push([element,event,callback]);};
  function canPurchase(){return !disposed&&!loading&&!navigating&&!!data&&data.enabled===true&&validSponsorOffer(data.offer)&&!!safeCheckoutUrl(data.checkoutUrl)&&validPublicMerchant(data.merchant);}
  function renderPurchase(){
    const ready=canPurchase(),button=get('sponsor-buy'),check=get('sponsor-terms-check');
    set('sponsor-sales-badge',ready?'お申し込み受付中':'販売準備中');set('sponsor-price-caption',ready?'支払総額':'販売予定価格・支払総額');
    set('sponsor-sales-message',loading?'販売状況を確認しています。':error||(!ready?'現在、販売開始に向けて準備しています。お申し込みとお支払いはまだできません。':'掲載内容と販売事業者の表記をご確認のうえ、決済画面へお進みください。'));
    if(button){button.disabled=!ready||!acknowledged;button.textContent=navigating?'決済画面を開いています…':ready?'Stripeの決済画面へ進む':'販売準備中';}
    if(check){check.disabled=!ready;check.checked=acknowledged&&ready;}
  }
  function renderListings(){
    const cards=get('sponsor-directory-cards'),state=get('sponsor-directory-state'),refresh=get('sponsor-directory-refresh');if(refresh)refresh.disabled=loading;
    const listings=data?.listings||[];
    if(cards)cards.innerHTML=listings.map(item=>`<article class="sp-sponsor-card"><span class="sp-ad-label">広告 / SPONSOR</span><h3>${esc(item.sponsorName)}</h3>${item.message?`<p>${esc(item.message)}</p>`:''}<a href="${esc(item.url)}" target="_blank" rel="sponsored noopener noreferrer">ウェブサイトを見る</a><span class="sp-card-period">掲載期間：${date(item.startsAt)}〜${date(item.endsAt)}</span></article>`).join('');
    if(state){state.hidden=!loading&&!error&&listings.length>0;state.textContent=loading?'掲載情報を確認しています。':error?'スポンサー一覧を読み込めませんでした。「一覧を更新する」から再度ご確認ください。':'掲載中のスポンサーはまだいません。承認後、掲載期間中のスポンサーがここに表示されます。';}
  }
  function renderReceipt(){
    const panel=get('sponsor-receipt');if(panel)panel.hidden=!receiptId;const button=get('sponsor-receipt-refresh');if(button)button.disabled=receiptLoading;
    const status=receipt&&SPONSOR_STATUSES[receipt.status];set('sponsor-receipt-title',status?.title||'お申し込みの状況');set('sponsor-receipt-message',receiptLoading?'お支払いと掲載の状況を確認しています。':receiptError||status?.message||'まだ支払いの完了を確認できていません。');
    const details=get('sponsor-receipt-details');if(details)details.innerHTML=receipt?`${receipt.sponsorName?`<div><dt>スポンサー名</dt><dd>${esc(receipt.sponsorName)}</dd></div>`:''}${integer(receipt.amount)&&receipt.currency==='jpy'?`<div><dt>お申し込み金額</dt><dd>${receipt.amount.toLocaleString('ja-JP')}円</dd></div>`:''}${timestamp(receipt.startsAt)&&timestamp(receipt.endsAt)?`<div><dt>掲載期間</dt><dd>${date(receipt.startsAt)}〜${date(receipt.endsAt)}</dd></div>`:''}`:'';
  }
  function validateSnapshot(result){
    if(!result||typeof result.enabled!=='boolean'||!validSponsorOffer(result.offer)||!Array.isArray(result.listings)||!timestamp(result.serverTime))throw new Error('販売状況を確認できませんでした。時間をおいて一覧を更新してください。');
    if(result.enabled&&(!safeCheckoutUrl(result.checkoutUrl)||!validPublicMerchant(result.merchant)))throw new Error('お申し込みの準備状況を確認できませんでした。現在、お支払いへは進めません。');
    const listings=[];for(const item of result.listings){
      const url=safeSponsorUrl(item?.url);if(!item||typeof item.id!=='string'||typeof item.sponsorName!=='string'||!item.sponsorName.trim()||Array.from(item.sponsorName).length>60||typeof item.message!=='string'||Array.from(item.message).length>80||!url||!timestamp(item.startsAt)||!timestamp(item.endsAt)||item.startsAt>result.serverTime||item.endsAt<=result.serverTime)continue;
      listings.push({...item,url});
    }
    return {...result,listings,checkoutUrl:result.enabled?safeCheckoutUrl(result.checkoutUrl):null};
  }
  async function load(){
    if(disposed||navigating)return false;controller?.abort();const current=new AbortController(),request=++sequence;controller=current;loading=true;error='';data=null;acknowledged=false;renderPurchase();renderListings();const timer=setTimeout(()=>current.abort(),12000);
    try{const response=await fetcher('/api/sponsors',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:current.signal});if(!response.ok)throw new Error('販売状況を読み込めませんでした。時間をおいて一覧を更新してください。');const result=await response.json();if(disposed||request!==sequence)return false;data=validateSnapshot(result);return true;}
    catch(failure){if(!disposed&&request===sequence){data=null;error=failure.name==='AbortError'?'通信が時間切れになりました。販売状況をもう一度ご確認ください。':failure instanceof SyntaxError?'販売状況を確認できませんでした。時間をおいて一覧を更新してください。':failure.message;}return false;}
    finally{clearTimeout(timer);if(request===sequence&&!disposed){loading=false;controller=null;renderPurchase();renderListings();}}
  }
  async function loadReceipt(){
    if(disposed||!receiptId)return false;receiptController?.abort();const current=new AbortController(),request=++receiptSequence;receiptController=current;receiptLoading=true;receiptError='';receipt=null;renderReceipt();const timer=setTimeout(()=>current.abort(),12000);
    try{const response=await fetcher('/api/sponsors/order?session_id='+encodeURIComponent(receiptId),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:current.signal});if(!response.ok)throw new Error('申し込みの状況を確認できませんでした。少し待って更新するか、運営へお問い合わせください。');const result=await response.json();if(disposed||request!==receiptSequence)return false;
      if(!result||!Object.hasOwn(SPONSOR_STATUSES,result.status)||(result.amount!=null&&!integer(result.amount))||(result.currency!=null&&result.currency!=='jpy')||(result.sponsorName!=null&&(typeof result.sponsorName!=='string'||Array.from(result.sponsorName).length>60)))throw new Error('申し込みの記録を確認できませんでした。支払いが完了したとは判断できません。');
      receipt={status:result.status,amount:result.amount,currency:result.currency,sponsorName:result.sponsorName,startsAt:result.startsAt,endsAt:result.endsAt};return true;
    }catch(failure){if(!disposed&&request===receiptSequence){receipt=null;receiptError=failure.name==='AbortError'?'確認が時間切れになりました。お支払いをやり直さず、先に状況を更新してください。':failure instanceof SyntaxError?'申し込みの状況を確認できませんでした。お支払いをやり直さず、先に状況を更新してください。':failure.message;}return false;}
    finally{clearTimeout(timer);if(request===receiptSequence&&!disposed){receiptLoading=false;receiptController=null;renderReceipt();}}
  }
  function setTermsAcknowledged(value){acknowledged=canPurchase()&&value===true;renderPurchase();return acknowledged;}
  function checkout(){
    if(!canPurchase()||!acknowledged)return false;const url=safeCheckoutUrl(data.checkoutUrl);if(!url)return false;navigating=true;renderPurchase();
    try{navigate(url);return true;}catch{navigating=false;error='決済画面を開けませんでした。お支払いは開始していません。販売状況を更新してからお試しください。';acknowledged=false;renderPurchase();return false;}
  }
  function start(){
    if(disposed)return;try{const id=new URL(href).searchParams.get('session_id');if(id&&/^cs_live_[A-Za-z0-9]{8,180}$/.test(id))receiptId=id;}catch{}
    listen('sponsor-terms-check','change',event=>setTermsAcknowledged(event.target.checked));listen('sponsor-buy','click',checkout);listen('sponsor-directory-refresh','click',()=>void load());listen('sponsor-receipt-refresh','click',()=>void loadReceipt());renderPurchase();renderReceipt();return Promise.all([load(),...(receiptId?[loadReceipt()]:[])]);
  }
  function dispose(){disposed=true;sequence++;receiptSequence++;controller?.abort();receiptController?.abort();data=null;receipt=null;acknowledged=false;for(const [element,event,callback]of listeners)element.removeEventListener?.(event,callback);listeners.length=0;}
  return {start,load,loadReceipt,setTermsAcknowledged,checkout,dispose,getState:()=>({loading,receiptLoading,ready:canPurchase(),acknowledged,navigating,error,receiptError,listings:data?.listings?.map(item=>({...item}))||[],receipt:receipt?{...receipt}:null})};
}
if(typeof document!=='undefined'){const root=document.getElementById('sponsors-app');if(root){let page;const mount=()=>{page=createSponsorsPage(root);page.start();};mount();globalThis.addEventListener?.('pagehide',()=>{page?.dispose();page=null;});globalThis.addEventListener?.('pageshow',event=>{if(event.persisted&&!page)mount();});}}
