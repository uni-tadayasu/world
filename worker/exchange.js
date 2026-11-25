// Reward-account foundation only. Production HTTP never constructs a provider.
// Game money, save files and client-provided balances are not a funding source.
const MAX_POINTS=1000000000000,MAX_SATOSHIS=2100000000000000,MAX_QUOTE_MS=15*60000;
const UNAVAILABLE='暗号資産への交換は準備中です。現在、実際の交換・送金はできません。';
const RESPONSE_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
class ExchangeError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new ExchangeError(status,code,message);};
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const rows=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results||[];
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();
function token(value,label,max=160,min=1){
  if(typeof value!=='string'||value.length<min||value.length>max||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))fail(400,'exchange_invalid_input',label+'が正しくありません。');
  return value;
}
function integer(value,label,{min=1,max=MAX_POINTS}={}){
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'exchange_invalid_amount',label+'は範囲内の整数で指定してください。');return value;
}
function storageFailure(error){
  if(error instanceof ExchangeError)return error;
  const message=String(error?.message||'');
  if(message.includes('exchange_insufficient_balance'))return new ExchangeError(409,'exchange_insufficient_balance','交換対象の確定ポイントが不足しています。');
  if(message.includes('exchange_quote_expired'))return new ExchangeError(410,'exchange_quote_expired','見積の有効期限が切れています。');
  if(message.includes('exchange_requests.quote_id'))return new ExchangeError(409,'exchange_quote_used','この見積はすでに申請に使用されています。');
  if(message.includes('exchange_accounts.confirmed_points')||message.includes('confirmed_points BETWEEN'))return new ExchangeError(409,'exchange_balance_limit','確定ポイントの上限を超えるため記帳できません。');
  return new ExchangeError(503,'exchange_storage_unavailable','交換台帳を読み込めませんでした。少し待ってから再読み込みしてください。');
}
const quoteView=row=>({id:row.id,asset:row.asset,points:row.points,receiveSatoshis:row.receive_satoshis,feeSatoshis:row.fee_satoshis,createdAt:row.created_at,expiresAt:row.expires_at});
const requestView=row=>({id:row.id,asset:row.asset,points:row.points,receiveSatoshis:row.receive_satoshis,feeSatoshis:row.fee_satoshis,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at});
const REQUEST_SELECT='SELECT r.*,q.asset,q.points,q.receive_satoshis,q.fee_satoshis FROM exchange_requests r JOIN exchange_quotes q ON q.id=r.quote_id';

/**
 * Server-only dependency boundary, exercised with verified-provider fixtures.
 * A future adapter must verify signed/provider-fetched receipts and destination
 * ownership/KYC/network policy. A client boolean is never verification.
 * This service reserves points; it does not send BTC or dispatch payouts.
 */
export function createExchangeService({db,provider=null,now=()=>Date.now(),id=()=>crypto.randomUUID()}={}){
  const timestamp=()=>integer(now(),'記帳時刻',{min:0,max:Number.MAX_SAFE_INTEGER});
  const owner=value=>token(value,'端末ID',80);
  function requireProvider(method){
    if(!provider||typeof provider!=='object'||typeof provider[method]!=='function'||typeof provider.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(provider.id))fail(503,'exchange_unavailable',UNAVAILABLE);
    return provider;
  }
  async function getBalance(userId){
    owner(userId);const account=await first(db,'SELECT confirmed_points,reserved_points FROM exchange_accounts WHERE user_id=?',userId);
    const confirmedPoints=account?.confirmed_points??0,reservedPoints=account?.reserved_points??0;
    if(!Number.isSafeInteger(confirmedPoints)||!Number.isSafeInteger(reservedPoints)||confirmedPoints<0||confirmedPoints>MAX_POINTS||reservedPoints<0||reservedPoints>confirmedPoints)fail(503,'exchange_ledger_invalid','交換台帳の確認が必要です。現在、交換は利用できません。');
    return {confirmedPoints,availablePoints:confirmedPoints-reservedPoints,reservedPoints};
  }
  async function getRequests(userId){
    owner(userId);return (await rows(db,REQUEST_SELECT+' WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50',userId)).map(requestView);
  }
  async function getRequest(userId,requestId){
    owner(userId);token(requestId,'申請ID');const row=await first(db,REQUEST_SELECT+' WHERE r.user_id=? AND r.id=?',userId,requestId);
    if(!row)fail(404,'exchange_request_not_found','この申請は見つかりません。');return requestView(row);
  }
  async function getLedger(userId){
    owner(userId);return (await rows(db,'SELECT id,kind,points_delta,reserved_delta,created_at FROM exchange_ledger WHERE user_id=? ORDER BY id DESC LIMIT 100',userId)).map(row=>({id:row.id,kind:row.kind,pointsDelta:row.points_delta,reservedDelta:row.reserved_delta,createdAt:row.created_at}));
  }
  async function creditConfirmedReward(envelope){
    const adapter=requireProvider('verifyRewardEvent');
    // Only the adapter's verified return value is used; never envelope.points,
    // local money, imported save values or the caller's declared owner.
    const event=await adapter.verifyRewardEvent(envelope);
    if(!event||event.verified!==true||event.confirmed!==true||event.providerId!==adapter.id)fail(403,'exchange_reward_unverified','確定済みの報酬として確認できません。');
    const userId=owner(event.userId),eventId=token(event.eventId,'報酬イベントID'),receiptRef=token(event.receiptRef,'確認済み受領ID'),points=integer(event.points,'確定ポイント');
    const existing=await first(db,'SELECT * FROM exchange_reward_events WHERE provider_id=? AND event_id=?',adapter.id,eventId);
    const matches=row=>row.user_id===userId&&row.points===points&&row.receipt_ref===receiptRef;
    if(existing){if(!matches(existing))fail(409,'exchange_reward_conflict','同じ報酬イベントの内容が一致しません。');return {duplicate:true,balance:await getBalance(userId)};}
    let result;
    try{result=await run(db,'INSERT INTO exchange_reward_events(provider_id,event_id,user_id,points,receipt_ref,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(provider_id,event_id) DO NOTHING',adapter.id,eventId,userId,points,receiptRef,timestamp());}
    catch(error){throw storageFailure(error);}
    const recorded=await first(db,'SELECT * FROM exchange_reward_events WHERE provider_id=? AND event_id=?',adapter.id,eventId);
    if(!recorded||!matches(recorded))fail(409,'exchange_reward_conflict','同じ報酬イベントの内容が一致しません。');
    return {duplicate:Number(result?.meta?.changes||0)===0,balance:await getBalance(userId)};
  }
  async function createQuote(userId,{points,asset='BTC'}={}){
    const adapter=requireProvider('quote');owner(userId);integer(points,'交換ポイント');
    if(asset!=='BTC')fail(400,'exchange_asset_unsupported','現在の交換設計の対象はBTCです。');
    const balance=await getBalance(userId);if(balance.availablePoints<points)fail(409,'exchange_insufficient_balance','交換対象の確定ポイントが不足しています。');
    const result=await adapter.quote({userId,asset,points});
    if(!result||result.providerId!==adapter.id||result.asset!=='BTC'||result.points!==points)fail(502,'exchange_quote_invalid','提供元の見積を確認できませんでした。');
    const providerQuoteId=token(result.quoteId,'提供元の見積ID'),receiveSatoshis=integer(result.receiveSatoshis,'受取数量',{max:MAX_SATOSHIS}),feeSatoshis=integer(result.feeSatoshis,'手数料',{min:0,max:MAX_SATOSHIS});
    const createdAt=timestamp(),expiresAt=integer(result.expiresAt,'見積期限',{min:0,max:Number.MAX_SAFE_INTEGER});
    if(expiresAt<=createdAt)fail(410,'exchange_quote_expired','見積の有効期限が切れています。');
    if(expiresAt-createdAt>MAX_QUOTE_MS)fail(502,'exchange_quote_invalid','提供元の見積期限を確認できませんでした。');
    const quoteId=token(id(),'見積ID');
    try{await run(db,'INSERT INTO exchange_quotes(id,user_id,provider_id,provider_quote_id,asset,points,receive_satoshis,fee_satoshis,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',quoteId,userId,adapter.id,providerQuoteId,asset,points,receiveSatoshis,feeSatoshis,createdAt,expiresAt);}
    catch(error){throw storageFailure(error);}
    return {id:quoteId,asset,points,receiveSatoshis,feeSatoshis,createdAt,expiresAt};
  }
  async function createRequest(userId,{quoteId,idempotencyKey,destinationRef}={}){
    const adapter=requireProvider('verifyDestination');owner(userId);token(quoteId,'見積ID');token(idempotencyKey,'再送防止キー',128,8);token(destinationRef,'確認済み送付先ID');
    const previous=()=>first(db,REQUEST_SELECT+' WHERE r.user_id=? AND r.idempotency_key=?',userId,idempotencyKey);
    const replay=row=>{if(row.quote_id!==quoteId||row.destination_ref!==destinationRef)fail(409,'exchange_idempotency_conflict','同じ再送防止キーで異なる申請を送信できません。');return {request:requestView(row),duplicate:true};};
    const existing=await previous();if(existing)return replay(existing);
    const quote=await first(db,'SELECT * FROM exchange_quotes WHERE id=? AND user_id=?',quoteId,userId);
    if(!quote)fail(404,'exchange_quote_not_found','この見積は見つかりません。');
    if(quote.provider_id!==adapter.id)fail(409,'exchange_quote_provider_changed','現在の提供元で見積を取り直してください。');
    if(quote.expires_at<=timestamp())fail(410,'exchange_quote_expired','見積の有効期限が切れています。');
    const destination=await adapter.verifyDestination({userId,asset:'BTC',reference:destinationRef});
    if(!destination||destination.verified!==true||destination.userId!==userId||destination.asset!=='BTC'||destination.reference!==destinationRef)fail(403,'exchange_destination_unverified','送付先の本人確認とネットワークの確認が完了していません。');
    const requestId=token(id(),'申請ID'),at=timestamp();let result;
    try{
      // The insert trigger checks quote expiry and reserves only if sufficient
      // unreserved confirmed points remain at this atomic SQL statement.
      result=await run(db,"INSERT INTO exchange_requests(id,user_id,quote_id,idempotency_key,destination_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,'reserved',?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING",requestId,userId,quoteId,idempotencyKey,destinationRef,at,at);
    }catch(error){const raced=await previous();if(raced)return replay(raced);throw storageFailure(error);}
    const saved=await previous();if(!saved)fail(503,'exchange_storage_unavailable','申請の保存状態を確認できませんでした。');
    if(saved.id!==requestId||Number(result?.meta?.changes||0)===0)return replay(saved);
    return {request:requestView(saved),duplicate:false};
  }
  async function cancelRequest(userId,requestId){
    owner(userId);token(requestId,'申請ID');const existing=await first(db,REQUEST_SELECT+' WHERE r.user_id=? AND r.id=?',userId,requestId);
    if(!existing)fail(404,'exchange_request_not_found','この申請は見つかりません。');
    if(existing.status==='cancelled')return {request:requestView(existing),duplicate:true};
    // There is no payout dispatcher. Only still-reserved, unsent requests may
    // be cancelled; the transition trigger releases the reservation once.
    let result;try{result=await run(db,"UPDATE exchange_requests SET status='cancelled',updated_at=? WHERE id=? AND user_id=? AND status='reserved'",Math.max(timestamp(),existing.created_at),requestId,userId);}catch(error){throw storageFailure(error);}
    return {request:await getRequest(userId,requestId),duplicate:Number(result?.meta?.changes||0)===0};
  }
  return {getBalance,getRequests,getRequest,getLedger,creditConfirmedReward,createQuote,createRequest,cancelRequest};
}

/** Called only after social.js has enforced device identity, CSRF and owner guard. */
export async function handleExchangeRequest({db,user,path,method,now=Date.now()}={}){
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:RESPONSE_HEADERS});
  try{
    // Deliberate production gate: env flags, client flags and account balances
    // cannot supply an adapter or enable sending. No outgoing request exists.
    const exchange=createExchangeService({db,provider:null,now:()=>now});
    if(method==='GET'&&path==='/exchange'){
      const [balance,requests]=await Promise.all([exchange.getBalance(user.id),exchange.getRequests(user.id)]);
      return json({userId:user.id,available:false,mode:'preparing',asset:'BTC',balance,requests,message:UNAVAILABLE});
    }
    if(method==='GET'&&path==='/exchange/requests')return json({userId:user.id,requests:await exchange.getRequests(user.id)});
    if(method==='POST'&&(path==='/exchange/quote'||path==='/exchange/requests'||/^\/exchange\/requests\/[^/]+\/cancel$/.test(path)))return json({error:UNAVAILABLE,code:'exchange_unavailable',available:false,asset:'BTC'},503);
    return json({error:'この交換機能は見つかりません。',code:'not_found'},404);
  }catch(error){const failure=storageFailure(error);return json({error:failure.message,code:failure.code},failure.status);}
}
