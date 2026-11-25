/** One profile authority: guest storage, or the authenticated social profile. */
const ONLINE_ORIGIN='https://machi-life.hisa-0128-1996.chatgpt.site';
const GUEST_KEY='machi.profile.guest.v1';
const ACCOUNT_PREFIX='machi.profile.account.';
const EDITABLE=['name','tagline','bio','title','accent','avatarIcon','showName'];
export const PROFILE_TITLES=Object.freeze(['街の住人','気ままな旅人','散歩好き','カフェ日和','本のある暮らし','部屋づくり好き','のんびり暮らし','街の探索者']);
export const PROFILE_ICONS=Object.freeze([
  {id:'leaf',label:'若葉',path:'M20 3C9 2 3 8 5 15c2 7 12 7 15-12ZM5 20l10-10M9 16l-1-5M12 13h5'},
  {id:'coffee',label:'コーヒー',path:'M4 8h13v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM17 9h2a3 3 0 0 1 0 6h-2M7 3v2M11 2v3M15 3v2M2 22h19'},
  {id:'book',label:'本',path:'M12 5C8 2 4 3 2 4v15c3-2 7-2 10 1 3-3 7-3 10-1V4c-2-1-6-2-10 1ZM12 5v15M5 8h4M5 12h4M15 8h4M15 12h4'},
  {id:'home',label:'家',path:'m2 11 10-8 10 8M5 10v11h14V10M10 21v-7h4v7'},
  {id:'sun',label:'太陽',path:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'},
  {id:'moon',label:'月',path:'M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5 9 9 0 1 0 20.5 14.2ZM17 3v4M15 5h4'},
  {id:'star',label:'星',path:'m12 2 3.1 6.3 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7L2 9.3l7-1Z'},
  {id:'compass',label:'方位磁針',path:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16.5 7.5l-3 6-6 3 3-6ZM12 2v2M12 20v2M2 12h2M20 12h2'},
]);
const ACCENTS=['#2e6b54','#3d6f88','#8e654c','#795c89','#8a723a','#4b716b'];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const length=value=>Array.from(String(value)).length;
const truncate=(value,count)=>Array.from(String(value??'')).slice(0,count).join('');
const controlFree=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const fields=value=>Object.fromEntries(EDITABLE.map(key=>[key,value[key]]));
const sameFields=(a,b)=>EDITABLE.every(key=>a?.[key]===b?.[key]);
const iconExists=id=>PROFILE_ICONS.some(icon=>icon.id===id);
const contextOf=state=>({scope:state.scope,accountId:state.accountId,version:state.version});
const keyFor=id=>id?`${ACCOUNT_PREFIX}${id}.v1`:GUEST_KEY;

export function ensureProfileStyles(){
  if(typeof document==='undefined'||document.querySelector('link[data-machi-profile]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./profile.css',import.meta.url).href;link.dataset.machiProfile='';document.head.append(link);
}
export function profileIconMarkup(id='leaf',size=28){
  const item=PROFILE_ICONS.find(icon=>icon.id===id)||PROFILE_ICONS[0];
  const pixels=Math.max(12,Math.min(96,Number(size)||28));
  return `<svg width="${pixels}" height="${pixels}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${item.path}"/></svg>`;
}
function safeAccent(value){return typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value)?value.toLowerCase():'#2e6b54';}
function accentInk(value){const hex=safeAccent(value).slice(1),channels=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16));return channels[0]*.299+channels[1]*.587+channels[2]*.114>170?'#29473a':safeAccent(value);}
export function profileAvatarMarkup(profile,size=48,className=''){
  ensureProfileStyles();const pixels=Math.max(24,Math.min(120,Number(size)||48));
  const extra=String(className).replace(/[^a-zA-Z0-9 _-]/g,'');
  return `<span class="machi-profile-avatar ${extra}" style="--profile-accent:${safeAccent(profile?.accent)};--profile-accent-ink:${accentInk(profile?.accent)};width:${pixels}px;height:${pixels}px" aria-hidden="true">${profileIconMarkup(profile?.avatarIcon,Math.round(pixels*.53))}</span>`;
}
function normalise(value={}){
  return {id:typeof value.id==='string'?value.id:null,code:typeof value.code==='string'?value.code:'',name:truncate(controlFree(value.name||'旅人').replace(/\s+/g,' ').trim(),24)||'旅人',tagline:truncate(controlFree(value.tagline||'').replace(/\s+/g,' ').trim(),60),bio:truncate(controlFree(value.bio||'').replace(/\r\n?/g,'\n').trim(),300),title:value.title===''||PROFILE_TITLES.includes(value.title)?value.title:'街の住人',accent:safeAccent(value.accent),avatarIcon:iconExists(value.avatarIcon)?value.avatarIcon:'leaf',showName:value.showName!==false,version:Number.isSafeInteger(value.version)&&value.version>=0?value.version:0,updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0};
}
function validate(patch,current){
  const next={...fields(current),...Object.fromEntries(Object.entries(patch||{}).filter(([key])=>EDITABLE.includes(key)))};
  for(const [key,label,max,min] of [['name','表示名',24,1],['tagline','ひとこと',60,0],['bio','自己紹介',300,0]]){
    if(typeof next[key]!=='string')throw new Error(`${label}を入力してください。`);
    next[key]=controlFree(next[key]).trim();if(key!=='bio')next[key]=next[key].replace(/\s+/g,' ');else next[key]=next[key].replace(/\r\n?/g,'\n');
    if(length(next[key])<min||length(next[key])>max)throw new Error(`${label}は${min?min+'〜':''}${max}文字${min?'で':'以内で'}入力してください。`);
  }
  if(next.title!==''&&!PROFILE_TITLES.includes(next.title))throw new Error('称号を一覧から選んでください。');
  if(typeof next.accent!=='string'||!/^#[a-f\d]{6}$/i.test(next.accent))throw new Error('アクセントカラーを選んでください。');
  if(!iconExists(next.avatarIcon))throw new Error('プロフィールアイコンを選んでください。');
  if(typeof next.showName!=='boolean')throw new Error('頭上ネームの表示設定を選んでください。');
  next.accent=next.accent.toLowerCase();return next;
}

export function createProfile({openPanel,toast=()=>{},onChange=()=>{}}={}){
  ensureProfileStyles();const hosted=typeof location!=='undefined'&&location.origin===ONLINE_ORIGIN;
  let committed=normalise(),scope='guest',accountId=null,pendingRecord=null,error='',storageError='';
  let disposed=false,verified=!hosted,syncing=false,saving=false,syncPromise=null,savePromise=null,sessionEpoch=0,viewEpoch=0,lastSync=0;
  let shell=null,visible=false,editing=false,draft=null,editContext=null,draftDirty=false,viewedId=null,viewedProfile=null,viewLoading=false;
  const requests=new Set();
  function readRecord(id){
    try{const raw=localStorage.getItem(keyFor(id));if(!raw)return null;const saved=JSON.parse(raw);if(!saved||saved.format!==1||saved.accountId!==(id||null)||!saved.profile||typeof saved.profile.name!=='string')throw new Error('invalid profile');return saved;}
    catch(_){storageError='プロフィールの端末保存を読み込めませんでした。保存ボタンを押すまで元のデータは変更しません。';return null;}
  }
  function writeRecord(id,profile,pending=null){
    localStorage.setItem(keyFor(id),JSON.stringify({format:1,accountId:id||null,profile,pending}));storageError='';
  }
  function cacheAccount(){try{writeRecord(accountId,committed,pendingRecord);}catch(_){storageError='このブラウザにプロフィールの控えを保存できませんでした。';}}
  function loadGuest(){
    const saved=readRecord(null);if(saved)return normalise({...saved.profile,id:null,code:''});
    let legacyName='旅人';
    try{const old=JSON.parse(localStorage.getItem('machi.life.v1')||'null');const name=old?.state?.name||old?.name;if(typeof name==='string'&&!['あなた',''].includes(name.trim()))legacyName=name;}catch(_){}
    const initial=normalise({name:legacyName});
    // Freeze the guest identity before a later account sign-in can change legacy state.
    if(!storageError)try{writeRecord(null,initial);}catch(_){storageError='プロフィールをこのブラウザに保存できません。保存設定を確認してください。';}
    return initial;
  }
  committed=loadGuest();
  function getState(){return {...committed,scope,signedIn:scope==='account',accountId,verified,syncing,saving,pending:!!pendingRecord,error:error||storageError,hosted};}
  function emit(){if(disposed)return;const state=getState();try{onChange({...state});}catch(_){}if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('machi:profile-change',{detail:state}));}
  function currentContext(){return contextOf(getState());}
  function contextMatches(context){return context.scope===scope&&context.accountId===accountId;}
  function isVisible(){return visible&&shell?.isConnected;}
  async function api(route,{method='GET',data}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);requests.add(controller);
    try{const response=await fetch('/api/social'+route,{method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});let result;try{result=await response.json();}catch(_){throw new Error('プロフィールの保存サービスに接続できませんでした。');}if(!response.ok){const failure=new Error(result.error||'プロフィールを保存できませんでした。');failure.code=result.code;failure.status=response.status;failure.user=result.user;throw failure;}return result;}
    catch(failure){if(failure.name==='AbortError'){const timeout=new Error('プロフィールの接続がタイムアウトしました。もう一度お試しください。');timeout.code='timeout';throw timeout;}throw failure;}
    finally{clearTimeout(timer);requests.delete(controller);}
  }
  function beginEdit(usePending=true){
    editing=true;viewedId=null;viewedProfile=null;draft=fields(usePending&&pendingRecord?.values?normalise(pendingRecord.values):committed);
    editContext=currentContext();if(usePending&&pendingRecord)editContext.version=pendingRecord.expectedVersion;
    draftDirty=false;
  }
  async function sync(){
    if(disposed)return getState();if(savePromise){await savePromise;if(disposed)return getState();}if(syncPromise)return syncPromise;
    const epoch=++sessionEpoch;syncing=true;error='';emit();render();
    const work=(async()=>{
      try{
        if(!hosted){const latest=loadGuest();if(epoch!==sessionEpoch||disposed)return getState();committed=latest;scope='guest';accountId=null;pendingRecord=null;lastSync=Date.now();return getState();}
        const result=await api('/me');if(epoch!==sessionEpoch||disposed)return getState();
        if(typeof result.signedIn!=='boolean'||(result.signedIn&&(typeof result.user?.id!=='string'||typeof result.user?.name!=='string')))throw new Error('アカウントのプロフィールを確認できませんでした。もう一度お試しください。');
        verified=true;
        const nextId=result.signedIn&&typeof result.user?.id==='string'?result.user.id:null;
        const changedIdentity=nextId!==accountId||!!nextId!==(scope==='account');
        if(nextId){
          const saved=readRecord(nextId);scope='account';accountId=nextId;committed=normalise(result.user);
          pendingRecord=saved?.pending&&saved.pending.accountId===nextId&&Number.isSafeInteger(saved.pending.expectedVersion)?saved.pending:null;
          if(pendingRecord&&sameFields(normalise(pendingRecord.values),committed))pendingRecord=null;
          if(!storageError)cacheAccount();
        }else{scope='guest';accountId=null;pendingRecord=null;committed=loadGuest();}
        if(editing&&changedIdentity){if(draftDirty){editing=false;draft=null;editContext=null;error='ログイン状態が変わったため、保存先を切り替えました。プロフィールを確認してから編集してください。';}else beginEdit();}
        lastSync=Date.now();return getState();
      }catch(failure){if(epoch===sessionEpoch&&!disposed)error=failure.message;return getState();}
    })();
    const completion=work.finally(()=>{if(syncPromise===completion)syncPromise=null;if(epoch===sessionEpoch&&!disposed){syncing=false;emit();render();}}).then(()=>getState());
    syncPromise=completion;return completion;
  }
  async function save(patch,{context=currentContext()}={}){
    if(disposed)return {ok:false,message:'プロフィール画面は閉じられています。'};
    if(savePromise)return {ok:false,message:'プロフィールを保存しています。'};
    if(syncPromise)await syncPromise;
    if(disposed)return {ok:false,message:'プロフィール画面は閉じられています。'};
    if(savePromise)return {ok:false,message:'プロフィールを保存しています。'};
    if(!contextMatches(context)){error='ログイン状態が変わりました。現在のプロフィールを確認してから保存してください。';emit();render();return {ok:false,message:error,code:'profile_identity_changed'};}
    let values;try{values=validate(patch,committed);}catch(failure){error=failure.message;render();return {ok:false,message:error};}
    const owner=accountId,epoch=sessionEpoch;saving=true;error='';emit();render();let mustResync=false;
    const work=(async()=>{
      try{
        if(scope==='guest'){
          const latest=readRecord(null);const actualVersion=latest?normalise(latest.profile).version:committed.version;
          if(actualVersion!==context.version){if(latest)committed=normalise(latest.profile);const failure=new Error('別の画面でプロフィールが更新されています。最新の内容を確認してください。');failure.code='profile_conflict';throw failure;}
          const next=normalise({...values,version:actualVersion+1,updatedAt:Date.now()});
          try{writeRecord(null,next);}catch(_){throw new Error('このブラウザに保存できませんでした。変更はまだ保存されていません。');}
          if(disposed||epoch!==sessionEpoch)return {ok:true,stale:true};committed=next;pendingRecord=null;
        }else{
          pendingRecord={accountId:owner,expectedVersion:context.version,values};cacheAccount();
          const result=await api('/profile',{method:'POST',data:{...values,expectedUserId:owner,expectedVersion:context.version}});
          if(disposed||epoch!==sessionEpoch||accountId!==owner)return {ok:true,stale:true};
          if(result.user?.id!==owner){const failure=new Error('保存先のアカウントを確認できませんでした。');failure.code='profile_identity_changed';throw failure;}
          committed=normalise(result.user);pendingRecord=null;cacheAccount();
        }
        editing=false;draft=null;editContext=null;draftDirty=false;toast(scope==='account'?'プロフィールをアカウントに保存しました。':'プロフィールをこのブラウザに保存しました。');return {ok:true,user:{...committed}};
      }catch(failure){
        if(disposed||epoch!==sessionEpoch||accountId!==owner)return {ok:false,stale:true,message:failure.message};
        error=failure.message;
        if(failure.code==='profile_conflict'&&failure.user?.id===owner){committed=normalise(failure.user);cacheAccount();}
        if(failure.code==='profile_identity_changed'||failure.status===401)mustResync=true;
        return {ok:false,message:error,code:failure.code};
      }
    })();savePromise=work;
    try{return await work;}finally{if(savePromise===work)savePromise=null;if(!disposed){saving=false;emit();render();if(mustResync)setTimeout(()=>{if(!disposed)void sync();},0);}}
  }
  function card(profile,{self=false,preview=false}={}){
    const status=preview?'プロフィールのプレビュー':self?(scope==='account'?'MACHI RESIDENT':'GUEST RESIDENT'):'MACHI RESIDENT';
    return `<article class="machi-profile-card" style="--profile-accent:${safeAccent(profile.accent)};--profile-accent-ink:${accentInk(profile.accent)}"><div class="profile-card-banner" aria-hidden="true"><span></span><i></i></div><div class="profile-card-content">${profileAvatarMarkup(profile,84)}<p class="profile-card-caption">${status}</p><h3>${esc(profile.name||'旅人')}</h3>${profile.title?`<span class="profile-title-badge">${esc(profile.title)}</span>`:''}${profile.tagline?`<p class="profile-tagline">${esc(profile.tagline)}</p>`:'<p class="profile-tagline placeholder">今日は、どんな一日にしよう。</p>'}<p class="profile-bio ${profile.bio?'':'placeholder'}">${esc(profile.bio||'まだ自己紹介はありません。')}</p>${profile.code?`<div class="profile-friend-code"><span>フレンドコード</span><strong>${esc(profile.code)}</strong></div>`:self?'<div class="profile-friend-code"><span>ゲストのプロフィール</span><strong>このブラウザでの暮らし</strong></div>':''}</div></article>`;
  }
  function render(){
    if(!isVisible())return;
    if(viewLoading){shell.innerHTML='<div class="profile-loading" role="status">プロフィールを確認しています…</div>';return;}
    if(viewedId&&!viewedProfile){shell.innerHTML=`<div class="profile-error" role="alert">${esc(error||'このプロフィールは表示できません。')}</div><button class="profile-btn" data-profile-action="own">自分のプロフィール</button>`;return;}
    const notice=error||storageError;
    if(viewedProfile){shell.innerHTML=`${card(viewedProfile)}<div class="profile-actions"><button class="profile-btn" data-profile-action="copy" data-code="${esc(viewedProfile.code)}">フレンドコードをコピー</button><button class="profile-btn quiet" data-profile-action="own">自分のプロフィール</button></div>${notice?`<p class="profile-error" role="alert">${esc(notice)}</p>`:''}`;return;}
    const busy=syncing||saving;
    if(editing){
      const value=draft||fields(committed);
      shell.innerHTML=`<div class="profile-editor"><div class="profile-edit-preview">${card({...committed,...value},{self:true,preview:true})}</div><form class="profile-form"><fieldset ${busy?'disabled':''}><label class="profile-label" for="profile-name">表示名<span data-count="name">${length(value.name)} / 24</span></label><input id="profile-name" name="name" type="text" value="${esc(value.name)}" maxlength="48" required autocomplete="off" aria-describedby="profile-name-note"><small id="profile-name-note" class="profile-field-note">ゲームの中で使う名前です。1〜24文字で入力できます。</small><label class="profile-label" for="profile-tagline">ひとこと<span data-count="tagline">${length(value.tagline)} / 60</span></label><input id="profile-tagline" name="tagline" type="text" value="${esc(value.tagline)}" maxlength="120" placeholder="例：気になる喫茶店を探しています" autocomplete="off"><label class="profile-label" for="profile-bio">自己紹介<span data-count="bio">${length(value.bio)} / 300</span></label><textarea id="profile-bio" name="bio" rows="4" maxlength="600" placeholder="好きな過ごし方や、この街でやってみたいこと">${esc(value.bio)}</textarea><label class="profile-label" for="profile-title">称号</label><select id="profile-title" name="title"><option value="" ${value.title===''?'selected':''}>表示しない</option>${PROFILE_TITLES.map(title=>`<option value="${title}" ${value.title===title?'selected':''}>${title}</option>`).join('')}</select><p class="profile-label">プロフィールアイコン</p><div class="profile-icon-picker" role="group" aria-label="プロフィールアイコン">${PROFILE_ICONS.map(icon=>`<button type="button" data-profile-icon="${icon.id}" class="${value.avatarIcon===icon.id?'selected':''}" aria-label="${icon.label}" aria-pressed="${value.avatarIcon===icon.id}">${profileIconMarkup(icon.id,26)}<span>${icon.label}</span></button>`).join('')}</div><p class="profile-label">アクセントカラー</p><div class="profile-color-picker" role="group" aria-label="アクセントカラー">${ACCENTS.map(color=>`<button type="button" data-profile-color="${color}" style="--swatch:${color}" class="${value.accent===color?'selected':''}" aria-label="${color}を選ぶ" aria-pressed="${value.accent===color}"></button>`).join('')}<label class="profile-custom-color">自由に選ぶ<input type="color" name="accent" value="${safeAccent(value.accent)}" aria-label="自由なアクセントカラー"></label></div><label class="profile-toggle"><span>キャラクターの頭上に名前を表示<small>チャットでは、表示名が引き続き使われます。</small></span><input type="checkbox" name="showName" ${value.showName?'checked':''}></label></fieldset><p class="profile-privacy">${scope==='account'?'表示名・紹介文・称号・アイコンは、ゲーム内のほかのプレイヤーが閲覧できます。ChatGPTの氏名やメールアドレスは自動公開しません。':'ゲストの編集内容は、このブラウザに保存します。ログイン先のプロフィールへ自動でコピーしません。'}</p>${notice?`<div class="profile-error" role="alert">${esc(notice)}</div>`:''}${editContext&&editContext.version!==committed.version?'<div class="profile-conflict"><span>保存先に新しいプロフィールがあります。</span><button type="button" data-profile-action="latest">最新の内容を読み込む</button></div>':''}<div class="profile-actions"><button type="submit" class="profile-btn primary" ${busy?'disabled':''}>${saving?'保存しています…':syncing?'アカウントを確認中…':scope==='account'?'プロフィールを保存':'このブラウザに保存'}</button><button type="button" class="profile-btn quiet" data-profile-action="cancel" ${saving?'disabled':''}>戻る</button></div></form></div>`;
    }else{
      shell.innerHTML=`${card(committed,{self:true})}<div class="profile-save-state"><span>${syncing?'保存先を確認しています…':scope==='account'?'アカウントのプロフィール':'このブラウザのゲストプロフィール'}</span>${pendingRecord?'<strong>未保存の編集があります</strong>':''}</div>${notice?`<div class="profile-error" role="alert">${esc(notice)}</div>`:''}<div class="profile-actions"><button class="profile-btn primary" data-profile-action="edit" ${busy?'disabled':''}>${pendingRecord?'編集の続きを開く':'プロフィールを編集'}</button>${committed.code?'<button class="profile-btn" data-profile-action="copy">コードをコピー</button>':''}<button class="profile-btn quiet" data-profile-action="sync" ${busy?'disabled':''}>保存先を再確認</button></div>${scope==='guest'?`<div class="profile-login"><p>ログインすると、自分のアカウントにプロフィールを保存できます。ゲストの内容とログイン後の内容は、それぞれ別に保管します。</p><a class="profile-btn" href="${ONLINE_ORIGIN}/signin-with-chatgpt?return_to=/" target="_top">${hosted?'ChatGPTでログイン':'オンライン版でログイン'}</a></div>`:''}`;
    }
  }
  function updatePreview(){
    if(!isVisible()||!draft)return;const preview=shell.querySelector('.profile-edit-preview');if(preview)preview.innerHTML=card({...committed,...draft},{self:true,preview:true});
    for(const key of ['name','tagline','bio']){const counter=shell.querySelector(`[data-count="${key}"]`);if(counter)counter.textContent=`${length(draft[key])} / ${{name:24,tagline:60,bio:300}[key]}`;}
    shell.querySelectorAll('[data-profile-icon]').forEach(button=>{const selected=button.dataset.profileIcon===draft.avatarIcon;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    shell.querySelectorAll('[data-profile-color]').forEach(button=>{const selected=button.dataset.profileColor===draft.accent;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    const color=shell.querySelector('[name="accent"]');if(color)color.value=draft.accent;
  }
  function onInput(event){
    if(!editing||!draft||event.isComposing)return;const input=event.target;if(!EDITABLE.includes(input.name))return;
    if(input.name==='showName')draft.showName=!!input.checked;else{const max={name:24,tagline:60,bio:300}[input.name];if(max&&length(input.value)>max)input.value=truncate(input.value,max);draft[input.name]=input.value;}
    draftDirty=true;updatePreview();
  }
  async function onClick(event){
    const button=event.target.closest('button');if(!button||!shell?.contains(button)||button.disabled)return;
    if(button.dataset.profileIcon&&draft){draft.avatarIcon=button.dataset.profileIcon;draftDirty=true;updatePreview();return;}
    if(button.dataset.profileColor&&draft){draft.accent=button.dataset.profileColor;draftDirty=true;updatePreview();return;}
    const action=button.dataset.profileAction;
    if(action==='edit'){beginEdit();error='';render();}
    if(action==='cancel'){editing=false;draft=null;editContext=null;error='';render();}
    if(action==='own')open();
    if(action==='sync')await sync();
    if(action==='latest'){pendingRecord=null;if(scope==='account')cacheAccount();beginEdit(false);error='';render();}
    if(action==='copy'){const code=button.dataset.code||committed.code;if(!code)return;try{await navigator.clipboard.writeText(code);toast('フレンドコードをコピーしました。');}catch(_){toast(`フレンドコード: ${code}`);}}
  }
  function mount(){
    if(typeof openPanel!=='function')throw new Error('プロフィール画面の表示先がありません。');
    const container=openPanel('あなたのプロフィール','A LIFE WITH YOUR NAME','<div class="machi-profile"></div>');shell=container?.querySelector('.machi-profile');
    if(!shell)throw new Error('プロフィール画面を開けませんでした。');visible=true;
    shell.addEventListener('click',onClick);shell.addEventListener('input',onInput);shell.addEventListener('change',onInput);shell.addEventListener('compositionend',onInput);
    shell.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))event.stopPropagation();});
    shell.addEventListener('submit',event=>{if(!event.target.matches('.profile-form'))return;event.preventDefault();if(draft&&editContext)void save({...draft},{context:{...editContext}});});
  }
  function open({edit=false}={}){
    if(disposed)return;viewEpoch++;viewedId=null;viewedProfile=null;viewLoading=false;editing=false;draftDirty=false;if(edit)beginEdit();mount();render();if(hosted)void sync();
  }
  async function view(userId){
    if(!userId||userId===committed.id){open();return;}
    if(disposed)return;const token=++viewEpoch;viewedId=String(userId);viewedProfile=null;viewLoading=true;editing=false;error='';mount();render();
    try{await sync();if(token!==viewEpoch||disposed)return;if(scope!=='account')throw new Error('ほかのプレイヤーのプロフィールを見るには、オンライン版でログインしてください。');const result=await api('/profile?userId='+encodeURIComponent(userId));if(token!==viewEpoch||disposed)return;viewedProfile=normalise(result.user);}
    catch(failure){if(token===viewEpoch&&!disposed)error=failure.message;}finally{if(token===viewEpoch&&!disposed){viewLoading=false;render();}}
  }
  function close(){visible=false;viewEpoch++;}
  function onFocus(){if(hosted&&Date.now()-lastSync>3000&&!disposed)void sync();}
  function onStorage(event){if(disposed)return;if(event.key===GUEST_KEY&&scope==='guest'){committed=loadGuest();emit();render();}else if(accountId&&event.key===keyFor(accountId))void sync();}
  function dispose(){disposed=true;visible=false;sessionEpoch++;viewEpoch++;for(const request of requests)request.abort();requests.clear();if(typeof window!=='undefined'){window.removeEventListener('focus',onFocus);window.removeEventListener('storage',onStorage);}shell=null;}
  if(typeof window!=='undefined'){window.addEventListener('focus',onFocus);window.addEventListener('storage',onStorage);}
  queueMicrotask(()=>{if(!disposed)emit();});
  return {open,view,getState,sync,save,close,dispose};
}
