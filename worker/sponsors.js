// Sponsor listings are a separate advertising purchase. They never fund or
// credit game money, reward points, the BTC treasury, or a player's wallet.
export const SPONSOR_OFFER=Object.freeze({id:'sponsor-directory-30d-v1',name:'まち スポンサー掲載30日',amount:3300,currency:'jpy',durationDays:30,reviewDays:7});
const BASE='/api/sponsors',DAY=86400000,MAX_BODY=262144,MAX_TIME=253402297199999;
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const CHECKOUT_TYPES=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']);
const CHARGE_TYPES=new Set(['charge.succeeded','charge.updated','charge.refunded']);
const REFUND_TYPES=new Set(['refund.created','refund.updated','refund.failed','charge.refund.updated']);
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const rows=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results||[];
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();
class SponsorError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new SponsorError(status,code,message);};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const changes=r=>Number(r?.meta?.changes||0)>0;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const encoder=new TextEncoder();
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value)));
const reference=(value,prefix)=>{const id=typeof value==='string'?value:object(value)?value.id:null;return typeof id==='string'&&id.length<=200&&new RegExp('^'+prefix+'[A-Za-z0-9]+$').test(id)?id:null;};
const sessionId=value=>typeof value==='string'&&/^cs_live_[A-Za-z0-9]{8,180}$/.test(value)?value:null;
const finiteInteger=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function plain(value,min,max){
  if(typeof value!=='string'||/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))return null;
  const text=value.trim(),length=Array.from(text).length;return length>=min&&length<=max?text:null;
}
function publicHttps(value,max=2048){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0020\u007f]/.test(value))return null;
  let url;try{url=new URL(value);}catch{return null;}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!host.includes('.')||host.endsWith('.')||host.includes(':')||/^\d+(?:\.\d+)*$/.test(host)||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host))return null;
  return url.href;
}
const placeholder=value=>/(?:未設定|確認中|準備中|未入力|後で|サンプル|仮入力|placeholder|\btodo\b|\btbd\b|example\.(?:com|org|net)|your[_ -]|dummy)/i.test(value);
function merchantInfo(env){
  let source;try{source=JSON.parse(env?.SPONSOR_MERCHANT_JSON||'');}catch{return null;}
  if(!object(source))return null;
  const out={};for(const [key,min,max]of [['sellerName',2,160],['representative',2,120],['address',8,500],['phone',8,40],['email',5,254],['paymentTiming',2,200]]){const value=plain(source[key],min,max);if(!value||placeholder(value))return null;out[key]=value;}
  const digits=out.phone.replace(/[^0-9]/g,'');if(!/^[+()0-9 .-]+$/.test(out.phone)||digits.length<10||digits.length>15||/^(\d)\1+$/.test(digits)||digits==='1234567890')return null;
  if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(out.email))return null;
  if(!Array.isArray(source.paymentMethods)||source.paymentMethods.length<1||source.paymentMethods.length>12)return null;
  out.paymentMethods=[];for(const item of source.paymentMethods){const text=plain(item,1,60);if(!text||placeholder(text)||out.paymentMethods.includes(text))return null;out.paymentMethods.push(text);}
  if(source.contactUrl!==undefined&&source.contactUrl!==''){out.contactUrl=publicHttps(source.contactUrl);if(!out.contactUrl||placeholder(out.contactUrl))return null;}
  return out;
}
function config(env={}){
  const accountId=reference(env.SPONSOR_STRIPE_ACCOUNT_ID,'acct_'),paymentLinkId=reference(env.SPONSOR_STRIPE_PAYMENT_LINK_ID,'plink_');
  const webhookSecret=typeof env.SPONSOR_STRIPE_WEBHOOK_SECRET==='string'&&/^whsec_[A-Za-z0-9]{16,250}$/.test(env.SPONSOR_STRIPE_WEBHOOK_SECRET)?env.SPONSOR_STRIPE_WEBHOOK_SECRET:null;
  const adminToken=typeof env.SPONSOR_ADMIN_TOKEN==='string'&&/^[\x21-\x7e]{32,512}$/.test(env.SPONSOR_ADMIN_TOKEN)?env.SPONSOR_ADMIN_TOKEN:null;
  const merchant=merchantInfo(env);let checkoutUrl=publicHttps(env.SPONSOR_STRIPE_PAYMENT_LINK_URL);
  if(checkoutUrl){const url=new URL(checkoutUrl);if(url.hostname!=='buy.stripe.com'||url.search||url.hash||!/^\/[A-Za-z0-9]+$/.test(url.pathname)||url.pathname.startsWith('/test_'))checkoutUrl=null;}
  let disabledReason=null;
  if(!merchant)disabledReason='販売者情報と利用できる決済方法の確認が完了していません。';
  else if(env.SPONSOR_TAX_REVIEWED!=='true')disabledReason='販売時の税設定の確認が完了していません。';
  else if(!accountId||!paymentLinkId||!checkoutUrl||!webhookSecret)disabledReason='決済と入金通知の接続を準備しています。';
  else if(!adminToken)disabledReason='掲載審査を行う運営機能の準備が完了していません。';
  else if(env.SPONSOR_SALES_ENABLED!=='true')disabledReason='現在、新しいスポンサーのお申し込みを受け付けていません。';
  return {accountId,paymentLinkId,webhookSecret,adminToken,merchant,enabled:disabledReason===null,disabledReason,checkoutUrl:disabledReason===null?checkoutUrl:null};
}
function storageFailure(error){
  if(error instanceof SponsorError)return error;
  const text=String(error?.message||'');
  if(/sponsor_event_conflict|sponsor_order_conflict|sponsor_charge_conflict|sponsor_orders.payment_intent_id/.test(text))return new SponsorError(409,'sponsor_event_conflict','決済記録の一致を確認できません。運営で確認してください。');
  if(/sponsor_approval_blocked|sponsor_invalid_transition/.test(text))return new SponsorError(409,'sponsor_action_blocked','現在の状態ではこの掲載操作を実行できません。記録を更新してください。');
  return new SponsorError(503,'sponsor_storage_unavailable','スポンサーの記録を確認できませんでした。時間をおいて再度お試しください。');
}
async function readBytes(request,limit){
  const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>limit)fail(413,'sponsor_body_too_large','送信データが大きすぎます。');
  const reader=request.body?.getReader();if(!reader)fail(400,'sponsor_body_missing','送信データがありません。');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'sponsor_body_too_large','送信データが大きすぎます。');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
async function verifiedEvent(request,settings,at){
  if(!settings.webhookSecret||!settings.accountId||!settings.paymentLinkId)fail(503,'sponsor_webhook_unconfigured','決済通知の受信設定が完了していません。');
  const signature=request.headers.get('Stripe-Signature')||'';if(signature.length>4096)fail(400,'sponsor_signature_invalid','決済通知の署名を確認できません。');
  const parts=signature.split(',').map(part=>part.trim()),times=parts.filter(part=>part.startsWith('t=')),signatures=parts.filter(part=>part.startsWith('v1=')).map(part=>part.slice(3));
  if(times.length!==1||!/^t=\d{1,12}$/.test(times[0])||signatures.length<1||signatures.length>8||signatures.some(value=>!/^[a-f0-9]{64}$/i.test(value)))fail(400,'sponsor_signature_invalid','決済通知の署名を確認できません。');
  const timestamp=Number(times[0].slice(2));if(Math.abs(Math.floor(at/1000)-timestamp)>300)fail(400,'sponsor_signature_expired','決済通知の署名期限を確認できません。');
  const raw=await readBytes(request,MAX_BODY),prefix=encoder.encode(timestamp+'.'),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
  const key=await crypto.subtle.importKey('raw',encoder.encode(settings.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;for(const signature of signatures){const bytes=Uint8Array.from(signature.match(/../g),value=>parseInt(value,16));if(await crypto.subtle.verify('HMAC',key,bytes,signed))valid=true;}
  if(!valid)fail(400,'sponsor_signature_invalid','決済通知の署名を確認できません。');
  let event;try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail(400,'sponsor_event_invalid','決済通知を読み取れません。');}
  if(!object(event)||!reference(event.id,'evt_')||event.object!=='event'||event.livemode!==true||!finiteInteger(event.created,0,Math.floor(at/1000)+300)||typeof event.type!=='string'||event.type.length>120||!object(event.data?.object))fail(400,'sponsor_event_invalid','本番の決済通知として確認できません。');
  // Direct-account snapshot events normally omit account. This endpoint's
  // account-owned signing secret and allowlisted Payment Link bind that case.
  // Connect/organization events must explicitly match the configured account.
  if(event.account!=null&&event.account!==settings.accountId||event.context!=null&&event.context!==settings.accountId)fail(400,'sponsor_account_mismatch','決済通知の販売アカウントが一致しません。');
  if(event.data.object.livemode!==undefined&&event.data.object.livemode!==true)fail(400,'sponsor_event_invalid','テスト用の決済通知は受け付けていません。');
  return {event};
}
function contentFromSession(session){
  const fields=session.custom_fields;let valid=Array.isArray(fields)&&fields.length<=3,values={};
  if(Array.isArray(fields))for(const field of fields){if(!object(field)||!['sponsor_name','sponsor_url','sponsor_message'].includes(field.key)||Object.hasOwn(values,field.key)||field.type!=='text'||typeof field.text?.value!=='string'){valid=false;continue;}values[field.key]=field.text.value;}
  const name=plain(values.sponsor_name,1,60),url=publicHttps(values.sponsor_url),message=plain(values.sponsor_message??'',0,80);
  valid=valid&&name!==null&&url!==null&&message!==null;
  return {name:name??'',url:url??'',message:message??'',valid:valid?1:0,error:valid?'':'掲載名・紹介文・公開HTTPS URLの条件を満たしていません。掲載せず、返金対応を確認してください。'};
}
function normalizeEvent(event,settings,hash,receivedAt){
  const data=event.data.object;
  const out={id:event.id,payload_hash:hash,event_type:event.type,account_id:settings.accountId,event_at:event.created*1000,received_at:receivedAt,effect:'ignored',order_id:null,session_id:null,payment_intent_id:null,charge_id:null,payment_link_id:null,offer_id:null,amount:null,currency:null,payment_state:null,sponsor_name:null,sponsor_url:null,sponsor_message:null,content_valid:null,content_error:null,content_fingerprint:null,charge_paid:null,charge_captured:null,amount_captured:null,amount_refunded:null,charge_disputed:null,hold_reason:null};
  if(CHECKOUT_TYPES.has(event.type)){
    if(data.object!=='checkout.session'||data.livemode!==true||!sessionId(data.id))fail(400,'sponsor_checkout_invalid','Checkoutの通知形式が正しくありません。');
    if(reference(data.payment_link,'plink_')!==settings.paymentLinkId)return out;
    const totals=data.total_details;
    if(data.metadata?.offer!==SPONSOR_OFFER.id||data.mode!=='payment'||data.status!=='complete'||data.currency!=='jpy'||data.amount_total!==3300||!object(totals)||totals.amount_discount!==0||totals.amount_shipping!==0||!finiteInteger(totals.amount_tax,0,3300)||data.allow_promotion_codes===true||data.shipping_cost!=null||data.shipping_address_collection!=null||Array.isArray(data.shipping_options)&&data.shipping_options.length||Array.isArray(data.discounts)&&data.discounts.length)fail(400,'sponsor_offer_mismatch','指定された掲載プランの支払いとして確認できません。');
    if(!['paid','unpaid'].includes(data.payment_status))fail(400,'sponsor_payment_invalid','支払い状態を確認できません。');
    const pi=reference(data.payment_intent,'pi_');
    if(data.payment_status==='paid'&&!pi)fail(400,'sponsor_payment_invalid','支払いの識別情報を確認できません。');
    const paymentState=event.type==='checkout.session.async_payment_failed'?'failed':data.payment_status==='paid'?'paid':'unpaid';
    if(event.type==='checkout.session.async_payment_succeeded'&&paymentState!=='paid')fail(400,'sponsor_payment_invalid','支払い完了を確認できません。');
    const content=contentFromSession(data);
    Object.assign(out,{effect:'checkout',order_id:'sp_'+crypto.randomUUID().replaceAll('-',''),session_id:data.id,payment_intent_id:pi,payment_link_id:settings.paymentLinkId,offer_id:SPONSOR_OFFER.id,amount:3300,currency:'jpy',payment_state:paymentState,sponsor_name:content.name,sponsor_url:content.url,sponsor_message:content.message,content_valid:content.valid,content_error:content.error});
    // Filled asynchronously before insertion, without preserving raw custom data.
    out.content_fingerprint=JSON.stringify([out.payment_link_id,out.offer_id,out.amount,out.currency,content.name,content.url,content.message,content.valid]);
  }else if(CHARGE_TYPES.has(event.type)){
    if(data.object!=='charge'||data.livemode!==true||!reference(data.id,'ch_'))fail(400,'sponsor_charge_invalid','支払い照合の通知形式が正しくありません。');
    const pi=reference(data.payment_intent,'pi_');if(!pi)return out;
    // The account may sell other products. Only this offer's charge metadata
    // may verify a listing; unrelated amounts/customer data are never stored.
    if(data.metadata?.offer!==SPONSOR_OFFER.id){
      if(event.type==='charge.refunded'||data.amount_refunded>0||data.disputed===true)Object.assign(out,{effect:'hold',payment_intent_id:pi,charge_id:data.id,hold_reason:data.disputed===true?'dispute':'refund'});
      return out;
    }
    if(!finiteInteger(data.amount,0,1000000000000)||!finiteInteger(data.amount_captured,0,data.amount)||!finiteInteger(data.amount_refunded,0,data.amount)||typeof data.currency!=='string'||!/^[a-z]{3}$/.test(data.currency)||typeof data.paid!=='boolean'||typeof data.captured!=='boolean'||typeof data.disputed!=='boolean')fail(400,'sponsor_charge_invalid','支払い金額の照合情報が正しくありません。');
    Object.assign(out,{effect:'charge',payment_intent_id:pi,charge_id:data.id,amount:data.amount,currency:data.currency,charge_paid:data.paid&&data.status==='succeeded'?1:0,charge_captured:data.captured?1:0,amount_captured:data.amount_captured,amount_refunded:data.amount_refunded,charge_disputed:data.disputed?1:0,hold_reason:event.type==='charge.refunded'||data.amount_refunded>0?'refund':data.disputed?'dispute':null});
  }else if(REFUND_TYPES.has(event.type)||event.type.startsWith('charge.dispute.')){
    const dispute=event.type.startsWith('charge.dispute.');
    if(data.object!==(dispute?'dispute':'refund')||!reference(data.id,dispute?'du_':'re_'))fail(400,'sponsor_hold_invalid','返金・異議申立ての通知形式が正しくありません。');
    const pi=reference(data.payment_intent,'pi_'),charge=reference(data.charge,'ch_');
    if(!pi&&!charge)fail(400,'sponsor_hold_invalid','確認が必要な支払いを特定できません。');
    Object.assign(out,{effect:'hold',payment_intent_id:pi,charge_id:charge,hold_reason:dispute?'dispute':event.type==='refund.failed'?'refund_failed':'refund'});
  }
  return out;
}
const HOLD_SQL="EXISTS(SELECT 1 FROM sponsor_payment_holds h WHERE h.session_id=o.session_id OR (h.payment_intent_id IS NOT NULL AND h.payment_intent_id=o.payment_intent_id) OR h.charge_id IN(SELECT c.charge_id FROM sponsor_charges c WHERE c.payment_intent_id=o.payment_intent_id))";
const VERIFIED_SQL="EXISTS(SELECT 1 FROM sponsor_charges c WHERE c.payment_intent_id=o.payment_intent_id AND c.amount=3300 AND c.currency='jpy' AND c.paid=1 AND c.captured=1 AND c.amount_captured=3300 AND c.amount_refunded=0 AND c.disputed=0)";
const HOLD_REASONS_SQL="(SELECT group_concat(DISTINCT h.reason) FROM sponsor_payment_holds h WHERE h.session_id=o.session_id OR h.payment_intent_id=o.payment_intent_id OR h.charge_id IN(SELECT c.charge_id FROM sponsor_charges c WHERE c.payment_intent_id=o.payment_intent_id))";
const ORDER_SELECT=`SELECT o.*,${HOLD_SQL} AS hold,${VERIFIED_SQL} AS payment_verified,${HOLD_REASONS_SQL} AS hold_reasons FROM sponsor_orders o`;
// Two time parameters followed by the expected public status; evaluated again
// inside the mutation, not only in the operator's earlier confirmation view.
const EXPECTED_STATUS_SQL=`(CASE WHEN o.state='refund_required' THEN 'refund_required' WHEN ${HOLD_SQL} THEN 'payment_hold' WHEN o.starts_at IS NOT NULL AND o.ends_at<=? THEN 'expired' WHEN o.state='paid_pending_review' AND o.paid_at+604800000<=? THEN 'review_overdue' ELSE o.state END)=?`;
function status(row,at){
  if(row.state==='refund_required')return 'refund_required';
  if(row.hold)return 'payment_hold';
  if(row.starts_at!==null&&row.ends_at<=at)return 'expired';
  if(row.state==='paid_pending_review'&&row.paid_at+SPONSOR_OFFER.reviewDays*DAY<=at)return 'review_overdue';
  return row.state;
}
function adminView(row,at){
  const state=status(row,at),started=row.starts_at!==null;
  const holdReasons=row.hold_reasons?row.hold_reasons.split(',').sort():[];
  return {id:row.id,status:state,sponsorName:row.sponsor_name,url:row.sponsor_url,message:row.sponsor_message,amount:row.amount,currency:row.currency,paidAt:row.paid_at,startsAt:row.starts_at,endsAt:row.ends_at,createdAt:row.created_at,updatedAt:row.updated_at,reviewDeadlineAt:row.paid_at===null?null:row.paid_at+SPONSOR_OFFER.reviewDays*DAY,hold:!!row.hold,holdReasons,contentValid:!!row.content_valid,contentError:row.content_error,paymentVerified:!!row.payment_verified,paymentStatus:row.payment_state,canApprove:row.payment_state==='paid'&&!!row.payment_verified&&!!row.content_valid&&!row.hold&&['paid_pending_review','paused'].includes(row.state)&&(started?row.ends_at>at:row.paid_at+SPONSOR_OFFER.reviewDays*DAY>at),canReject:row.payment_state==='paid'&&row.state!=='refund_required',canPause:row.state==='approved'&&row.ends_at>at,sessionId:row.session_id,paymentIntentId:row.payment_intent_id};
}
export function createSponsorshipService({db,env={},now=()=>Date.now()}={}){
  const settings=config(env);
  const timestamp=()=>{const at=now();if(!finiteInteger(at,0,MAX_TIME-SPONSOR_OFFER.durationDays*DAY))fail(503,'sponsor_clock_invalid','時刻の確認が必要です。');return at;};
  async function getOrderRow(id,bySession=false){return first(db,ORDER_SELECT+' WHERE '+(bySession?'o.session_id':'o.id')+'=?',id);}
  async function getPublic(){
    const at=timestamp();const listings=await rows(db,`SELECT o.id,o.sponsor_name,o.sponsor_url,o.sponsor_message,o.starts_at,o.ends_at FROM sponsor_orders o WHERE o.state='approved' AND o.payment_state='paid' AND o.content_valid=1 AND o.starts_at<=? AND o.ends_at>? AND ${VERIFIED_SQL} AND NOT (${HOLD_SQL}) ORDER BY o.starts_at DESC,o.id`,at,at);
    return {offer:{...SPONSOR_OFFER},enabled:settings.enabled,disabledReason:settings.disabledReason,checkoutUrl:settings.checkoutUrl,merchant:settings.merchant,listings:listings.map(row=>({id:row.id,sponsorName:row.sponsor_name,url:row.sponsor_url,message:row.sponsor_message,startsAt:row.starts_at,endsAt:row.ends_at})),serverTime:at};
  }
  async function getOrder(session){
    if(!sessionId(session))fail(400,'sponsor_session_invalid','支払いの確認番号が正しくありません。');
    const row=await getOrderRow(session,true);if(!row)return {status:'awaiting_confirmation',amount:3300,currency:'jpy',sponsorName:null,startsAt:null,endsAt:null};
    return {status:status(row,timestamp()),amount:row.amount,currency:row.currency,sponsorName:row.sponsor_name||null,startsAt:row.starts_at,endsAt:row.ends_at};
  }
  async function getAdminOrder(id){
    const row=await getOrderRow(id);if(!row)fail(404,'sponsor_order_not_found','この掲載申請は見つかりません。');
    return adminView(row,timestamp());
  }
  async function getAdmin(){
    const at=timestamp(),orders=await rows(db,ORDER_SELECT+" ORDER BY CASE WHEN o.state='paid_pending_review' THEN 0 WHEN o.state='refund_required' THEN 1 ELSE 2 END,o.created_at DESC,o.id LIMIT 200");
    const mapped=orders.map(row=>adminView(row,at));
    return {orders:mapped,serverTime:at,offer:{...SPONSOR_OFFER},enabled:settings.enabled,disabledReason:settings.disabledReason};
  }
  async function receiveWebhook(request){
    const at=timestamp(),{event}=await verifiedEvent(request,settings,at),item=normalizeEvent(event,settings,null,at);
    if(item.effect==='ignored')return {received:true,ignored:true};
    if(item.content_fingerprint)item.content_fingerprint=await digest(item.content_fingerprint);
    // Stripe may reserialize an event or change delivery-envelope counters on
    // retry. Authenticate the raw bytes above, but deduplicate normalized
    // business facts rather than whitespace, pending_webhooks or receive time.
    const facts=Object.fromEntries(Object.entries(item).filter(([key])=>!['payload_hash','received_at','order_id'].includes(key)));
    const hash=await digest(JSON.stringify(facts));item.payload_hash=hash;
    const fields=Object.keys(item),values=Object.values(item);let result;
    try{result=await run(db,'INSERT INTO sponsor_events('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+') ON CONFLICT(id) DO NOTHING',...values);}catch(error){throw storageFailure(error);}
    const recorded=await first(db,'SELECT payload_hash FROM sponsor_events WHERE id=?',event.id);
    if(!recorded||recorded.payload_hash!==hash)fail(409,'sponsor_event_conflict','同じ決済通知の内容が一致しません。');
    return {received:true,duplicate:!changes(result)};
  }
  async function act(id,action,expected){
    if(typeof id!=='string'||!/^sp_[a-f0-9]{32}$/.test(id)||!['approve','reject','pause'].includes(action))fail(400,'sponsor_action_invalid','掲載操作が正しくありません。');
    if(!object(expected)||Object.keys(expected).length!==2||typeof expected.expectedStatus!=='string'||expected.expectedStatus.length>40||!finiteInteger(expected.expectedUpdatedAt,0,MAX_TIME))fail(400,'sponsor_body_invalid','確認した掲載状態と更新時刻を指定してください。');
    const before=await getAdminOrder(id),at=timestamp();
    if(action==='approve'&&before.status==='approved'||action==='pause'&&before.status==='paused'||action==='reject'&&before.status==='refund_required')return {order:before,duplicate:true,serverTime:at};
    if(before.status!==expected.expectedStatus||before.updatedAt!==expected.expectedUpdatedAt)fail(409,'sponsor_stale_state','確認後に掲載状態が更新されました。最新の記録を読み込み、もう一度確認してください。');
    if(action==='approve'&&!before.canApprove||action==='pause'&&!before.canPause||action==='reject'&&!before.canReject)fail(409,'sponsor_action_blocked','支払い・審査期限・掲載内容・保留状態を確認してください。この操作は実行できません。');
    let result;
    const version=[expected.expectedUpdatedAt,at,at,expected.expectedStatus];
    if(action==='approve')result=await run(db,`UPDATE sponsor_orders AS o SET state='approved',starts_at=coalesce(starts_at,?),ends_at=coalesce(ends_at,?),updated_at=max(updated_at+1,?) WHERE id=? AND state IN ('paid_pending_review','paused') AND payment_state='paid' AND content_valid=1 AND ${VERIFIED_SQL} AND NOT (${HOLD_SQL}) AND ((starts_at IS NULL AND paid_at+604800000>?) OR (starts_at IS NOT NULL AND ends_at>?)) AND updated_at=? AND ${EXPECTED_STATUS_SQL}`,at,at+SPONSOR_OFFER.durationDays*DAY,at,id,at,at,...version);
    else if(action==='pause')result=await run(db,`UPDATE sponsor_orders AS o SET state='paused',updated_at=max(updated_at+1,?) WHERE id=? AND state='approved' AND ends_at>? AND updated_at=? AND ${EXPECTED_STATUS_SQL}`,at,id,at,...version);
    else result=await run(db,`UPDATE sponsor_orders AS o SET state='refund_required',updated_at=max(updated_at+1,?) WHERE id=? AND payment_state='paid' AND state<>'refund_required' AND updated_at=? AND ${EXPECTED_STATUS_SQL}`,at,id,...version);
    const after=await getAdminOrder(id),target=action==='approve'?'approved':action==='pause'?'paused':'refund_required';
    if(!changes(result)&&after.status!==target)fail(409,'sponsor_stale_state','別の操作で状態が変わりました。最新の記録を読み込み、もう一度確認してください。');
    return {order:after,duplicate:!changes(result),serverTime:timestamp()};
  }
  const methods={getPublic,getOrder,getAdmin,getAdminOrder,receiveWebhook,act};
  return Object.fromEntries(Object.entries(methods).map(([name,fn])=>[name,async(...args)=>{try{return await fn(...args);}catch(error){throw storageFailure(error);}}]));
}
async function authorize(request,settings){
  if(!settings.adminToken)fail(503,'sponsor_admin_unconfigured','運営用の接続設定が完了していません。');
  const header=request.headers.get('Authorization')||'',match=/^Bearer ([\x21-\x7e]{32,512})$/.exec(header);
  if(!match)fail(401,'sponsor_admin_required','運営用の接続情報を確認してください。');
  const [expected,actual]=await Promise.all([digest(settings.adminToken),digest(match[1])]);let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i);if(difference)fail(401,'sponsor_admin_required','運営用の接続情報を確認してください。');
}
export async function handleSponsors(request,env){
  const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
  const path=url.pathname.slice(BASE.length)||'/',method=request.method.toUpperCase();
  try{
    const db=env?.DB;if(!db?.prepare)fail(503,'sponsor_database_unavailable','スポンサー機能を準備しています。');
    const service=createSponsorshipService({db,env});
    if(path==='/stripe-webhook'){
      if(method!=='POST')fail(405,'method_not_allowed','この操作は利用できません。');
      return json(await service.receiveWebhook(request));
    }
    const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
    if(origin&&origin!==url.origin||site&&!['same-origin','none'].includes(site))fail(403,'sponsor_origin_forbidden','このサイト内から操作してください。');
    if(path==='/'&&method==='GET')return json(await service.getPublic());
    if(path==='/order'&&method==='GET')return json(await service.getOrder(url.searchParams.get('session_id')));
    if(path==='/admin'||path.startsWith('/admin/')){
      await authorize(request,config(env));
      if(path==='/admin'&&method==='GET')return json(await service.getAdmin());
      const match=/^\/admin\/(sp_[a-f0-9]{32})\/(approve|reject|pause)$/.exec(path);
      if(match&&method==='POST'){
        if(origin!==url.origin)fail(403,'sponsor_origin_forbidden','このサイト内から操作してください。');
        if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'sponsor_json_required','JSON形式で送信してください。');
        let body;try{body=JSON.parse(new TextDecoder().decode(await readBytes(request,2048)));}catch(error){if(error instanceof SponsorError)throw error;fail(400,'sponsor_body_invalid','送信データを読み取れません。');}
        if(!object(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'expectedStatus')||!Object.hasOwn(body,'expectedUpdatedAt'))fail(400,'sponsor_body_invalid','この操作では確認した掲載状態と更新時刻だけを送信してください。');
        return json(await service.act(match[1],match[2],body));
      }
    }
    return json({error:'このスポンサー機能は見つかりません。',code:'not_found'},404);
  }catch(error){const failure=storageFailure(error);return json({error:failure.message,code:failure.code},failure.status);}
}
