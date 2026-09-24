/* Salah Phone — panneau d'administration */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const I = window.ICONS;
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const da = (n) => `${Number(n || 0).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} DA`;
  const fmtDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const STATUS = { pending: 'En attente', confirmed: 'Confirmée', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée' };
  const PRO = { none: '—', pending: 'À valider', approved: 'Validé', rejected: 'Refusé' };
  const ERR = {
    name_required: 'Nom obligatoire', price_invalid: 'Prix invalide', exists: 'Existe déjà', brand_invalid: 'Marque invalide',
    image_invalid: 'Image invalide (jpg, png, webp — 4 Mo max)', admin_only: 'Accès réservé aux administrateurs',
    bad_credentials: 'Email ou mot de passe incorrect', too_many: 'Trop de tentatives', stock_invalid: 'Stock invalide',
  };
  let categories = [];
  let brandsCache = null;

  async function api(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      if (isForm) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* vide */ }
    if (!res.ok) {
      const e = new Error((data && data.error) || 'error');
      e.code = data && data.error;
      e.status = res.status;
      throw e;
    }
    return data;
  }
  const errText = (e) => ERR[e.code] || `Erreur (${e.code || e.message})`;

  // Photos prises avec un téléphone : souvent 3000×4000 px et plusieurs Mo.
  // On les réduit dans le navigateur (1200 px max, JPEG) avant l'envoi : upload rapide,
  // pas de refus « 4 Mo max », et un site léger pour les clients en 4G.
  const MAX_IMG = 1200;
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return file; // format non décodable : le serveur décidera
    }
    const scale = Math.min(1, MAX_IMG / Math.max(src.width, src.height));
    if (scale === 1 && file.size < 400 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  }
  async function uploadImage(file) {
    toast('Envoi de la photo…');
    const fd = new FormData();
    fd.append('image', await shrinkImage(file));
    const r = await api('POST', '/api/admin/upload', fd, true);
    toast('Photo ajoutée ✓');
    return r.url;
  }

  let tt;
  function toast(msg, err) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!err);
    el.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function modal(html) {
    $('#modalBox').innerHTML = html;
    $('#modal').hidden = false;
    return $('#modalBox');
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const statusPill = (s) => `<span class="status st-${s}">${STATUS[s]}</span>`;
  const proPill = (s) => `<span class="pill ${{ approved: 'ok', pending: 'warn', rejected: 'bad' }[s] || ''}">${PRO[s]}</span>`;
  const thumb = (img) => `<div class="thumb">${img ? `<img src="${esc(img)}" alt="">` : I.box}</div>`;
  const pager = (d, base) => (d.pages > 1 ? `<div class="pager">
      ${d.page > 1 ? `<a class="btn btn-ghost btn-sm" href="${base}page=${d.page - 1}">Précédent</a>` : ''}
      <span>${d.page} / ${d.pages} — ${d.total} résultats</span>
      ${d.page < d.pages ? `<a class="btn btn-ghost btn-sm" href="${base}page=${d.page + 1}">Suivant</a>` : ''}</div>` : '');

  // ------------------------------------------------------------ nav
  const NAV = [
    ['', 'Tableau de bord', 'dashboard'], ['orders', 'Commandes', 'box', 'orders_pending'], ['products', 'Produits', 'tag'],
    ['catalog', 'Marques & modèles', 'phone'], ['categories', 'Catégories', 'store'], ['users', 'Clients & réparateurs', 'users', 'pros_pending'],
    ['requests', 'Pièces demandées', 'inbox', 'requests_new'], ['delivery', 'Livraison', 'truck'], ['settings', 'Paramètres', 'settings'],
  ];
  let counts = {};
  function renderNav(active) {
    $('#aNav').innerHTML = NAV.map(([r, label, ic, cnt]) => `<a href="#/${r}" class="${active === r ? 'on' : ''}">${I[ic]}${label}${cnt && counts[cnt] ? `<span class="cnt">${counts[cnt]}</span>` : ''}</a>`).join('')
      + `<a href="#" id="aLogout">${I.logout}Déconnexion</a>`;
    $('#aLogout').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout', {}); location.href = '/'; };
  }
  async function refreshCounts() {
    try { counts = await api('GET', '/api/admin/stats'); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ dashboard
  async function pageDashboard() {
    const s = await api('GET', '/api/admin/stats');
    counts = s;
    view.innerHTML = `
      <div class="stats">
        <a class="card stat warn" href="#/orders?status=pending"><span>Commandes en attente</span><b>${s.orders_pending}</b></a>
        <div class="card stat"><span>Chiffre d'affaires (mois)</span><b>${da(s.revenue_month)}</b></div>
        <div class="card stat"><span>Chiffre d'affaires total</span><b>${da(s.revenue)}</b></div>
        <div class="card stat"><span>Commandes</span><b>${s.orders_total}</b></div>
        <a class="card stat ${s.pros_pending ? 'warn' : ''}" href="#/users?pro_status=pending"><span>Réparateurs à valider</span><b>${s.pros_pending}</b></a>
        <div class="card stat"><span>Clients inscrits</span><b>${s.users}</b></div>
        <a class="card stat" href="#/products"><span>Produits</span><b>${s.products}</b></a>
        <a class="card stat ${s.out_of_stock ? 'warn' : ''}" href="#/products?stock=out"><span>En rupture de stock</span><b>${s.out_of_stock}</b></a>
        <a class="card stat ${s.requests_new ? 'warn' : ''}" href="#/requests"><span>Pièces demandées</span><b>${s.requests_new}</b></a>
      </div>
      <div class="card">
        <div class="pad" style="display:flex;justify-content:space-between;align-items:center"><b style="color:var(--navy)">Dernières commandes</b><a class="link" href="#/orders">Tout voir</a></div>
        <div class="tbl-wrap">${ordersTable(s.recent_orders)}</div>
      </div>`;
  }

  function ordersTable(orders) {
    if (!orders.length) return '<p class="pad muted">Aucune commande.</p>';
    return `<table class="tbl"><thead><tr><th>#</th><th>Date</th><th>Client</th><th>Wilaya</th><th class="num">Total</th><th>Statut</th><th></th></tr></thead><tbody>
      ${orders.map((o) => `<tr>
        <td><b>#${o.id}</b></td><td class="small">${fmtDate(o.created_at)}</td>
        <td>${esc(o.first_name)} ${esc(o.last_name)} ${o.is_pro ? '<span class="pill info">Pro</span>' : ''}${o.phone ? `<div class="small" dir="ltr">${esc(o.phone)}</div>` : ''}</td>
        <td class="small">${o.wilaya_fr ? `${o.wilaya} - ${esc(o.wilaya_fr)}` : ''}</td>
        <td class="num"><b>${da(o.total)}</b></td><td>${statusPill(o.status)}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-order="${o.id}">Détails</button></td></tr>`).join('')}
      </tbody></table>`;
  }

  // ------------------------------------------------------------ orders
  async function pageOrders(p) {
    const status = p.get('status') || '';
    const q = p.get('q') || '';
    const page = p.get('page') || 1;
    const d = await api('GET', `/api/admin/orders?${new URLSearchParams({ status, q, page })}`);
    view.innerHTML = `
      <form class="a-bar" id="of">
        <input class="input" name="q" placeholder="N°, nom ou téléphone" value="${esc(q)}">
        <select class="input" name="status"><option value="">Tous les statuts</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn btn-navy btn-sm">Filtrer</button>
      </form>
      <div class="card tbl-wrap">${ordersTable(d.orders)}</div>
      ${pager(d, `#/orders?${new URLSearchParams({ status, q })}&`)}`;
    $('#of').onsubmit = (e) => { e.preventDefault(); location.hash = `#/orders?${new URLSearchParams(new FormData(e.target))}`; };
    $('#of').status.onchange = () => $('#of').requestSubmit();
  }

  async function openOrder(id) {
    const { order: o } = await api('GET', `/api/admin/orders/${id}`);
    const box = modal(`
      <h2>Commande #${o.id} ${statusPill(o.status)}</h2>
      <div class="grid-2">
        <div>
          <b>${esc(o.first_name)} ${esc(o.last_name)}</b> ${o.is_pro ? '<span class="pill info">Prix réparateur</span>' : ''}<br>
          <a class="link" dir="ltr" href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.phone2 ? ` / <a class="link" dir="ltr" href="tel:${esc(o.phone2)}">${esc(o.phone2)}</a>` : ''}<br>
          ${o.user ? `<span class="small muted">${esc(o.user.email)}${o.user.shop_name ? ` — ${esc(o.user.shop_name)}` : ''}</span>` : ''}
        </div>
        <div>
          <b>${o.delivery_type === 'desk' ? 'Stop desk' : 'À domicile'}</b><br>
          ${o.wilaya} - ${esc(o.wilaya_fr)}, ${esc(o.commune)}<br>${esc(o.address || '')}
        </div>
      </div>
      ${o.note ? `<p class="note" style="margin-top:12px">📝 ${esc(o.note)}</p>` : ''}
      <div class="tbl-wrap" style="margin-top:12px"><table class="tbl">
        <thead><tr><th>Produit</th><th class="num">Prix</th><th class="num">Qté</th><th class="num">Total</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${da(i.unit_price)}</td><td class="num">${i.qty}</td><td class="num">${da(i.unit_price * i.qty)}</td></tr>`).join('')}
          <tr><td colspan="3" class="num">Sous-total</td><td class="num">${da(o.subtotal)}</td></tr>
          <tr><td colspan="3" class="num">Livraison</td><td class="num">${da(o.delivery_fee)}</td></tr>
          <tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b>${da(o.total)}</b></td></tr>
        </tbody></table></div>
      <div class="field" style="margin-top:14px"><label>Changer le statut</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(STATUS).map(([k, v]) => `<button class="btn btn-sm ${k === o.status ? 'btn-navy' : 'btn-ghost'}" data-st="${k}">${v}</button>`).join('')}</div>
        <p class="small muted" style="margin:6px 0 0">L'annulation remet les articles en stock.</p>
      </div>
      <div class="modal-actions">
        <a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(o.phone))}?text=${encodeURIComponent(`Salah Phone — commande #${o.id} (${da(o.total)})`)}">${I.whatsapp} WhatsApp</a>
        <button class="btn btn-ghost btn-sm" onclick="window.print()">Imprimer</button>
        <button class="btn btn-ghost btn-sm" data-close>Fermer</button>
      </div>`);
    $('[data-close]', box).onclick = closeModal;
    $$('[data-st]', box).forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.st === o.status) return;
        try {
          await api('PUT', `/api/admin/orders/${o.id}/status`, { status: b.dataset.st });
          toast('Statut mis à jour');
          await refreshCounts();
          openOrder(o.id);
          route(true);
        } catch (e) { toast(errText(e), true); }
      };
    });
  }
  const waNumber = (p) => { const d = String(p).replace(/\D/g, ''); return d.startsWith('0') ? `213${d.slice(1)}` : d; };

  // ------------------------------------------------------------ products
  async function pageProducts(p) {
    const q = p.get('q') || '';
    const category = p.get('category') || '';
    const stock = p.get('stock') || '';
    const page = p.get('page') || 1;
    const d = await api('GET', `/api/admin/products?${new URLSearchParams({ q, category, stock, page })}`);
    view.innerHTML = `
      <form class="a-bar" id="pf">
        <input class="input" name="q" placeholder="Rechercher (nom ou modèle)" value="${esc(q)}">
        <select class="input" name="category"><option value="">Toutes catégories</option>${categories.map((c) => `<option value="${c.id}" ${String(c.id) === category ? 'selected' : ''}>${esc(c.name_fr)}</option>`).join('')}</select>
        <select class="input" name="stock"><option value="">Tout le stock</option><option value="low" ${stock === 'low' ? 'selected' : ''}>Stock faible (1-3)</option><option value="out" ${stock === 'out' ? 'selected' : ''}>En rupture</option></select>
        <button class="btn btn-navy btn-sm">Filtrer</button>
        <button type="button" class="btn btn-sm" id="newProd">${I.plus} Nouveau produit</button>
      </form>
      <div class="card tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>Produit</th><th>Catégorie</th><th class="num">Prix</th><th class="num">Prix pro</th><th>Stock</th><th></th></tr></thead>
        <tbody>${d.products.map((x) => `<tr>
          <td>${thumb(x.image)}</td>
          <td><b>${esc(x.name)}</b> ${x.is_active ? '' : '<span class="pill bad">Masqué</span>'}<div class="small">${esc(x.models || '')}</div></td>
          <td class="small">${esc(x.category || '')}</td>
          <td class="num">${da(x.price)}</td>
          <td class="num small">${x.pro_price === null ? 'auto' : da(x.pro_price)}</td>
          <td><input class="stock-in-input" type="number" min="0" value="${x.stock}" data-stock="${x.id}" style="${x.stock <= 0 ? 'border-color:var(--red)' : ''}"></td>
          <td class="actions"><button class="icon-sm" data-edit="${x.id}" title="Modifier">${I.edit}</button><button class="icon-sm danger" data-del="${x.id}" title="Supprimer">${I.trash}</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun produit.</td></tr>'}</tbody></table></div>
      ${pager(d, `#/products?${new URLSearchParams({ q, category, stock })}&`)}`;
    $('#pf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/products?${new URLSearchParams(new FormData(e.target))}`; };
    $('#newProd').onclick = () => productForm(null);
    $$('[data-edit]').forEach((b) => { b.onclick = () => productForm(Number(b.dataset.edit)); });
    $$('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Supprimer ce produit ?')) return;
        await api('DELETE', `/api/admin/products/${b.dataset.del}`);
        toast('Produit supprimé');
        route(true);
      };
    });
    $$('[data-stock]').forEach((i) => {
      i.onchange = async () => {
        try {
          await api('PATCH', `/api/admin/products/${i.dataset.stock}/stock`, { stock: Number(i.value) });
          i.style.borderColor = Number(i.value) <= 0 ? 'var(--red)' : 'var(--green)';
          toast('Stock mis à jour');
        } catch (e) { toast(errText(e), true); }
      };
    });
  }

  async function allModels() {
    if (!brandsCache) brandsCache = (await api('GET', '/api/admin/brands')).brands;
    return brandsCache.flatMap((b) => b.models.map((m) => ({ ...m, brand: b.name })));
  }

  async function productForm(id) {
    const [models, prod] = await Promise.all([allModels(), id ? api('GET', `/api/admin/products/${id}`).then((r) => r.product) : null]);
    const p = prod || { name: '', category_id: categories[0] && categories[0].id, price: '', pro_price: null, stock: 10, quality: 'Original', description: '', image: '', is_active: 1, model_ids: [] };
    let picked = new Set(p.model_ids);
    const box = modal(`
      <h2>${id ? 'Modifier le produit' : 'Nouveau produit'}</h2>
      <form class="form" id="prodForm" novalidate>
        <div class="field"><label>Nom du produit</label><input class="input" name="name" value="${esc(p.name)}" required placeholder="Afficheur Redmi 9A Original"></div>
        <div class="field"><label>Modèles compatibles</label>
          <div class="model-picker"><div class="picked" id="picked"></div>
            <input class="input" id="mSearch" placeholder="Tapez pour ajouter un modèle (ex : 9a)">
            <div class="opts" id="mOpts"></div></div></div>
        <div class="grid-2">
          <div class="field"><label>Catégorie</label><select class="input" name="category_id">${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name_fr)}</option>`).join('')}</select></div>
          <div class="field"><label>Qualité</label><input class="input" name="quality" value="${esc(p.quality || '')}" list="qualities" placeholder="Original, Incell, OLED..."><datalist id="qualities"><option>Original</option><option>Original Service Pack</option><option>Incell</option><option>OLED</option><option>TFT</option><option>Copie</option></datalist></div>
          <div class="field"><label>Prix normal (DA)</label><input class="input" name="price" type="number" min="0" value="${p.price}" required></div>
          <div class="field"><label>Prix réparateur (DA) <small>vide = remise auto</small></label><input class="input" name="pro_price" type="number" min="0" value="${p.pro_price ?? ''}"></div>
          <div class="field"><label>Stock</label><input class="input" name="stock" type="number" min="0" value="${p.stock}"></div>
          <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''}> Visible sur le site</label></div>
        </div>
        <div class="field"><label>Image</label>
          <div class="img-field"><div class="prev" id="imgPrev">${p.image ? `<img src="${esc(p.image)}" alt="">` : I.box}</div>
            <div style="flex:1;display:grid;gap:6px"><input type="file" accept="image/*" id="imgFile"><input class="input" name="image" value="${esc(p.image || '')}" placeholder="ou URL de l'image"></div></div></div>
        <div class="field"><label>Description <small>(optionnel)</small></label><textarea class="input" name="description">${esc(p.description || '')}</textarea></div>
        <div id="pErr"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-navy">Enregistrer</button></div>
      </form>`);
    const f = $('#prodForm', box);
    $('[data-close]', box).onclick = closeModal;
    const drawPicked = () => {
      $('#picked', box).innerHTML = [...picked].map((mid) => {
        const m = models.find((x) => x.id === mid);
        return m ? `<span>${esc(m.name)}<button type="button" data-unpick="${mid}">×</button></span>` : '';
      }).join('') || '<small class="muted">Aucun modèle (ex : outillage)</small>';
    };
    const drawOpts = () => {
      const q = $('#mSearch', box).value.toLowerCase().replace(/\s+/g, '');
      const list = q ? models.filter((m) => !picked.has(m.id) && `${m.brand}${m.name}`.toLowerCase().replace(/\s+/g, '').includes(q)).slice(0, 30) : [];
      $('#mOpts', box).innerHTML = list.map((m) => `<button type="button" data-pick="${m.id}">${esc(m.name)} <small>${esc(m.brand)}</small></button>`).join('');
    };
    box.addEventListener('click', (e) => {
      const pk = e.target.closest('[data-pick]');
      const up = e.target.closest('[data-unpick]');
      if (pk) { picked.add(Number(pk.dataset.pick)); $('#mSearch', box).value = ''; drawPicked(); drawOpts(); $('#mSearch', box).focus(); }
      if (up) { picked.delete(Number(up.dataset.unpick)); drawPicked(); drawOpts(); }
    });
    $('#mSearch', box).oninput = drawOpts;
    $('#mSearch', box).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = $('[data-pick]', box); if (first) first.click(); } };
    drawPicked();
    f.image.oninput = () => { $('#imgPrev', box).innerHTML = f.image.value ? `<img src="${esc(f.image.value)}" alt="">` : I.box; };
    $('#imgFile', box).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        f.image.value = await uploadImage(file);
        f.image.oninput();
      } catch (err) { toast(errText(err), true); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        name: f.name.value, category_id: Number(f.category_id.value), quality: f.quality.value, price: f.price.value,
        pro_price: f.pro_price.value, stock: f.stock.value, image: f.image.value, description: f.description.value,
        is_active: f.is_active.checked, model_ids: [...picked],
      };
      try {
        if (id) await api('PUT', `/api/admin/products/${id}`, body);
        else await api('POST', '/api/admin/products', body);
        closeModal();
        toast('Produit enregistré');
        route(true);
      } catch (err) { $('#pErr', box).innerHTML = `<p class="form-error">${esc(errText(err))}</p>`; }
    };
  }

  // ------------------------------------------------------------ brands & models
  async function pageCatalog() {
    brandsCache = (await api('GET', '/api/admin/brands')).brands;
    view.innerHTML = `
      <div class="a-bar"><p class="muted" style="margin:0;flex:1">Cliquez sur un modèle pour le modifier. Les clients cherchent les pièces par nom de modèle.</p>
        <button class="btn btn-sm" id="newBrand">${I.plus} Nouvelle marque</button></div>
      ${brandsCache.map((b) => `
        <div class="card brand-block">
          <div class="bh"><b>${esc(b.name)}</b><span class="small muted">${b.models.length} modèles</span>
            <button class="btn btn-ghost btn-sm" data-addm="${b.id}">${I.plus} Modèle</button>
            <button class="icon-sm" data-editb="${b.id}">${I.edit}</button>
            <button class="icon-sm danger" data-delb="${b.id}">${I.trash}</button></div>
          <div class="models">${b.models.map((m) => `<span class="chip" data-editm="${m.id}">${esc(m.name)} <small>(${m.count})</small></span>`).join('') || '<span class="muted small">Aucun modèle</span>'}</div>
        </div>`).join('')}`;
    $('#newBrand').onclick = () => brandForm(null);
    $$('[data-editb]').forEach((b) => { b.onclick = () => brandForm(brandsCache.find((x) => x.id === Number(b.dataset.editb))); });
    $$('[data-delb]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Supprimer cette marque et tous ses modèles ? (les produits restent)')) return;
        await api('DELETE', `/api/admin/brands/${b.dataset.delb}`);
        route(true);
      };
    });
    $$('[data-addm]').forEach((b) => { b.onclick = () => modelForm(null, Number(b.dataset.addm)); });
    $$('[data-editm]').forEach((c) => {
      c.onclick = () => {
        const m = brandsCache.flatMap((b) => b.models).find((x) => x.id === Number(c.dataset.editm));
        modelForm(m, m.brand_id);
      };
    });
  }

  function brandForm(b) {
    const box = modal(`<h2>${b ? 'Modifier la marque' : 'Nouvelle marque'}</h2>
      <form class="form" id="bf"><div class="grid-2">
        <div class="field"><label>Nom</label><input class="input" name="name" value="${esc(b ? b.name : '')}" required></div>
        <div class="field"><label>Ordre d'affichage</label><input class="input" name="sort" type="number" value="${b ? b.sort : 0}"></div></div>
        <div id="bErr"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-navy">Enregistrer</button></div></form>`);
    $('[data-close]', box).onclick = closeModal;
    $('#bf', box).onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: e.target.name.value, sort: e.target.sort.value };
      try {
        if (b) await api('PUT', `/api/admin/brands/${b.id}`, body); else await api('POST', '/api/admin/brands', body);
        closeModal(); route(true);
      } catch (err) { $('#bErr', box).innerHTML = `<p class="form-error">${esc(errText(err))}</p>`; }
    };
  }

  function modelForm(m, brandId) {
    const box = modal(`<h2>${m ? 'Modifier le modèle' : 'Nouveau modèle'}</h2>
      <form class="form" id="mf">
        <div class="grid-2">
          <div class="field"><label>Nom du modèle</label><input class="input" name="name" value="${esc(m ? m.name : '')}" placeholder="Redmi Note 13" required></div>
          <div class="field"><label>Marque</label><select class="input" name="brand_id">${brandsCache.map((b) => `<option value="${b.id}" ${b.id === brandId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Photo du téléphone <small>(optionnel)</small></label>
          <div class="img-field"><div class="prev" id="mPrev">${m && m.image ? `<img src="${esc(m.image)}" alt="">` : I.phone}</div>
          <div style="flex:1;display:grid;gap:6px"><input type="file" accept="image/*" id="mFile"><input class="input" name="image" value="${esc(m && m.image ? m.image : '')}" placeholder="ou URL"></div></div></div>
        <div id="mErr"></div>
        <div class="modal-actions">
          ${m ? `<button type="button" class="btn btn-ghost" style="color:var(--red);margin-inline-end:auto" id="delM">Supprimer</button>` : ''}
          <button type="button" class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-navy">Enregistrer</button></div></form>`);
    const f = $('#mf', box);
    $('[data-close]', box).onclick = closeModal;
    $('#mFile', box).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        f.image.value = await uploadImage(file);
        $('#mPrev', box).innerHTML = `<img src="${esc(f.image.value)}" alt="">`;
      } catch (err) { toast(errText(err), true); }
    };
    if (m) $('#delM', box).onclick = async () => {
      if (!confirm('Supprimer ce modèle ?')) return;
      await api('DELETE', `/api/admin/models/${m.id}`); closeModal(); route(true);
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, brand_id: Number(f.brand_id.value), image: f.image.value };
      try {
        if (m) await api('PUT', `/api/admin/models/${m.id}`, body); else await api('POST', '/api/admin/models', body);
        closeModal(); route(true);
      } catch (err) { $('#mErr', box).innerHTML = `<p class="form-error">${esc(errText(err))}</p>`; }
    };
  }

  // ------------------------------------------------------------ categories
  async function pageCategories() {
    categories = (await api('GET', '/api/admin/categories')).categories;
    const icons = Object.keys(I.cat);
    view.innerHTML = `
      <div class="card tbl-wrap"><table class="tbl">
        <thead><tr><th>Icône</th><th>Nom (FR)</th><th>Nom (AR)</th><th>Ordre</th><th></th></tr></thead>
        <tbody>${categories.map((c) => catRow(c, icons)).join('')}${catRow({ id: 0, name_fr: '', name_ar: '', icon: 'box', sort: 50 }, icons)}</tbody></table></div>
      <p class="small muted">La dernière ligne permet d'ajouter une catégorie.</p>`;
    $$('[data-savec]').forEach((b) => {
      b.onclick = async () => {
        const tr = b.closest('tr');
        const body = { name_fr: $('[name=fr]', tr).value, name_ar: $('[name=ar]', tr).value, icon: $('[name=icon]', tr).value, sort: $('[name=sort]', tr).value };
        try {
          const id = Number(b.dataset.savec);
          if (id) await api('PUT', `/api/admin/categories/${id}`, body); else await api('POST', '/api/admin/categories', body);
          toast('Enregistré'); route(true);
        } catch (e) { toast(errText(e), true); }
      };
    });
    $$('[data-delc]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Supprimer cette catégorie ? Les produits resteront sans catégorie.')) return;
        await api('DELETE', `/api/admin/categories/${b.dataset.delc}`); route(true);
      };
    });
  }
  const catRow = (c, icons) => `<tr>
    <td><select class="input" name="icon" style="width:110px;padding:6px">${icons.map((i) => `<option ${i === c.icon ? 'selected' : ''}>${i}</option>`).join('')}</select></td>
    <td><input class="input" name="fr" value="${esc(c.name_fr)}" placeholder="${c.id ? '' : 'Nouvelle catégorie'}" style="padding:6px 10px"></td>
    <td><input class="input" name="ar" value="${esc(c.name_ar)}" dir="rtl" style="padding:6px 10px"></td>
    <td><input class="input" name="sort" type="number" value="${c.sort}" style="width:70px;padding:6px"></td>
    <td class="actions"><button class="btn btn-navy btn-sm" data-savec="${c.id}">${c.id ? 'OK' : 'Ajouter'}</button>${c.id ? `<button class="icon-sm danger" data-delc="${c.id}">${I.trash}</button>` : ''}</td></tr>`;

  // ------------------------------------------------------------ users
  async function pageUsers(p) {
    const q = p.get('q') || '';
    const type = p.get('type') || '';
    const proStatus = p.get('pro_status') || '';
    const { users } = await api('GET', `/api/admin/users?${new URLSearchParams({ q, type, pro_status: proStatus })}`);
    view.innerHTML = `
      <form class="a-bar" id="uf">
        <input class="input" name="q" placeholder="Nom, email, téléphone, atelier" value="${esc(q)}">
        <select class="input" name="type"><option value="">Tous</option><option value="client" ${type === 'client' ? 'selected' : ''}>Particuliers</option><option value="repairer" ${type === 'repairer' ? 'selected' : ''}>Réparateurs</option></select>
        <select class="input" name="pro_status"><option value="">—</option><option value="pending" ${proStatus === 'pending' ? 'selected' : ''}>À valider</option></select>
        <button class="btn btn-navy btn-sm">Filtrer</button>
      </form>
      <div class="card tbl-wrap"><table class="tbl">
        <thead><tr><th>Client</th><th>Contact</th><th>Wilaya</th><th>Type</th><th>Statut pro</th><th class="num">Cmd</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td><b>${esc(u.first_name)} ${esc(u.last_name)}</b> ${u.is_admin ? '<span class="pill info">Admin</span>' : ''}${u.shop_name ? `<div class="small">🏪 ${esc(u.shop_name)}</div>` : ''}<div class="small">${fmtDate(u.created_at)}</div></td>
          <td class="small"><span dir="ltr">${esc(u.phone)}</span><br>${esc(u.email)}</td>
          <td class="small">${u.wilaya ? `${u.wilaya} - ${esc(u.wilaya_fr)}` : ''}${u.commune ? `<br>${esc(u.commune)}` : ''}</td>
          <td>${u.type === 'repairer' ? 'Réparateur' : 'Particulier'}</td>
          <td>${proPill(u.pro_status)}</td>
          <td class="num">${u.orders}</td>
          <td class="actions">
            ${u.type === 'repairer' && u.pro_status !== 'approved' ? `<button class="btn btn-sm" data-pro="${u.id}" data-v="approved" style="background:var(--green)">Valider</button>` : ''}
            ${u.type === 'repairer' && u.pro_status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" data-pro="${u.id}" data-v="rejected">${u.pro_status === 'approved' ? 'Retirer' : 'Refuser'}</button>` : ''}
            ${u.type === 'client' ? `<button class="btn btn-ghost btn-sm" data-mkpro="${u.id}">→ Réparateur</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun utilisateur.</td></tr>'}</tbody></table></div>`;
    $('#uf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/users?${new URLSearchParams(new FormData(e.target))}`; };
    $$('[data-pro]').forEach((b) => {
      b.onclick = async () => {
        await api('PUT', `/api/admin/users/${b.dataset.pro}`, { pro_status: b.dataset.v });
        toast(b.dataset.v === 'approved' ? 'Réparateur validé ✓' : 'Mis à jour');
        await refreshCounts(); route(true);
      };
    });
    $$('[data-mkpro]').forEach((b) => {
      b.onclick = async () => {
        await api('PUT', `/api/admin/users/${b.dataset.mkpro}`, { type: 'repairer', pro_status: 'approved' });
        toast('Compte passé en réparateur validé'); route(true);
      };
    });
  }

  // ------------------------------------------------------------ requests
  async function pageRequests() {
    const { requests } = await api('GET', '/api/admin/requests');
    view.innerHTML = `<div class="card tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Client</th><th>Modèle</th><th>Pièce</th><th>Remarque</th><th>Statut</th><th></th></tr></thead>
      <tbody>${requests.map((r) => `<tr style="${r.status === 'done' ? 'opacity:.55' : ''}">
        <td class="small">${fmtDate(r.created_at)}</td>
        <td><b>${esc(r.name)}</b><div class="small"><a class="link" dir="ltr" href="tel:${esc(r.phone)}">${esc(r.phone)}</a></div></td>
        <td><b>${esc(r.phone_model)}</b></td><td>${esc(r.part)}</td><td class="small">${esc(r.note || '')}</td>
        <td>${r.status === 'done' ? '<span class="pill ok">Traité</span>' : '<span class="pill warn">Nouveau</span>'}</td>
        <td class="actions">
          <a class="icon-sm" style="color:#25d366" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(r.phone))}?text=${encodeURIComponent(`Salah Phone — ${r.part} ${r.phone_model}`)}">${I.whatsapp}</a>
          <button class="btn btn-ghost btn-sm" data-rq="${r.id}" data-v="${r.status === 'done' ? 'new' : 'done'}">${r.status === 'done' ? 'Rouvrir' : 'Traité ✓'}</button>
          <button class="icon-sm danger" data-rqdel="${r.id}">${I.trash}</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune demande.</td></tr>'}
      </tbody></table></div>`;
    $$('[data-rq]').forEach((b) => { b.onclick = async () => { await api('PUT', `/api/admin/requests/${b.dataset.rq}`, { status: b.dataset.v }); await refreshCounts(); route(true); }; });
    $$('[data-rqdel]').forEach((b) => { b.onclick = async () => { if (confirm('Supprimer ?')) { await api('DELETE', `/api/admin/requests/${b.dataset.rqdel}`); await refreshCounts(); route(true); } }; });
  }

  // ------------------------------------------------------------ delivery
  async function pageDelivery() {
    const { wilayas } = await api('GET', '/api/admin/delivery');
    view.innerHTML = `
      <div class="a-bar"><p class="muted" style="margin:0;flex:1">Frais de livraison par wilaya (DA). Décochez une wilaya pour ne plus y livrer.</p>
        <button class="btn btn-sm" id="saveDel">Enregistrer</button></div>
      <div class="card tbl-wrap"><table class="tbl" id="delTbl">
        <thead><tr><th>Wilaya</th><th class="num">À domicile</th><th class="num">Stop desk</th><th>Active</th></tr></thead>
        <tbody>${wilayas.map((w) => `<tr data-w="${w.wilaya}">
          <td><b>${String(w.wilaya).padStart(2, '0')}</b> ${esc(w.name_fr)} <span class="small" dir="rtl">${esc(w.name_ar)}</span></td>
          <td class="num"><input class="stock-in-input" style="width:90px" type="number" min="0" name="home" value="${w.home_fee}"></td>
          <td class="num"><input class="stock-in-input" style="width:90px" type="number" min="0" name="desk" value="${w.desk_fee}"></td>
          <td><input type="checkbox" name="en" ${w.enabled ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>`;
    $('#saveDel').onclick = async () => {
      const rows = $$('#delTbl tbody tr').map((tr) => ({ wilaya: Number(tr.dataset.w), home_fee: $('[name=home]', tr).value, desk_fee: $('[name=desk]', tr).value, enabled: $('[name=en]', tr).checked }));
      await api('PUT', '/api/admin/delivery', { wilayas: rows });
      toast('Frais de livraison enregistrés');
    };
  }

  // ------------------------------------------------------------ settings
  async function pageSettings() {
    const { settings: s } = await api('GET', '/api/admin/settings');
    const f = (k, label, extra = '') => `<div class="field"><label>${label}</label><input class="input" name="${k}" value="${esc(s[k] || '')}" ${extra}></div>`;
    view.innerHTML = `
      <form class="card pad form" id="sf" style="max-width:760px">
        <h2 class="section-title">Boutique</h2>
        <div class="grid-2">
          ${f('shop_name', 'Nom de la boutique')}
          ${f('shop_phone', 'Téléphone', 'dir="ltr"')}
          ${f('shop_whatsapp', 'WhatsApp (format international, ex : 213550000000)', 'dir="ltr"')}
          ${f('shop_address', 'Adresse')}
          ${f('shop_facebook', 'Lien Facebook', 'dir="ltr"')}
          ${f('shop_instagram', 'Lien Instagram', 'dir="ltr"')}
        </div>
        <h2 class="section-title">Réparateurs</h2>
        ${f('pro_discount_percent', 'Remise automatique réparateurs (%) — appliquée quand un produit n’a pas de « prix réparateur »', 'type="number" min="0" max="90"')}
        <h2 class="section-title">Bandeau d'annonce</h2>
        ${f('announcement_ar', 'Texte en arabe', 'dir="rtl"')}
        ${f('announcement_fr', 'Texte en français')}
        <button class="btn btn-navy">Enregistrer</button>
      </form>
      <div class="card pad form" style="max-width:760px;margin-top:16px;border-color:var(--red)">
        <h2 class="section-title" style="color:var(--red)">Vider le catalogue</h2>
        <p class="muted" style="margin:0">Supprime <b>tous</b> les produits, catégories, marques et modèles. Les commandes, clients,
          frais de livraison et paramètres sont conservés. Cette action est irréversible.</p>
        <div class="field"><label>Tapez <b>SUPPRIMER</b> pour confirmer</label><input class="input" id="wipeConfirm" autocomplete="off"></div>
        <button class="btn" id="wipeBtn" style="background:var(--red);justify-self:start" disabled>Vider le catalogue</button>
      </div>
      <form class="card pad form" id="pwf" style="max-width:760px;margin-top:16px">
        <h2 class="section-title">Mot de passe administrateur</h2>
        <div class="grid-2">
          <div class="field"><label>Mot de passe actuel</label><input class="input" type="password" name="current" autocomplete="current-password"></div>
          <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" name="password" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-navy">Changer</button>
      </form>`;
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      await api('PUT', '/api/admin/settings', Object.fromEntries(new FormData(e.target)));
      toast('Paramètres enregistrés');
    };
    $('#wipeConfirm').oninput = (e) => { $('#wipeBtn').disabled = e.target.value.trim() !== 'SUPPRIMER'; };
    $('#wipeBtn').onclick = async () => {
      if (!confirm('Supprimer définitivement tout le catalogue ?')) return;
      try {
        const r = await api('POST', '/api/admin/catalog/wipe', { confirm: 'SUPPRIMER' });
        categories = [];
        brandsCache = null;
        $('#wipeConfirm').value = '';
        $('#wipeBtn').disabled = true;
        toast(`Supprimé : ${r.deleted.products} produits, ${r.deleted.categories} catégories, ${r.deleted.brands} marques, ${r.deleted.models} modèles`);
      } catch (err) { toast(errText(err), true); }
    };
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/me/password', Object.fromEntries(new FormData(e.target)));
        e.target.reset(); toast('Mot de passe changé');
      } catch (err) { toast(err.code === 'password_short' ? 'Mot de passe trop court (6 min.)' : errText(err), true); }
    };
  }

  // ------------------------------------------------------------ login
  function pageLogin(msg) {
    $('#side').hidden = true;
    $('.a-top').hidden = true;
    view.innerHTML = `<div class="card pad login-wrap">
      <img src="/img/logo.svg" alt="Salah Phone" style="height:44px;margin:0 auto 16px">
      <h1 style="color:var(--navy);font-size:22px">Administration</h1>
      ${msg ? `<p class="form-error">${esc(msg)}</p>` : ''}
      <form class="form" id="lf">
        <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>Mot de passe</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
        <div id="lErr"></div>
        <button class="btn btn-navy btn-block">Se connecter</button>
      </form></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/auth/login', Object.fromEntries(new FormData(e.target)));
        if (!r.user.is_admin) { $('#lErr').innerHTML = '<p class="form-error">Ce compte n\'est pas administrateur.</p>'; return; }
        location.reload();
      } catch (err) { $('#lErr').innerHTML = `<p class="form-error">${esc(errText(err))}</p>`; }
    };
  }

  // ------------------------------------------------------------ router
  const ROUTES = {
    '': ['Tableau de bord', pageDashboard], orders: ['Commandes', pageOrders], products: ['Produits', pageProducts],
    catalog: ['Marques & modèles', pageCatalog], categories: ['Catégories', pageCategories], users: ['Clients & réparateurs', pageUsers],
    requests: ['Pièces demandées', pageRequests], delivery: ['Frais de livraison', pageDelivery], settings: ['Paramètres', pageSettings],
  };
  async function route(keepScroll) {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const r = ROUTES[path] || ROUTES[''];
    $('#aTitle').textContent = r[0];
    document.title = `${r[0]} — Admin Salah Phone`;
    renderNav(ROUTES[path] ? path : '');
    $('#side').classList.remove('open');
    const y = window.scrollY;
    try {
      await r[1](new URLSearchParams(qs || ''));
      if (keepScroll === true) window.scrollTo(0, y); else window.scrollTo(0, 0);
    } catch (e) {
      if (e.status === 401 || e.status === 403) return pageLogin(e.status === 403 ? 'Accès réservé aux administrateurs.' : '');
      console.error(e);
      view.innerHTML = `<p class="form-error">${esc(errText(e))}</p>`;
    }
    renderNav(ROUTES[path] ? path : '');
  }

  view.addEventListener('click', (e) => {
    const o = e.target.closest('[data-order]');
    if (o) openOrder(Number(o.dataset.order)).catch((err) => toast(errText(err), true));
  });

  async function boot() {
    $('#sideBtn').innerHTML = I.menu;
    $('#sideBtn').onclick = () => $('#side').classList.toggle('open');
    const { user } = await api('GET', '/api/me');
    if (!user || !user.is_admin) return pageLogin(user ? 'Ce compte n\'est pas administrateur.' : '');
    categories = (await api('GET', '/api/admin/categories')).categories;
    await refreshCounts();
    window.addEventListener('hashchange', () => route());
    route();
  }
  boot();
})();
