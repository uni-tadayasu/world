// Internal accounting only: no HTTP writes, wallet connection, signing or payout.
// A recorded funding receipt is historical evidence accepted from an adapter;
// it is not a promise that the wallet still has that amount available to spend.
const MAX_SATOSHIS=1000000000000,MAX_TIMESTAMP=253402268399999,JST_OFFSET_MS=9*60*60*1000;

export const REWARD_TREASURY_POLICY=Object.freeze({
  version:'machi-reward-draft-v1',status:'draft',country:'JP',minimumAge:18,
  timezone:'Asia/Tokyo',dailyRewardMR:100,satoshisPerMR:1,
  minWithdrawalMR:10000,maxWithdrawalMR:100000
});

class RewardTreasuryError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new RewardTreasuryError(status,code,message);};
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();
function token(value,label,max=160){
  if(typeof value!=='string'||value.length<1||value.length>max||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))fail(400,'reward_treasury_invalid_input',label+'が正しくありません。');
  return value;
}
function integer(value,label,{min=1,max=MAX_SATOSHIS}={}){
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'reward_treasury_invalid_amount',label+'は範囲内の整数で指定してください。');
  return value;
}
function canonicalOutpoint(value){
  // One Bitcoin output can fund the pool only once, including across adapters.
  // Normalize case and decimal aliases before the database's unique constraint.
  const match=typeof value==='string'&&/^([a-fA-F0-9]{64}):([0-9]{1,32})$/.exec(value);
  if(!match)fail(400,'reward_treasury_invalid_receipt','入金の取引出力参照を確認できません。');
  const vout=Number(match[2]);
  if(!Number.isSafeInteger(vout)||vout<0||vout>4294967295)fail(400,'reward_treasury_invalid_receipt','入金の取引出力参照を確認できません。');
  return match[1].toLowerCase()+':'+String(vout);
}
function storageFailure(error){
  if(error instanceof RewardTreasuryError)return error;
  const message=String(error?.message||'');
  if(message.includes('reward_treasury_insufficient_funding'))return new RewardTreasuryError(409,'reward_treasury_insufficient_funding','記録済みの原資が不足しているため、報酬を確定できません。');
  if(message.includes('reward_treasury_funding_limit'))return new RewardTreasuryError(409,'reward_treasury_funding_limit','原資の記録上限を超えるため記帳できません。');
  if(message.includes('reward_treasury_verification_expired'))return new RewardTreasuryError(403,'reward_treasury_beneficiary_unverified','報酬対象者の確認期限が切れています。');
  if(message.includes('exchange_accounts.confirmed_points')||message.includes('confirmed_points BETWEEN'))return new RewardTreasuryError(409,'reward_treasury_reward_limit','交換対象の報酬が上限を超えるため記帳できません。');
  return new RewardTreasuryError(503,'reward_treasury_storage_unavailable','原資と報酬の記録を確認できません。少し待ってから再確認してください。');
}
const allocationView=row=>({id:row.id,day:row.reward_day,rewardMR:row.reward_mr,amountSatoshis:row.amount_satoshis,createdAt:row.created_at});

/**
 * Server-only dependency boundary. Production constructs this with verifier:null.
 * A real adapter must independently verify wallet control, external net funding
 * (not change outputs or internal transfers), chain/network, confirmations and
 * the amount/destination of each UTXO. It must also address withdrawals, reorgs
 * and balance reconciliation before any future live-payout feature can rely on
 * these historical records. Those wallet operations do not exist in this module.
 *
 * verifyBeneficiary must perform the applicable identity/residency/age checks
 * and return a stable person-level subjectId. A client checkbox, cookie, local
 * balance or a caller-supplied object is never a verification result. Identity
 * documents and private keys must not be passed to this service or its ledger.
 */
export function createRewardTreasuryService({db,verifier=null,now=()=>Date.now(),id=()=>crypto.randomUUID()}={}){
  const timestamp=()=>integer(now(),'記帳時刻',{min:0,max:MAX_TIMESTAMP});
  function requireVerifier(){
    if(!verifier||typeof verifier!=='object'||typeof verifier.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(verifier.id)||typeof verifier.verifyFundingReceipt!=='function'||typeof verifier.verifyBeneficiary!=='function'){
      fail(503,'reward_treasury_verifier_unavailable','原資と対象者を確認するサービスは未接続です。報酬の確定は利用できません。');
    }
    return verifier;
  }
  async function verify(adapter,method,input){
    try{return await adapter[method](input);}
    catch{fail(503,'reward_treasury_verification_unavailable','確認サービスから有効な応答を取得できませんでした。');}
  }
  async function getState(){
    let row;try{row=await first(db,'SELECT confirmed_satoshis,allocated_satoshis FROM reward_treasury_pool WHERE id=1');}catch(error){throw storageFailure(error);}
    const confirmedSatoshis=row?.confirmed_satoshis,allocatedSatoshis=row?.allocated_satoshis;
    if(!Number.isSafeInteger(confirmedSatoshis)||!Number.isSafeInteger(allocatedSatoshis)||confirmedSatoshis<0||confirmedSatoshis>MAX_SATOSHIS||allocatedSatoshis<0||allocatedSatoshis>confirmedSatoshis)fail(503,'reward_treasury_ledger_invalid','原資台帳の確認が必要です。現在、報酬は確定できません。');
    // "funded" means a positive confirmed-funding record exists in this ledger.
    // It does not mean a live wallet is connected, reconciled or able to pay.
    return {confirmedSatoshis,allocatedSatoshis,availableSatoshis:confirmedSatoshis-allocatedSatoshis,status:confirmedSatoshis>0?'funded':'unfunded'};
  }
  async function ingestConfirmedFunding(envelope){
    const adapter=requireVerifier(),providerId=adapter.id;
    const receipt=await verify(adapter,'verifyFundingReceipt',envelope);
    if(!receipt||receipt.verified!==true||receipt.providerId!==providerId||receipt.asset!=='BTC'||receipt.network!=='bitcoin'||!Number.isSafeInteger(receipt.confirmations)||receipt.confirmations<6)fail(403,'reward_treasury_funding_unverified','Bitcoin本番ネットワークで確定した原資として確認できません。');
    // Values come exclusively from the verified adapter response, not envelope.
    const receiptId=canonicalOutpoint(receipt.receiptId),amountSatoshis=integer(receipt.amountSatoshis,'入金数量'),destinationRef=token(receipt.destinationRef,'確認済み入金先');
    const previous=()=>first(db,'SELECT * FROM reward_treasury_funding WHERE receipt_id=?',receiptId);
    const matches=row=>row.provider_id===providerId&&row.amount_satoshis===amountSatoshis&&row.destination_ref===destinationRef&&row.asset==='BTC'&&row.network==='bitcoin';
    const replay=async row=>{if(!matches(row))fail(409,'reward_treasury_funding_conflict','同じ取引出力の入金内容が一致しません。');return {duplicate:true,state:await getState()};};
    let result;
    try{
      const existing=await previous();if(existing)return replay(existing);
      result=await run(db,"INSERT INTO reward_treasury_funding(receipt_id,provider_id,asset,network,amount_satoshis,destination_ref,confirmations,created_at) VALUES(?,?,'BTC','bitcoin',?,?,?,?) ON CONFLICT(receipt_id) DO NOTHING",receiptId,providerId,amountSatoshis,destinationRef,receipt.confirmations,timestamp());
      const recorded=await previous();
      if(!recorded)fail(503,'reward_treasury_storage_unavailable','入金記録の保存状態を確認できませんでした。');
      if(!matches(recorded))return replay(recorded);
    }catch(error){throw storageFailure(error);}
    return {duplicate:Number(result?.meta?.changes||0)===0,state:await getState()};
  }
  async function creditDailyReward({userId,beneficiaryRef}={}){
    const adapter=requireVerifier(),providerId=adapter.id;
    token(userId,'端末ID',80);token(beneficiaryRef,'確認済み対象者参照');
    const beneficiary=await verify(adapter,'verifyBeneficiary',{userId,beneficiaryRef});
    if(!beneficiary||beneficiary.verified!==true||beneficiary.providerId!==providerId||beneficiary.userId!==userId||beneficiary.beneficiaryRef!==beneficiaryRef||beneficiary.country!=='JP'||beneficiary.ageOver18!==true)fail(403,'reward_treasury_beneficiary_unverified','報酬対象者の本人・居住地・年齢を確認できません。');
    const subjectId=token(beneficiary.subjectId,'確認済み個人ID'),expiresAt=integer(beneficiary.expiresAt,'対象者確認の期限',{min:0,max:Number.MAX_SAFE_INTEGER});
    const checkExpiry=at=>{if(expiresAt<=at)fail(403,'reward_treasury_beneficiary_unverified','報酬対象者の確認期限が切れています。');};
    checkExpiry(timestamp());
    // Compute the day after verification and again after the async read so a
    // midnight boundary or an expired verification cannot use a stale day.
    const dayFor=at=>new Date(at+JST_OFFSET_MS).toISOString().slice(0,10);
    const findAllocation=day=>first(db,'SELECT * FROM reward_treasury_allocations WHERE subject_id=? AND reward_day=?',subjectId,day);
    const replay=async row=>{
      if(row.user_id!==userId)fail(409,'reward_treasury_daily_claimed','本日の報酬はすでに受給済みです。端末を変更して再受給することはできません。');
      return {duplicate:true,allocation:allocationView(row),state:await getState()};
    };
    let allocationId,at,day,result;
    try{
      const checkedDay=dayFor(timestamp()),existing=await findAllocation(checkedDay);
      at=timestamp();checkExpiry(at);day=dayFor(at);
      if(existing&&day===checkedDay)return replay(existing);
      allocationId=token(id(),'報酬記録ID',128);
      // The one INSERT atomically reserves the funding budget, credits the
      // existing exchange ledger and appends audit data through SQL triggers.
      result=await run(db,"INSERT INTO reward_treasury_allocations(id,provider_id,user_id,beneficiary_ref,subject_id,reward_day,country,age_over_18,verification_expires_at,policy_version,reward_mr,amount_satoshis,created_at) VALUES(?,?,?,?,?,?,'JP',1,?,'machi-reward-draft-v1',100,100,?) ON CONFLICT(subject_id,reward_day) DO NOTHING",allocationId,providerId,userId,beneficiaryRef,subjectId,day,expiresAt,at);
    }catch(error){
      // A simultaneous request for this same person/day may have won while the
      // current statement failed; only its own device can receive its details.
      if(day){let raced;try{raced=await findAllocation(day);}catch{}if(raced)return replay(raced);}
      throw storageFailure(error);
    }
    let saved;try{saved=await findAllocation(day);}catch(error){throw storageFailure(error);}
    if(!saved)fail(503,'reward_treasury_storage_unavailable','報酬記録の保存状態を確認できませんでした。');
    if(saved.id!==allocationId||Number(result?.meta?.changes||0)===0)return replay(saved);
    return {duplicate:false,allocation:allocationView(saved),state:await getState()};
  }
  return {getState,ingestConfirmedFunding,creditDailyReward};
}
