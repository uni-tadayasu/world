(() => {
  'use strict';

  // This page consumes only the server's allowlisted public merchant settings.
  // An incomplete response never enables sales or creates a purchase link.
  const requiredTextFields = ['sellerName', 'representative', 'address', 'phone', 'email', 'paymentTiming'];
  const state = document.querySelector('[data-sales-state]');
  const label = document.querySelector('[data-status-label]');
  const copy = document.querySelector('[data-status-copy]');

  function publicText(value, limit = 600) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text && text.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? text : null;
  }

  function httpsUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  function mailUrl(value) {
    if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/u.test(value)) return null;
    // Encode the address as a path so valid local-part punctuation cannot add
    // mailto query parameters or a fragment.
    return `mailto:${encodeURIComponent(value).replace(/%40/gu, '@')}`;
  }

  function publicMerchant(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const merchant = {};
    for (const field of requiredTextFields) {
      merchant[field] = publicText(value[field], field === 'paymentTiming' ? 200 : 600);
      if (!merchant[field]) return null;
    }
    if (!mailUrl(merchant.email)) return null;
    if (!Array.isArray(value.paymentMethods) || value.paymentMethods.length < 1 || value.paymentMethods.length > 12) return null;
    merchant.paymentMethods = value.paymentMethods.map(method => publicText(method, 60));
    if (merchant.paymentMethods.some(method => !method)) return null;
    if (value.contactUrl != null && value.contactUrl !== '') {
      merchant.contactUrl = httpsUrl(value.contactUrl);
      if (!merchant.contactUrl) return null;
    }
    return merchant;
  }

  function sameOffer(offer) {
    return offer && offer.id === 'sponsor-directory-30d-v1' && offer.amount === 3300 &&
      offer.currency === 'jpy' && offer.durationDays === 30 && offer.reviewDays === 7;
  }

  function renderMerchant(merchant) {
    document.querySelectorAll('[data-merchant-field]').forEach(element => {
      const field = element.dataset.merchantField;
      const value = merchant?.[field];
      element.textContent = value ? (Array.isArray(value) ? value.join('、') : value) : '確認中';
      const href = field === 'email' ? mailUrl(value) : field === 'contactUrl' ? httpsUrl(value) : null;
      if (href) {
        const link = document.createElement('a');
        link.textContent = value;
        link.href = href;
        if (field === 'contactUrl') {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        element.replaceChildren(link);
      }
    });
    document.querySelectorAll('[data-contact-row]').forEach(element => {
      element.hidden = !merchant?.contactUrl;
    });
  }

  function renderState(enabled, unavailable = false) {
    if (state) state.classList.toggle('is-ready', enabled);
    if (label) label.textContent = enabled ? 'スポンサー掲載を受け付けています' : '販売開始前の準備ページ';
    if (copy) copy.textContent = enabled
      ? '販売者情報と掲載条件をご確認のうえ、スポンサー掲載ページからお申込みください。'
      : unavailable
        ? '現在、公開情報と受付状況を取得できません。時間をおいてページを開き直し、購入前に販売者情報をご確認ください。'
        : '現在、購入受付は開始していません。販売者情報、税の取扱い、決済と掲載管理の確認が完了してから、受付を開始します。';
    document.querySelectorAll('[data-prelaunch-only]').forEach(element => { element.hidden = enabled; });
    document.querySelectorAll('[data-active-only]').forEach(element => { element.hidden = !enabled; });
    document.querySelectorAll('[data-price-label]').forEach(element => {
      element.textContent = enabled ? '販売価格' : '販売予定価格';
    });
  }

  async function loadPublicInformation() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/sponsors', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Public information unavailable');
      const data = await response.json();
      const merchant = publicMerchant(data?.merchant);
      renderMerchant(merchant);
      renderState(data?.enabled === true && Boolean(merchant) && sameOffer(data?.offer));
    } catch {
      renderMerchant(null);
      renderState(false, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  loadPublicInformation();
})();
