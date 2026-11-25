// Character files remain in this browser's IndexedDB; this module never uploads.
const DATABASE='machi.characters.v1';
const STORE='characters';
const ACTIVE_KEY='active';

function storageError(cause,operation){
  if(cause?.name==='CharacterStorageError')return cause;
  let message;
  if(cause?.name==='QuotaExceededError')message='端末の保存容量が足りません。不要なサイトデータを整理するか、小さいモデルを選んでください。';
  else if(cause?.name==='DataCloneError')message='このキャラクターデータは保存できない形式を含んでいます。画像やモデルファイルを選び直してください。';
  else if(cause?.name==='SecurityError'||cause?.name==='InvalidStateError')message='このブラウザではキャラクターの保存領域を利用できません。通常のブラウザウィンドウで開いてください。';
  else message=`キャラクターデータの${operation}ができませんでした。ブラウザの保存設定や空き容量を確認してください。`;
  const error=new Error(message,{cause});
  error.name='CharacterStorageError';
  return error;
}

function explicitError(message){
  const error=new Error(message);
  error.name='CharacterStorageError';
  return error;
}

function openDatabase(){
  return new Promise((resolve,reject)=>{
    let request,finished=false;
    const timer=setTimeout(()=>fail(explicitError('キャラクターの保存領域を開くのに時間がかかっています。別のタブを閉じてから再度お試しください。')),6000);
    function fail(error){if(finished)return;finished=true;clearTimeout(timer);reject(storageError(error,'読み込み'));}
    try{
      if(!globalThis.indexedDB){fail(explicitError('このブラウザではキャラクターを保存できません。読み込んだモデルは、このページを開いている間だけ使用できます。'));return;}
      request=globalThis.indexedDB.open(DATABASE,1);
    }catch(error){fail(error);return;}
    request.onupgradeneeded=()=>{
      try{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
      }catch(error){try{request.transaction?.abort();}catch(_){}fail(error);}
    };
    request.onblocked=()=>fail(explicitError('キャラクターの保存領域が別のタブで使用されています。このゲームの別タブを閉じてから再度お試しください。'));
    request.onerror=()=>fail(request.error);
    request.onsuccess=()=>{
      const db=request.result;
      if(finished){db.close();return;}
      finished=true;clearTimeout(timer);
      db.onversionchange=()=>db.close();
      resolve(db);
    };
  });
}

async function transaction(mode,operation,makeRequest){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    let tx,request,value,finished=false;
    const timer=setTimeout(()=>{
      try{tx?.abort();}catch(_){}
      fail(explicitError(`キャラクターデータの${operation}が完了しませんでした。ページを開き直して再度お試しください。`));
    },mode==='readonly'?8000:20000);
    function fail(error){if(finished)return;finished=true;clearTimeout(timer);db.close();reject(storageError(error,operation));}
    try{
      tx=db.transaction(STORE,mode);
      tx.oncomplete=()=>{if(finished)return;finished=true;clearTimeout(timer);db.close();resolve(value);};
      tx.onabort=()=>fail(tx.error||request?.error||new Error('Transaction aborted'));
      tx.onerror=()=>fail(tx.error||request?.error);
      request=makeRequest(tx.objectStore(STORE));
      request.onsuccess=()=>{value=request.result;};
      request.onerror=()=>fail(request.error);
    }catch(error){try{tx?.abort();}catch(_){}fail(error);}
  });
}

/** Save any structured-clone-compatible character record (including Blobs). */
export async function saveCharacter(record){
  if(record===undefined)throw explicitError('保存するキャラクターデータがありません。');
  const savedAt=new Date().toISOString();
  await transaction('readwrite','保存',store=>store.put({version:1,savedAt,record},ACTIVE_KEY));
  return {ok:true,savedAt};
}

/** Returns the saved record or null when no character has been saved. */
export async function loadCharacter(){
  const envelope=await transaction('readonly','読み込み',store=>store.get(ACTIVE_KEY));
  if(envelope===undefined)return null;
  if(!envelope||envelope.version!==1||!Object.hasOwn(envelope,'record'))throw explicitError('保存されたキャラクターデータの形式を確認できません。画像やモデルを選び直してください。');
  return envelope.record;
}

/** Resolves only after deletion has committed to the browser database. */
export async function deleteCharacter(){
  await transaction('readwrite','削除',store=>store.delete(ACTIVE_KEY));
  return {ok:true};
}
