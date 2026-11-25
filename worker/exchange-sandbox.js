// Isolated, valueless exchange rehearsal. No real money, BTC, wallet or network
// transaction is created here. Every write targets exchange_sandbox_* tables.
export const SANDBOX_EXCHANGE_POLICY=Object.freeze({
  refillPoints:10000,minimumPoints:1000,maximumPoints:1000000,
  rateSatoshisPerPoint:1,quoteTtlMs:300000,balanceLimitPoints:1000000000000,
  refillCooldownMs:1500
});
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const MARKER=Object.freeze({mode:'sandbox',network:'simulation',realValue:false});
const DESTINATION='検証用の受取先';
class SandboxExchangeError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new SandboxExchangeError(status,code,message);};
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const rows=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results||[];
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();
function identifier(value,label,{min=1,max=160}={}){
  if(typeof value!=='string'||value.length<min||value.length>max||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))fail(400,'sandbox_invalid_input',label+'が正しくありません。');
  return value;
}
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'sandbox_invalid_amount',label+'は範囲内の整数で指定してください。');
  return value;
}
function storageFailure(error){
  if(error instanceof SandboxExchangeError)return error;
  const message=String(error?.message||'');
  if(message.includes('sandbox_insufficient_balance'))return new SandboxExchangeError(409,'sandbox_insufficient_balance','検証MRが不足しています。補充してからお試しください。');
  if(message.includes('sandbox_quote_expired'))return new SandboxExchangeError(410,'sandbox_quote_expired','検証用の見積期限が切れています。見積を取り直してください。');
  if(message.includes('sandbox_refill_cooldown'))return new SandboxExchangeError(429,'sandbox_refill_cooldown','連続補充の間隔を少し空けてください。');
  if(message.includes('sandbox_balance_limit'))return new SandboxExchangeError(409,'sandbox_balance_limit','検証MRの残高上限は1兆MRです。検証送金を完了して残高を減らしてから補充してください。');
  if(message.includes('exchange_sandbox_requests.quote_id'))return new SandboxExchangeError(409,'sandbox_quote_used','この検証見積は既に申請に使用されています。');
  if(message.includes('sandbox_invalid_transition'))return new SandboxExchangeError(409,'sandbox_request_state','この検証申請は既に処理されています。最新の記録を確認してください。');
  return new SandboxExchangeError(503,'sandbox_storage_unavailable','検証用の記録を確認できませんでした。少し待ってから再読み込みしてください。');
}
const quoteView=row=>({id:row.id,points:row.points,receiveSatoshis:row.receive_satoshis,feeSatoshis:0,createdAt:row.created_at,expiresAt:row.expires_at,destination:DESTINATION,...MARKER});
const requestView=row=>({id:row.id,points:row.points,receiveSatoshis:row.receive_satoshis,feeSatoshis:0,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,canCancel:row.status==='reserved',canComplete:row.status==='reserved',destination:DESTINATION,...MARKER});
const REQUEST_SELECT='SELECT r.*,q.points,q.receive_satoshis FROM exchange_sandbox_requests r JOIN exchange_sandbox_quotes q ON q.id=r.quote_id';

export function createSandboxExchangeService({db,now=()=>Date.now(),id=()=>crypto.randomUUID()}={}){
  const owner=value=>identifier(value,'端末ID',{max:80});
  const timestamp=()=>integer(now(),'記録時刻',0,Number.MAX_SAFE_INTEGER-SANDBOX_EXCHANGE_POLICY.quoteTtlMs);
  const requestKey=value=>identifier(value,'再送防止キー',{min:8,max:128});
  async function getBalance(userId){
    owner(userId);const account=await first(db,'SELECT confirmed_points,reserved_points FROM exchange_sandbox_accounts WHERE user_id=?',userId);
    const confirmedPoints=account?.confirmed_points??0,reservedPoints=account?.reserved_points??0;
    if(!Number.isSafeInteger(confirmedPoints)||!Number.isSafeInteger(reservedPoints)||confirmedPoints<0||confirmedPoints>SANDBOX_EXCHANGE_POLICY.balanceLimitPoints||reservedPoints<0||reservedPoints>confirmedPoints)fail(503,'sandbox_ledger_invalid','検証台帳の確認が必要です。現在この操作は利用できません。');
    return {confirmedPoints,availablePoints:confirmedPoints-reservedPoints,reservedPoints};
  }
  async function getRequests(userId){
    owner(userId);return (await rows(db,REQUEST_SELECT+' WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50',userId)).map(requestView);
  }
  async function getRequest(userId,requestId){
    owner(userId);identifier(requestId,'検証申請ID');
    const row=await first(db,REQUEST_SELECT+' WHERE r.user_id=? AND r.id=?',userId,requestId);
    if(!row)fail(404,'sandbox_request_not_found','この検証申請は見つかりません。');return requestView(row);
  }
  async function getLedger(userId){
    owner(userId);return (await rows(db,'SELECT id,kind,points_delta,reserved_delta,created_at FROM exchange_sandbox_ledger WHERE user_id=? ORDER BY id DESC LIMIT 100',userId)).map(row=>({id:row.id,kind:row.kind,pointsDelta:row.points_delta,reservedDelta:row.reserved_delta,createdAt:row.created_at,...MARKER}));
  }
  async function getState(userId){
    owner(userId);const [balance,requests]=await Promise.all([getBalance(userId),getRequests(userId)]);
    return {userId,...MARKER,balance,requests,policy:{...SANDBOX_EXCHANGE_POLICY},serverTime:timestamp(),destination:DESTINATION};
  }
  async function refill(userId,{idempotencyKey}={}){
    owner(userId);requestKey(idempotencyKey);
    const previous=()=>first(db,'SELECT * FROM exchange_sandbox_refills WHERE user_id=? AND idempotency_key=?',userId,idempotencyKey);
    if(await previous())return {duplicate:true,balance:await getBalance(userId)};
    const refillId=identifier(id(),'検証補充ID'),at=timestamp();let result;
    try{result=await run(db,'INSERT INTO exchange_sandbox_refills(id,user_id,idempotency_key,points,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING',refillId,userId,idempotencyKey,SANDBOX_EXCHANGE_POLICY.refillPoints,at);}
    catch(error){if(await previous())return {duplicate:true,balance:await getBalance(userId)};throw storageFailure(error);}
    const saved=await previous();if(!saved)fail(503,'sandbox_storage_unavailable','検証MRの補充結果を確認できませんでした。');
    return {duplicate:saved.id!==refillId||Number(result?.meta?.changes||0)===0,balance:await getBalance(userId)};
  }
  async function createQuote(userId,{points}={}){
    owner(userId);integer(points,'検証MR',SANDBOX_EXCHANGE_POLICY.minimumPoints,SANDBOX_EXCHANGE_POLICY.maximumPoints);
    if((await getBalance(userId)).availablePoints<points)fail(409,'sandbox_insufficient_balance','検証MRが不足しています。補充してからお試しください。');
    const quoteId=identifier(id(),'検証見積ID'),at=timestamp(),expiresAt=at+SANDBOX_EXCHANGE_POLICY.quoteTtlMs;
    try{await run(db,'INSERT INTO exchange_sandbox_quotes(id,user_id,points,receive_satoshis,created_at,expires_at) VALUES(?,?,?,?,?,?)',quoteId,userId,points,points,at,expiresAt);}
    catch(error){throw storageFailure(error);}
    return quoteView({id:quoteId,points,receive_satoshis:points,created_at:at,expires_at:expiresAt});
  }
  async function createRequest(userId,{quoteId,idempotencyKey}={}){
    owner(userId);identifier(quoteId,'検証見積ID');requestKey(idempotencyKey);
    const previous=()=>first(db,REQUEST_SELECT+' WHERE r.user_id=? AND r.idempotency_key=?',userId,idempotencyKey);
    const replay=row=>{if(row.quote_id!==quoteId)fail(409,'sandbox_idempotency_conflict','同じ再送防止キーで異なる検証申請は送信できません。');return {request:requestView(row),duplicate:true};};
    const existing=await previous();if(existing)return replay(existing);
    const quote=await first(db,'SELECT * FROM exchange_sandbox_quotes WHERE id=? AND user_id=?',quoteId,userId);
    if(!quote)fail(404,'sandbox_quote_not_found','この検証見積は見つかりません。');
    const at=timestamp();if(quote.expires_at<=at||quote.created_at>at)fail(410,'sandbox_quote_expired','検証用の見積期限が切れています。見積を取り直してください。');
    const requestId=identifier(id(),'検証申請ID');let result;
    try{result=await run(db,"INSERT INTO exchange_sandbox_requests(id,user_id,quote_id,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,'reserved',?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING",requestId,userId,quoteId,idempotencyKey,at,at);}
    catch(error){const raced=await previous();if(raced)return replay(raced);throw storageFailure(error);}
    const saved=await previous();if(!saved)fail(503,'sandbox_storage_unavailable','検証申請の保存状態を確認できませんでした。');
    if(saved.id!==requestId||Number(result?.meta?.changes||0)===0)return replay(saved);
    return {request:requestView(saved),duplicate:false};
  }
  async function transition(userId,requestId,target){
    owner(userId);identifier(requestId,'検証申請ID');
    const existing=await getRequest(userId,requestId);
    if(existing.status===target)return {request:existing,duplicate:true};
    if(existing.status!=='reserved')fail(409,'sandbox_request_state','この検証申請は既に処理されています。最新の記録を確認してください。');
    let result;try{result=await run(db,'UPDATE exchange_sandbox_requests SET status=?,updated_at=? WHERE id=? AND user_id=? AND status=\'reserved\'',target,Math.max(timestamp(),existing.updatedAt),requestId,userId);}
    catch(error){throw storageFailure(error);}
    const saved=await getRequest(userId,requestId);
    if(saved.status!==target)fail(409,'sandbox_request_state','この検証申請は別の操作で処理されました。最新の記録を確認してください。');
    return {request:saved,duplicate:Number(result?.meta?.changes||0)===0};
  }
  const methods={getState,getBalance,getRequests,getRequest,getLedger,refill,createQuote,createRequest,cancelRequest:(userId,requestId)=>transition(userId,requestId,'cancelled'),completeRequest:(userId,requestId)=>transition(userId,requestId,'simulated_paid')};
  return Object.fromEntries(Object.entries(methods).map(([name,fn])=>[name,async(...args)=>{try{return await fn(...args);}catch(error){throw storageFailure(error);}}]));
}

/** Identity, expectedUserId and CSRF are checked by social.js before dispatch. */
export async function handleSandboxExchangeRequest({db,user,path,method,now=Date.now(),data={}}={}){
  const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...HEADERS,...extra}});
  try{
    const exchange=createSandboxExchangeService({db,now:()=>now});
    if(method==='GET'&&path==='/exchange/sandbox')return json(await exchange.getState(user.id));
    if(method!=='POST')return json({error:'この検証機能は見つかりません。',code:'not_found',...MARKER},404);
    let result;
    if(path==='/exchange/sandbox/refill')result=await exchange.refill(user.id,data);
    else if(path==='/exchange/sandbox/quote')result={quote:await exchange.createQuote(user.id,data)};
    else if(path==='/exchange/sandbox/requests')result=await exchange.createRequest(user.id,data);
    else{
      const match=/^\/exchange\/sandbox\/requests\/([^/]+)\/(cancel|complete)$/.exec(path);
      if(!match)return json({error:'この検証機能は見つかりません。',code:'not_found',...MARKER},404);
      result=await exchange[match[2]==='cancel'?'cancelRequest':'completeRequest'](user.id,match[1]);
    }
    return json({userId:user.id,...MARKER,...result,balance:await exchange.getBalance(user.id)});
  }catch(error){const failure=storageFailure(error);return json({error:failure.message,code:failure.code,...MARKER},failure.status,failure.code==='sandbox_refill_cooldown'?{'Retry-After':'2'}:{});}
}
