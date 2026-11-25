const ENDPOINT='https://photon.komoot.io/api/';
const cache=new Map();
let lastRequest=0;
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function normalizePlaces(data){
  const seen=new Set(),results=[];
  for(const feature of Array.isArray(data?.features)?data.features:[]){
    const [longitude,latitude]=feature.geometry?.coordinates||[],p=feature.properties||{};
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180)continue;
    const title=String(p.name||[p.street,p.housenumber].filter(Boolean).join(' ')||p.city||p.district||p.state||p.country||'検索地点').slice(0,100);
    const details=[p.country,p.state,p.county,p.city,p.district,p.postcode,p.street,p.housenumber].filter(Boolean).map(String);
    const address=[...new Set(details)].join(' · ').slice(0,320);
    const key=latitude.toFixed(6)+','+longitude.toFixed(6);if(seen.has(key))continue;seen.add(key);
    results.push({id:key,title,address,latitude,longitude});if(results.length===6)break;
  }
  return results;
}

export async function searchAddress(query,{signal,fetcher=fetch}={}){
  const text=String(query||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(text.length<2||text.length>160)throw new Error('住所や地名を2〜160文字で入力してください。');
  if(cache.has(text))return cache.get(text);
  const now=Date.now();if(now-lastRequest<1600)throw new Error('少し時間をおいてから、もう一度検索してください。');lastRequest=now;
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  const timeout=setTimeout(abort,15000),url=new URL(ENDPOINT);url.searchParams.set('q',text);url.searchParams.set('limit','6');
  try{
    const response=await fetcher(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin',headers:{Accept:'application/json'}});
    if(response.status===429)throw new Error('住所検索が混み合っています。しばらく待ってから検索するか、座標を指定してください。');
    if(!response.ok)throw new Error('住所検索に接続できませんでした。時間をおいて再度お試しください。');
    const places=normalizePlaces(await response.json());cache.set(text,places);if(cache.size>30)cache.delete(cache.keys().next().value);return places;
  }catch(error){if(error.name==='AbortError'&&!signal?.aborted)throw new Error('住所検索が時間切れになりました。再検索するか、座標を指定してください。');throw error;}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}

export function mountAddressSearch(container,{onSelect,started=false}={}){
  let controller=null,requestId=0,results=[],selected=null,disposed=false;
  container.innerHTML=`<section class="address-search"><div class="address-heading"><span class="section-label">ADDRESS / PLACE</span><h3>${started?'次に訪れる街を探す':'住所から、あなたの街へ'}</h3></div><form class="address-form"><label class="sr-only" for="address-query">住所・地名・施設名</label><input id="address-query" name="address" type="search" autocomplete="off" maxlength="160" placeholder="住所・地名・施設名を入力" required minlength="2"><button type="submit" class="primary-btn">検索</button></form><p class="address-privacy">検索ボタンを押すと、入力内容をPhotonの住所検索サービスへ送信します。他のプレイヤーには表示しません。</p><div class="address-results" aria-live="polite"></div><p class="legal-note">住所検索 <a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a></p></section>`;
  const form=container.querySelector('form'),input=container.querySelector('input'),submit=container.querySelector('[type=submit]'),output=container.querySelector('.address-results');
  const render=()=>{
    if(selected){output.innerHTML=`<div class="address-preview"><div class="address-preview-pin" aria-hidden="true">⌖</div><div><span class="section-label">訪問する場所</span><h4>${escapeText(selected.title)}</h4><p>${escapeText(selected.address)}</p><span class="address-coordinates">${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}</span></div></div><p class="address-precision">検索結果は代表地点です。道路・建物データによっては近くの歩ける場所から始まります。</p><div class="button-row"><button class="primary-btn" type="button" data-address-go>${started?'この場所へ移動する':'この場所からはじめる'}</button><button class="secondary-btn" type="button" data-address-back>候補に戻る</button></div>`;return;}
    output.innerHTML=results.length?`<p class="address-result-count">${results.length}件の候補から訪問先を選んでください</p><div class="address-options">${results.map((place,index)=>`<button class="address-option" type="button" data-address-index="${index}"><span class="address-option-mark" aria-hidden="true">⌖</span><span><strong>${escapeText(place.title)}</strong><small>${escapeText(place.address)}</small></span><span class="address-option-coordinates">${place.latitude.toFixed(3)}<br>${place.longitude.toFixed(3)}</span></button>`).join('')}</div>`:'<div class="empty-state">一致する場所が見つかりませんでした。<p>都道府県・市区町村から入力するか、近くの駅や施設名、下の座標指定をお試しください。</p></div>';
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();controller?.abort();controller=new AbortController();const ownId=++requestId;selected=null;submit.disabled=true;submit.textContent='検索中…';output.innerHTML='<p class="address-searching">候補の住所を探しています…</p>';
    try{results=await searchAddress(input.value,{signal:controller.signal});if(!disposed&&ownId===requestId)render();}
    catch(error){if(!disposed&&ownId===requestId&&error.name!=='AbortError')output.innerHTML=`<p class="inline-error" role="alert">${escapeText(error.message)}</p>`;}
    finally{if(!disposed&&ownId===requestId){submit.disabled=false;submit.textContent='検索';}}
  });
  output.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-address-index')){selected=results[Number(button.dataset.addressIndex)];render();}
    else if(button.hasAttribute('data-address-back')){selected=null;render();}
    else if(button.hasAttribute('data-address-go')&&selected)onSelect?.({...selected});
  });
  return {dispose(){disposed=true;requestId++;controller?.abort();}};
}
