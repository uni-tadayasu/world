import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife} from '../dist/life.js';

const SAVE_KEY='machi.life.v1';
const localDate=(day,hours=0,minutes=0,seconds=0,milliseconds=0)=>new Date(2026,10,day,hours,minutes,seconds,milliseconds);
const minuteOf=date=>date.getHours()*60+date.getMinutes()+date.getSeconds()/60+date.getMilliseconds()/60000;
function clockAt(date){let current=date;return {now:()=>new Date(current.getTime()),set:value=>{current=value;},get:()=>current};}
function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function assertClock(life,date){assert.ok(Math.abs(life.state.minutes-minuteOf(date))<1e-9,`Expected device minutes ${minuteOf(date)}, got ${life.state.minutes}`);}

// Dates are constructed in the process's local timezone: the contract follows
// the device timezone, so these tests also run unchanged under TZ=Asia/Tokyo.
test('a fresh game starts at the exact device local time, including seconds',()=>{
  const clock=clockAt(localDate(25,18,42,31,450)),life=createLife({storage:null,now:clock.now});
  assertClock(life,clock.get());
  assert.equal(life.formatTime(),'18:42');
  assert.equal(life.state.daily.date,'2026-11-25');
  assert.equal(life.getDayLabel(),'11月25日（水）');
});

test('elapsed rendering ticks do not advance the clock independently of the device',()=>{
  const clock=clockAt(localDate(25,10,15,30)),life=createLife({storage:null,now:clock.now}),hunger=life.state.hunger;
  for(let i=0;i<120;i++)life.tick(1,true,false);
  assertClock(life,clock.get());
  assert.ok(life.state.hunger<hunger,'Active play still affects life status');
  assert.ok(life.state.stats.steps>0,'Active play still records movement');
  clock.set(localDate(25,10,21,7));
  life.tick(.016);
  assertClock(life,clock.get());
});

test('sleep, food and work change life state while preserving actual time',()=>{
  const clock=clockAt(localDate(25,23,59,30)),life=createLife({storage:memoryStorage(),now:clock.now});
  for(const action of ['sleep_8h','buy_water','use:water','office_shift']){
    life.state.energy=100;life.state.hunger=100;
    const result=life.perform(action);
    assert.equal(result.ok,true,`${action}: ${result.message}`);
    assertClock(life,clock.get());
    assert.equal(life.state.day,1);
  }
  assert.equal(life.state.stats.nights,1);
  assert.equal(life.state.stats.shifts,1);
  assert.equal(life.state.daily.workedMinutes,240,'A full work action counts even just before midnight');
  life.state.energy=life.state.hunger=100;
  assert.equal(life.perform('office_shift').ok,true);
  life.state.energy=life.state.hunger=100;
  assert.equal(life.perform('cafe_shift').ok,false,'The daily work limit still applies without clock fast-forward');
  assert.equal(life.state.daily.workedMinutes,480);
});

test('crossing midnight resets daily state once and counts a gap in calendar days',()=>{
  const clock=clockAt(localDate(25,23,59,59,999)),life=createLife({storage:null,now:clock.now});
  life.state.daily.workedMinutes=480;life.state.daily.talked=['neighbor'];
  clock.set(localDate(26,0,0,0));
  assert.equal(life.syncClock(),true);
  assert.equal(life.state.day,2);
  assert.deepEqual(life.state.daily,{workedMinutes:0,talked:[],date:'2026-11-26'});
  life.state.daily.workedMinutes=120;
  assert.equal(life.syncClock(),false);
  assert.equal(life.state.daily.workedMinutes,120);
  clock.set(localDate(29,7,10));
  assert.equal(life.syncClock(),true);
  assert.equal(life.state.day,5);
  assert.equal(life.state.daily.workedMinutes,0);
  assertClock(life,clock.get());
});

test('turning the device clock backwards does not refresh the daily work budget',()=>{
  const clock=clockAt(localDate(26,12,0)),life=createLife({storage:null,now:clock.now});
  life.state.daily.workedMinutes=480;life.state.daily.talked=['neighbor'];
  clock.set(localDate(25,18,0));
  assert.equal(life.syncClock(),false);
  assertClock(life,clock.get());
  assert.equal(life.state.daily.date,'2026-11-26');
  assert.equal(life.state.daily.workedMinutes,480);
  assert.deepEqual(life.state.daily.talked,['neighbor']);
  clock.set(localDate(26,12,1));
  assert.equal(life.syncClock(),false);
  assert.equal(life.state.day,1);
  assert.equal(life.state.daily.workedMinutes,480);
  clock.set(localDate(27,0,1));
  assert.equal(life.syncClock(),true);
  assert.equal(life.state.day,2);
  assert.equal(life.state.daily.workedMinutes,0);
});

test('save and restore sync to actual time while preserving earned progress',()=>{
  const storage=memoryStorage(),clock=clockAt(localDate(25,8,15)),life=createLife({storage,now:clock.now});
  life.state.money=45678;life.state.daily.workedMinutes=240;
  clock.set(localDate(25,13,32,20));
  assert.equal(life.save().ok,true);
  const saved=JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.state.minutes,minuteOf(clock.get()));
  clock.set(localDate(27,20,5));
  const restored=createLife({storage,now:clock.now});
  assertClock(restored,clock.get());
  assert.equal(restored.state.money,45678);
  assert.equal(restored.state.day,3);
  assert.equal(restored.state.daily.workedMinutes,0);
  assert.equal(restored.state.daily.date,'2026-11-27');
});

test('import syncs stale save time even when browser storage is unavailable',()=>{
  for(const storage of [memoryStorage(),null]){
    const clock=clockAt(localDate(25,8,15)),source=createLife({storage:null,now:clock.now});
    source.state.money=32100;source.state.daily.workedMinutes=240;
    const exported=source.exportSave();
    clock.set(localDate(27,19,45));
    const imported=createLife({storage,now:clock.now}),stableState=imported.state;
    const result=imported.importSave(exported);
    assert.equal(result.ok,true);
    assert.strictEqual(imported.state,stableState,'Import must preserve the public state reference');
    assertClock(imported,clock.get());
    assert.equal(imported.state.money,32100);
    assert.equal(imported.state.day,3);
    assert.equal(imported.state.daily.workedMinutes,0);
    assert.equal(imported.state.daily.date,'2026-11-27');
  }
});

test('export after an idle period writes current local time and refreshed daily state',()=>{
  const clock=clockAt(localDate(25,23,30)),life=createLife({storage:null,now:clock.now});
  life.state.daily.workedMinutes=480;
  clock.set(localDate(26,6,50));
  const saved=JSON.parse(life.exportSave()).state;
  assert.equal(saved.minutes,minuteOf(clock.get()));
  assert.equal(saved.daily.date,'2026-11-26');
  assert.equal(saved.daily.workedMinutes,0);
  assert.equal(saved.day,2);
});

test('reset stays on device time even without browser storage',()=>{
  const clock=clockAt(localDate(25,15,28)),life=createLife({storage:null,now:clock.now});
  life.state.money=45678;
  clock.set(localDate(27,21,10));
  assert.equal(life.reset().ok,true);
  assertClock(life,clock.get());
  assert.equal(life.state.daily.date,'2026-11-27');
  assert.equal(life.state.day,1);
  assert.equal(life.state.money,12000);
});

test('a zero-delta resume still reports a midnight transition',()=>{
  const clock=clockAt(localDate(25,23,59)),life=createLife({storage:null,now:clock.now});
  clock.set(localDate(26,0,1));
  assert.equal(life.tick(0).dayChanged,true);
  assert.equal(life.tick(0).dayChanged,false);
  assertClock(life,clock.get());
});

test('the first conversation after midnight uses the new day before checking rewards',()=>{
  const clock=clockAt(localDate(25,23,59)),life=createLife({storage:null,now:clock.now});
  assert.equal(life.talk('neighbor').firstToday,true);
  assert.equal(life.talk('neighbor').firstToday,false);
  clock.set(localDate(26,0,1));
  assert.equal(life.talk('neighbor').firstToday,true);
  assert.equal(life.state.stats.conversations,2);
  assert.deepEqual(life.state.daily.talked,['neighbor']);
  assert.equal(life.state.daily.date,'2026-11-26');
  assertClock(life,clock.get());
});
