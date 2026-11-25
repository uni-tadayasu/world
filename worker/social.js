// Authenticated community, messaging and opt-in WebRTC signalling for MACHI LIFE.
// The hosting gateway supplies identity. Client-submitted account IDs are ignored.
const PREFIX='/api/social';
const VOICE_TTL=45000;
const SIGNAL_TTL=120000;
const PUBLIC_FIELDS='id,code,name,tagline,bio,title,accent,avatar_icon,show_name,profile_version,updated_at';
const PROFILE_TITLES=new Set(['','街の住人','気ままな旅人','散歩好き','カフェ日和','本のある暮らし','部屋づくり好き','のんびり暮らし','街の探索者']);
const PROFILE_ICONS=new Set(['leaf','coffee','book','home','sun','moon','star','compass']);
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};

class HttpError extends Error{
  constructor(status,message,code='invalid_request'){super(message);this.status=status;this.code=code;}
}
const fail=(status,message,code)=>{throw new HttpError(status,message,code);};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const uuid=()=>crypto.randomUUID();
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const all=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results||[];
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();
const publicUser=row=>({id:row.id,code:row.code,name:Array.from(String(row.name||'旅人')).slice(0,24).join(''),title:PROFILE_TITLES.has(row.title)?row.title:'街の住人',accent:/^#[0-9a-f]{6}$/i.test(row.accent||'')?row.accent:'#2e6b54',avatarIcon:PROFILE_ICONS.has(row.avatar_icon)?row.avatar_icon:'leaf'});
const publicProfile=row=>({...publicUser(row),tagline:row.tagline||'',bio:row.bio||''});
const ownProfile=row=>({...publicProfile(row),showName:row.show_name!==0,version:Number(row.profile_version||0),updatedAt:Number(row.updated_at||0)});
const pair=(a,b)=>a<b?[a,b]:[b,a];
const changed=result=>Number(result?.meta?.changes||0)>0;
const blockedSQL='NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?))';
const blockedParams=(a,b)=>[a,b,b,a];

function string(value,label,min,max){
  if(typeof value!=='string')fail(400,`${label}を入力してください。`);
  const cleaned=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  const length=Array.from(cleaned).length;
  if(length<min||length>max)fail(400,`${label}は${min}〜${max}文字で入力してください。`);
  return cleaned;
}
function identifier(value,label='ID'){
  if(typeof value!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(value))fail(400,`${label}が正しくありません。`);
  return value;
}
function numericId(value){
  const number=Number(value||0);
  if(!Number.isSafeInteger(number)||number<0)fail(400,'メッセージIDが正しくありません。');
  return number;
}
async function body(request,maxBytes=16384){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'JSON形式で送信してください。');
  if(Number(request.headers.get('Content-Length'))>maxBytes)fail(413,'送信するデータが大きすぎます。');
  const reader=request.body?.getReader();
  if(!reader)fail(400,'送信データがありません。');
  const chunks=[];let length=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();fail(413,'送信するデータが大きすぎます。');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const combined=new Uint8Array(length);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  let parsed;try{parsed=JSON.parse(new TextDecoder().decode(combined));}catch(_){fail(400,'送信データを読み取れませんでした。');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(400,'送信データが正しくありません。');
  return parsed;
}
async function profile(db,authId){
  let user=await first(db,`SELECT ${PUBLIC_FIELDS} FROM profiles WHERE auth_id=?`,authId);
  if(user)return ownProfile(user);
  for(let attempt=0;attempt<3;attempt++){
    const now=Date.now();
    await run(db,'INSERT OR IGNORE INTO profiles(id,auth_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',uuid(),authId,'M-'+uuid().replace(/-/g,'').slice(0,10).toUpperCase(),'旅人',now,now);
    user=await first(db,`SELECT ${PUBLIC_FIELDS} FROM profiles WHERE auth_id=?`,authId);
    if(user)return ownProfile(user);
  }
  fail(503,'プロフィールを作成できませんでした。もう一度お試しください。','profile_unavailable');
}

function normalizeChannel(raw,userId){
  if(raw==='global')return {key:'global',raw,kind:'global',acl:'1',params:[]};
  if(typeof raw!=='string')fail(400,'会話を選択してください。');
  if(raw.startsWith('dm:')){
    const peerId=identifier(raw.slice(3),'相手のID');
    if(peerId===userId)fail(400,'自分自身との個別会話は作成できません。');
    const [a,b]=pair(userId,peerId);
    return {key:`dm:${a}:${b}`,raw,kind:'dm',peerId,acl:`EXISTS(SELECT 1 FROM friends WHERE user_a=? AND user_b=? AND status='accepted') AND ${blockedSQL}`,params:[a,b,...blockedParams(userId,peerId)]};
  }
  if(raw.startsWith('org:')){
    const orgId=identifier(raw.slice(4),'組織のID');
    return {key:`org:${orgId}`,raw,kind:'org',orgId,acl:'EXISTS(SELECT 1 FROM members WHERE org_id=? AND user_id=?)',params:[orgId,userId]};
  }
  fail(400,'この会話は利用できません。');
}
async function authorizeChannel(db,raw,userId){
  const channel=normalizeChannel(raw,userId);
  const allowed=await first(db,`SELECT 1 AS allowed WHERE ${channel.acl}`,...channel.params);
  if(!allowed)fail(403,channel.kind==='dm'?'友だちになっている相手との会話だけ利用できます。':'この組織に参加すると会話を利用できます。','channel_forbidden');
  return channel;
}
function recipientAccess(channel,to){
  if(channel.kind==='org')return {sql:'EXISTS(SELECT 1 FROM members WHERE org_id=? AND user_id=?)',params:[channel.orgId,to]};
  if(channel.kind==='dm')return {sql:'?=?',params:[to,channel.peerId]};
  return {sql:'1',params:[]};
}
function message(row,channel,userId){
  return {id:row.id,channel,text:row.text,createdAt:row.created_at,user:publicUser({...row,id:row.sender_id}),mine:row.sender_id===userId};
}
function organization(row){return {id:row.id,name:row.name,description:row.description,ownerId:row.owner_id,memberCount:Number(row.member_count||0),joined:!!row.role,role:row.role||null};}
async function listOrganizations(db,userId,joinedOnly=false){
  const rows=await all(db,`SELECT o.*,m.role,(SELECT COUNT(*) FROM members c WHERE c.org_id=o.id) AS member_count FROM organizations o LEFT JOIN members m ON m.org_id=o.id AND m.user_id=? ${joinedOnly?'WHERE m.user_id IS NOT NULL':''} ORDER BY o.created_at DESC LIMIT 50`,userId);
  return rows.map(organization);
}
async function state(db,user){
  const [rows,organizations,blocks]=await Promise.all([
    all(db,`SELECT f.*,p.id AS other_id,p.code,p.name,p.title,p.accent,p.avatar_icon FROM friends f JOIN profiles p ON p.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE f.user_a=? OR f.user_b=? ORDER BY f.updated_at DESC LIMIT 200`,user.id,user.id,user.id),
    listOrganizations(db,user.id,true),
    all(db,`SELECT p.id,p.code,p.name FROM blocks b JOIN profiles p ON p.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC LIMIT 100`,user.id),
  ]);
  const friends={incoming:[],outgoing:[],accepted:[]};
  for(const row of rows){const entry={requestId:row.id,user:publicUser({...row,id:row.other_id}),createdAt:row.created_at};friends[row.status==='accepted'?'accepted':row.recipient_id===user.id?'incoming':'outgoing'].push(entry);}
  return {user,friends,organizations,blocks};
}
async function voicePeers(db,channel,userId,now){
  const membership=channel.kind==='org'?'AND EXISTS(SELECT 1 FROM members m WHERE m.org_id=? AND m.user_id=v.user_id)':channel.kind==='dm'?'AND (v.user_id=? OR v.user_id=?)':'';
  const membershipParams=channel.kind==='org'?[channel.orgId]:channel.kind==='dm'?[userId,channel.peerId]:[];
  const rows=await all(db,`SELECT p.id,p.code,p.name,p.title,p.accent,p.avatar_icon FROM voice_members v JOIN profiles p ON p.id=v.user_id WHERE v.channel=? AND v.updated_at>=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=v.user_id) OR (b.blocker_id=v.user_id AND b.blocked_id=?)) ${membership} ORDER BY v.user_id LIMIT 4`,channel.key,now-VOICE_TTL,userId,userId,...membershipParams);
  return rows.map(publicUser);
}
async function cleanupSignals(db,now){
  await db.batch([
    db.prepare('DELETE FROM signals WHERE id IN(SELECT id FROM signals WHERE created_at<? ORDER BY id LIMIT 200)').bind(now-SIGNAL_TTL),
    db.prepare('DELETE FROM voice_members WHERE rowid IN(SELECT rowid FROM voice_members WHERE updated_at<? LIMIT 100)').bind(now-VOICE_TTL),
  ]);
}

function roomLayout(value){
  const colors=/^#[0-9a-fA-F]{6}$/;
  const object=item=>item&&typeof item==='object'&&!Array.isArray(item);
  if(!object(value)||value.version!==1||typeof value.floor!=='string'||typeof value.wall!=='string'||!colors.test(value.floor)||!colors.test(value.wall)||!Array.isArray(value.items)||value.items.length>80)fail(400,'部屋はバージョン1の形式で、壁・床の色と80点以内の家具を指定してください。','invalid_room');
  if(Object.keys(value).some(key=>!['version','floor','wall','items','cleanliness','lights'].includes(key)))fail(400,'部屋のデータに対応していない項目があります。','invalid_room');
  if(value.cleanliness!==undefined&&(typeof value.cleanliness!=='number'||!Number.isFinite(value.cleanliness)||value.cleanliness<0||value.cleanliness>100))fail(400,'部屋の清潔さは0〜100で指定してください。','invalid_room');
  if(value.lights!==undefined&&typeof value.lights!=='boolean')fail(400,'照明の設定が正しくありません。','invalid_room');
  const types=new Set(['sofa','table','chair','bed','desk','shelf','plant','lamp','rug','cabinet']);
  const seen=new Set();
  const items=value.items.map(item=>{
    if(!object(item)||Object.keys(item).some(key=>!['id','type','x','z','rotation','color'].includes(key)))fail(400,'家具のデータ形式が正しくありません。','invalid_room');
    const id=string(item.id,'家具ID',1,60);
    if(seen.has(id)||!types.has(item.type)||typeof item.x!=='number'||!Number.isFinite(item.x)||Math.abs(item.x)>6.5||typeof item.z!=='number'||!Number.isFinite(item.z)||Math.abs(item.z)>7.5||typeof item.rotation!=='number'||!Number.isFinite(item.rotation)||item.rotation<0||item.rotation>Math.PI*2||typeof item.color!=='string'||!colors.test(item.color))fail(400,'家具のID・種類・位置・角度・色を確認してください。','invalid_room');
    seen.add(id);
    return {id,type:item.type,x:item.x,z:item.z,rotation:item.rotation,color:item.color.toLowerCase()};
  });
  const layout={version:1,floor:value.floor.toLowerCase(),wall:value.wall.toLowerCase(),items};
  if(value.cleanliness!==undefined)layout.cleanliness=value.cleanliness;
  if(value.lights!==undefined)layout.lights=value.lights;
  return layout;
}

function belongings(value){
  if(!Array.isArray(value)||value.length>100)fail(400,'所有物は100点以内で指定してください。','invalid_belongings');
  const types=new Set(['sofa','table','chair','bed','desk','shelf','plant','lamp','rug','cabinet']);const seen=new Set();
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id','type','name','color','condition','stored'].includes(key)))fail(400,'所有物のデータ形式が正しくありません。','invalid_belongings');
    const id=string(item.id,'所有物ID',1,80),name=string(item.name,'所有物の名前',1,50);
    if(seen.has(id)||!types.has(item.type)||typeof item.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(item.color)||typeof item.condition!=='number'||!Number.isFinite(item.condition)||item.condition<0||item.condition>100||typeof item.stored!=='boolean')fail(400,'所有物のID・種類・色・状態・保管設定を確認してください。','invalid_belongings');
    seen.add(id);return {id,type:item.type,name,color:item.color.toLowerCase(),condition:item.condition,stored:item.stored};
  });
}

/** Returns null for URLs outside /api/social, otherwise an authenticated JSON API response. */
export async function handleSocial(request,env){
  const url=new URL(request.url);
  if(url.pathname!==PREFIX&&!url.pathname.startsWith(PREFIX+'/'))return null;
  const path=url.pathname.slice(PREFIX.length)||'/';
  const method=request.method.toUpperCase();
  try{
    if(!['GET','POST','DELETE'].includes(method))fail(405,'この操作は利用できません。','method_not_allowed');
    if(method!=='GET'){
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)fail(403,'このサイト内から操作してください。','origin_forbidden');
      if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'このサイト内から操作してください。','origin_forbidden');
    }
    const authId=request.headers.get('oai-authenticated-user-id');
    if(!authId){if(path==='/me'&&method==='GET')return json({signedIn:false});fail(401,'ChatGPTでログインすると交流機能を利用できます。','auth_required');}
    if(authId.length>256)fail(401,'ログイン情報を確認できませんでした。','auth_required');
    const db=env?.DB;
    if(!db?.prepare||!db?.batch)fail(503,'交流機能のデータベースを準備しています。少し後にもう一度お試しください。','database_unavailable');
    const user=await profile(db,authId);
    const now=Date.now();

    if(path==='/me'&&method==='GET')return json({signedIn:true,user});
    if(path==='/home'&&method==='GET'){
      const saved=await first(db,'SELECT layout_json,updated_at FROM player_rooms WHERE user_id=?',user.id);
      return json({layout:saved?JSON.parse(saved.layout_json):null,updatedAt:saved?.updated_at??null});
    }
    if(path==='/home'&&method==='POST'){
      const data=await body(request,32768);const layout=roomLayout(data.layout);
      await run(db,'INSERT INTO player_rooms(user_id,layout_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET layout_json=excluded.layout_json,updated_at=excluded.updated_at',user.id,JSON.stringify(layout),now);
      return json({ok:true,layout,updatedAt:now});
    }
    if(path==='/belongings'&&method==='GET'){
      const saved=await first(db,'SELECT data_json,updated_at FROM player_belongings WHERE user_id=?',user.id);
      return json({items:saved?JSON.parse(saved.data_json):[],updatedAt:saved?.updated_at??null});
    }
    if(path==='/belongings'&&method==='POST'){
      const data=await body(request,65536);const items=belongings(data.items);
      await run(db,'INSERT INTO player_belongings(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at',user.id,JSON.stringify(items),now);
      return json({ok:true,items,updatedAt:now});
    }
    if(path==='/profile'&&method==='GET'){
      const requested=url.searchParams.get('userId');
      if(!requested||requested===user.id)return json({user,isSelf:true,signedIn:true});
      const id=identifier(requested,'プロフィールID');
      const other=await first(db,`SELECT ${PUBLIC_FIELDS} FROM profiles WHERE id=? AND ${blockedSQL}`,id,...blockedParams(user.id,id));
      if(!other)fail(404,'このプロフィールは表示できません。','profile_not_found');
      return json({user:publicProfile(other),isSelf:false});
    }
    if(path==='/profile'&&method==='POST'){
      const data=await body(request);
      // The expected ID is a session-change guard, never an ownership selector.
      if(data.expectedUserId!==undefined&&data.expectedUserId!==user.id)fail(409,'ログイン中のアカウントが変わりました。現在のプロフィールを確認してください。','profile_identity_changed');
      const expected=data.expectedVersion===undefined?user.version:data.expectedVersion;
      if(!Number.isSafeInteger(expected)||expected<0)fail(400,'プロフィールの保存状態を確認できません。','invalid_profile_version');
      const next={name:user.name,tagline:user.tagline,bio:user.bio,title:user.title,accent:user.accent,avatarIcon:user.avatarIcon,showName:user.showName};
      if(data.name!==undefined)next.name=string(typeof data.name==='string'?data.name.replace(/\s+/g,' '):data.name,'表示名',1,24);
      if(data.tagline!==undefined)next.tagline=string(typeof data.tagline==='string'?data.tagline.replace(/\s+/g,' '):data.tagline,'ひとこと',0,60);
      if(data.bio!==undefined)next.bio=string(typeof data.bio==='string'?data.bio.replace(/\r\n?/g,'\n'):data.bio,'自己紹介',0,300);
      if(data.title!==undefined){if(!PROFILE_TITLES.has(data.title))fail(400,'用意された称号から選んでください。','invalid_profile_title');next.title=data.title;}
      if(data.accent!==undefined){if(typeof data.accent!=='string'||!/^#[0-9a-f]{6}$/i.test(data.accent))fail(400,'アクセントカラーが正しくありません。','invalid_profile_accent');next.accent=data.accent.toLowerCase();}
      if(data.avatarIcon!==undefined){if(!PROFILE_ICONS.has(data.avatarIcon))fail(400,'用意されたアイコンから選んでください。','invalid_profile_icon');next.avatarIcon=data.avatarIcon;}
      if(data.showName!==undefined){if(typeof data.showName!=='boolean')fail(400,'頭上ネームの設定が正しくありません。','invalid_profile_visibility');next.showName=data.showName;}
      const result=await run(db,'UPDATE profiles SET name=?,tagline=?,bio=?,title=?,accent=?,avatar_icon=?,show_name=?,profile_version=profile_version+1,updated_at=? WHERE id=? AND profile_version=?',next.name,next.tagline,next.bio,next.title,next.accent,next.avatarIcon,next.showName?1:0,now,user.id,expected);
      const saved=await first(db,`SELECT ${PUBLIC_FIELDS} FROM profiles WHERE id=?`,user.id);
      if(!changed(result))return json({error:'別の画面でプロフィールが更新されています。最新の内容を確認してから保存してください。',code:'profile_conflict',user:ownProfile(saved)},409);
      return json({user:ownProfile(saved)});
    }
    if(path==='/state'&&method==='GET')return json(await state(db,user));
    if(path==='/users'&&method==='GET'){
      const q=string(url.searchParams.get('q'),'検索する名前またはコード',3,64);
      const users=await all(db,`SELECT p.id,p.code,p.name,p.title,p.accent,p.avatar_icon FROM profiles p WHERE p.id<>? AND (UPPER(p.code)=UPPER(?) OR p.name=?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.id) OR (b.blocker_id=p.id AND b.blocked_id=?)) ORDER BY p.created_at LIMIT 20`,user.id,q,q,user.id,user.id);
      return json({users:users.map(publicUser)});
    }
    if(path==='/friends/request'&&method==='POST'){
      const data=await body(request);const code=string(data.code,'友だちコード',3,32).toUpperCase();
      const other=await first(db,`SELECT ${PUBLIC_FIELDS} FROM profiles WHERE UPPER(code)=?`,code);
      if(!other||other.id===user.id)fail(404,'その友だちコードは見つかりません。','user_not_found');
      if(!await first(db,`SELECT 1 WHERE ${blockedSQL}`,...blockedParams(user.id,other.id)))fail(403,'この相手には友だち申請を送信できません。','user_unavailable');
      const [a,b]=pair(user.id,other.id);
      await db.batch([
        db.prepare(`UPDATE friends SET status='accepted',updated_at=? WHERE user_a=? AND user_b=? AND status='pending' AND recipient_id=? AND ${blockedSQL}`).bind(now,a,b,user.id,...blockedParams(user.id,other.id)),
        db.prepare(`INSERT OR IGNORE INTO friends(id,user_a,user_b,requester_id,recipient_id,status,created_at,updated_at) SELECT ?,?,?,?,?,'pending',?,? WHERE ${blockedSQL} AND (SELECT COUNT(*) FROM friends WHERE requester_id=? AND status='pending')<30 AND (SELECT COUNT(*) FROM friends WHERE (user_a=? OR user_b=?) AND status='accepted')<100`).bind(uuid(),a,b,user.id,other.id,now,now,...blockedParams(user.id,other.id),user.id,user.id,user.id),
      ]);
      const friendship=await first(db,'SELECT status FROM friends WHERE user_a=? AND user_b=?',a,b);
      if(!friendship)fail(409,'友だち申請の上限です。送信中の申請を整理してからお試しください。','friend_limit');
      return json({ok:true,status:friendship.status});
    }
    if(path==='/friends/respond'&&method==='POST'){
      const data=await body(request);const requestId=identifier(data.requestId,'申請ID');
      if(typeof data.accept!=='boolean')fail(400,'承認するかどうかを選んでください。');
      const pending=await first(db,"SELECT * FROM friends WHERE id=? AND recipient_id=? AND status='pending'",requestId,user.id);
      if(!pending)fail(404,'その申請は見つからないか、すでに処理されています。','request_not_found');
      if(data.accept){
        const result=await run(db,`UPDATE friends SET status='accepted',updated_at=? WHERE id=? AND recipient_id=? AND status='pending' AND ${blockedSQL} AND (SELECT COUNT(*) FROM friends WHERE (user_a=? OR user_b=?) AND status='accepted')<100`,now,requestId,user.id,...blockedParams(user.id,pending.requester_id),user.id,user.id);
        if(!changed(result))fail(409,'この申請を承認できません。相手の状態や友だち数を確認してください。','request_unavailable');
      }else await run(db,"DELETE FROM friends WHERE id=? AND recipient_id=? AND status='pending'",requestId,user.id);
      return json({ok:true});
    }
    if(path==='/friends/remove'&&method==='POST'){
      const data=await body(request);const other=identifier(data.userId,'相手のID');const [a,b]=pair(user.id,other);
      await db.batch([
        db.prepare('DELETE FROM friends WHERE user_a=? AND user_b=?').bind(a,b),
        db.prepare('DELETE FROM voice_members WHERE channel=?').bind(`dm:${a}:${b}`),
        db.prepare('DELETE FROM signals WHERE channel=?').bind(`dm:${a}:${b}`),
      ]);
      return json({ok:true});
    }
    if(path==='/organizations'&&method==='GET')return json({organizations:await listOrganizations(db,user.id)});
    if(path==='/organizations'&&method==='POST'){
      const data=await body(request);const name=string(data.name,'組織名',2,40);const description=string(data.description??'','説明',0,240);const id=uuid();
      await db.batch([
        db.prepare('INSERT INTO organizations(id,name,description,owner_id,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM organizations WHERE owner_id=?)<5 AND (SELECT COUNT(*) FROM members WHERE user_id=?)<20').bind(id,name,description,user.id,now,user.id,user.id),
        db.prepare("INSERT INTO members(org_id,user_id,role,created_at) SELECT ?,?,'owner',? WHERE EXISTS(SELECT 1 FROM organizations WHERE id=? AND owner_id=?)").bind(id,user.id,now,id,user.id),
      ]);
      const row=await first(db,"SELECT o.*,'owner' AS role,1 AS member_count FROM organizations o WHERE id=? AND owner_id=?",id,user.id);
      if(!row)fail(409,'作成は5組織、参加は20組織までです。参加中の組織を整理してください。','organization_limit');
      return json({organization:organization(row)},201);
    }
    if(path==='/organizations/join'&&method==='POST'){
      const data=await body(request);const id=identifier(data.id,'組織ID');
      if(!await first(db,'SELECT id FROM organizations WHERE id=?',id))fail(404,'この組織は見つかりません。','organization_not_found');
      await run(db,"INSERT OR IGNORE INTO members(org_id,user_id,role,created_at) SELECT ?,?,'member',? WHERE EXISTS(SELECT 1 FROM organizations WHERE id=?) AND (SELECT COUNT(*) FROM members WHERE org_id=?)<100 AND (SELECT COUNT(*) FROM members WHERE user_id=?)<20",id,user.id,now,id,id,user.id);
      if(!await first(db,'SELECT user_id FROM members WHERE org_id=? AND user_id=?',id,user.id))fail(409,'この組織の参加上限か、参加できる組織数の上限に達しています。','membership_limit');
      return json({ok:true});
    }
    if(path==='/organizations/leave'&&method==='POST'){
      const data=await body(request);const id=identifier(data.id,'組織ID');const channel='org:'+id;
      if(!await first(db,'SELECT role FROM members WHERE org_id=? AND user_id=?',id,user.id))fail(404,'この組織には参加していません。','membership_not_found');
      await db.batch([
        db.prepare('UPDATE organizations SET owner_id=(SELECT user_id FROM members WHERE org_id=? AND user_id<>? ORDER BY created_at,user_id LIMIT 1) WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM members WHERE org_id=? AND user_id<>?)').bind(id,user.id,id,user.id,id,user.id),
        db.prepare("UPDATE members SET role=CASE WHEN user_id=(SELECT owner_id FROM organizations WHERE id=?) THEN 'owner' ELSE 'member' END WHERE org_id=?").bind(id,id),
        db.prepare('DELETE FROM members WHERE org_id=? AND user_id=? AND (EXISTS(SELECT 1 FROM organizations WHERE id=? AND owner_id<>?) OR NOT EXISTS(SELECT 1 FROM members other WHERE other.org_id=? AND other.user_id<>?))').bind(id,user.id,id,user.id,id,user.id),
        db.prepare('DELETE FROM voice_members WHERE channel=? AND user_id=?').bind(channel,user.id),
        db.prepare('DELETE FROM signals WHERE channel=? AND (from_id=? OR to_id=?)').bind(channel,user.id,user.id),
        db.prepare('DELETE FROM organizations WHERE id=? AND NOT EXISTS(SELECT 1 FROM members WHERE org_id=?)').bind(id,id),
        db.prepare('DELETE FROM messages WHERE channel=? AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=?)').bind(channel,id),
        db.prepare('DELETE FROM voice_members WHERE channel=? AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=?)').bind(channel,id),
      ]);
      return json({ok:true});
    }
    const membersMatch=path.match(/^\/organizations\/([A-Za-z0-9-]{1,80})\/members$/);
    if(membersMatch&&method==='GET'){
      const id=membersMatch[1];await authorizeChannel(db,'org:'+id,user.id);
      const members=await all(db,'SELECT p.id,p.code,p.name,p.title,p.accent,p.avatar_icon,m.role FROM members m JOIN profiles p ON p.id=m.user_id WHERE m.org_id=? ORDER BY CASE WHEN m.role=\'owner\' THEN 0 ELSE 1 END,m.created_at,p.id LIMIT 100',id);
      return json({members:members.map(member=>({...publicUser(member),role:member.role}))});
    }
    if(path==='/messages'&&method==='GET'){
      const channel=await authorizeChannel(db,url.searchParams.get('channel')||'global',user.id);const since=numericId(url.searchParams.get('since'));
      const rows=await all(db,`SELECT m.*,p.code,p.name,p.title,p.accent,p.avatar_icon FROM messages m JOIN profiles p ON p.id=m.sender_id WHERE m.channel=? AND m.id>? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=m.sender_id) OR (b.blocker_id=m.sender_id AND b.blocked_id=?)) ORDER BY m.id ${since?'ASC':'DESC'} LIMIT ${since?100:50}`,channel.key,since,user.id,user.id);
      if(!since)rows.reverse();
      return json({messages:rows.map(row=>message(row,channel.raw,user.id))});
    }
    if(path==='/messages'&&method==='POST'){
      const data=await body(request);const text=string(data.text,'メッセージ',1,500);const channel=await authorizeChannel(db,url.searchParams.get('channel')||'global',user.id);
      const result=await run(db,`INSERT INTO messages(channel,sender_id,text,created_at) SELECT ?,?,?,? WHERE ${channel.acl} AND (SELECT COUNT(*) FROM messages WHERE sender_id=? AND created_at>?)<8`,channel.key,user.id,text,now,...channel.params,user.id,now-30000);
      if(!changed(result)){
        await authorizeChannel(db,channel.raw,user.id);
        fail(429,'送信が続いています。30秒ほど待ってから送信してください。','message_rate_limit');
      }
      const row=await first(db,'SELECT m.*,p.code,p.name,p.title,p.accent,p.avatar_icon FROM messages m JOIN profiles p ON p.id=m.sender_id WHERE m.id=?',result.meta.last_row_id);
      return json({message:message(row,channel.raw,user.id)},201);
    }
    if(path==='/block'&&(method==='POST'||method==='DELETE')){
      const data=await body(request);const other=identifier(data.userId,'相手のID');if(other===user.id)fail(400,'自分自身はブロックできません。');
      if(method==='DELETE'){await run(db,'DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?',user.id,other);return json({ok:true});}
      if(!await first(db,'SELECT id FROM profiles WHERE id=?',other))fail(404,'この相手は見つかりません。','user_not_found');
      const [a,b]=pair(user.id,other);
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').bind(user.id,other,now),
        db.prepare('DELETE FROM friends WHERE user_a=? AND user_b=?').bind(a,b),
        db.prepare('DELETE FROM signals WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').bind(user.id,other,other,user.id),
        db.prepare('DELETE FROM voice_members WHERE channel=?').bind(`dm:${a}:${b}`),
      ]);
      return json({ok:true});
    }
    if(path==='/report'&&method==='POST'){
      const data=await body(request);const messageId=numericId(data.messageId);const reason=string(data.reason,'通報理由',5,500);
      const reported=await first(db,'SELECT * FROM messages WHERE id=?',messageId);if(!reported)fail(404,'このメッセージは見つかりません。','message_not_found');
      let raw=reported.channel;
      if(raw.startsWith('dm:')){const ids=raw.slice(3).split(':');if(!ids.includes(user.id))fail(403,'このメッセージを通報する権限がありません。','channel_forbidden');raw='dm:'+ids.find(id=>id!==user.id);}
      await authorizeChannel(db,raw,user.id);
      await run(db,'INSERT OR IGNORE INTO reports(id,reporter_id,message_id,reported_user_id,message_snapshot,reason,created_at) VALUES(?,?,?,?,?,?,?)',uuid(),user.id,messageId,reported.sender_id,reported.text,reason,now);
      return json({ok:true});
    }
    if(path==='/voice/join'&&method==='POST'){
      const data=await body(request);const channel=await authorizeChannel(db,data.channel||'global',user.id);
      await cleanupSignals(db,now);
      const results=await db.batch([
        db.prepare(`INSERT INTO voice_members(channel,user_id,updated_at) SELECT ?,?,? WHERE ${channel.acl} AND ((SELECT COUNT(*) FROM voice_members WHERE channel=? AND updated_at>=?)<4 OR EXISTS(SELECT 1 FROM voice_members WHERE channel=? AND user_id=? AND updated_at>=?)) ON CONFLICT(channel,user_id) DO UPDATE SET updated_at=excluded.updated_at`).bind(channel.key,user.id,now,...channel.params,channel.key,now-VOICE_TTL,channel.key,user.id,now-VOICE_TTL),
        db.prepare('DELETE FROM voice_members WHERE user_id=? AND channel<>? AND EXISTS(SELECT 1 FROM voice_members current WHERE current.channel=? AND current.user_id=? AND current.updated_at=?)').bind(user.id,channel.key,channel.key,user.id,now),
        db.prepare('DELETE FROM signals WHERE channel=? AND (from_id=? OR to_id=?) AND EXISTS(SELECT 1 FROM voice_members current WHERE current.channel=? AND current.user_id=? AND current.updated_at=?)').bind(channel.key,user.id,user.id,channel.key,user.id,now),
      ]);
      if(!changed(results[0])){await authorizeChannel(db,channel.raw,user.id);fail(409,'この通話は4人までです。空きができてから参加してください。','voice_full');}
      return json({channel:channel.raw,peers:await voicePeers(db,channel,user.id,now)});
    }
    if(path==='/voice/leave'&&method==='POST'){
      const data=await body(request);const channel=normalizeChannel(data.channel||'global',user.id);
      // Leaving is allowed after membership removal too: it only deletes this user's presence.
      await db.batch([
        db.prepare('DELETE FROM voice_members WHERE channel=? AND user_id=?').bind(channel.key,user.id),
        db.prepare('DELETE FROM signals WHERE channel=? AND (from_id=? OR to_id=?)').bind(channel.key,user.id,user.id),
      ]);
      return json({ok:true});
    }
    if(path==='/voice/poll'&&method==='GET'){
      const channel=await authorizeChannel(db,url.searchParams.get('channel')||'global',user.id);const since=numericId(url.searchParams.get('since'));
      const pulse=await run(db,`UPDATE voice_members SET updated_at=? WHERE channel=? AND user_id=? AND updated_at>=? AND ${channel.acl}`,now,channel.key,user.id,now-VOICE_TTL,...channel.params);
      if(!changed(pulse))fail(409,'通話への接続が切れました。もう一度参加してください。','voice_expired');
      const peers=await voicePeers(db,channel,user.id,now);
      const allowed=peers.filter(peer=>peer.id!==user.id).map(peer=>peer.id);
      const rows=allowed.length?await all(db,`SELECT id,from_id,type,data,created_at FROM signals WHERE channel=? AND to_id=? AND id>? AND created_at>=? AND from_id IN(${allowed.map(()=>'?').join(',')}) ORDER BY id LIMIT 60`,channel.key,user.id,since,now-SIGNAL_TTL,...allowed):[];
      const signals=rows.map(row=>({id:row.id,from:row.from_id,type:row.type,data:JSON.parse(row.data),createdAt:row.created_at}));
      return json({peers,signals,lastSignalId:signals.length?signals[signals.length-1].id:since});
    }
    if(path==='/voice/signal'&&method==='POST'){
      const data=await body(request,140000);const channel=await authorizeChannel(db,data.channel||'global',user.id);const to=identifier(data.to,'相手のID');
      if(to===user.id)fail(400,'自分自身には通話信号を送信できません。');
      const type=data.type;if(!['offer','answer','ice'].includes(type))fail(400,'通話信号の種類が正しくありません。');
      if(!data.data||typeof data.data!=='object'||Array.isArray(data.data))fail(400,'通話信号が正しくありません。');
      let signal;
      if(type==='offer'||type==='answer'){
        if(data.data.type!==type||typeof data.data.sdp!=='string'||!data.data.sdp.length||data.data.sdp.length>120000)fail(400,'通話の接続情報が正しくありません。');
        signal={type,sdp:data.data.sdp};
      }else{
        if(typeof data.data.candidate!=='string'||data.data.candidate.length>8192)fail(400,'通話の経路情報が正しくありません。');
        const mid=data.data.sdpMid,index=data.data.sdpMLineIndex,fragment=data.data.usernameFragment;
        if(mid!=null&&(typeof mid!=='string'||mid.length>80))fail(400,'通話の経路情報が正しくありません。');
        if(index!=null&&(!Number.isInteger(index)||index<0||index>64))fail(400,'通話の経路情報が正しくありません。');
        if(fragment!=null&&(typeof fragment!=='string'||fragment.length>256))fail(400,'通話の経路情報が正しくありません。');
        signal={candidate:data.data.candidate,sdpMid:mid??null,sdpMLineIndex:index??null};if(fragment!=null)signal.usernameFragment=fragment;
      }
      const encoded=JSON.stringify(signal);if(new TextEncoder().encode(encoded).byteLength>131072)fail(413,'通話信号が大きすぎます。');
      await cleanupSignals(db,now);
      const recipient=recipientAccess(channel,to);
      const result=await run(db,`INSERT INTO signals(channel,from_id,to_id,type,data,created_at) SELECT ?,?,?,?,?,? WHERE ${channel.acl} AND ${recipient.sql} AND ${blockedSQL} AND EXISTS(SELECT 1 FROM voice_members WHERE channel=? AND user_id=? AND updated_at>=?) AND EXISTS(SELECT 1 FROM voice_members WHERE channel=? AND user_id=? AND updated_at>=?) AND (SELECT COUNT(*) FROM signals WHERE from_id=? AND created_at>?)<120`,channel.key,user.id,to,type,encoded,now,...channel.params,...recipient.params,...blockedParams(user.id,to),channel.key,user.id,now-VOICE_TTL,channel.key,to,now-VOICE_TTL,user.id,now-30000);
      if(!changed(result)){
        const count=await first(db,'SELECT COUNT(*) AS total FROM signals WHERE from_id=? AND created_at>?',user.id,now-30000);
        if(Number(count?.total)>=120)fail(429,'通話信号の送信が続いています。少し待って再接続してください。','signal_rate_limit');
        fail(403,'相手が通話を退出したか、この通話を利用できなくなりました。','signal_forbidden');
      }
      return json({ok:true});
    }
    fail(404,'この交流機能は見つかりません。','not_found');
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message,code:error.code},error.status);
    console.error('MACHI social service error:',error?.name||'Error');
    return json({error:'交流サービスに接続できませんでした。少し待ってからもう一度お試しください。',code:'service_error'},503);
  }
}
