import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_ORIGIN,NATIVE_ORIGIN,isOnlineHost,getOnlineOrigin} from '../dist/site-config.js';
test('custom and managed domains retain same-origin sessions and API requests',()=>{
  const original=globalThis.location;
  try{for(const origin of [PUBLIC_ORIGIN,NATIVE_ORIGIN]){globalThis.location={origin};assert.equal(isOnlineHost(),true);assert.equal(getOnlineOrigin(),origin);}
    for(const origin of ['https://uni-tadayasu.github.io','https://www.omoji-z.com.evil.example','https://unrelated.chatgpt.site']){globalThis.location={origin};assert.equal(isOnlineHost(),false);assert.equal(getOnlineOrigin(),NATIVE_ORIGIN);}
  }finally{if(original===undefined)delete globalThis.location;else globalThis.location=original;}
});
