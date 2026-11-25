import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife} from '../dist/life.js';

test('environment sound defaults on but preserves an existing explicit mute across save migration',()=>{
  const life=createLife({storage:null});assert.equal(life.state.settings.sound,true);assert.equal(life.state.settings.environmentVolume,.6);
  const old=JSON.parse(life.exportSave());old.state.settings.sound=false;delete old.state.settings.environmentVolume;
  assert.equal(life.importSave(JSON.stringify(old)).ok,true);assert.equal(life.state.settings.sound,false);assert.equal(life.state.settings.environmentVolume,.6);
  life.state.settings.environmentVolume=.27;
  const restored=createLife({storage:null});assert.equal(restored.importSave(life.exportSave()).ok,true);
  assert.equal(restored.state.settings.environmentVolume,.27);assert.equal(restored.state.settings.sound,false);
});

test('imported volume is bounded and malformed settings cannot poison the audio gain',()=>{
  const life=createLife({storage:null});
  for(const [volume,expected] of [[999,1],[-3,0],['loud',.6],[null,.6]]){
    const input=JSON.parse(life.exportSave());input.state.settings.environmentVolume=volume;
    assert.equal(life.importSave(JSON.stringify(input)).ok,true);assert.equal(life.state.settings.environmentVolume,expected);
  }
});
