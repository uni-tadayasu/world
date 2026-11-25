/** Establish one anonymous browser session before profile/social saves begin.
 * Concurrent callers share only the in-flight request; later calls verify the
 * current browser identity again. Cookies are managed by the server/browser.
 */
let inFlight=null;
export function readDeviceSession({signal}={}){
  if(signal?.aborted)return Promise.reject(new DOMException('接続を中止しました。','AbortError'));
  if(!inFlight){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    const connect=async()=>{
        const response=await fetch('/api/social/me',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
        let result;try{result=await response.json();}catch{throw new Error('ブラウザの接続を確認できませんでした。通信を確認して再試行してください。');}
        if(!response.ok){const error=new Error(result.error||'接続を確認できませんでした。もう一度お試しください。');error.code=result.code;error.status=response.status;throw error;}
        if(result.identityKind!=='device'||result.connected!==true||typeof result.user?.id!=='string'||!result.user.id){const error=new Error('このブラウザの保存先を確認できませんでした。もう一度接続してください。');error.code='session_unavailable';throw error;}
        return result;
    };
    const request=(async()=>{
      try{
        // A module promise covers one tab. Web Locks also serialize a first
        // visit in several tabs so the next request sees the established cookie.
        const locks=globalThis.navigator?.locks;
        return typeof locks?.request==='function'
          ?await locks.request('machi-device-session',{mode:'exclusive',signal:controller.signal},connect)
          :await connect();
      }catch(error){if(error.name==='AbortError'){const timeout=new Error('接続がタイムアウトしました。通信を確認して再試行してください。');timeout.code='timeout';throw timeout;}throw error;}
      finally{clearTimeout(timer);}
    })();
    const shared=request.finally(()=>{if(inFlight===shared)inFlight=null;});inFlight=shared;
  }
  if(!signal)return inFlight;
  // Disposing one screen must not abort another screen's shared connection.
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(new DOMException('接続を中止しました。','AbortError'));};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    inFlight.then(result=>{cleanup();resolve(result);},error=>{cleanup();reject(error);});
  });
}
