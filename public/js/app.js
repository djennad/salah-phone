/* Salah Phone — application boutique (SPA sans framework) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const I = window.ICONS;
  const app = $('#app');

  // ---------------------------------------------------------------- state
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  };
  let lang = store.get('sp_lang', 'ar');
  if (!window.I18N[lang]) lang = 'ar';
  let config = { settings: {}, categories: [], wilayas: [], user: null };
  let cart = store.get('sp_cart', []);

  // ---------------------------------------------------------------- utils
  const t = (k) => window.I18N[lang][k] ?? window.I18N.fr[k] ?? k;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `<bdi class="money" dir="ltr">${Number(n || 0).toLocaleString('fr-DZ').replace(/[\u202f\u00a0]/g, ' ')}</bdi> <small>${t('currency')}</small>`;
  const catName = (c) => (c ? (lang === 'ar' ? c.name_ar : c.name_fr) : '');
  const catBySlug = (slug) => config.categories.find((c) => c.slug === slug);
  const catById = (id) => config.categories.find((c) => c.id === id);
  const wilayaName = (w) => (w ? `${String(w.code).padStart(2, '0')} - ${lang === 'ar' ? w.name_ar : w.name_fr}` : '');
  const user = () => config.user;
  const errMsg = (e) => {
    const m = t('errors')[e.code] || t('error');
    return e.detail && e.code === 'out_of_stock' ? `${m} ${e.detail}` : m;
  };

  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* pas de JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'error');
      err.code = data && data.error;
      err.detail = data && data.detail;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function setTitle(s) {
    document.title = s ? `${s} — Salah Phone` : `Salah Phone — ${lang === 'ar' ? 'قطع غيار الهواتف' : 'Pièces de rechange téléphone'}`;
  }

  // ---------------------------------------------------------------- cart
  function saveCart() {
    store.set('sp_cart', cart);
    const n = cart.reduce((s, i) => s + i.qty, 0);
    const b = $('#cartCount');
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = n === 0;
  }
  function addToCart(id, qty = 1) {
    const it = cart.find((i) => i.id === id);
    if (it) it.qty = Math.min(99, it.qty + qty);
    else cart.push({ id, qty: Math.min(99, qty) });
    saveCart();
  }

  // ---------------------------------------------------------------- components
  function productImage(p, small) {
    if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`;
    const c = p.category_slug ? catBySlug(p.category_slug) : catById(p.category_id);
    const ico = (c && I.cat[c.icon]) || I.cat.box;
    return `<div class="ph">${ico}${small ? '' : `<small>${esc(catName(c))}</small>`}</div>`;
  }

  function priceBlock(p) {
    if (!p.in_stock) return `<div class="stock-out">${t('out_of_stock')}</div>`;
    if (p.pro_price !== null && p.pro_price !== undefined && p.pro_price < p.price_public) {
      return `<div><span class="pro-label">${t('price_pro')}</span> <span class="price-old">${money(p.price_public)}</span></div>
              <div class="price">${money(p.price)}</div>`;
    }
    return `<div class="price">${money(p.price)}</div>`;
  }

  function productCard(p) {
    return `<article class="p-card">
      <a href="#/product/${p.id}" class="p-img">${productImage(p)}${p.is_new ? `<span class="p-tag new">NEW</span>` : ''}</a>
      <div class="p-body">
        <a href="#/product/${p.id}" class="p-name" title="${esc(p.name)}">${esc(p.name)}</a>
        ${priceBlock(p)}
        <div class="p-actions">
          <button class="btn btn-outline" data-buy="${p.id}" ${p.in_stock ? '' : 'disabled'}>${t('buy')}</button>
          <button class="btn btn-outline add" data-add="${p.id}" aria-label="${t('add_cart')}" ${p.in_stock ? '' : 'disabled'}>${I.cartPlus}</button>
        </div>
      </div>
    </article>`;
  }

  function modelCard(m) {
    const img = m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}" loading="lazy">` : `<span style="color:var(--navy)">${phoneArt(56)}</span>`;
    return `<a class="m-card" href="#/model/${esc(m.slug)}">
      <div class="m-ico">${img}</div>
      <span class="m-brand">${esc(m.brand)}</span>
      <b dir="ltr">${esc(m.name)}</b>
      <span class="m-count">${m.count} ${t('products')}</span>
    </a>`;
  }

  function phoneArt(h) {
    return `<svg viewBox="0 0 60 100" style="width:${h * 0.6}px;height:${h}px"><rect x="3" y="2" width="54" height="96" rx="9" fill="#0b2a63"/><rect x="7" y="9" width="46" height="80" rx="4" fill="url(#pg)"/><rect x="24" y="4.5" width="12" height="2.2" rx="1.1" fill="#3b5ba5"/><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb27d"/><stop offset=".5" stop-color="#ff5a00"/><stop offset="1" stop-color="#173c85"/></linearGradient></defs></svg>`;
  }

  function grid(items, fn, cls = '') {
    return `<div class="grid ${cls}">${items.map(fn).join('')}</div>`;
  }

  function breadcrumb(parts) {
    return `<nav class="breadcrumb"><a href="#/">${t('home')}</a>${parts.map((p) => `${I.chevron}${p.href ? `<a href="${p.href}">${esc(p.label)}</a>` : `<span>${esc(p.label)}</span>`}`).join('')}</nav>`;
  }

  function pager(page, pages, base) {
    if (pages <= 1) return '';
    const sep = base.includes('?') ? '&' : '?';
    return `<div class="pager">
      ${page > 1 ? `<a class="btn btn-ghost btn-sm" href="${base}${sep}page=${page - 1}">${t('prev')}</a>` : ''}
      <span>${page} / ${pages}</span>
      ${page < pages ? `<a class="btn btn-ghost btn-sm" href="${base}${sep}page=${page + 1}">${t('next')}</a>` : ''}
    </div>`;
  }

  const empty = (msg, extra = '') => `<div class="empty card">${I.box}<p>${esc(msg)}</p>${extra}</div>`;
  const loading = () => `<div class="grid">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
  const statusBadge = (s) => `<span class="status st-${s}">${t(`st_${s}`)}</span>`;
  const fmtDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : 'fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });

  function wilayaOptions(sel) {
    return `<option value="">${t('choose_wilaya')}</option>` +
      config.wilayas.map((w) => `<option value="${w.code}" ${Number(sel) === w.code ? 'selected' : ''}>${esc(wilayaName(w))}</option>`).join('');
  }

  // ---------------------------------------------------------------- pages
  async function pageHome() {
    setTitle('');
    const s = config.settings;
    app.innerHTML = `
      <section class="hero">
        <div>
          <h1>${t('hero_title')}</h1>
          <p style="margin-top:8px">${t('hero_sub')}</p>
          <div class="hero-actions" style="margin-top:18px">
            ${user() ? '' : `<a href="#/register/pro" class="btn">${t('hero_cta')}</a>`}
            <a href="#/products" class="btn btn-outline">${t('all_products')}</a>
          </div>
        </div>
        <div class="hero-art">${heroArt()}</div>
      </section>

      <div class="features">
        ${[['truck', 'feat_delivery'], ['shield', 'feat_quality'], ['tag', 'feat_pro'], ['cash', 'feat_cod']].map(([ic, k]) => `
          <div class="feature card"><span class="f-ico">${I[ic]}</span><div><b>${t(k)}</b><span>${t(`${k}_sub`)}</span></div></div>`).join('')}
      </div>

      <section class="block">
        <div class="block-head"><h2>${t('categories')}</h2><a href="#/products">${t('see_all')}</a></div>
        <div class="cats">
          <a class="cat-card" href="#/products">${I.store}<span>${t('all_products')}</span></a>
          ${config.categories.map((c) => `<a class="cat-card" href="#/category/${c.slug}">${I.cat[c.icon] || I.cat.box}<span>${esc(catName(c))}</span><small>${c.count} ${t('products')}</small></a>`).join('')}
        </div>
      </section>

      <section class="block">
        <div class="block-head"><h2>${t('brands')}</h2></div>
        <div id="brandChips" class="chips"></div>
        <div id="brandModels"></div>
      </section>

      ${user() && user().type === 'repairer' ? '' : `
      <section class="pro-banner">
        <div><h3>${t('pro_banner_title')}</h3><p>${t('pro_banner_text')}${s.pro_discount_percent ? ` (-${s.pro_discount_percent}%)` : ''}</p></div>
        <a class="btn" href="#/register/pro">${t('pro_banner_btn')}</a>
      </section>`}

      <section class="block">
        <div class="block-head"><h2>${t('new_products')}</h2><a href="#/products?sort=new">${t('see_all')}</a></div>
        <div id="newProducts">${loading()}</div>
      </section>`;

    const [brands, prods] = await Promise.all([api('GET', '/api/brands'), api('GET', '/api/products?sort=new&limit=10')]);
    const np = $('#newProducts');
    if (np) {
      np.innerHTML = grid(prods.products, productCard, 'grid-5');
      np.closest('section').hidden = !prods.products.length;
    }

    const chips = $('#brandChips');
    if (!chips) return;
    // Seules les marques qui ont au moins un modèle avec des pièces sont affichées
    const list = brands.brands.filter((b) => b.models.some((m) => m.count > 0));
    chips.closest('section').hidden = !list.length;
    let current = store.get('sp_brand', list[0] && list[0].id);
    if (!list.some((b) => b.id === current) && list[0]) current = list[0].id;
    const draw = () => {
      chips.innerHTML = list.map((b) => `<button class="chip ${b.id === current ? 'on' : ''}" data-brand="${b.id}">${esc(b.name)}</button>`).join('');
      const b = list.find((x) => x.id === current);
      $('#brandModels').innerHTML = b ? grid(b.models.filter((m) => m.count > 0), modelCard, 'grid-models') : '';
    };
    chips.onclick = (e) => {
      const btn = e.target.closest('[data-brand]');
      if (!btn) return;
      current = Number(btn.dataset.brand);
      store.set('sp_brand', current);
      draw();
    };
    draw();
  }

  function heroArt() {
    return `<svg viewBox="0 0 260 220" aria-hidden="true">
      <circle cx="130" cy="110" r="100" fill="rgba(255,255,255,.06)"/>
      <g transform="rotate(-12 110 110)">
        <rect x="70" y="20" width="96" height="180" rx="16" fill="#08183a"/>
        <rect x="77" y="30" width="82" height="160" rx="9" fill="url(#hg)"/>
        <rect x="104" y="24" width="28" height="4" rx="2" fill="#2a4687"/>
      </g>
      <g transform="rotate(10 190 130)">
        <rect x="160" y="70" width="60" height="100" rx="8" fill="#e8edf7"/>
        <rect x="168" y="80" width="44" height="64" rx="4" fill="#c7d2e8"/>
        <text x="190" y="118" font-size="12" text-anchor="middle" fill="#0b2a63" font-weight="800">Li-ion</text>
        <path d="M193 150l-8 10h7l-4 8 10-12h-7l4-6z" fill="#ff5a00"/>
      </g>
      <circle cx="50" cy="60" r="12" fill="#ff7a1a"/>
      <rect x="30" y="150" width="36" height="36" rx="6" fill="#1d4aa3" stroke="#ffb27d" stroke-width="2"/>
      <path d="M36 150v-6M44 150v-6M52 150v-6M60 150v-6M36 192v-6M44 192v-6M52 192v-6M60 192v-6" stroke="#ffb27d" stroke-width="2"/>
      <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb27d"/><stop offset=".55" stop-color="#ff5a00"/><stop offset="1" stop-color="#173c85"/></linearGradient></defs>
    </svg>`;
  }

  async function pageSearch(q, params) {
    const page = Number(params.get('page')) || 1;
    setTitle(q);
    $('#searchInput').value = q;
    app.innerHTML = breadcrumb([{ label: q }]) + loading();
    const d = await api('GET', `/api/search?q=${encodeURIComponent(q)}&page=${page}`);
    const noRes = !d.models.length && !d.products.length;
    app.innerHTML = breadcrumb([{ label: q }]) + `
      <div class="page-head"><h1>${t('results_for')} « <span dir="ltr">${esc(q)}</span> »</h1></div>
      ${noRes ? empty(t('no_results'), `<a class="btn" href="#/request?model=${encodeURIComponent(q)}">${t('request_part')}</a>`) : ''}
      ${d.models.length ? `<h2 class="section-title" style="margin-bottom:10px">${t('phones_found')}</h2>${grid(d.models, modelCard, 'grid-models')}` : ''}
      ${d.products.length ? `<h2 class="section-title" style="margin:22px 0 10px">${t('parts_found')} (${d.total})</h2>${grid(d.products, productCard)}` : ''}
      ${pager(d.page, d.pages, `#/search/${encodeURIComponent(q)}`)}`;
  }

  async function pageModel(slug, params) {
    app.innerHTML = loading();
    let d;
    try { d = await api('GET', `/api/models/${encodeURIComponent(slug)}`); } catch (e) { if (e.status === 404) return pageNotFound(); throw e; }
    const m = d.model;
    setTitle(m.name);
    const cat = params.get('cat');
    const cats = config.categories.filter((c) => d.products.some((p) => p.category_id === c.id));
    const draw = (sel) => {
      const list = sel ? d.products.filter((p) => p.category_slug === sel) : d.products;
      app.innerHTML = breadcrumb([{ label: m.brand }, { label: m.name }]) + `
        <div class="page-head"><h1 dir="ltr">${esc(m.name)}</h1><span class="muted">${d.products.length} ${t('products')}</span></div>
        <div class="chips">
          <button class="chip ${sel ? '' : 'on'}" data-cat="">${t('filter_all')}</button>
          ${cats.map((c) => `<button class="chip ${sel === c.slug ? 'on' : ''}" data-cat="${c.slug}">${esc(catName(c))}</button>`).join('')}
        </div>
        ${list.length ? grid(list, productCard) : empty(t('no_results'))}
        <div class="card pad center" style="margin-top:22px">
          <p style="margin:0 0 10px;font-weight:700">${t('req_title')}</p>
          <a class="btn btn-outline" href="#/request?model=${encodeURIComponent(m.name)}">${t('request_part')}</a>
        </div>`;
      $$('.chips [data-cat]').forEach((b) => { b.onclick = () => draw(b.dataset.cat); });
    };
    draw(cat);
  }

  async function pageProducts(slug, params) {
    const page = Number(params.get('page')) || 1;
    const sort = params.get('sort') || 'new';
    const inStock = params.get('in_stock') === '1';
    const cat = slug ? catBySlug(slug) : null;
    if (slug && !cat) return pageNotFound();
    const title = cat ? catName(cat) : t('all_products');
    setTitle(title);
    app.innerHTML = breadcrumb([{ label: title }]) + loading();
    const qs = new URLSearchParams({ page, sort, limit: 24 });
    if (cat) qs.set('category', cat.slug);
    if (inStock) qs.set('in_stock', '1');
    const d = await api('GET', `/api/products?${qs}`);
    const base = cat ? `#/category/${cat.slug}` : '#/products';
    const keep = new URLSearchParams({ sort });
    if (inStock) keep.set('in_stock', '1');
    app.innerHTML = breadcrumb([{ label: title }]) + `
      <div class="page-head">
        <h1>${esc(title)} <small class="muted" style="font-size:14px">(${d.total})</small></h1>
        <div class="toolbar">
          <label class="check"><input type="checkbox" id="inStock" ${inStock ? 'checked' : ''}> ${t('only_in_stock')}</label>
          <select class="input" id="sortSel" aria-label="${t('sort')}">
            ${['new', 'price_asc', 'price_desc', 'name'].map((s) => `<option value="${s}" ${s === sort ? 'selected' : ''}>${t(`sort_${s}`)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="chips">
        <a class="chip ${cat ? '' : 'on'}" href="#/products">${t('filter_all')}</a>
        ${config.categories.map((c) => `<a class="chip ${cat && cat.id === c.id ? 'on' : ''}" href="#/category/${c.slug}">${esc(catName(c))}</a>`).join('')}
      </div>
      ${d.products.length ? grid(d.products, productCard) : empty(t('no_results'))}
      ${pager(d.page, d.pages, `${base}?${keep}`)}`;
    const go = () => {
      const q = new URLSearchParams({ sort: $('#sortSel').value });
      if ($('#inStock').checked) q.set('in_stock', '1');
      location.hash = `${base}?${q}`;
    };
    $('#sortSel').onchange = go;
    $('#inStock').onchange = go;
  }

  async function pageProduct(id) {
    app.innerHTML = loading();
    let p;
    try { p = (await api('GET', `/api/products/${Number(id)}`)).product; } catch (e) { if (e.status === 404) return pageNotFound(); throw e; }
    setTitle(p.name);
    const crumbs = [];
    if (p.category) crumbs.push({ label: catName(p.category), href: `#/category/${p.category.slug}` });
    crumbs.push({ label: p.name });
    const s = config.settings;
    const waText = encodeURIComponent(`${p.name} — ${location.origin}/#/product/${p.id}`);
    app.innerHTML = breadcrumb(crumbs) + `
      <div class="product">
        <div class="p-img">${productImage(p)}</div>
        <div class="card pad">
          <h1>${esc(p.name)}</h1>
          ${priceBlock(p)}
          ${p.in_stock ? `<div class="stock-in">● ${t('in_stock')}</div>` : ''}
          ${user() && user().type === 'repairer' && user().pro_status === 'pending' ? `<p class="note" style="margin-top:10px">${t('pro_status_pending')}</p>` : ''}
          ${!user() && s.pro_discount_percent ? `<p class="note" style="margin-top:10px">${t('pro_banner_title')} <a class="link" href="#/register/pro">${t('pro_banner_btn')}</a></p>` : ''}
          <dl class="meta">
            ${p.category ? `<div><dt>${t('category')}</dt><dd><a class="link" href="#/category/${p.category.slug}">${esc(catName(p.category))}</a></dd></div>` : ''}
            ${p.quality ? `<div><dt>${t('quality')}</dt><dd>${esc(p.quality)}</dd></div>` : ''}
          </dl>
          ${p.in_stock ? `
          <div class="buy-row">
            <div class="qty"><button data-q="-1" aria-label="-">−</button><input id="qtyIn" type="number" min="1" max="${p.stock}" value="1" inputmode="numeric"><button data-q="1" aria-label="+">+</button></div>
            <button class="btn" id="buyNow">${t('buy')}</button>
            <button class="btn btn-outline" id="addCart">${I.cartPlus} ${t('add_cart')}</button>
          </div>` : ''}
          ${s.shop_whatsapp ? `<a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="https://wa.me/${esc(s.shop_whatsapp)}?text=${waText}">${I.whatsapp} ${t('whatsapp')}</a>` : ''}
          ${p.models.length ? `<h3 style="margin-top:18px;font-size:15px;color:var(--navy)">${t('compatible')}</h3>
            <div class="model-links">${p.models.map((m) => `<a class="chip" dir="ltr" href="#/model/${esc(m.slug)}">${esc(m.name)}</a>`).join('')}</div>` : ''}
          ${p.description ? `<p class="muted" style="margin-top:14px;white-space:pre-line">${esc(p.description)}</p>` : ''}
        </div>
      </div>`;
    if (!p.in_stock) return;
    const qIn = $('#qtyIn');
    const clamp = () => { qIn.value = Math.max(1, Math.min(p.stock, Number(qIn.value) || 1)); };
    $$('[data-q]').forEach((b) => { b.onclick = () => { qIn.value = Number(qIn.value) + Number(b.dataset.q); clamp(); }; });
    qIn.onchange = clamp;
    $('#addCart').onclick = () => { clamp(); addToCart(p.id, Number(qIn.value)); toast(t('added')); };
    $('#buyNow').onclick = () => { clamp(); addToCart(p.id, Number(qIn.value)); location.hash = '#/cart'; };
  }

  // ------------------------------------------------ cart & checkout
  async function pageCart() {
    setTitle(t('cart'));
    if (!cart.length) {
      app.innerHTML = breadcrumb([{ label: t('cart') }]) + empty(t('cart_empty'), `<a class="btn" href="#/products">${t('continue_shopping')}</a>`);
      return;
    }
    app.innerHTML = breadcrumb([{ label: t('cart') }]) + loading();
    const u = user();
    const q = await api('POST', '/api/cart/quote', { items: cart, wilaya: u && u.wilaya, delivery_type: u && u.delivery_type });
    // Retire du panier les produits supprimés du catalogue
    const gone = q.lines.filter((l) => l.unavailable).map((l) => l.id);
    if (gone.length) { cart = cart.filter((c) => !gone.includes(c.id)); saveCart(); }
    const lines = q.lines.filter((l) => !l.unavailable);
    if (!lines.length) return pageCart();
    const blocked = lines.some((l) => !l.enough_stock);
    app.innerHTML = breadcrumb([{ label: t('cart') }]) + `
      <div class="page-head"><h1>${t('cart')}</h1></div>
      ${gone.length ? `<p class="form-error">${t('unavailable')}</p>` : ''}
      <div class="two-col">
        <div class="card">
          ${lines.map((l) => `
            <div class="cart-line">
              <a href="#/product/${l.id}" class="p-img">${productImage(l, true)}</a>
              <div>
                <a href="#/product/${l.id}" class="cl-name">${esc(l.name)}</a>
                <div class="cl-row">
                  <div class="qty"><button data-dec="${l.id}">−</button><input value="${l.qty}" data-qty="${l.id}" type="number" min="1" inputmode="numeric"><button data-inc="${l.id}">+</button></div>
                  <b>${money(l.line_total)}</b>
                </div>
                <div class="cl-row">
                  <span class="muted" style="font-size:13px">${money(l.price)} × ${l.qty}</span>
                  <button class="btn btn-ghost btn-sm" data-rm="${l.id}">${I.trash} ${t('remove')}</button>
                </div>
                ${l.enough_stock ? '' : `<div class="warn">${l.stock > 0 ? `${t('not_enough_stock')} — ${t('stock_left')}: ${l.stock}` : t('out_of_stock')}</div>`}
              </div>
            </div>`).join('')}
        </div>
        <div class="card pad summary">
          <h3 style="color:var(--navy)">${t('order_summary')}</h3>
          ${q.is_pro ? `<p><span class="pro-label">${t('price_pro')}</span></p>` : ''}
          <div class="row"><span>${t('subtotal')}</span><span>${money(q.subtotal)}</span></div>
          <div class="row"><span>${t('delivery_fee')}</span><span>${q.delivery_fee === null ? `<small class="muted">${t('choose_wilaya_fee')}</small>` : money(q.delivery_fee)}</span></div>
          <div class="row total"><span>${t('total')}</span><span>${money(q.total)}</span></div>
          <p class="muted" style="font-size:13px;margin:4px 0 12px">${I.cash} ${t('cod')}</p>
          ${u ? `<a class="btn btn-block ${blocked ? 'disabled' : ''}" href="#/checkout" ${blocked ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>${t('checkout')}</a>`
              : `<a class="btn btn-block" href="#/login?next=checkout">${t('login_to_order')}</a>
                 <a class="btn btn-ghost btn-block" style="margin-top:8px" href="#/register?next=checkout">${t('register')}</a>`}
          <a class="btn btn-ghost btn-block" style="margin-top:8px" href="#/products">${t('continue_shopping')}</a>
        </div>
      </div>`;
    const setQty = (id, qty) => {
      const it = cart.find((c) => c.id === id);
      if (!it) return;
      it.qty = Math.max(1, Math.min(99, qty || 1));
      saveCart();
      pageCart();
    };
    $$('[data-inc]').forEach((b) => { b.onclick = () => setQty(Number(b.dataset.inc), cart.find((c) => c.id === Number(b.dataset.inc)).qty + 1); });
    $$('[data-dec]').forEach((b) => { b.onclick = () => setQty(Number(b.dataset.dec), cart.find((c) => c.id === Number(b.dataset.dec)).qty - 1); });
    $$('[data-qty]').forEach((i) => { i.onchange = () => setQty(Number(i.dataset.qty), Number(i.value)); });
    $$('[data-rm]').forEach((b) => { b.onclick = () => { cart = cart.filter((c) => c.id !== Number(b.dataset.rm)); saveCart(); pageCart(); }; });
  }

  async function pageCheckout() {
    setTitle(t('checkout'));
    const u = user();
    if (!u) { location.hash = '#/login?next=checkout'; return; }
    if (!cart.length) { location.hash = '#/cart'; return; }
    app.innerHTML = breadcrumb([{ label: t('cart'), href: '#/cart' }, { label: t('checkout') }]) + `
      <div class="two-col">
        <form class="card pad form" id="coForm" novalidate>
          <h2 class="section-title">${t('shipping')}</h2>
          <div class="grid-2">
            ${field('last_name', t('last_name'), u.last_name)}
            ${field('first_name', t('first_name'), u.first_name)}
            ${field('phone', t('phone'), u.phone, 'tel')}
            ${field('phone2', `${t('phone2')} <small>${t('optional')}</small>`, u.phone2 || '', 'tel')}
          </div>
          ${deliveryFields(u)}
          <div class="field"><label for="f_note">${t('note')} <small>${t('optional')}</small></label><textarea class="input" id="f_note" name="note" maxlength="500"></textarea></div>
          <label class="check"><input type="checkbox" name="save_info" checked> ${t('save_info')}</label>
          <div id="coErr"></div>
          <button class="btn btn-block" type="submit" id="coBtn">${t('confirm_order')}</button>
        </form>
        <div class="card pad summary" id="coSummary">${t('loading')}</div>
      </div>`;
    const form = $('#coForm');
    const refresh = async () => {
      const q = await api('POST', '/api/cart/quote', { items: cart, wilaya: form.wilaya.value, delivery_type: form.delivery_type.value });
      const lines = q.lines.filter((l) => !l.unavailable);
      $('#coSummary').innerHTML = `
        <h3 style="color:var(--navy)">${t('order_summary')}</h3>
        ${lines.map((l) => `<div class="row" style="font-weight:600;font-size:14px"><span dir="ltr" style="flex:1">${l.qty} × ${esc(l.name)}</span><span style="white-space:nowrap;margin-inline-start:8px">${money(l.line_total)}</span></div>`).join('')}
        <div class="row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px"><span>${t('subtotal')}</span><span>${money(q.subtotal)}</span></div>
        <div class="row"><span>${t('delivery_fee')}</span><span>${q.delivery_fee === null ? `<small class="muted">${t('choose_wilaya_fee')}</small>` : money(q.delivery_fee)}</span></div>
        <div class="row total"><span>${t('total')}</span><span>${money(q.total)}</span></div>
        <p class="muted" style="font-size:13px;margin:6px 0 0">${I.cash} ${t('cod')}</p>`;
    };
    bindDeliveryFields(form, refresh);
    refresh();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = formData(form);
      data.items = cart;
      data.save_info = form.save_info.checked;
      const btn = $('#coBtn');
      btn.disabled = true;
      $('#coErr').innerHTML = '';
      try {
        const r = await api('POST', '/api/orders', data);
        cart = [];
        saveCart();
        if (data.save_info) config.user = (await api('GET', '/api/me')).user;
        location.hash = `#/order/${r.order.id}?new=1`;
      } catch (err) {
        $('#coErr').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
        btn.disabled = false;
      }
    };
  }

  async function pageOrder(id, params) {
    if (!user()) { location.hash = '#/login'; return; }
    app.innerHTML = loading();
    let o;
    try { o = (await api('GET', `/api/me/orders/${Number(id)}`)).order; } catch (e) { if (e.status === 404) return pageNotFound(); throw e; }
    setTitle(`${t('order')} #${o.id}`);
    const isNew = params.get('new') === '1';
    app.innerHTML = breadcrumb([{ label: t('my_orders'), href: '#/account/orders' }, { label: `#${o.id}` }]) + `
      ${isNew ? `<div class="card success"><div class="ok-ico">${I.shield}</div><h1 style="color:var(--navy)">${t('order_placed')}</h1><p class="muted">${t('order_placed_sub')}</p></div><div style="height:16px"></div>` : ''}
      <div class="two-col">
        <div class="card">
          <div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
            <b style="color:var(--navy)">${t('order')} #${o.id}</b>${statusBadge(o.status)}
          </div>
          ${o.items.map((l) => `
            <div class="cart-line">
              <div class="p-img">${productImage({ ...l, name: l.name }, true)}</div>
              <div>
                <div class="cl-name">${esc(l.name)}</div>
                <div class="cl-row"><span class="muted">${money(l.unit_price)} × ${l.qty}</span><b>${money(l.unit_price * l.qty)}</b></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="card pad summary">
          <div class="row"><span>${t('date')}</span><span>${fmtDate(o.created_at)}</span></div>
          <div class="row"><span>${t('subtotal')}</span><span>${money(o.subtotal)}</span></div>
          <div class="row"><span>${t('delivery_fee')}</span><span>${money(o.delivery_fee)}</span></div>
          <div class="row total"><span>${t('total')}</span><span>${money(o.total)}</span></div>
          <hr style="border:0;border-top:1px solid var(--line)">
          <p style="margin:0;font-size:14px;line-height:1.8">
            <b>${esc(o.first_name)} ${esc(o.last_name)}</b><br>
            <span dir="ltr">${esc(o.phone)}${o.phone2 ? ` / ${esc(o.phone2)}` : ''}</span><br>
            ${o.delivery_type === 'desk' ? t('delivery_desk') : t('delivery_home')}<br>
            ${esc(String(o.wilaya).padStart(2, '0'))} - ${esc(lang === 'ar' ? o.wilaya_ar : o.wilaya_fr)}, ${esc(o.commune)}<br>
            ${o.address ? esc(o.address) : ''}
          </p>
          ${o.status === 'pending' ? `<button class="btn btn-ghost btn-block" style="margin-top:12px" id="cancelOrder">${t('cancel_order')}</button>` : ''}
        </div>
      </div>`;
    const c = $('#cancelOrder');
    if (c) c.onclick = async () => {
      if (!confirm(t('confirm_cancel'))) return;
      try { await api('POST', `/api/me/orders/${o.id}/cancel`, {}); pageOrder(o.id, new URLSearchParams()); } catch (e) { toast(errMsg(e), true); }
    };
  }

  // ------------------------------------------------ forms helpers
  function field(name, label, value = '', type = 'text', extra = '') {
    return `<div class="field"><label for="f_${name}">${label}</label><input class="input" id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  }
  function deliveryFields(u = {}) {
    const dt = u.delivery_type || 'home';
    return `
      <h2 class="section-title">${t('delivery_info')}</h2>
      <div class="field"><label>${t('delivery_type')}</label>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="delivery_type" value="home" ${dt === 'home' ? 'checked' : ''}><b>${t('delivery_home')}</b><i class="fee" data-fee="home"></i></label>
          <label class="choice"><input type="radio" name="delivery_type" value="desk" ${dt === 'desk' ? 'checked' : ''}><b>${t('delivery_desk')}</b><i class="fee" data-fee="desk"></i></label>
        </div>
      </div>
      <div class="grid-2">
        <div class="field"><label for="f_wilaya">${t('wilaya')}</label><select class="input" id="f_wilaya" name="wilaya">${wilayaOptions(u.wilaya)}</select></div>
        ${field('commune', t('commune'), u.commune || '', 'text', 'maxlength="80"')}
      </div>
      ${field('address', `${t('address')} <small data-addr-opt>${t('optional')}</small>`, u.address || '', 'text', 'maxlength="250"')}`;
  }
  function bindDeliveryFields(form, onChange) {
    const upd = () => {
      const w = config.wilayas.find((x) => x.code === Number(form.wilaya.value));
      $$('[data-fee]', form).forEach((s) => { s.innerHTML = w ? money(s.dataset.fee === 'desk' ? w.desk_fee : w.home_fee) : ''; });
      const opt = $('[data-addr-opt]', form);
      if (opt) opt.hidden = form.delivery_type.value === 'home';
    };
    form.wilaya.addEventListener('change', () => { upd(); onChange && onChange(); });
    $$('input[name="delivery_type"]', form).forEach((r) => r.addEventListener('change', () => { upd(); onChange && onChange(); }));
    upd();
  }
  function formData(form) {
    const d = {};
    for (const el of form.elements) {
      if (!el.name || el.type === 'submit') continue;
      if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; } else if (el.type === 'checkbox') d[el.name] = el.checked;
      else d[el.name] = el.value.trim();
    }
    return d;
  }

  // ------------------------------------------------ auth pages
  function pageLogin(params) {
    setTitle(t('login'));
    if (user()) { location.hash = '#/account'; return; }
    const next = params.get('next');
    app.innerHTML = `
      <div class="card pad auth-card">
        <h1>${t('login')}</h1><p class="sub">${t('login_sub')}</p>
        <form class="form" id="loginForm" novalidate>
          ${field('email', t('email'), '', 'email', 'autocomplete="email" required dir="ltr"')}
          ${field('password', t('password'), '', 'password', 'autocomplete="current-password" required')}
          <div id="lErr"></div>
          <button class="btn btn-navy btn-block" type="submit">${t('login')}</button>
          <p class="center muted" style="margin:0">${t('no_account')} <a class="link" href="#/register${next ? `?next=${esc(next)}` : ''}">${t('register')}</a></p>
        </form>
      </div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api('POST', '/api/auth/login', { email: f.email.value, password: f.password.value });
        config.user = r.user;
        renderChrome();
        location.hash = next === 'checkout' ? '#/checkout' : r.user.is_admin ? '#/account' : '#/';
      } catch (err) {
        $('#lErr').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
      }
    };
  }

  function pageRegister(pro, params) {
    setTitle(t('register'));
    if (user()) { location.hash = '#/account'; return; }
    const next = params.get('next');
    const srcs = ['facebook', 'instagram', 'tiktok', 'google', 'friend', 'other'];
    app.innerHTML = `
      <div class="card pad auth-card">
        <h1>${t('register')}</h1><p class="sub">${t('register_sub')}</p>
        <form class="form" id="regForm" novalidate>
          <div class="field"><label>${t('account_type')}</label>
            <div class="choice-grid">
              <label class="choice"><input type="radio" name="type" value="client" ${pro ? '' : 'checked'}><b>${t('type_client')}</b><span>${t('type_client_sub')}</span></label>
              <label class="choice"><input type="radio" name="type" value="repairer" ${pro ? 'checked' : ''}><b>${t('type_repairer')}</b><span>${t('type_repairer_sub')}</span></label>
            </div>
          </div>
          <div id="proBox" class="form" ${pro ? '' : 'hidden'}>
            ${field('shop_name', t('shop_name'), '', 'text', 'maxlength="100"')}
            <p class="note" style="margin:0">${t('pro_pending_note')}</p>
          </div>
          <div class="grid-2">
            ${field('last_name', t('last_name'), '', 'text', 'autocomplete="family-name" maxlength="60"')}
            ${field('first_name', t('first_name'), '', 'text', 'autocomplete="given-name" maxlength="60"')}
          </div>
          ${field('email', t('email'), '', 'email', 'autocomplete="email" dir="ltr"')}
          ${field('password', t('password'), '', 'password', `autocomplete="new-password" placeholder="${t('password_ph')}"`)}
          <div class="grid-2">
            ${field('phone', t('phone'), '', 'tel', 'autocomplete="tel" dir="ltr" placeholder="05XXXXXXXX"')}
            ${field('phone2', `${t('phone2')} <small>${t('optional')}</small>`, '', 'tel', 'dir="ltr"')}
          </div>
          <div class="field"><label for="f_source">${t('source')} <small>${t('optional')}</small></label>
            <select class="input" id="f_source" name="source"><option value="">—</option>${srcs.map((s) => `<option value="${s}">${t(`src_${s}`)}</option>`).join('')}</select></div>
          ${deliveryFields()}
          <div id="rErr"></div>
          <button class="btn btn-navy btn-block" type="submit">${t('register')}</button>
          <p class="center muted" style="margin:0">${t('have_account')} <a class="link" href="#/login${next ? `?next=${esc(next)}` : ''}">${t('login')}</a></p>
        </form>
      </div>`;
    const f = $('#regForm');
    bindDeliveryFields(f);
    $$('input[name="type"]', f).forEach((r) => { r.onchange = () => { $('#proBox').hidden = f.type.value !== 'repairer'; }; });
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/auth/register', formData(f));
        config.user = r.user;
        renderChrome();
        location.hash = next === 'checkout' ? '#/checkout' : '#/account';
      } catch (err) {
        $('#rErr').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
      }
    };
  }

  function accountTabs(on) {
    return `<div class="tabs">
      <a href="#/account" class="${on === 'info' ? 'on' : ''}">${t('my_info')}</a>
      <a href="#/account/orders" class="${on === 'orders' ? 'on' : ''}">${t('my_orders')}</a>
      <a href="#/account/security" class="${on === 'security' ? 'on' : ''}">${t('change_password')}</a>
    </div>`;
  }

  function proStatusNote(u) {
    if (u.type !== 'repairer') return '';
    const cls = u.pro_status === 'approved' ? 'form-ok' : u.pro_status === 'rejected' ? 'form-error' : 'note';
    return `<p class="${cls}" style="margin:0 0 14px">${t(`pro_status_${u.pro_status}`)}</p>`;
  }

  function pageAccount() {
    const u = user();
    if (!u) { location.hash = '#/login'; return; }
    setTitle(t('my_account'));
    app.innerHTML = `
      <div class="page-head"><h1>${t('hello')} ${esc(u.first_name)} 👋</h1>
        <div class="toolbar">
          ${u.is_admin ? `<a class="btn btn-navy btn-sm" href="/admin">${I.dashboard} ${t('admin_panel')}</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="logoutBtn">${I.logout} ${t('logout')}</button>
        </div>
      </div>
      ${accountTabs('info')}
      <div class="card pad" style="max-width:760px">
        ${proStatusNote(u)}
        <form class="form" id="accForm" novalidate>
          <div class="grid-2">
            ${field('last_name', t('last_name'), u.last_name)}
            ${field('first_name', t('first_name'), u.first_name)}
            ${field('phone', t('phone'), u.phone, 'tel', 'dir="ltr"')}
            ${field('phone2', `${t('phone2')} <small>${t('optional')}</small>`, u.phone2 || '', 'tel', 'dir="ltr"')}
          </div>
          <div class="field"><label>${t('email')}</label><input class="input" value="${esc(u.email)}" disabled dir="ltr"></div>
          ${u.type === 'repairer' ? field('shop_name', t('shop_name'), u.shop_name || '') : `
            <label class="check"><input type="checkbox" id="becomePro"> ${t('become_pro')}</label>
            <div id="proBox" hidden>${field('shop_name', t('shop_name'), '')}</div>`}
          ${deliveryFields(u)}
          <div id="aMsg"></div>
          <button class="btn btn-navy" type="submit">${t('save')}</button>
        </form>
      </div>`;
    $('#logoutBtn').onclick = logout;
    const f = $('#accForm');
    bindDeliveryFields(f);
    const bp = $('#becomePro');
    if (bp) bp.onchange = () => { $('#proBox').hidden = !bp.checked; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(f);
      if (bp && bp.checked) d.type = 'repairer';
      try {
        config.user = (await api('PUT', '/api/me', d)).user;
        toast(t('saved'));
        pageAccount();
      } catch (err) {
        $('#aMsg').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
      }
    };
  }

  async function pageMyOrders() {
    if (!user()) { location.hash = '#/login'; return; }
    setTitle(t('my_orders'));
    app.innerHTML = `<div class="page-head"><h1>${t('my_account')}</h1></div>${accountTabs('orders')}<div id="ol">${t('loading')}</div>`;
    const { orders } = await api('GET', '/api/me/orders');
    $('#ol').innerHTML = orders.length ? `
      <div class="card" style="overflow-x:auto">
        <table class="orders-table">
          <thead><tr><th>#</th><th>${t('date')}</th><th>${t('items')}</th><th>${t('total')}</th><th>${t('status')}</th><th></th></tr></thead>
          <tbody>${orders.map((o) => `<tr>
            <td><b>#${o.id}</b></td><td>${fmtDate(o.created_at)}</td><td>${o.items}</td><td style="white-space:nowrap"><b>${money(o.total)}</b></td>
            <td>${statusBadge(o.status)}</td><td><a class="btn btn-ghost btn-sm" href="#/order/${o.id}">${t('see')}</a></td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : empty(t('no_orders'), `<a class="btn" href="#/products">${t('continue_shopping')}</a>`);
  }

  function pageSecurity() {
    if (!user()) { location.hash = '#/login'; return; }
    setTitle(t('change_password'));
    app.innerHTML = `<div class="page-head"><h1>${t('my_account')}</h1></div>${accountTabs('security')}
      <form class="card pad form" id="pwForm" style="max-width:480px" novalidate>
        ${field('current', t('current_password'), '', 'password', 'autocomplete="current-password"')}
        ${field('password', t('new_password'), '', 'password', `autocomplete="new-password" placeholder="${t('password_ph')}"`)}
        <div id="pMsg"></div>
        <button class="btn btn-navy" type="submit">${t('save')}</button>
      </form>`;
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('PUT', '/api/me/password', { current: f.current.value, password: f.password.value });
        f.reset();
        $('#pMsg').innerHTML = `<p class="form-ok">${t('saved')}</p>`;
      } catch (err) {
        $('#pMsg').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
      }
    };
  }

  function pageRequest(params) {
    setTitle(t('req_title'));
    const u = user();
    app.innerHTML = `
      <div class="card pad auth-card">
        <h1>${t('req_title')}</h1><p class="sub">${t('req_sub')}</p>
        <form class="form" id="reqForm" novalidate>
          ${field('name', t('your_name'), u ? `${u.first_name} ${u.last_name}` : '', 'text', 'maxlength="80"')}
          ${field('phone', t('phone'), u ? u.phone : '', 'tel', 'dir="ltr" placeholder="05XXXXXXXX"')}
          ${field('phone_model', t('phone_model'), params.get('model') || '', 'text', 'maxlength="80" dir="ltr" placeholder="Redmi Note 12"')}
          ${field('part', t('part_needed'), '', 'text', 'maxlength="120"')}
          <div class="field"><label for="f_note">${t('note')} <small>${t('optional')}</small></label><textarea class="input" id="f_note" name="note" maxlength="500"></textarea></div>
          <div id="qMsg"></div>
          <button class="btn btn-block" type="submit">${t('send')}</button>
        </form>
      </div>`;
    $('#reqForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('POST', '/api/requests', formData(f));
        f.innerHTML = `<p class="form-ok">${t('req_sent')}</p><a class="btn btn-ghost" href="#/">${t('home')}</a>`;
      } catch (err) {
        $('#qMsg').innerHTML = `<p class="form-error">${esc(errMsg(err))}</p>`;
      }
    };
  }

  function pageNotFound() {
    setTitle(t('not_found'));
    app.innerHTML = empty(t('not_found'), `<a class="btn" href="#/">${t('home')}</a>`);
  }

  async function logout() {
    await api('POST', '/api/auth/logout', {});
    config.user = null;
    renderChrome();
    location.hash = '#/';
  }

  // ---------------------------------------------------------------- chrome (header, drawer, footer)
  function renderChrome() {
    const s = config.settings;
    const d = window.I18N[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = d.dir;
    const ann = lang === 'ar' ? s.announcement_ar : s.announcement_fr;
    $('#topbar').innerHTML = ann ? `${esc(ann)}${!user() ? ` <a href="#/register/pro">${t('pro_banner_btn')}</a>` : ''}` : '';
    $('#topbar').hidden = !ann;
    $('#menuBtn').innerHTML = I.menu;
    $('#drawerClose').innerHTML = I.close;
    $('#reqBtn').textContent = t('not_found_btn');
    $('#userBtn').innerHTML = I.user + (user() ? '<span class="user-dot"></span>' : '');
    $('#userBtn').setAttribute('href', user() ? '#/account' : '#/login');
    if (!$('#cartBtn svg')) $('#cartBtn').insertAdjacentHTML('afterbegin', I.cart);
    $('#searchBtn').innerHTML = I.search;
    $('#searchInput').placeholder = t('search_ph');
    $$('#langSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));

    const u = user();
    $('#drawerNav').innerHTML = `
      <a href="#/products"><span class="d-ico">${I.store}</span>${t('all_products')}</a>
      ${config.categories.map((c) => `<a href="#/category/${c.slug}"><span class="d-ico">${I.cat[c.icon] || I.cat.box}</span>${esc(catName(c))}<span class="d-count">${c.count}</span></a>`).join('')}
      <hr>
      <a href="#/request"><span class="d-ico" style="background:var(--navy)">${I.search}</span>${t('not_found_btn')}</a>
      ${u ? `<a href="#/account"><span class="d-ico" style="background:var(--navy)">${I.user}</span>${t('my_account')}</a>
             <a href="#/account/orders"><span class="d-ico" style="background:var(--navy)">${I.box}</span>${t('my_orders')}</a>
             ${u.is_admin ? `<a href="/admin"><span class="d-ico" style="background:var(--navy)">${I.dashboard}</span>${t('admin_panel')}</a>` : ''}`
          : `<a href="#/login"><span class="d-ico" style="background:var(--navy)">${I.user}</span>${t('login')}</a>
             <a href="#/register/pro"><span class="d-ico" style="background:var(--navy)">${I.tag}</span>${t('pro_banner_btn')}</a>`}`;

    const wa = $('#waBtn');
    wa.innerHTML = I.whatsapp;
    wa.hidden = !s.shop_whatsapp;
    wa.href = `https://wa.me/${encodeURIComponent(s.shop_whatsapp || '')}`;

    $('#footer').innerHTML = `
      <div class="container">
        <div class="f-grid">
          <div><span class="f-logo"><img src="/img/logo.svg" alt="Salah Phone"></span><p>${t('footer_about')}</p></div>
          <div><h4>${t('categories')}</h4>${config.categories.slice(0, 6).map((c) => `<a href="#/category/${c.slug}">${esc(catName(c))}</a>`).join('')}</div>
          <div><h4>${t('contact')}</h4>
            ${s.shop_phone ? `<a href="tel:${esc(s.shop_phone.replace(/\s/g, ''))}" dir="ltr">📞 ${esc(s.shop_phone)}</a>` : ''}
            ${s.shop_whatsapp ? `<a href="https://wa.me/${esc(s.shop_whatsapp)}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}
            ${s.shop_facebook ? `<a href="${esc(s.shop_facebook)}" target="_blank" rel="noopener">Facebook</a>` : ''}
            ${s.shop_instagram ? `<a href="${esc(s.shop_instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''}
            ${s.shop_address ? `<p style="margin:4px 0 0">📍 ${esc(s.shop_address)}</p>` : ''}
          </div>
        </div>
        <div class="copy">© ${new Date().getFullYear()} ${esc(s.shop_name || 'Salah Phone')} — ${t('rights')}</div>
      </div>`;
    saveCart();
  }

  function openDrawer(open) {
    $('#drawer').classList.toggle('open', open);
    $('#drawer').setAttribute('aria-hidden', String(!open));
  }

  // ---------------------------------------------------------------- search suggestions
  function setupSearch() {
    const input = $('#searchInput');
    const box = $('#suggest');
    let timer;
    let seq = 0;
    let active = -1;
    const hide = () => { box.hidden = true; active = -1; };
    const hl = (text, q) => {
      const safe = esc(text);
      const toks = q.trim().split(/\s+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!toks.length) return safe;
      return safe.replace(new RegExp(`(${toks.join('|')})`, 'ig'), '<mark>$1</mark>');
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { hide(); return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        const d = await api('GET', `/api/suggest?q=${encodeURIComponent(q)}`).catch(() => null);
        if (!d || my !== seq) return;
        if (!d.models.length && !d.products.length) { hide(); return; }
        box.innerHTML = `
          ${d.models.length ? `<div class="suggest-group"><div class="suggest-title">${t('phones_found')}</div>
            ${d.models.map((m) => `<a href="#/model/${esc(m.slug)}"><span class="s-thumb">${I.phone}</span><span class="s-name" dir="ltr">${hl(m.name, q)}</span><span class="s-meta">${m.count} ${t('products')}</span></a>`).join('')}</div>` : ''}
          ${d.products.length ? `<div class="suggest-group"><div class="suggest-title">${t('parts_found')}</div>
            ${d.products.map((p) => `<a href="#/product/${p.id}"><span class="s-thumb">${productImage(p, true)}</span><span dir="ltr">${hl(p.name, q)}</span><span class="s-meta">${p.in_stock ? money(p.price) : t('out_of_stock')}</span></a>`).join('')}</div>` : ''}`;
        box.hidden = false;
        active = -1;
      }, 180);
    });
    input.addEventListener('keydown', (e) => {
      const links = $$('a', box);
      if (box.hidden || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((l, i) => l.classList.toggle('active', i === active));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        location.hash = links[active].getAttribute('href');
        hide();
        input.blur();
      } else if (e.key === 'Escape') hide();
    });
    box.addEventListener('click', (e) => { if (e.target.closest('a')) { hide(); input.blur(); } });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) hide(); });
    $('#searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      hide();
      input.blur();
      if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
    });
  }

  // ---------------------------------------------------------------- router
  const routes = [
    [/^$/, () => pageHome()],
    [/^search\/(.+)$/, (m, p) => pageSearch(decodeURIComponent(m[1]), p)],
    [/^model\/([\w-]+)$/, (m, p) => pageModel(m[1], p)],
    [/^products$/, (m, p) => pageProducts(null, p)],
    [/^category\/([\w-]+)$/, (m, p) => pageProducts(m[1], p)],
    [/^product\/(\d+)$/, (m) => pageProduct(m[1])],
    [/^cart$/, () => pageCart()],
    [/^checkout$/, () => pageCheckout()],
    [/^order\/(\d+)$/, (m, p) => pageOrder(m[1], p)],
    [/^login$/, (m, p) => pageLogin(p)],
    [/^register$/, (m, p) => pageRegister(false, p)],
    [/^register\/pro$/, (m, p) => pageRegister(true, p)],
    [/^account$/, () => pageAccount()],
    [/^account\/orders$/, () => pageMyOrders()],
    [/^account\/security$/, () => pageSecurity()],
    [/^request$/, (m, p) => pageRequest(p)],
  ];

  let lastPath = null;
  async function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const params = new URLSearchParams(qs || '');
    openDrawer(false);
    $('#suggest').hidden = true;
    if (!path.startsWith('search/')) $('#searchInput').value = '';
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try { await fn(m, params); } catch (e) {
          console.error(e);
          app.innerHTML = empty(t('error'), `<button class="btn" onclick="location.reload()">↻</button>`);
        }
        return;
      }
    }
    pageNotFound();
  }

  // Boutons « Acheter » / « + panier » des cartes produits
  app.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const buy = e.target.closest('[data-buy]');
    if (add) { addToCart(Number(add.dataset.add)); toast(t('added')); }
    if (buy) { addToCart(Number(buy.dataset.buy)); location.hash = '#/cart'; }
  });

  // ---------------------------------------------------------------- boot
  async function boot() {
    try { config = await api('GET', '/api/config'); } catch (e) { console.error(e); }
    renderChrome();
    setupSearch();
    $('#menuBtn').onclick = () => openDrawer(true);
    $('#drawerClose').onclick = () => openDrawer(false);
    $('#drawer').onclick = (e) => { if (e.target.id === 'drawer') openDrawer(false); };
    $('#langSwitch').onclick = (e) => {
      const b = e.target.closest('[data-lang]');
      if (!b || b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      store.set('sp_lang', lang);
      renderChrome();
      route();
    };
    window.addEventListener('hashchange', route);
    route();
  }
  boot();
})();
