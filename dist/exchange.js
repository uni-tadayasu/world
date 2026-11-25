import {readDeviceSession} from './device-session.js';
import {isOnlineHost,getOnlineOrigin} from './site-config.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const points=value=>integer(value)?value.toLocaleString('ja-JP'):'—';
const labels={pending:'受付済み',reserved:'残高を確保済み',review:'確認中',approved:'承認済み',cancelled:'取り消し',rejected:'受付不可',submitted:'送金処理中',paid:'処理済み',completed:'処理済み'};

/** Read-only preparation screen. It never turns browser save money into funds. */
export function createExchange({openPanel,getGameMoney=()=>0,hosted=isOnlineHost(),sessionReader=readDeviceSession,fetcher=(...args)=>fetch(...args)}={}){
  let shell=null,visible=false,disposed=false,sequence=0,controller=null,loading=false,error='',accountId=null,data=null;
  if(typeof document!=='undefined'&&!document.querySelector('link[data-machi-exchange]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./exchange.css',import.meta.url).href;link.dataset.machiExchange='';document.head.append(link);}
  function render(){
    if(!visible||!shell?.isConnected||disposed)return;
    const balance=data?.balance,gameMoney=getGameMoney();
    shell.innerHTML=`<section class="exchange-heading"><span class="exchange-currency" aria-hidden="true">₿</span><div><span class="exchange-status">準備中</span><h3>報酬から、次の可能性へ。</h3><p>暗号資産への交換に向けた、報酬と申請の確認画面です。</p></div></section>
      <div class="exchange-notice"><strong>現在、実際の交換・送金はできません。</strong><p>送金先サービスと原資がまだ接続されていません。交換レート・手数料・最低交換額も未確定です。</p></div>
      <div class="exchange-balances"><div><small>ゲーム内の所持金</small><strong>${Number.isFinite(gameMoney)?'¥'+Math.floor(Math.max(0,gameMoney)).toLocaleString('ja-JP'):'—'}</strong><span>生活で使う通貨 · 換金対象外</span></div><div><small>交換対象の報酬</small><strong>${points(balance?.availablePoints)}<em> pt</em></strong><span>サーバーで確認された分のみ</span></div><div><small>申請中の報酬</small><strong>${points(balance?.reservedPoints)}<em> pt</em></strong><span>重複して使用できない残高</span></div></div>
      <p class="exchange-state" role="status">${esc(loading?'報酬の記録を確認しています…':error||(!hosted?'記録の確認はオンライン版で利用できます。':data?'このブラウザの報酬記録を確認しました。':'記録を読み込んでください。'))}</p>
      <button class="secondary-btn" data-exchange-refresh ${loading||!hosted?'disabled':''}>${loading?'確認しています…':'記録を更新する'}</button>
      ${!hosted?`<a class="secondary-btn" href="${esc(getOnlineOrigin())}">オンライン版を開く</a>`:''}
      <p class="section-label">交換の申請履歴</p>${data?.requests?.length?`<div class="exchange-history">${data.requests.map(item=>`<div><span><strong>${esc(labels[item.status]||'確認中')}</strong><small>${esc(typeof item.id==='string'?item.id.slice(0,40):'')}</small></span><span>${points(item.points)} pt</span></div>`).join('')}</div>`:`<div class="exchange-empty">${data?'交換申請はまだありません。':'記録を確認すると、申請履歴がここに表示されます。'}</div>`}
      <p class="exchange-footnote">初期の所持金、セーブの読み込み、端末上で増えたお金が、そのまま交換対象になることはありません。対象となる報酬の条件は、サービス開始時に案内します。現在はウォレットアドレスや秘密鍵を入力する必要はありません。</p>`;
    shell.querySelector('[data-exchange-refresh]')?.addEventListener('click',()=>void sync());
  }
  async function sync(){
    if(disposed||!visible||!hosted)return false;
    controller?.abort();const request=++sequence,current=new AbortController();controller=current;loading=true;error='';data=null;accountId=null;render();
    const timer=setTimeout(()=>current.abort(),12000);
    try{
      const session=await sessionReader({signal:current.signal});if(request!==sequence||!visible)return false;
      const owner=session.user?.id;if(!owner)throw new Error('このブラウザの接続を確認できませんでした。');
      const response=await fetcher('/api/social/exchange',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','X-Machi-User-Id':owner},signal:current.signal});
      const result=await response.json();if(request!==sequence||!visible)return false;
      if(!response.ok)throw new Error(result.error||'報酬の記録を取得できませんでした。');
      if(result.userId!==owner)throw new Error('このブラウザの保存先が変わりました。記録を更新してください。');
      if(!result.balance||!['confirmedPoints','availablePoints','reservedPoints'].every(key=>integer(result.balance[key]))||result.balance.availablePoints+result.balance.reservedPoints!==result.balance.confirmedPoints||!Array.isArray(result.requests))throw new Error('報酬の記録を確認できませんでした。');
      accountId=owner;data={...result,requests:result.requests.slice(0,50)};return true;
    }catch(failure){if(request===sequence&&visible){data=null;error=failure.name==='AbortError'?'通信が時間切れになりました。もう一度、記録を更新してください。':failure.message;}return false;}
    finally{clearTimeout(timer);if(request===sequence){loading=false;controller=null;render();}}
  }
  function open(){if(disposed)return;visible=true;data=null;error='';const body=openPanel('報酬と暗号資産への交換','REWARDS & EXCHANGE','<div id="exchange-content"></div>');shell=body.querySelector('#exchange-content');render();if(hosted)void sync();}
  function close(){visible=false;sequence++;controller?.abort();controller=null;loading=false;data=null;accountId=null;shell=null;}
  function dispose(){close();disposed=true;}
  return {open,close,sync,dispose,getState:()=>({loading,error,accountId,available:false,balance:data?.balance?{...data.balance}:null})};
}
