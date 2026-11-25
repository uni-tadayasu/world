/** Authenticated community UI and opt-in, four-participant WebRTC voice. */
export function initSocial({openPanel,toast=()=>{},icon,escapeHTML,baseUrl='https://machi-life.hisa-0128-1996.chatgpt.site'}={}) {
  const esc=escapeHTML||(value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const paths={chat:'M21 11.5a8.4 8.4 0 0 1-1 4L21 21l-5.5-1a8.4 8.4 0 0 1-4 1A9 9 0 1 1 21 11.5Z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',mic:'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',micoff:'M9 5a3 3 0 0 1 6 0v7M9 9v3a3 3 0 0 0 5 2.2M5 10v2a7 7 0 0 0 12 4.9M19 10v2c0 .5 0 1-.2 1.5M12 19v3M8 22h8M2 2l20 20',phone:'M5 15c4-5 10-5 14 0M3 14l2-2 4 2-1 4-5-1ZM21 14l-2-2-4 2 1 4 5-1Z',building:'M4 21V5h10v16M14 10h6v11M8 9h2M8 13h2M8 17h2M17 14h1M17 18h1M2 21h20',edit:'M16 3l5 5M4 20l4-1L21 6a2 2 0 0 0-3-3L5 16l-1 4Z',copy:'M9 9h12v12H9ZM5 15H3V3h12v2',sound:'M11 5L6 9H2v6h4l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'};
  const ico=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.users}"/></svg>`;
  const cssUrl=new URL('./social.css',import.meta.url).href;
  if(!document.querySelector(`link[data-machi-social]`)){const link=document.createElement('link');link.rel='stylesheet';link.href=cssUrl;link.dataset.machiSocial='';document.head.append(link);}
  const onlineUrl=new URL(baseUrl,location.href);const hosted=location.origin===onlineUrl.origin;
  const apiBase='/api/social';
  let shell=null,body=null,visible=false,generation=0,chatTimer=null,pollBusy=false,pollTick=0;
  let authenticated=null,user=null,state={friends:{incoming:[],outgoing:[],accepted:[]},organizations:[],blocks:[]};
  let tab='chat',channel='global',messages=[],since=0,error='',profileEditing=false;
  let searchQuery='',searchResults=null,orgs=[],orgDetail=null,orgMembers=[],createOrg=false,leaveConfirm=false;
  let menuMessage=null,reportMessage=null,reportReason='',loadingChannel=false;
  const drafts=new Map();
  const voice={joined:false,joining:false,channel:'global',selected:'global',name:'街の広場',stream:null,muted:false,peers:new Map(),members:[],cursor:0,timer:null,polling:false,epoch:0,error:'',audioBlocked:false};
  const audioContainer=document.createElement('div');audioContainer.hidden=true;audioContainer.dataset.machiVoiceAudio='';document.body.append(audioContainer);
  const dock=document.createElement('div');dock.className='machi-voice-dock';dock.hidden=true;dock.setAttribute('aria-label','参加中の音声通話');document.body.append(dock);
  let turn={url:'',username:'',credential:''};
  try{const value=JSON.parse(localStorage.getItem('machi:voice:turn:v1')||'null');if(value&&typeof value==='object')turn={url:String(value.url||''),username:String(value.username||''),credential:String(value.credential||'')};}catch{}
  const friendRows=()=>state.friends?.accepted||[];
  const joinedOrgs=()=>state.organizations||[];
  const nameOfChannel=value=>value==='global'?'街の広場':value.startsWith('dm:')?friendRows().find(r=>r.user.id===value.slice(3))?.user.name||'フレンドとの会話':joinedOrgs().find(o=>o.id===value.slice(4))?.name||'コミュニティ';
  const tone=u=>[...String(u.id||u.name)].reduce((sum,c)=>sum+c.charCodeAt(0),0)%6;
  const avatar=u=>`<span class="social-avatar tone-${tone(u)}" aria-hidden="true">${esc([...String(u.name||'?')][0])}</span>`;
  const btn=(label,action,attrs='',cls='')=>`<button type="button" class="social-btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
  const empty=(title,detail='')=>`<div class="social-empty"><strong>${esc(title)}</strong>${esc(detail)}</div>`;
  const isVisible=()=>visible&&shell?.isConnected&&shell.getClientRects().length>0;
  function errorText(err){return err?.message||'接続できませんでした。少し待って、もう一度お試しください。';}
  function showError(err){error=errorText(err);if(isVisible())render();else toast(error);}
  async function api(path,{method='GET',data,keepalive=false}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;
    try{response=await fetch(`${apiBase}${path}`,{method,credentials:'same-origin',headers:data===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),keepalive,cache:'no-store',signal:controller.signal});}
    catch(err){if(err.name==='AbortError')throw new Error('オンライン機能の応答に時間がかかっています。もう一度お試しください。');throw err;}
    finally{clearTimeout(timer);}
    let result;try{result=await response.json();}catch{throw new Error('オンライン機能の応答を読み取れませんでした。ページを再読み込みしてください。');}
    if(!response.ok){if(response.status===401){authenticated=false;user=null;void leaveVoice(false);if(isVisible())render();}const err=new Error(typeof result.error==='string'?result.error:'操作を完了できませんでした。');err.code=result.code;err.status=response.status;throw err;}
    return result;
  }
  function formatTime(value){const time=typeof value==='number'&&value<1e11?value*1000:value;const d=new Date(time);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
  function options(selected){
    return `<option value="global" ${selected==='global'?'selected':''}>街の広場 · ワールドチャット</option>`+
      (friendRows().length?`<optgroup label="フレンド">${friendRows().map(r=>`<option value="dm:${esc(r.user.id)}" ${selected===`dm:${r.user.id}`?'selected':''}>${esc(r.user.name)}</option>`).join('')}</optgroup>`:'')+
      (joinedOrgs().length?`<optgroup label="コミュニティ">${joinedOrgs().map(o=>`<option value="org:${esc(o.id)}" ${selected===`org:${o.id}`?'selected':''}>${esc(o.name)}</option>`).join('')}</optgroup>`:'');
  }
  function preserveForm(){
    const active=document.activeElement;if(!shell?.contains(active))return null;
    return {id:active.dataset.focus||active.id,start:active.selectionStart,end:active.selectionEnd};
  }
  function render(preserveInputs=false){
    if(!shell?.isConnected)return;
    const focus=preserveForm();const oldScroll=shell.querySelector('.social-messages')?.scrollTop;
    const fields=preserveInputs?[...shell.querySelectorAll('form[data-form] input,form[data-form] textarea')].map(el=>({form:el.form.dataset.form,name:el.name,value:el.value})):[];
    const details=[...shell.querySelectorAll('details')].map(el=>el.open);
    if(!hosted){shell.innerHTML=`<div class="social-auth"><span class="social-hero-icon">${ico('users')}</span><h3>街の人と、つながる。</h3><p>チャット・フレンド・コミュニティ・音声通話は、アカウントを確認できるオンライン版で利用できます。</p><a class="social-btn primary" href="${esc(onlineUrl.href)}" target="_top">オンライン版で接続</a><p class="social-note">この画面から、オンライン版の同じゲームへ移動します。</p></div>`;return;}
    if(authenticated===null){shell.innerHTML=error?`<div class="social-auth"><h3>接続を確認できませんでした。</h3><p>${esc(error)}</p>${btn('もう一度接続','retry-connect','','primary')}</div>`:`<div class="social-loading" role="status">アカウントを確認しています…</div>`;return;}
    if(!authenticated){shell.innerHTML=`<div class="social-auth"><span class="social-hero-icon">${ico('users')}</span><h3>あなたの名前で、<br>街の会話に参加しよう。</h3><p>ChatGPTアカウントでログインすると、チャットやフレンド登録、コミュニティ、最大4人の音声通話を利用できます。</p><a class="social-btn primary" href="/signin-with-chatgpt?return_to=/" target="_top">ChatGPTでログイン</a><p class="social-note">会話にはゲーム内の表示名とフレンドコードを使います。メールアドレスは表示されません。</p></div>${error?`<div class="social-error" role="alert">${esc(error)}</div>`:''}`;return;}
    const incoming=state.friends?.incoming?.length||0;
    shell.innerHTML=`<div class="social-profile">${avatar(user)}<div class="social-profile-info"><strong>${esc(user.name)}</strong><span class="social-code">ID ${esc(user.code)}</span></div><div class="social-profile-actions">${btn(ico('copy'),'copy-code','aria-label="フレンドコードをコピー"')}${btn(ico('edit'),'edit-profile','aria-label="表示名を変更"')}</div></div>
      ${profileEditing?`<form class="social-form" data-form="profile"><label>ゲーム内の表示名<input name="name" data-focus="profile-name" value="${esc(user.name)}" minlength="2" maxlength="32" required autocomplete="nickname"></label><div class="social-form-actions">${btn('キャンセル','cancel-profile')}<button class="social-btn primary" type="submit">保存する</button></div></form>`:''}
      <nav class="social-tabs" aria-label="つながりのメニュー">${[['chat','チャット'],['friends','フレンド'],['orgs','コミュニティ'],['voice','通話']].map(([key,label])=>`<button type="button" class="social-tab ${tab===key?'active':''}" data-action="tab" data-tab="${key}" aria-current="${tab===key?'page':'false'}">${label}${key==='friends'&&incoming?`<span class="social-badge">${incoming}</span>`:''}</button>`).join('')}</nav>
      ${error?`<div class="social-error" role="alert">${esc(error)} ${btn('閉じる','clear-error','','quiet')}</div>`:''}
      <div class="social-content">${tab==='chat'?chatHTML():tab==='friends'?friendsHTML():tab==='orgs'?orgHTML():voiceHTML()}</div>`;
    if(tab==='chat'){renderMessages(false);const list=shell.querySelector('.social-messages');if(oldScroll!==undefined&&list)list.scrollTop=oldScroll;}
    const credential=shell.querySelector('[name="turn-credential"]');if(credential)credential.value=turn.credential;
    for(const field of fields){const form=[...shell.querySelectorAll('form[data-form]')].find(el=>el.dataset.form===field.form);const input=form?.elements.namedItem(field.name);if(input)input.value=field.value;}
    [...shell.querySelectorAll('details')].forEach((el,index)=>{if(details[index])el.open=true;});
    if(focus?.id){const target=[...shell.querySelectorAll('[data-focus], [id]')].find(el=>el.dataset.focus===focus.id||el.id===focus.id);if(target){target.focus({preventScroll:true});try{if(focus.start!==null&&focus.start!==undefined)target.setSelectionRange(focus.start,focus.end);}catch{}}}
  }
  function chatHTML(){
    return `<div class="social-channel"><div class="social-toolbar"><label class="social-sr-only" for="social-channel">チャットの相手</label><select id="social-channel" data-action="channel">${options(channel)}</select>${btn(`${ico('mic')} 通話`,'voice-channel','','quiet')}</div>
      <div class="social-messages" role="log" aria-label="チャットのメッセージ" aria-live="polite">${loadingChannel?'<div class="social-loading">会話を読み込んでいます…</div>':''}</div>
      ${menuMessage?`<div class="social-chat-actions"><span>${esc(menuMessage.user.name)}のメッセージ</span>${btn('通報する','start-report','data-id="'+esc(menuMessage.id)+'"')}${btn('ブロック','block-user','data-user="'+esc(menuMessage.user.id)+'"','danger')}${btn('閉じる','close-msg-menu','','quiet')}</div>`:''}
      ${reportMessage?`<form class="social-form" data-form="report"><label>通報の理由<textarea name="reason" data-focus="report-reason" minlength="5" maxlength="500" required placeholder="どのような問題がありましたか？（5文字以上）">${esc(reportReason)}</textarea></label><p class="social-note">対象のメッセージと理由を運営向けの通報記録として送信します。</p><div class="social-form-actions">${btn('キャンセル','cancel-report')}<button type="submit" class="social-btn primary">通報を送信</button></div></form>`:''}
      <form class="social-composer" data-form="message"><label class="social-sr-only" for="social-message">メッセージ</label><textarea id="social-message" name="message" data-focus="message" maxlength="500" rows="2" placeholder="${esc(nameOfChannel(channel))}にメッセージ" required>${esc(drafts.get(channel)||'')}</textarea><button class="social-btn primary" type="submit">送信</button></form><div class="social-compose-help"><span>Enterで改行 · Ctrl / ⌘ + Enterで送信</span><span data-message-count>${(drafts.get(channel)||'').length} / 500</span></div></div>`;
  }
  function renderMessages(scroll=true){
    const list=shell?.querySelector('.social-messages');if(!list)return;
    const nearBottom=list.scrollHeight-list.clientHeight-list.scrollTop<80,previous=list.scrollTop;
    const blocked=new Set((state.blocks||[]).map(u=>u.id));const shown=messages.filter(m=>!blocked.has(m.user.id));
    list.innerHTML=shown.length?shown.map(m=>`<article class="social-message ${m.mine?'mine':''}">${avatar(m.user)}<div class="social-message-content"><div class="social-message-meta"><strong>${esc(m.user.name)}${m.mine?' · あなた':''}</strong><time>${esc(formatTime(m.createdAt))}</time>${!m.mine?`<button type="button" class="social-msg-menu" data-action="message-menu" data-id="${esc(m.id)}" aria-label="${esc(m.user.name)}のメッセージの操作">···</button>`:''}</div><div class="social-bubble">${esc(m.text)}</div></div></article>`).join(''):loadingChannel?'<div class="social-loading" role="status">会話を読み込んでいます…</div>':empty('まだメッセージはありません','ひとことから、会話をはじめられます。');
    if(scroll&&nearBottom)list.scrollTop=list.scrollHeight;else list.scrollTop=previous;
  }
  function personRow(u,actions,subtitle=''){
    return `<div class="social-person">${avatar(u)}<div class="social-person-main"><strong>${esc(u.name)}</strong><small>${esc(subtitle||u.code)}</small></div><div class="social-person-actions">${actions}</div></div>`;
  }
  function friendsHTML(){
    const incoming=state.friends?.incoming||[],outgoing=state.friends?.outgoing||[],accepted=friendRows();
    return `<div class="social-stack"><form class="social-inline" data-form="search"><label class="social-sr-only" for="social-search">フレンドを探す</label><input id="social-search" name="query" data-focus="search" value="${esc(searchQuery)}" minlength="3" maxlength="64" required placeholder="フレンドコード・表示名（3文字以上）"><button class="social-btn" type="submit">探す</button></form>
      ${searchResults!==null?`<div class="social-list">${searchResults.length?searchResults.map(u=>personRow(u,u.id===user.id?'<span class="social-note">あなた</span>':accepted.some(r=>r.user.id===u.id)?btn('メッセージ','dm','data-user="'+esc(u.id)+'"'):btn('申請する','friend-request','data-code="'+esc(u.code)+'"','primary'))).join(''):empty('見つかりませんでした','コードや表示名を確認してください。')}</div>`:''}
      ${incoming.length?`<h3 class="social-section-title">届いた申請</h3><div class="social-list">${incoming.map(r=>personRow(r.user,btn('承認','friend-accept','data-request="'+esc(r.requestId)+'"','primary')+btn('見送る','friend-reject','data-request="'+esc(r.requestId)+'"'))).join('')}</div>`:''}
      <h3 class="social-section-title">フレンド <span class="social-note">${accepted.length}人</span></h3><div class="social-list">${accepted.length?accepted.map(r=>personRow(r.user,btn('会話','dm','data-user="'+esc(r.user.id)+'"')+btn('解除','friend-remove','data-user="'+esc(r.user.id)+'"','quiet'))).join(''):empty('フレンドを見つけよう','相手のフレンドコードを入力して、申請できます。')}</div>
      ${outgoing.length?`<h3 class="social-section-title">返事を待っている申請</h3><div class="social-list">${outgoing.map(r=>personRow(r.user,btn('取り消す','friend-remove','data-user="'+esc(r.user.id)+'"','quiet'))).join('')}</div>`:''}
      ${(state.blocks||[]).length?`<details class="social-disclosure"><summary>ブロック中のユーザー (${state.blocks.length})</summary><div class="social-list">${state.blocks.map(u=>personRow(u,btn('解除','unblock-user','data-user="'+esc(u.id)+'"'))).join('')}</div></details>`:''}
      <p class="social-note">コードはプロフィール横のコピーボタンから共有できます。</p></div>`;
  }
  function orgHTML(){
    if(orgDetail){const joined=joinedOrgs().find(o=>o.id===orgDetail.id);return `<div class="social-stack"><div class="social-toolbar">${btn('コミュニティ一覧','org-list','','quiet')}<span class="social-note">${esc(orgDetail.memberCount||orgMembers.length)}人</span></div><div class="social-org"><span class="social-avatar">${ico('building')}</span><div class="social-org-main"><strong>${esc(orgDetail.name)}</strong><p>${esc(orgDetail.description||'')}</p></div></div>
      ${joined?`<div class="social-inline">${btn('チャットを開く','org-chat','data-id="'+esc(orgDetail.id)+'"','primary')}${btn('通話へ','org-voice','data-id="'+esc(orgDetail.id)+'"')}${btn('退出する','org-leave-confirm','','quiet')}</div>${leaveConfirm?`<div class="social-warning">このコミュニティから退出します。代表の場合は次のメンバーへ引き継がれ、最後の一人の場合はコミュニティが削除されます。<div class="social-form-actions">${btn('キャンセル','org-leave-cancel')}${btn('退出を確定','org-leave','data-id="'+esc(orgDetail.id)+'"','danger')}</div></div>`:''}<h3 class="social-section-title">メンバー</h3><div class="social-list">${orgMembers.length?orgMembers.map(u=>personRow(u,'',u.role==='owner'?'代表':'メンバー')).join(''):empty('メンバーを読み込んでいます')}</div>`:`${btn('このコミュニティに参加','org-join','data-id="'+esc(orgDetail.id)+'"','primary')}<p class="social-note">参加すると、メンバーの会話と音声通話を利用できます。</p>`}</div>`;}
    return `<div class="social-stack"><div class="social-toolbar"><p class="social-note">好きな場所や話題で集まる、小さなコミュニティ。</p>${btn('つくる','org-create','','primary')}</div>
      ${createOrg?`<form class="social-form" data-form="org-create"><label>コミュニティ名<input name="name" data-focus="org-name" minlength="2" maxlength="40" required placeholder="2〜40文字"></label><label>紹介文<textarea name="description" data-focus="org-description" maxlength="240" placeholder="どんな集まりですか？"></textarea></label><div class="social-form-actions">${btn('キャンセル','org-create-cancel')}<button class="social-btn primary" type="submit">作成する</button></div></form>`:''}
      <div class="social-list">${orgs.length?orgs.map(o=>`<div class="social-org"><span class="social-avatar">${ico('building')}</span><div class="social-org-main"><strong>${esc(o.name)}</strong><p>${esc(o.description||'')}</p><span class="social-org-meta">${esc(o.memberCount)}人 ${o.joined?'· 参加中':''}</span></div>${btn('見る','org-detail','data-id="'+esc(o.id)+'"')}</div>`).join(''):empty('最初の集まりをつくろう','コミュニティを作ると、専用の会話と通話を利用できます。')}</div></div>`;
  }
  function voiceStatus(entry){return entry?.pc.connectionState==='connected'?'音声接続中':entry?.pc.connectionState==='failed'?'接続できません':entry?.pc.connectionState==='disconnected'?'接続が途切れています':'接続中…';}
  function voiceHTML(){
    const available=!!(navigator.mediaDevices?.getUserMedia&&window.RTCPeerConnection);
    return `<div class="social-stack"><div class="social-voice-summary"><span class="social-voice-symbol">${ico('mic')}</span><div><strong>${voice.joined?esc(voice.name):'声で、いっしょに過ごす。'}</strong><p>${voice.joined?`参加者 ${voice.members.length} / 4人`:'最大4人 · マイクは参加ボタンを押したときだけ使用'}</p></div></div>
      ${voice.error?`<div class="social-warning" role="status">${esc(voice.error)}</div>`:''}
      ${voice.joined?`<div class="social-voice-grid">${voice.members.map(u=>{const self=u.id===user?.id,entry=voice.peers.get(u.id),status=self?(voice.muted?'あなた · マイクOFF':'あなた · マイクON'):voiceStatus(entry);return`<div class="social-voice-person ${self||entry?.pc.connectionState==='connected'?'connected':entry?.pc.connectionState==='failed'?'failed':''}">${avatar(u)}<div><strong>${esc(u.name)}</strong><small>${esc(status)}</small></div></div>`;}).join('')}${voice.members.length===1?'<div class="social-voice-empty">ほかの参加者を待っています</div>':''}</div><div class="social-voice-controls">${btn(`${ico(voice.muted?'micoff':'mic')} ${voice.muted?'マイクをON':'ミュート'}`,'voice-mute')}${btn(`${ico('phone')} 通話から退出`,'voice-leave','','danger')}</div>${voice.audioBlocked?btn(`${ico('sound')} 参加者の音声を再生`,'voice-play','','primary'):''}`:
      `<label class="social-stack">通話する場所<select data-action="voice-select" ${voice.joining?'disabled':''}>${options(voice.selected)}</select></label><button type="button" class="social-btn primary" data-action="voice-join" ${!available||voice.joining?'disabled':''}>${ico('mic')} ${voice.joining?'接続しています…':'マイクを使って参加'}</button>${!available?'<p class="social-warning">このブラウザでは音声通話を開始できません。HTTPSのオンライン版を対応ブラウザで開いてください。</p>':''}`}
      <p class="social-note">この画面を閉じても通話は続きます。画面下の通話バーからミュート・退出できます。</p>
      <details class="social-disclosure"><summary>接続設定 · TURNサーバー</summary><form class="social-form" data-form="turn"><p class="social-note">音声はWebRTCで接続します。通信環境によってはTURNサーバーが必要です。利用できるサーバーの情報をお持ちの場合に設定してください。</p><label>TURN URL<input name="turn-url" data-focus="turn-url" value="${esc(turn.url)}" placeholder="turn:example.com:3478" autocomplete="off"></label><label>ユーザー名<input name="turn-user" data-focus="turn-user" value="${esc(turn.username)}" autocomplete="off"></label><label>認証情報<input name="turn-credential" data-focus="turn-credential" type="password" autocomplete="off"></label><p class="social-note">この端末だけに保存され、次回の通話参加から使われます。</p><div class="social-form-actions">${btn('設定を消す','turn-clear')}<button class="social-btn" type="submit">保存する</button></div></form></details></div>`;
  }
  async function refreshState({redraw=false}={}){
    const previous=JSON.stringify(state);const result=await api('/state');state=result;user=result.user;authenticated=true;
    if(redraw||(JSON.stringify(state)!==previous&&tab!=='chat'))render(true);
  }
  async function loadMessages(reset=false){
    const requested=channel;if(reset){messages=[];since=0;loadingChannel=true;renderMessages();}
    const result=await api(`/messages?channel=${encodeURIComponent(requested)}&since=${reset?0:since}`);
    if(requested!==channel)return;
    const incoming=Array.isArray(result.messages)?result.messages:[];
    if(reset)messages=[];
    const ids=new Set(messages.map(m=>String(m.id)));let changed=reset||loadingChannel;
    for(const m of incoming){if(!ids.has(String(m.id))){messages.push(m);ids.add(String(m.id));changed=true;}since=Math.max(since,Number(m.id)||0);}
    messages.sort((a,b)=>Number(a.id)-Number(b.id));if(messages.length>100)messages=messages.slice(-100);loadingChannel=false;
    if(changed&&tab==='chat'&&isVisible()){renderMessages(true);if(reset){const list=shell.querySelector('.social-messages');if(list)list.scrollTop=list.scrollHeight;}}
  }
  async function loadOrgs(){const result=await api('/organizations');orgs=result.organizations||[];if(tab==='orgs')render();}
  async function loadOrg(id){orgDetail=orgs.find(o=>o.id===id)||joinedOrgs().find(o=>o.id===id);if(!orgDetail)return;orgMembers=[];leaveConfirm=false;render();if(joinedOrgs().some(o=>o.id===id)){const result=await api(`/organizations/${encodeURIComponent(id)}/members`);if(orgDetail?.id===id){orgMembers=result.members||[];render();}}}
  function startPolling(){
    clearInterval(chatTimer);chatTimer=setInterval(async()=>{
      if(!isVisible()){close();return;}if(!authenticated||pollBusy)return;pollBusy=true;
      try{if(tab==='chat')await loadMessages();if(++pollTick%4===0)await refreshState();}catch(err){if(err.status===401)render();else if(isVisible()){const already=error;error=errorText(err);if(error!==already)render();}}finally{pollBusy=false;}
    },3000);
  }
  async function connect(){
    const token=++generation;error='';authenticated=null;render();
    try{const me=await api('/me');if(token!==generation)return;authenticated=!!me.signedIn;user=me.user||null;if(authenticated){await refreshState();if(token!==generation)return;render();if(tab==='chat')await loadMessages(true);else if(tab==='orgs')await loadOrgs();startPolling();}else render();}
    catch(err){if(token!==generation)return;authenticated=err.status===401?false:null;error=errorText(err);render();}
  }
  function open(){
    visible=true;body=openPanel('街のつながり','COMMUNITY','<div class="machi-social"></div>');shell=body.querySelector('.machi-social');
    if(!shell){shell=document.createElement('div');shell.className='machi-social';body.append(shell);}
    shell.addEventListener('click',onClick);shell.addEventListener('submit',onSubmit);shell.addEventListener('change',onChange);shell.addEventListener('input',onInput);shell.addEventListener('keydown',onKeydown);
    render();if(hosted)void connect();
  }
  function close(){visible=false;generation++;clearInterval(chatTimer);chatTimer=null;}
  async function withBusy(button,fn){
    if(button?.disabled)return;error='';if(button)button.disabled=true;
    try{await fn();}catch(err){showError(err);}finally{if(button?.isConnected)button.disabled=false;}
  }
  function onInput(event){const el=event.target;if(el.name==='message'){drafts.set(channel,el.value);const count=shell.querySelector('[data-message-count]');if(count)count.textContent=`${el.value.length} / 500`;}if(el.name==='query')searchQuery=el.value;if(el.name==='reason')reportReason=el.value;}
  function onKeydown(event){
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))event.stopPropagation();
    if(event.target.name==='message'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.form.requestSubmit();}
  }
  function onChange(event){
    const action=event.target.dataset.action;
    if(action==='channel'){channel=event.target.value;menuMessage=null;reportMessage=null;render();void loadMessages(true).catch(showError);}
    if(action==='voice-select')voice.selected=event.target.value;
  }
  async function onSubmit(event){
    const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form);const submit=form.querySelector('[type="submit"]');
    await withBusy(submit,async()=>{
      if(form.dataset.form==='message'){
        const text=String(data.get('message')||'').trim();if(!text)return;
        const sentChannel=channel;const result=await api(`/messages?channel=${encodeURIComponent(sentChannel)}`,{method:'POST',data:{text}});
        if(drafts.get(sentChannel)===String(data.get('message')||''))drafts.set(sentChannel,'');
        if(channel===sentChannel){if(result.message&&!messages.some(m=>String(m.id)===String(result.message.id)))messages.push(result.message);since=Math.max(since,Number(result.message?.id)||0);render();const list=shell.querySelector('.social-messages');if(list)list.scrollTop=list.scrollHeight;shell.querySelector('[name="message"]')?.focus();}
      }else if(form.dataset.form==='profile'){
        const result=await api('/profile',{method:'POST',data:{name:String(data.get('name')||'').trim()}});user=result.user;state.user=user;profileEditing=false;render();toast('表示名を保存しました。');
      }else if(form.dataset.form==='search'){
        searchQuery=String(data.get('query')||'').trim();if(searchQuery.length<3)throw new Error('3文字以上のコード・表示名を入力してください。');const result=await api(`/users?q=${encodeURIComponent(searchQuery)}`);searchResults=result.users||[];render();
      }else if(form.dataset.form==='org-create'){
        const result=await api('/organizations',{method:'POST',data:{name:String(data.get('name')||'').trim(),description:String(data.get('description')||'').trim()}});createOrg=false;await refreshState();await loadOrgs();await loadOrg(result.organization.id);toast('コミュニティを作成しました。');
      }else if(form.dataset.form==='report'){
        if(!reportMessage)return;await api('/report',{method:'POST',data:{messageId:reportMessage.id,reason:String(data.get('reason')||'').trim()}});reportMessage=null;reportReason='';render();toast('通報を受け付けました。');
      }else if(form.dataset.form==='turn'){
        const url=String(data.get('turn-url')||'').trim();if(url&&!/^turns?:[^\s]+$/i.test(url))throw new Error('TURN URLは turn: または turns: で始まる形式で入力してください。');turn={url,username:String(data.get('turn-user')||''),credential:String(data.get('turn-credential')||'')};try{localStorage.setItem('machi:voice:turn:v1',JSON.stringify(turn));}catch{throw new Error('このブラウザでは設定を保存できません。');}toast('通話の接続設定を保存しました。');
      }
    });
  }
  async function onClick(event){
    const button=event.target.closest('[data-action]');if(!button||!shell.contains(button)||button.tagName==='SELECT')return;const action=button.dataset.action;
    await withBusy(button,async()=>{
      if(action==='retry-connect')await connect();
      else if(action==='tab'){tab=button.dataset.tab;error='';render();if(tab==='chat')await loadMessages(true);if(tab==='orgs')await loadOrgs();}
      else if(action==='copy-code'){try{await navigator.clipboard.writeText(user.code);toast('フレンドコードをコピーしました。');}catch{toast(`フレンドコード: ${user.code}`);}}
      else if(action==='edit-profile'){profileEditing=!profileEditing;render();}
      else if(action==='cancel-profile'){profileEditing=false;render();}
      else if(action==='clear-error'){error='';render();}
      else if(action==='friend-request'){await api('/friends/request',{method:'POST',data:{code:button.dataset.code}});await refreshState({redraw:true});toast('フレンド申請を送りました。');}
      else if(action==='friend-accept'||action==='friend-reject'){await api('/friends/respond',{method:'POST',data:{requestId:button.dataset.request,accept:action==='friend-accept'}});await refreshState({redraw:true});}
      else if(action==='friend-remove'){await api('/friends/remove',{method:'POST',data:{userId:button.dataset.user}});if(channel===`dm:${button.dataset.user}`)channel='global';await refreshState({redraw:true});}
      else if(action==='dm'){channel=`dm:${button.dataset.user}`;tab='chat';menuMessage=null;render();await loadMessages(true);}
      else if(action==='org-create'){createOrg=true;render();}
      else if(action==='org-create-cancel'){createOrg=false;render();}
      else if(action==='org-detail')await loadOrg(button.dataset.id);
      else if(action==='org-list'){orgDetail=null;leaveConfirm=false;await loadOrgs();}
      else if(action==='org-join'){await api('/organizations/join',{method:'POST',data:{id:button.dataset.id}});await refreshState();await loadOrgs();await loadOrg(button.dataset.id);}
      else if(action==='org-leave-confirm'){leaveConfirm=true;render();}
      else if(action==='org-leave-cancel'){leaveConfirm=false;render();}
      else if(action==='org-leave'){const id=button.dataset.id;await api('/organizations/leave',{method:'POST',data:{id}});if(channel===`org:${id}`)channel='global';if(voice.joined&&voice.channel===`org:${id}`)await leaveVoice();orgDetail=null;leaveConfirm=false;await refreshState();await loadOrgs();}
      else if(action==='org-chat'){channel=`org:${button.dataset.id}`;tab='chat';render();await loadMessages(true);}
      else if(action==='org-voice'){voice.selected=`org:${button.dataset.id}`;tab='voice';render();}
      else if(action==='message-menu'){menuMessage=messages.find(m=>String(m.id)===button.dataset.id)||null;reportMessage=null;render();}
      else if(action==='close-msg-menu'){menuMessage=null;render();}
      else if(action==='start-report'){reportMessage=menuMessage;menuMessage=null;reportReason='';render();}
      else if(action==='cancel-report'){reportMessage=null;reportReason='';render();}
      else if(action==='block-user'){const id=button.dataset.user;await api('/block',{method:'POST',data:{userId:id}});removePeer(id);menuMessage=null;if(channel===`dm:${id}`)channel='global';await refreshState();messages=messages.filter(m=>m.user.id!==id);render();toast('このユーザーをブロックしました。');}
      else if(action==='unblock-user'){await api('/block',{method:'DELETE',data:{userId:button.dataset.user}});await refreshState({redraw:true});}
      else if(action==='voice-channel'){voice.selected=channel;tab='voice';render();}
      else if(action==='voice-join')await joinVoice();
      else if(action==='voice-leave')await leaveVoice();
      else if(action==='voice-mute')toggleMute();
      else if(action==='voice-play')await resumeAudio();
      else if(action==='turn-clear'){turn={url:'',username:'',credential:''};try{localStorage.removeItem('machi:voice:turn:v1');}catch{}render();toast('TURN設定を削除しました。');}
    });
  }

  // Voice channels use real server presence and full-mesh WebRTC media.
  function iceServers(){const servers=[{urls:'stun:stun.l.google.com:19302'}];if(turn.url)servers.push({urls:turn.url,username:turn.username,credential:turn.credential});return servers;}
  function updateVoiceUI(){
    const focusedAction=dock.contains(document.activeElement)?document.activeElement.dataset.voiceAction:null;
    dock.hidden=!voice.joined;
    if(voice.joined)dock.innerHTML=`<button type="button" class="voice-dock-title" data-voice-action="open"><strong>${esc(voice.name)}</strong><small>${voice.members.length} / 4人 · ${voice.muted?'マイクOFF':'マイクON'}</small></button><button type="button" class="voice-dock-btn" data-voice-action="mute" aria-label="${voice.muted?'マイクをON':'ミュート'}">${ico(voice.muted?'micoff':'mic')}</button><button type="button" class="voice-dock-btn leave" data-voice-action="leave" aria-label="通話から退出">${ico('phone')}</button>`;
    if(focusedAction&&voice.joined)dock.querySelector(`[data-voice-action="${focusedAction}"]`)?.focus({preventScroll:true});
    if(isVisible()&&tab==='voice')render(true);
  }
  function removePeer(id){const entry=voice.peers.get(id);if(!entry)return;entry.pc.onicecandidate=null;entry.pc.onconnectionstatechange=null;entry.pc.ontrack=null;entry.pc.close();entry.audio.srcObject=null;entry.audio.remove();voice.peers.delete(id);}
  async function sendSignal(to,type,data){if(!voice.joined)return;await api('/voice/signal',{method:'POST',data:{channel:voice.channel,to,type,data}});}
  async function ensurePeer(info,offer=true){
    if(info.id===user?.id)return null;if(voice.peers.has(info.id))return voice.peers.get(info.id);
    if(!voice.stream||!voice.joined)return null;
    const epoch=voice.epoch,pc=new RTCPeerConnection({iceServers:iceServers()});const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.dataset.peer=info.id;audioContainer.append(audio);
    const entry={pc,audio,info,pendingIce:[],makingOffer:false,polite:String(user.id)>String(info.id)};voice.peers.set(info.id,entry);
    for(const track of voice.stream.getTracks())pc.addTrack(track,voice.stream);
    pc.onicecandidate=event=>{if(event.candidate&&voice.joined&&voice.epoch===epoch)void sendSignal(info.id,'ice',event.candidate.toJSON()).catch(err=>{voice.error=errorText(err);updateVoiceUI();});};
    pc.ontrack=event=>{if(voice.epoch!==epoch)return;audio.srcObject=event.streams[0]||new MediaStream([event.track]);audio.play().catch(()=>{voice.audioBlocked=true;updateVoiceUI();});};
    pc.onconnectionstatechange=()=>{if(voice.epoch!==epoch)return;if(pc.connectionState==='failed')voice.error='音声の直接接続に失敗しました。退出して再参加するか、利用可能なTURNサーバーを接続設定に指定してください。';updateVoiceUI();};
    if(offer&&String(user.id)<String(info.id)){
      entry.makingOffer=true;
      try{await pc.setLocalDescription(await pc.createOffer());if(voice.epoch===epoch)await sendSignal(info.id,'offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});}finally{entry.makingOffer=false;}
    }
    return entry;
  }
  async function flushIce(entry){while(entry.pendingIce.length){const candidate=entry.pendingIce.shift();try{await entry.pc.addIceCandidate(candidate);}catch{}}}
  async function handleSignal(signal){
    const info=voice.members.find(p=>p.id===signal.from);if(!info||signal.from===user?.id)return;
    const entry=await ensurePeer(info,false);if(!entry)return;const pc=entry.pc,data=signal.data;
    if(signal.type==='offer'){
      if(!data||typeof data.sdp!=='string')return;
      const collision=entry.makingOffer||pc.signalingState!=='stable';if(collision&&!entry.polite)return;
      if(collision)await pc.setLocalDescription({type:'rollback'});
      await pc.setRemoteDescription({type:'offer',sdp:data.sdp});await flushIce(entry);
      await pc.setLocalDescription(await pc.createAnswer());await sendSignal(signal.from,'answer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
    }else if(signal.type==='answer'){
      if(data?.sdp&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription({type:'answer',sdp:data.sdp});await flushIce(entry);}
    }else if(signal.type==='ice'&&data&&typeof data.candidate==='string'){
      if(pc.remoteDescription)await pc.addIceCandidate(data);else entry.pendingIce.push(data);
    }
  }
  async function pollVoice(){
    if(!voice.joined||voice.polling)return;voice.polling=true;const epoch=voice.epoch;
    try{
      const result=await api(`/voice/poll?channel=${encodeURIComponent(voice.channel)}&since=${voice.cursor}`);if(!voice.joined||voice.epoch!==epoch)return;
      voice.members=result.peers||[];const ids=new Set(voice.members.map(p=>p.id));for(const id of voice.peers.keys())if(!ids.has(id))removePeer(id);
      for(const peer of voice.members)if(peer.id!==user?.id)await ensurePeer(peer);
      for(const signal of result.signals||[]){try{await handleSignal(signal);}catch(err){voice.error=`音声の接続を完了できませんでした。${errorText(err)}`;}voice.cursor=Math.max(voice.cursor,Number(signal.id)||0);}
      voice.cursor=Math.max(voice.cursor,Number(result.lastSignalId)||0);updateVoiceUI();
    }catch(err){if(voice.epoch!==epoch)return;if(err.status===401||err.status===403||err.code==='not_joined'||err.code==='voice_expired'){await leaveVoice(false);toast(errorText(err));}else{voice.error=errorText(err);updateVoiceUI();}}
    finally{if(voice.epoch===epoch)voice.polling=false;}
  }
  async function joinVoice(){
    if(voice.joined||voice.joining)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('このブラウザは音声通話に対応していません。');
    voice.joining=true;voice.error='';voice.audioBlocked=false;const joinEpoch=++voice.epoch;updateVoiceUI();let stream,serverJoined=false;const requested=voice.selected;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(voice.epoch!==joinEpoch){stream.getTracks().forEach(t=>t.stop());return;}
      const result=await api('/voice/join',{method:'POST',data:{channel:requested}});serverJoined=true;
      if(voice.epoch!==joinEpoch){stream.getTracks().forEach(t=>t.stop());await api('/voice/leave',{method:'POST',data:{channel:requested}}).catch(()=>{});return;}
      voice.joined=true;voice.channel=requested;voice.name=nameOfChannel(requested);voice.members=result.peers||[];voice.cursor=Number(result.lastSignalId)||0;voice.stream=stream;voice.muted=false;voice.polling=false;
      for(const track of stream.getAudioTracks())track.onended=()=>{if(voice.joined){void leaveVoice();toast('マイクが停止したため通話から退出しました。');}};
      for(const peer of voice.members)if(peer.id!==user?.id)await ensurePeer(peer);
      voice.timer=setInterval(()=>void pollVoice(),2000);void pollVoice();
    }catch(err){stream?.getTracks().forEach(t=>t.stop());if(serverJoined)await api('/voice/leave',{method:'POST',data:{channel:requested}}).catch(()=>{});for(const id of [...voice.peers.keys()])removePeer(id);voice.joined=false;voice.stream=null;
      if(err.name==='NotAllowedError')throw new Error('マイクの使用が許可されませんでした。ブラウザのマイク設定を確認してから、参加を押してください。');if(err.name==='NotFoundError')throw new Error('使用できるマイクが見つかりませんでした。');throw err;
    }finally{if(voice.epoch===joinEpoch)voice.joining=false;updateVoiceUI();}
  }
  async function leaveVoice(notify=true,keepalive=false){
    const wasJoined=voice.joined,oldChannel=voice.channel;voice.epoch++;voice.joined=false;voice.joining=false;voice.polling=false;clearInterval(voice.timer);voice.timer=null;
    voice.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});voice.stream=null;for(const id of [...voice.peers.keys()])removePeer(id);voice.members=[];voice.cursor=0;voice.audioBlocked=false;voice.error='';updateVoiceUI();
    if(wasJoined&&hosted)try{await api('/voice/leave',{method:'POST',data:{channel:oldChannel},keepalive});}catch(err){if(notify)toast(`音声は停止しました。退出通知を送れませんでした: ${errorText(err)}`);}
  }
  function toggleMute(){if(!voice.stream)return;voice.muted=!voice.muted;for(const t of voice.stream.getAudioTracks())t.enabled=!voice.muted;updateVoiceUI();}
  async function resumeAudio(){let blocked=false;for(const {audio} of voice.peers.values())try{await audio.play();}catch{blocked=true;}voice.audioBlocked=blocked;updateVoiceUI();}
  dock.addEventListener('click',event=>{const action=event.target.closest('[data-voice-action]')?.dataset.voiceAction;if(action==='mute')toggleMute();if(action==='leave')void leaveVoice();if(action==='open'){tab='voice';open();}});
  window.addEventListener('pagehide',()=>{close();void leaveVoice(false,true);});
  let lastVisibilityCheck=0;
  return{open,close,update(){const now=performance.now();if(now-lastVisibilityCheck<500)return;lastVisibilityCheck=now;if(visible&&!isVisible())close();}};
}
