// MACHI LIFE — deterministic, browser-local daily life simulation.
const SAVE_KEY = 'machi.life.v1';
const BACKUP_KEY = `${SAVE_KEY}.backup`;
// The visible clock follows the device's real local time, including after resume.
const GAME_MINUTES_PER_SECOND = 1 / 60;
const DAY_MINUTES = 1440;
const MAX_MONEY = 999999999;

const ITEMS = {
  onigiri: {name:'鮭のおにぎり', hunger:24, energy:2, mood:3, minutes:5, consumable:true},
  lunchbox: {name:'彩り弁当', hunger:48, energy:6, mood:7, minutes:15, consumable:true},
  water: {name:'ミネラルウォーター', hunger:3, energy:7, mood:3, minutes:2, consumable:true},
  groceries: {name:'今日の食材', consumable:false},
  book: {name:'街と暮らしのエッセイ', consumable:false},
};

const GOALS = [
  {id:'cafe_first',title:'お気に入りのカフェを見つける',description:'街のカフェに入ってみましょう。',reward:200,buildingId:'cafe',value:s=>s.visited.includes('cafe')?1:0},
  {id:'first_work',title:'この街で、はじめての仕事',description:'カフェかオフィスで仕事をして、お給料を受け取りましょう。',reward:400,buildingId:'office',value:s=>Math.min(1,s.stats.shifts)},
  {id:'first_groceries',title:'今日の夕食を考える',description:'マーケットで食材を買いましょう。',reward:200,buildingId:'market',value:s=>Math.min(1,s.stats.groceriesBought)},
  {id:'home_cook',title:'自分の部屋で、手料理を',description:'自宅のキッチンで、買った食材を料理しましょう。',reward:300,buildingId:'home',value:s=>Math.min(1,s.stats.cooked)},
  {id:'park_break',title:'少しだけ、ひと休み',description:'街のベンチや公園で、ゆっくり休みましょう。',reward:150,buildingId:'park',value:s=>Math.min(1,s.stats.parkRests)},
  {id:'new_day',title:'おやすみ。また明日',description:'自宅のベッドでしっかり休みましょう。',reward:300,buildingId:'home',value:s=>Math.min(1,s.stats.nights)},
];

const ACTIONS = {
  sleep_8h: {station:'sleep',label:'ベッドでしっかり休む',description:'ベッドで休んで、体力をしっかり回復します。',minutes:480,icon:'moon',effects:{energy:100,mood:12},setEnergy:true,stat:'nights'},
  nap: {station:'sleep',label:'仮眠をとる',description:'少し疲れたときの短い休息。体力を回復します。',minutes:60,icon:'moon',effects:{energy:32,mood:5}},
  cook_meal: {station:'cook',label:'食材で夕食を作る',description:'食材を1つ使い、温かい手料理を作ります。',minutes:40,icon:'meal',requiresItem:'groceries',effects:{hunger:52,energy:5,mood:12},stat:'cooked',meal:true},
  sofa_rest: {station:'relax',label:'ソファでくつろぐ',description:'ゆっくりひと息。体力と気分を回復します。',minutes:30,icon:'leaf',effects:{energy:20,mood:15},stat:'rests'},
  listen_music: {station:'relax',label:'音楽を聴いて過ごす',description:'好きな音楽を聴きながら、気持ちを整えます。',minutes:20,icon:'music',effects:{energy:8,mood:22},stat:'rests'},
  cafe_coffee: {station:'cafe_menu',label:'ハンドドリップコーヒー',description:'香ばしい一杯。体力と気分を少し回復。',cost:420,minutes:15,icon:'coffee',effects:{energy:18,mood:12,hunger:3}},
  cafe_sandwich: {station:'cafe_menu',label:'季節のサンドイッチ',description:'野菜たっぷりの軽い食事。お腹を満たします。',cost:780,minutes:25,icon:'meal',effects:{hunger:40,energy:5,mood:10},meal:true},
  cafe_lunch: {station:'cafe_menu',label:'本日のランチプレート',description:'ゆっくり楽しむ、温かいランチ。',cost:1180,minutes:40,icon:'meal',effects:{hunger:65,energy:10,mood:14},meal:true},
  cafe_shift: {station:'cafe_work',label:'カフェの仕事を手伝う',description:'接客や片付けを手伝います。お給料 ¥2,600。',minutes:120,reward:2600,icon:'work',work:true,minimumEnergy:25,minimumHunger:18,effects:{energy:-20,hunger:-10,mood:5}},
  buy_onigiri: {station:'shop',label:'鮭のおにぎり',description:'持ち歩ける軽食。持ち物から食べられます。',cost:180,minutes:2,icon:'meal',item:'onigiri'},
  buy_lunchbox: {station:'shop',label:'彩り弁当',description:'しっかり食べたいときのお弁当。',cost:580,minutes:2,icon:'meal',item:'lunchbox'},
  buy_water: {station:'shop',label:'ミネラルウォーター',description:'冷たい水でひと息。持ち物に追加します。',cost:140,minutes:1,icon:'drop',item:'water'},
  buy_groceries: {station:'shop',label:'今日の食材セット',description:'自宅のキッチンで1食分の料理を作れます。',cost:650,minutes:5,icon:'bag',item:'groceries'},
  office_shift: {station:'office_work',label:'オフィスの仕事を手伝う',description:'街の会社で事務のお手伝い。お給料 ¥6,400。',minutes:240,reward:6400,icon:'work',work:true,minimumEnergy:42,minimumHunger:28,effects:{energy:-32,hunger:-17,mood:-5}},
  view_art: {station:'admire',label:'展示をゆっくり鑑賞する',description:'作品に触れて、気分を大きく回復します。',minutes:25,icon:'art',effects:{mood:28,energy:-1},stat:'artVisits'},
  browse_books: {station:'books',label:'気になる本を探す',description:'書棚を眺める静かなひととき。気分を回復します。',minutes:20,icon:'book',effects:{mood:16,energy:-1}},
  buy_book: {station:'books',label:'「街と暮らしのエッセイ」を買う',description:'いつでも読める一冊。持ち物に追加します。',cost:1200,minutes:5,icon:'book',item:'book',unique:true},
  read_book: {station:'books',label:'持っている本を読む',description:'エッセイを読みながら、ゆったり過ごします。',minutes:30,icon:'book',requiresItem:'book',keepItem:true,effects:{mood:24,energy:2}},
  park_rest: {station:'park',label:'ベンチでひと休み',description:'街の景色を眺めながら、体力と気分を回復。',minutes:20,icon:'leaf',effects:{energy:18,mood:22},stat:'parkRests'},
};

function finite(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : fallback;
}
function cleanText(value, fallback, maxLength = 80) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,maxLength) : fallback;
}
function clampNeed(value) { return Math.min(100,Math.max(0,value)); }
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function freshState() {
  return {
    version:1,name:'あなた',day:1,minutes:560,money:12000,
    hunger:85,energy:90,mood:85,inventory:[],visited:[],goals:[],location:'街',
    position:{x:10,z:33,yaw:0},
    settings:{sound:true,environmentVolume:.6,quality:'auto',sensitivity:1,headBob:true,invertY:false},
    stats:{steps:0,earned:0,meals:0,shifts:0,cooked:0,rests:0,nights:0,parkRests:0,groceriesBought:0,artVisits:0,conversations:0},
    daily:{workedMinutes:0,talked:[]},journal:[],
  };
}

function validateState(input) {
  if (!plainObject(input) || input.version !== 1) throw new Error('対応していないセーブデータです。');
  if (!Number.isFinite(input.day) || !Number.isFinite(input.minutes) || !Number.isFinite(input.money)) {
    throw new Error('セーブデータの基本情報が見つかりません。');
  }
  const result = freshState();
  result.name = cleanText(input.name,'あなた',24) || 'あなた';
  result.day = Math.floor(finite(input.day,1,1,999999));
  result.minutes = finite(input.minutes,560,0,1439.999999);
  result.money = Math.floor(finite(input.money,12000,0,MAX_MONEY));
  for (const key of ['hunger','energy','mood']) result[key] = finite(input[key],result[key],0,100);
  result.location = cleanText(input.location,'街',60);
  if (plainObject(input.position)) result.position = {
    x:finite(input.position.x,10,-250,250),
    z:finite(input.position.z,33,-250,250),
    yaw:finite(input.position.yaw,0,-1e8,1e8),
  };
  if (plainObject(input.settings)) {
    result.settings.sound = input.settings.sound !== false;
    result.settings.environmentVolume = finite(input.settings.environmentVolume,.6,0,1);
    result.settings.quality = ['auto','cinematic','ultra','high','medium','low'].includes(input.settings.quality) ? input.settings.quality : 'auto';
    result.settings.sensitivity = finite(input.settings.sensitivity,1,0.25,3);
    result.settings.headBob = input.settings.headBob !== false;
    result.settings.invertY = input.settings.invertY === true;
  }
  if (plainObject(input.stats)) for (const key of Object.keys(result.stats)) result.stats[key] = finite(input.stats[key],0,0,1e9);
  if (Array.isArray(input.inventory)) {
    for (const item of input.inventory.slice(0,100)) {
      if (!plainObject(item) || !Object.hasOwn(ITEMS,item.id)) continue;
      const qty = Math.floor(finite(item.qty,0,0,item.id === 'book' ? 1 : 99));
      if (!qty) continue;
      const existing = result.inventory.find(entry=>entry.id===item.id);
      if (existing) existing.qty = Math.min(item.id === 'book'?1:99,existing.qty+qty);
      else result.inventory.push({id:item.id,name:ITEMS[item.id].name,qty});
    }
  }
  if (Array.isArray(input.visited)) result.visited = [...new Set(input.visited.filter(v=>typeof v==='string').map(v=>cleanText(v,'',80)))].slice(0,100);
  if (Array.isArray(input.goals)) result.goals = [...new Set(input.goals.filter(v=>GOALS.some(g=>g.id===v)))];
  if (plainObject(input.daily)) {
    result.daily.workedMinutes = finite(input.daily.workedMinutes,0,0,480);
    if(/^\d{4}-\d{2}-\d{2}$/.test(input.daily.date||''))result.daily.date=input.daily.date;
    if (Array.isArray(input.daily.talked)) result.daily.talked = [...new Set(input.daily.talked.filter(v=>typeof v==='string').map(v=>cleanText(v,'',80)))].slice(0,100);
  }
  if (Array.isArray(input.journal)) result.journal = input.journal.slice(-40).filter(plainObject).map(entry=>({
    day:Math.floor(finite(entry.day,1,1,999999)),time:cleanText(entry.time,'09:20',5),text:cleanText(entry.text,'',200),
  }));
  return result;
}

function parseSave(json) {
  if (typeof json !== 'string' || json.length > 500000) throw new Error('セーブデータのサイズが正しくありません。');
  const parsed = JSON.parse(json);
  if (plainObject(parsed) && Object.hasOwn(parsed,'state')) {
    if (parsed.game !== 'MACHI LIFE') throw new Error('MACHI LIFEのセーブデータを選んでください。');
    return validateState(parsed.state);
  }
  return validateState(parsed);
}

/**
 * Public state is intentionally stable: importSave/reset update its properties,
 * so UI references remain valid. Pausing and scene changes belong to the caller.
 */
export function createLife({storage = typeof localStorage !== 'undefined' ? localStorage : null,onToast = ()=>{},now = ()=>new Date()} = {}) {
  let state = freshState();
  let writeLocked = false;
  let autosaveSeconds = 0;
  let needsWarning = false;
  let saveWarning = false;

  function toast(message) { try { onToast(message); } catch (_) { /* Presentation must never break simulation. */ } }
  if (storage) {
    let raw;
    try {
      raw = storage.getItem(SAVE_KEY);
      if (raw) {
        try { state = parseSave(raw); }
        catch (_) {
          const backup = storage.getItem(BACKUP_KEY);
          if (backup) {
            state = parseSave(backup);
            toast('前回のバックアップから暮らしを復元しました。');
          } else {
            writeLocked = true;
            toast('保存データを読み込めませんでした。元のデータを保護しています。設定からデータを読み込めます。');
          }
        }
      }
    } catch (_) {
      writeLocked = true;
      toast('このブラウザでは保存データにアクセスできません。設定からデータを書き出せます。');
    }
  }

  function currentDate(){const value=now(),date=value instanceof Date?value:new Date(value);return Number.isFinite(date.getTime())?date:new Date();}
  function syncClock(){
    const date=currentDate(),key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const previous=state.daily.date;
    let dayChanged=false;
    if(previous&&key>previous){const delta=Math.round((Date.parse(key+'T00:00:00Z')-Date.parse(previous+'T00:00:00Z'))/86400000);state.day=Math.min(999999,state.day+Math.max(1,delta));state.daily={workedMinutes:0,talked:[],date:key};dayChanged=true;}
    else if(!previous)state.daily.date=key;
    state.minutes=date.getHours()*60+date.getMinutes()+date.getSeconds()/60+date.getMilliseconds()/60000;
    return dayChanged;
  }
  syncClock();
  function formatTime() {
    syncClock();
    const mins = Math.floor(state.minutes);
    return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  }
  function getDayLabel() {
    const date=currentDate(),weekdays=['日','月','火','水','木','金','土'];
    return `${date.getMonth()+1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
  }
  function journal(text) {
    state.journal.push({day:state.day,time:formatTime(),text});
    if (state.journal.length>40) state.journal.splice(0,state.journal.length-40);
  }
  function quantity(id) { return state.inventory.find(item=>item.id===id)?.qty || 0; }
  function addItem(id) {
    const existing = state.inventory.find(item=>item.id===id);
    if (existing) existing.qty++;
    else state.inventory.push({id,name:ITEMS[id].name,qty:1});
  }
  function consumeItem(id) {
    const index = state.inventory.findIndex(item=>item.id===id);
    if (index<0) return false;
    state.inventory[index].qty--;
    if (state.inventory[index].qty<=0) state.inventory.splice(index,1);
    return true;
  }
  function applyEffects(effects = {}) {
    for (const key of ['hunger','energy','mood']) if (Number.isFinite(effects[key])) state[key]=clampNeed(state[key]+effects[key]);
  }
  function passiveNeeds(minutes,moving=false,running=false) {
    const hungerLoss = minutes*(0.024+(moving?0.006:0)+(running?0.012:0));
    const energyLoss = minutes*(0.012+(moving?0.009:0)+(running?0.022:0));
    applyEffects({hunger:-hungerLoss,energy:-energyLoss,mood:-minutes*(state.hunger<15?0.035:0.004)});
  }
  function advanceClock(minutes,worked=false) {
    const changed=syncClock();
    if(worked)state.daily.workedMinutes=Math.min(480,state.daily.workedMinutes+Math.max(0,minutes));
    return changed;
  }
  function checkGoals() {
    const completed=[];
    for (const goal of GOALS) {
      if (!state.goals.includes(goal.id) && goal.value(state)>=1) {
        state.goals.push(goal.id);
        state.money = Math.min(MAX_MONEY,state.money+goal.reward);
        journal(`${goal.title}を達成。街からのお祝い ¥${goal.reward.toLocaleString('ja-JP')}。`);
        completed.push({id:goal.id,title:goal.title,reward:goal.reward});
        toast(`「${goal.title}」達成 · +¥${goal.reward.toLocaleString('ja-JP')}`);
      }
    }
    return completed;
  }
  function getGoals() {
    return GOALS.map(goal=>({id:goal.id,title:goal.title,description:goal.description,reward:goal.reward,buildingId:goal.buildingId,progress:goal.value(state),target:1,done:state.goals.includes(goal.id),completed:state.goals.includes(goal.id)}));
  }
  function disabledReason(action) {
    if ((action.cost||0)>state.money) return '所持金が足りません。';
    if (action.requiresItem && quantity(action.requiresItem)<1) return action.requiresItem==='groceries'?'マーケットで食材を買ってきましょう。':'先にこの本を購入しましょう。';
    if (action.item && quantity(action.item)>=(action.unique?1:99)) return action.unique?'この本はすでに持っています。':'この持ち物は99個までです。';
    if (action.work) {
      if (state.energy<action.minimumEnergy) return `体力が${action.minimumEnergy}以上必要です。自宅やベンチで休みましょう。`;
      if (state.hunger<action.minimumHunger) return `満腹度が${action.minimumHunger}以上必要です。先に食事をしましょう。`;
      const todaySpan = action.minutes;
      if (state.daily.workedMinutes+todaySpan>480.001) return '今日のお仕事は8時間まで。続きは明日にしましょう。';
    }
    return '';
  }
  function descriptor(id,action) {
    const reason = disabledReason(action);
    return {id,label:action.label,description:action.description,cost:action.cost||0,minutes:action.minutes||0,reward:action.reward||0,icon:action.icon||'leaf',disabled:!!reason,reason};
  }
  function getActions(station) {
    if (station==='inventory') return state.inventory.filter(item=>ITEMS[item.id].consumable||item.id==='book').map(item=>{
      if(item.id==='book') return descriptor('read_book',ACTIONS.read_book);
      return {id:`use:${item.id}`,label:`${item.name}を${item.id==='water'?'飲む':'食べる'}`,description:`所持数 ${item.qty} · ${item.id==='water'?'体力と気分を少し回復':'満腹度を回復します'}`,cost:0,minutes:ITEMS[item.id].minutes,icon:item.id==='water'?'drop':'meal',disabled:false,reason:''};
    });
    if (station==='bench') station='park';
    if (station==='vending') return [descriptor('buy_water',ACTIONS.buy_water)];
    const result = Object.entries(ACTIONS).filter(([,action])=>action.station===station).map(([id,action])=>descriptor(id,action));
    if (station==='relax' && quantity('book')) result.push(descriptor('read_book',ACTIONS.read_book));
    return result;
  }
  function save({force=false} = {}) {
    syncClock();
    if (!storage) return {ok:false,message:'ブラウザ保存を利用できません。設定からデータを書き出してください。'};
    if (writeLocked&&!force) return {ok:false,message:'元の保存データを保護しているため、自動保存を停止しています。'};
    try {
      syncClock();const checked=validateState(state);
      const json=JSON.stringify({game:'MACHI LIFE',version:1,savedAt:new Date().toISOString(),state:checked});
      const previous=storage.getItem(SAVE_KEY);
      if (previous) {
        try { parseSave(previous);storage.setItem(BACKUP_KEY,previous); }
        catch (_) { /* Never replace the backup with an unreadable save. */ }
      }
      storage.setItem(SAVE_KEY,json);
      autosaveSeconds=0;saveWarning=false;writeLocked=false;
      return {ok:true,message:'このブラウザに保存しました。'};
    } catch (_) {
      if (!saveWarning) {toast('ブラウザに保存できませんでした。設定からデータを書き出してください。');saveWarning=true;}
      return {ok:false,message:'保存できませんでした。設定からデータを書き出してください。'};
    }
  }
  function tick(dt,moving=false,running=false) {
    const dayChanged=syncClock(),elapsed=finite(dt,0,0,1);
    if (!elapsed) return {dayChanged,autosaved:false};
    const minutes=elapsed*GAME_MINUTES_PER_SECOND;
    passiveNeeds(minutes,!!moving,!!running&&!!moving);
    if (moving) state.stats.steps += elapsed*(running?3.4:1.8);
    if ((state.hunger<20||state.energy<20)&&!needsWarning) {
      toast(state.hunger<20?'お腹が空いてきました。カフェや持ち物から食事をどうぞ。':'少し疲れてきました。ベンチや自宅でひと休みしましょう。');needsWarning=true;
    } else if(state.hunger>=30&&state.energy>=30) needsWarning=false;
    autosaveSeconds+=elapsed;
    let autosaved=false;
    if(autosaveSeconds>=15){autosaved=save().ok;autosaveSeconds=0;}
    return {dayChanged,autosaved};
  }
  function perform(id) {
    syncClock();
    if (typeof id!=='string') return {ok:false,message:'この行動は見つかりません。',minutes:0};
    if (id.startsWith('use:')) {
      const itemId=id.slice(4);
      if (!Object.hasOwn(ITEMS,itemId)) return {ok:false,message:'この持ち物は見つかりません。',minutes:0};
      const item=ITEMS[itemId];
      if (!quantity(itemId)) return {ok:false,message:'この持ち物は持っていません。',minutes:0};
      if (itemId==='book') return perform('read_book');
      if (!item.consumable) return {ok:false,message:'食材は自宅のキッチンで料理できます。',minutes:0};
      consumeItem(itemId);
      passiveNeeds(item.minutes);
      advanceClock(item.minutes);
      applyEffects(item);
      if(itemId!=='water') state.stats.meals++;
      const message=`${item.name}を${itemId==='water'?'飲みました':'食べました'}。`;
      journal(message);checkGoals();save();
      return {ok:true,message,minutes:item.minutes,reward:0};
    }
    if(!Object.hasOwn(ACTIONS,id)) return {ok:false,message:'この行動は見つかりません。',minutes:0};
    const action=ACTIONS[id];
    const reason=disabledReason(action);
    if(reason) return {ok:false,message:reason,minutes:0};
    const originalDay=state.day;
    state.money-=action.cost||0;
    if(action.requiresItem&&!action.keepItem) consumeItem(action.requiresItem);
    if(action.item) {addItem(action.item);if(action.item==='groceries')state.stats.groceriesBought++;}
    passiveNeeds(action.minutes);
    advanceClock(action.minutes,action.work===true);
    applyEffects(action.effects);
    if(action.setEnergy)state.energy=100;
    if(action.stat) state.stats[action.stat]++;
    if(action.meal)state.stats.meals++;
    if(action.work){state.stats.shifts++;state.stats.earned+=action.reward;}
    if(action.reward)state.money=Math.min(MAX_MONEY,state.money+action.reward);
    let message;
    if(action.item) message=`${ITEMS[action.item].name}を買いました。持ち物に追加されました。`;
    else if(action.work)message=`おつかれさまでした。お給料 ¥${action.reward.toLocaleString('ja-JP')}を受け取りました。`;
    else if(id==='sleep_8h')message=state.day>originalDay?'おはようございます。新しい一日の始まりです。':'ぐっすり眠って、体力が回復しました。';
    else if(id==='cook_meal')message='手作りのごはんができました。いただきます。';
    else if(id==='park_rest')message='風を感じながら、ゆっくり休みました。';
    else if(id==='view_art')message='作品を眺めて、気持ちが豊かになりました。';
    else if(id==='read_book')message='読書を楽しみました。心が少し軽くなりました。';
    else if(id==='nap')message='仮眠をとって、すっきりしました。';
    else if(action.station==='cafe_menu')message='ごちそうさまでした。心地よいカフェのひとときでした。';
    else message='ゆっくりとした時間を過ごしました。';
    journal(message);
    const completedGoals=checkGoals();save();
    return {ok:true,message,minutes:action.minutes,reward:action.reward||0,completedGoals,dayChanged:state.day!==originalDay};
  }
  function visit(id) {
    if(typeof id!=='string'||!id) return {ok:false,firstVisit:false};
    id=cleanText(id,'',80);
    const firstVisit=!state.visited.includes(id);
    if(firstVisit){state.visited.push(id);applyEffects({mood:3});}
    const completedGoals=checkGoals();
    if(firstVisit||completedGoals.length)save();
    return {ok:true,firstVisit,completedGoals};
  }
  function talk(id='neighbor') {
    syncClock();
    id=cleanText(id,'neighbor',80);
    const dialogues=[
      'こんにちは。今日は、ゆっくり街を歩くのにいい日ですね。',
      'ここのカフェ、コーヒーの香りがとてもいいんです。もう行きましたか？',
      '公園のベンチで、ぼんやりする時間も好きなんです。',
      '本屋さんで見つけた一冊を、家で読む。そんな日もいいですよね。',
      'お仕事のあとは、しっかりごはんを食べて休んでくださいね。',
      'この街に慣れましたか？ 急がず、自分のペースで過ごしてください。',
      'ギャラリーにはもう行きました？ 静かで、気分転換におすすめです。',
    ];
    let hash=state.day;
    for(const character of id)hash=(hash*31+character.codePointAt(0))>>>0;
    const message=dialogues[hash%dialogues.length];
    const firstToday=!state.daily.talked.includes(id);
    if(firstToday){state.daily.talked.push(id);applyEffects({mood:6});state.stats.conversations++;journal('街の人と挨拶を交わしました。');}
    advanceClock(3);save();
    return {ok:true,message,minutes:3,firstToday};
  }
  function reset() {
    const next=freshState();
    for(const key of Object.keys(state))delete state[key];
    Object.assign(state,next);
    writeLocked=false;needsWarning=false;autosaveSeconds=0;
    const persisted=save({force:true});
    return {ok:true,message:'新しい暮らしを始めました。',saved:persisted.ok};
  }
  function exportSave() {
    syncClock();
    return JSON.stringify({game:'MACHI LIFE',version:1,savedAt:new Date().toISOString(),state:validateState(state)},null,2);
  }
  function importSave(json) {
    let next;
    try{next=parseSave(json);}catch(error){return {ok:false,message:error instanceof SyntaxError?'JSON形式のセーブデータを選んでください。':error.message||'セーブデータを読み込めませんでした。'};}
    for(const key of Object.keys(state))delete state[key];
    Object.assign(state,next);
    writeLocked=false;needsWarning=false;autosaveSeconds=0;
    const persisted=save({force:true});
    return {ok:true,message:persisted.ok?'暮らしのデータを読み込みました。':'データを読み込みました。ブラウザ保存が使えないため、書き出しも保管してください。',saved:persisted.ok};
  }
  return {state,tick,perform,getActions,visit,talk,save,reset,exportSave,importSave,formatTime,getDayLabel,getGoals,syncClock};
}
