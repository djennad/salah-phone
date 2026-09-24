const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { hashPassword, verifyPassword, newToken } = require('./security');
const { slugify, tx } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'sp_session';
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
const bad = (code, msg) => new HttpError(400, code, msg);

// ---------- helpers ----------
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function tokens(q) {
  return String(q || '').toLowerCase().split(/\s+/).map(norm).filter(Boolean);
}
function str(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
function int(v, def = null) {
  if (v === '' || v === undefined || v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const PHONE_RE = /^0[5-7]\d{8}$|^0[2-4]\d{7,8}$|^\+?213\d{8,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanPhone(p) {
  return str(p, 30).replace(/[\s.-]/g, '');
}

function createApp(db, opts = {}) {
  const uploadDir = opts.uploadDir || path.join(__dirname, '..', 'uploads');
  const publicDir = path.join(__dirname, '..', 'public');
  const secureCookie = !!opts.secureCookie;
  fs.mkdirSync(uploadDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // ---------- settings / pricing ----------
  const getSettings = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const discountPercent = () => Math.min(90, Math.max(0, Number(getSettings().pro_discount_percent) || 0));
  const isPro = (user) => !!user && user.type === 'repairer' && user.pro_status === 'approved';

  function proPriceOf(p, pct) {
    if (p.pro_price !== null && p.pro_price !== undefined) return p.pro_price;
    return Math.round((p.price * (100 - pct)) / 100 / 10) * 10;
  }
  function publicProduct(p, user, pct) {
    const pro = isPro(user);
    return {
      id: p.id,
      name: p.name,
      category_id: p.category_id,
      category_slug: p.category_slug,
      quality: p.quality,
      description: p.description,
      image: p.image,
      in_stock: p.stock > 0,
      stock: p.stock > 0 ? Math.min(p.stock, 99) : 0,
      price: pro ? proPriceOf(p, pct) : p.price,
      price_public: p.price,
      pro_price: pro ? proPriceOf(p, pct) : null,
      is_new: p.is_new === 1,
    };
  }
  const PRODUCT_SELECT = `SELECT p.*, c.slug AS category_slug,
      (p.created_at >= datetime('now','-15 days')) AS is_new
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

  // ---------- session ----------
  const loginAttempts = new Map();
  function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const e = loginAttempts.get(key);
    if (!e || e.reset < now) {
      loginAttempts.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    e.n++;
    return e.n <= max;
  }

  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.user = null;
    if (token) {
      const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                              WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
      if (row) {
        req.user = row;
        req.sessionToken = token;
      }
    }
    next();
  });

  // Protection CSRF : les requêtes qui modifient des données doivent venir du même site.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = null; }
      if (host !== req.headers.host) return next(new HttpError(403, 'bad_origin'));
    }
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json') && !ct.startsWith('multipart/form-data') && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) {
      return next(new HttpError(415, 'unsupported_media_type'));
    }
    next();
  });

  function startSession(res, userId) {
    const token = newToken();
    const expires = Date.now() + SESSION_DAYS * 864e5;
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookie ? '; Secure' : ''}`);
  }

  const requireUser = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'login_required')));
  const requireAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : next(new HttpError(req.user ? 403 : 401, 'admin_only')));

  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email,
      phone: u.phone, phone2: u.phone2, type: u.type, shop_name: u.shop_name, pro_status: u.pro_status,
      is_pro: isPro(u), delivery_type: u.delivery_type, wilaya: u.wilaya, commune: u.commune,
      address: u.address, is_admin: !!u.is_admin, source: u.source,
    };
  }

  function validateProfile(b, { partial = false } = {}) {
    const out = {
      first_name: str(b.first_name, 60),
      last_name: str(b.last_name, 60),
      phone: cleanPhone(b.phone),
      phone2: cleanPhone(b.phone2) || null,
      delivery_type: b.delivery_type === 'desk' ? 'desk' : 'home',
      wilaya: int(b.wilaya),
      commune: str(b.commune, 80) || null,
      address: str(b.address, 250) || null,
      shop_name: str(b.shop_name, 100) || null,
    };
    if (!out.first_name || !out.last_name) throw bad('name_required');
    if (!PHONE_RE.test(out.phone)) throw bad('phone_invalid');
    if (out.phone2 && !PHONE_RE.test(out.phone2)) throw bad('phone_invalid');
    if (out.wilaya !== null && !db.prepare('SELECT 1 FROM delivery_fees WHERE wilaya = ?').get(out.wilaya)) throw bad('wilaya_invalid');
    if (!partial && out.wilaya === null) throw bad('wilaya_required');
    return out;
  }

  // =====================================================================
  // PUBLIC API
  // =====================================================================
  app.get('/api/config', (req, res) => {
    const s = getSettings();
    res.json({
      settings: {
        shop_name: s.shop_name, shop_phone: s.shop_phone, shop_whatsapp: s.shop_whatsapp,
        shop_address: s.shop_address, shop_facebook: s.shop_facebook, shop_instagram: s.shop_instagram,
        pro_discount_percent: discountPercent(), announcement_ar: s.announcement_ar, announcement_fr: s.announcement_fr,
      },
      categories: db.prepare(`SELECT c.id, c.slug, c.name_fr, c.name_ar, c.icon,
          (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS count
        FROM categories c ORDER BY c.sort, c.id`).all(),
      wilayas: db.prepare('SELECT wilaya AS code, name_fr, name_ar, home_fee, desk_fee FROM delivery_fees WHERE enabled = 1 ORDER BY wilaya').all(),
      user: publicUser(req.user),
    });
  });

  const modelCountSql = `SELECT m.id, m.name, m.slug, m.image, b.name AS brand, b.id AS brand_id,
      (SELECT COUNT(*) FROM product_models pm JOIN products p ON p.id = pm.product_id
        WHERE pm.model_id = m.id AND p.is_active = 1) AS count
    FROM models m JOIN brands b ON b.id = m.brand_id`;

  app.get('/api/brands', (req, res) => {
    const brands = db.prepare('SELECT id, name FROM brands ORDER BY sort, name').all();
    const models = db.prepare(`${modelCountSql} ORDER BY m.name`).all();
    for (const b of brands) b.models = models.filter((m) => m.brand_id === b.id);
    res.json({ brands });
  });

  function searchModels(q, limit) {
    const toks = tokens(q);
    const whole = norm(q);
    if (!whole) return [];
    const all = db.prepare(modelCountSql).all();
    const scored = [];
    for (const m of all) {
      const key = norm(`${m.brand} ${m.name}`);
      const nameKey = norm(m.name);
      const ok = key.includes(whole) || toks.every((t) => key.includes(t));
      if (!ok) continue;
      let score = 0;
      if (nameKey === whole || key === whole) score += 100;
      if (nameKey.startsWith(whole)) score += 50;
      score -= nameKey.length;
      scored.push({ m, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.m);
  }

  function searchProducts(q, limit, offset = 0) {
    const toks = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!toks.length) return { total: 0, rows: [] };
    const where = toks.map(() => `(p.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_models pm JOIN models m ON m.id = pm.model_id JOIN brands b ON b.id = m.brand_id WHERE pm.product_id = p.id AND (m.name || ' ' || b.name) LIKE ? ESCAPE '\\'))`).join(' AND ');
    const params = [];
    for (const t of toks) {
      const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND ${where}`).get(...params).n;
    const rows = db.prepare(`${PRODUCT_SELECT} WHERE p.is_active = 1 AND ${where} ORDER BY (p.stock > 0) DESC, p.name LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { total, rows };
  }

  app.get('/api/suggest', (req, res) => {
    const q = str(req.query.q, 80);
    const pct = discountPercent();
    res.json({
      models: searchModels(q, 8),
      products: searchProducts(q, 5).rows.map((p) => publicProduct(p, req.user, pct)),
    });
  });

  app.get('/api/search', (req, res) => {
    const q = str(req.query.q, 80);
    const page = Math.max(1, int(req.query.page, 1));
    const per = 24;
    const pct = discountPercent();
    const r = searchProducts(q, per, (page - 1) * per);
    res.json({
      q,
      models: page === 1 ? searchModels(q, 30) : [],
      products: r.rows.map((p) => publicProduct(p, req.user, pct)),
      total: r.total,
      page,
      pages: Math.max(1, Math.ceil(r.total / per)),
    });
  });

  app.get('/api/models/:slug', (req, res, next) => {
    const model = db.prepare(`${modelCountSql} WHERE m.slug = ?`).get(req.params.slug);
    if (!model) return next(new HttpError(404, 'not_found'));
    const pct = discountPercent();
    const products = db.prepare(`${PRODUCT_SELECT} JOIN product_models pm ON pm.product_id = p.id
      WHERE pm.model_id = ? AND p.is_active = 1 ORDER BY c.sort, (p.stock > 0) DESC, p.name`).all(model.id);
    res.json({ model, products: products.map((p) => publicProduct(p, req.user, pct)) });
  });

  app.get('/api/products', (req, res) => {
    const per = Math.min(48, Math.max(1, int(req.query.limit, 24)));
    const page = Math.max(1, int(req.query.page, 1));
    const conds = ['p.is_active = 1'];
    const params = [];
    let category = null;
    if (req.query.category) {
      category = db.prepare('SELECT id, slug, name_fr, name_ar FROM categories WHERE slug = ?').get(str(req.query.category, 60));
      if (!category) return res.json({ products: [], total: 0, page, pages: 1, category: null });
      conds.push('p.category_id = ?');
      params.push(category.id);
    }
    if (req.query.brand) {
      conds.push('EXISTS (SELECT 1 FROM product_models pm JOIN models m ON m.id = pm.model_id WHERE pm.product_id = p.id AND m.brand_id = ?)');
      params.push(int(req.query.brand, 0));
    }
    if (req.query.in_stock === '1') conds.push('p.stock > 0');
    const order = { new: 'p.created_at DESC, p.id DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', name: 'p.name ASC' }[req.query.sort] || 'p.id DESC';
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where}`).get(...params).n;
    const rows = db.prepare(`${PRODUCT_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, per, (page - 1) * per);
    const pct = discountPercent();
    res.json({ products: rows.map((p) => publicProduct(p, req.user, pct)), total, page, pages: Math.max(1, Math.ceil(total / per)), category });
  });

  app.get('/api/products/:id', (req, res, next) => {
    const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.is_active = 1`).get(int(req.params.id, 0));
    if (!p) return next(new HttpError(404, 'not_found'));
    const models = db.prepare(`SELECT m.name, m.slug, b.name AS brand FROM product_models pm
      JOIN models m ON m.id = pm.model_id JOIN brands b ON b.id = m.brand_id WHERE pm.product_id = ? ORDER BY m.name`).all(p.id);
    const category = db.prepare('SELECT slug, name_fr, name_ar FROM categories WHERE id = ?').get(p.category_id);
    res.json({ product: { ...publicProduct(p, req.user, discountPercent()), models, category } });
  });

  // Calcul du panier (prix, stock, livraison) — les prix viennent toujours du serveur.
  function quote(items, user, wilaya, deliveryType) {
    if (!Array.isArray(items)) throw bad('cart_invalid');
    const pct = discountPercent();
    const merged = new Map();
    for (const it of items.slice(0, 100)) {
      const id = int(it && it.id, 0);
      const qty = Math.min(99, Math.max(1, int(it && it.qty, 1)));
      if (id > 0) merged.set(id, Math.min(99, (merged.get(id) || 0) + qty));
    }
    const lines = [];
    let subtotal = 0;
    for (const [id, qty] of merged) {
      const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
      if (!p || !p.is_active) {
        lines.push({ id, unavailable: true, qty });
        continue;
      }
      const pub = publicProduct(p, user, pct);
      const line = { ...pub, qty, stock: p.stock, line_total: pub.price * qty, enough_stock: p.stock >= qty };
      subtotal += line.line_total;
      lines.push(line);
    }
    let delivery_fee = null;
    const w = wilaya ? db.prepare('SELECT * FROM delivery_fees WHERE wilaya = ? AND enabled = 1').get(int(wilaya, 0)) : null;
    if (w) delivery_fee = deliveryType === 'desk' ? w.desk_fee : w.home_fee;
    return { lines, subtotal, delivery_fee, total: subtotal + (delivery_fee || 0), is_pro: isPro(user) };
  }

  app.post('/api/cart/quote', (req, res) => {
    const b = req.body || {};
    res.json(quote(b.items, req.user, b.wilaya, b.delivery_type));
  });

  // « Produit n'existe pas » — demande d'une pièce introuvable
  app.post('/api/requests', (req, res) => {
    const b = req.body || {};
    if (!rateLimit(`req:${req.ip}`, 10, 60 * 60e3)) throw new HttpError(429, 'too_many');
    const r = {
      name: str(b.name, 80) || (req.user ? `${req.user.first_name} ${req.user.last_name}` : ''),
      phone: cleanPhone(b.phone) || (req.user ? req.user.phone : ''),
      phone_model: str(b.phone_model, 80),
      part: str(b.part, 120),
      note: str(b.note, 500) || null,
    };
    if (!r.name) throw bad('name_required');
    if (!PHONE_RE.test(r.phone)) throw bad('phone_invalid');
    if (!r.phone_model || !r.part) throw bad('fields_required');
    db.prepare('INSERT INTO part_requests (user_id, name, phone, phone_model, part, note) VALUES (?,?,?,?,?,?)')
      .run(req.user ? req.user.id : null, r.name, r.phone, r.phone_model, r.part, r.note);
    res.status(201).json({ ok: true });
  });

  // =====================================================================
  // AUTH
  // =====================================================================
  app.post('/api/auth/register', (req, res) => {
    const b = req.body || {};
    if (!rateLimit(`reg:${req.ip}`, 10, 60 * 60e3)) throw new HttpError(429, 'too_many');
    const email = str(b.email, 120).toLowerCase();
    const password = String(b.password || '');
    if (!EMAIL_RE.test(email)) throw bad('email_invalid');
    if (password.length < 6 || password.length > 200) throw bad('password_short');
    const p = validateProfile(b);
    const type = b.type === 'repairer' ? 'repairer' : 'client';
    if (type === 'repairer' && !p.shop_name) throw bad('shop_required');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'email_taken');
    const r = db.prepare(`INSERT INTO users (first_name, last_name, email, password_hash, phone, phone2, type, shop_name,
        pro_status, source, delivery_type, wilaya, commune, address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.first_name, p.last_name, email, hashPassword(password), p.phone, p.phone2, type,
        type === 'repairer' ? p.shop_name : null, type === 'repairer' ? 'pending' : 'none',
        str(b.source, 60) || null, p.delivery_type, p.wilaya, p.commune, p.address);
    startSession(res, Number(r.lastInsertRowid));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 120).toLowerCase();
    if (!rateLimit(`login:${req.ip}:${email}`, 10, 15 * 60e3)) throw new HttpError(429, 'too_many');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(String(b.password || ''), user.password_hash)) throw new HttpError(401, 'bad_credentials');
    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

  app.put('/api/me', requireUser, (req, res) => {
    const b = req.body || {};
    const p = validateProfile({ ...b, shop_name: b.shop_name ?? req.user.shop_name }, { partial: true });
    let { type, pro_status: proStatus } = req.user;
    // Un client peut demander à devenir réparateur (validation par l'admin)
    if (b.type === 'repairer' && type === 'client') {
      if (!p.shop_name) throw bad('shop_required');
      type = 'repairer';
      proStatus = 'pending';
    }
    db.prepare(`UPDATE users SET first_name=?, last_name=?, phone=?, phone2=?, delivery_type=?, wilaya=?, commune=?,
        address=?, shop_name=?, type=?, pro_status=? WHERE id=?`)
      .run(p.first_name, p.last_name, p.phone, p.phone2, p.delivery_type, p.wilaya, p.commune, p.address,
        type === 'repairer' ? p.shop_name : null, type, proStatus, req.user.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  app.put('/api/me/password', requireUser, (req, res) => {
    const b = req.body || {};
    if (!verifyPassword(String(b.current || ''), req.user.password_hash)) throw new HttpError(401, 'bad_credentials');
    const pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 200) throw bad('password_short');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });

  // =====================================================================
  // ORDERS
  // =====================================================================
  app.post('/api/orders', requireUser, (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const ship = validateProfile({
      first_name: b.first_name ?? u.first_name, last_name: b.last_name ?? u.last_name,
      phone: b.phone ?? u.phone, phone2: b.phone2 ?? u.phone2, delivery_type: b.delivery_type ?? u.delivery_type,
      wilaya: b.wilaya ?? u.wilaya, commune: b.commune ?? u.commune, address: b.address ?? u.address,
    });
    if (!ship.commune) throw bad('commune_required');
    if (ship.delivery_type === 'home' && !ship.address) throw bad('address_required');

    const orderId = tx(db, () => {
      const q = quote(b.items, u, ship.wilaya, ship.delivery_type);
      const lines = q.lines.filter((l) => !l.unavailable);
      if (!lines.length) throw bad('cart_empty');
      if (q.lines.some((l) => l.unavailable)) throw bad('product_unavailable');
      const short = lines.find((l) => !l.enough_stock);
      if (short) throw new HttpError(409, 'out_of_stock', short.name);
      if (q.delivery_fee === null) throw bad('wilaya_invalid');

      const r = db.prepare(`INSERT INTO orders (user_id, is_pro, subtotal, delivery_fee, total, first_name, last_name, phone,
          phone2, delivery_type, wilaya, commune, address, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(u.id, q.is_pro ? 1 : 0, q.subtotal, q.delivery_fee, q.total, ship.first_name, ship.last_name, ship.phone,
          ship.phone2, ship.delivery_type, ship.wilaya, ship.commune, ship.address, str(b.note, 500) || null);
      const id = Number(r.lastInsertRowid);
      const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, qty) VALUES (?,?,?,?,?)');
      const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
      for (const l of lines) {
        insItem.run(id, l.id, l.name, l.price, l.qty);
        if (Number(dec.run(l.qty, l.id, l.qty).changes) !== 1) throw new HttpError(409, 'out_of_stock', l.name);
      }
      if (b.save_info) {
        db.prepare('UPDATE users SET phone=?, phone2=?, delivery_type=?, wilaya=?, commune=?, address=? WHERE id=?')
          .run(ship.phone, ship.phone2, ship.delivery_type, ship.wilaya, ship.commune, ship.address, u.id);
      }
      return id;
    });
    res.status(201).json({ order: getOrder(orderId) });
  });

  function getOrder(id) {
    const o = db.prepare(`SELECT o.*, w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar FROM orders o
      LEFT JOIN delivery_fees w ON w.wilaya = o.wilaya WHERE o.id = ?`).get(id);
    if (!o) return null;
    o.items = db.prepare(`SELECT oi.*, p.image FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ? ORDER BY oi.id`).all(id);
    return o;
  }

  app.get('/api/me/orders', requireUser, (req, res) => {
    const orders = db.prepare(`SELECT o.id, o.status, o.total, o.created_at,
        (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items
      FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC`).all(req.user.id);
    res.json({ orders });
  });

  app.get('/api/me/orders/:id', requireUser, (req, res, next) => {
    const o = getOrder(int(req.params.id, 0));
    if (!o || o.user_id !== req.user.id) return next(new HttpError(404, 'not_found'));
    res.json({ order: o });
  });

  app.post('/api/me/orders/:id/cancel', requireUser, (req, res, next) => {
    const o = getOrder(int(req.params.id, 0));
    if (!o || o.user_id !== req.user.id) return next(new HttpError(404, 'not_found'));
    if (o.status !== 'pending') throw bad('cannot_cancel');
    setOrderStatus(o, 'cancelled');
    res.json({ order: getOrder(o.id) });
  });

  function setOrderStatus(o, status) {
    tx(db, () => {
      // Remise en stock si la commande est annulée (et retrait si elle est réactivée)
      if (status === 'cancelled' && o.status !== 'cancelled') {
        const inc = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const it of o.items) if (it.product_id) inc.run(it.qty, it.product_id);
      } else if (o.status === 'cancelled' && status !== 'cancelled') {
        const dec = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');
        for (const it of o.items) if (it.product_id) dec.run(it.qty, it.product_id);
      }
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, o.id);
    });
  }

  // =====================================================================
  // ADMIN
  // =====================================================================
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/stats', (req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    res.json({
      orders_pending: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").n,
      orders_total: one('SELECT COUNT(*) AS n FROM orders').n,
      revenue: one("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status IN ('confirmed','shipped','delivered')").n,
      revenue_month: one("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status IN ('confirmed','shipped','delivered') AND created_at >= date('now','start of month')").n,
      users: one('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0').n,
      pros_pending: one("SELECT COUNT(*) AS n FROM users WHERE pro_status = 'pending'").n,
      products: one('SELECT COUNT(*) AS n FROM products').n,
      out_of_stock: one('SELECT COUNT(*) AS n FROM products WHERE stock <= 0 AND is_active = 1').n,
      requests_new: one("SELECT COUNT(*) AS n FROM part_requests WHERE status = 'new'").n,
      recent_orders: db.prepare(`SELECT o.id, o.status, o.total, o.created_at, o.first_name, o.last_name, o.is_pro
        FROM orders o ORDER BY o.id DESC LIMIT 8`).all(),
    });
  });

  // --- brands & models ---
  admin.get('/brands', (req, res) => {
    const brands = db.prepare('SELECT * FROM brands ORDER BY sort, name').all();
    const models = db.prepare(`${modelCountSql} ORDER BY m.name`).all();
    for (const b of brands) b.models = models.filter((m) => m.brand_id === b.id);
    res.json({ brands });
  });
  admin.post('/brands', (req, res) => {
    const name = str(req.body.name, 60);
    if (!name) throw bad('name_required');
    const sort = int(req.body.sort, 0);
    try {
      const r = db.prepare('INSERT INTO brands (name, sort) VALUES (?,?)').run(name, sort);
      res.status(201).json({ id: Number(r.lastInsertRowid) });
    } catch { throw new HttpError(409, 'exists'); }
  });
  admin.put('/brands/:id', (req, res) => {
    const name = str(req.body.name, 60);
    if (!name) throw bad('name_required');
    db.prepare('UPDATE brands SET name = ?, sort = ? WHERE id = ?').run(name, int(req.body.sort, 0), int(req.params.id, 0));
    res.json({ ok: true });
  });
  admin.delete('/brands/:id', (req, res) => {
    db.prepare('DELETE FROM brands WHERE id = ?').run(int(req.params.id, 0));
    res.json({ ok: true });
  });
  function uniqueModelSlug(name, exceptId = 0) {
    const base = slugify(name) || 'modele';
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM models WHERE slug = ? AND id != ?').get(slug, exceptId); i++) slug = `${base}-${i}`;
    return slug;
  }
  admin.post('/models', (req, res) => {
    const name = str(req.body.name, 80);
    const brandId = int(req.body.brand_id, 0);
    if (!name) throw bad('name_required');
    if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('brand_invalid');
    const r = db.prepare('INSERT INTO models (brand_id, name, slug, image) VALUES (?,?,?,?)')
      .run(brandId, name, uniqueModelSlug(name), str(req.body.image, 300) || null);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  admin.put('/models/:id', (req, res) => {
    const id = int(req.params.id, 0);
    const name = str(req.body.name, 80);
    const brandId = int(req.body.brand_id, 0);
    if (!name) throw bad('name_required');
    if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('brand_invalid');
    db.prepare('UPDATE models SET name = ?, brand_id = ?, slug = ?, image = ? WHERE id = ?')
      .run(name, brandId, uniqueModelSlug(name, id), str(req.body.image, 300) || null, id);
    res.json({ ok: true });
  });
  admin.delete('/models/:id', (req, res) => {
    db.prepare('DELETE FROM models WHERE id = ?').run(int(req.params.id, 0));
    res.json({ ok: true });
  });

  // --- categories ---
  admin.get('/categories', (req, res) => {
    res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY sort, id').all() });
  });
  admin.post('/categories', (req, res) => {
    const b = req.body || {};
    const fr = str(b.name_fr, 60);
    const ar = str(b.name_ar, 60);
    if (!fr || !ar) throw bad('name_required');
    const slug = slugify(fr);
    if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) throw new HttpError(409, 'exists');
    const r = db.prepare('INSERT INTO categories (slug, name_fr, name_ar, icon, sort) VALUES (?,?,?,?,?)')
      .run(slug, fr, ar, str(b.icon, 20) || 'box', int(b.sort, 50));
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  admin.put('/categories/:id', (req, res) => {
    const b = req.body || {};
    const fr = str(b.name_fr, 60);
    const ar = str(b.name_ar, 60);
    if (!fr || !ar) throw bad('name_required');
    db.prepare('UPDATE categories SET name_fr = ?, name_ar = ?, icon = ?, sort = ? WHERE id = ?')
      .run(fr, ar, str(b.icon, 20) || 'box', int(b.sort, 50), int(req.params.id, 0));
    res.json({ ok: true });
  });
  admin.delete('/categories/:id', (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(int(req.params.id, 0));
    res.json({ ok: true });
  });

  // --- products ---
  admin.get('/products', (req, res) => {
    const per = 50;
    const page = Math.max(1, int(req.query.page, 1));
    const conds = ['1=1'];
    const params = [];
    const q = str(req.query.q, 80);
    if (q) {
      for (const t of q.split(/\s+/).slice(0, 6)) {
        const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(`(p.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_models pm JOIN models m ON m.id = pm.model_id WHERE pm.product_id = p.id AND m.name LIKE ? ESCAPE '\\'))`);
        params.push(like, like);
      }
    }
    if (req.query.category) { conds.push('p.category_id = ?'); params.push(int(req.query.category, 0)); }
    if (req.query.stock === 'out') conds.push('p.stock <= 0');
    if (req.query.stock === 'low') conds.push('p.stock BETWEEN 1 AND 3');
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT p.*, c.name_fr AS category,
        (SELECT GROUP_CONCAT(m.name, ', ') FROM product_models pm JOIN models m ON m.id = pm.model_id WHERE pm.product_id = p.id) AS models
      FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`)
      .all(...params, per, (page - 1) * per);
    res.json({ products: rows, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });
  admin.get('/products/:id', (req, res, next) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(int(req.params.id, 0));
    if (!p) return next(new HttpError(404, 'not_found'));
    p.model_ids = db.prepare('SELECT model_id FROM product_models WHERE product_id = ?').all(p.id).map((r) => r.model_id);
    res.json({ product: p });
  });
  function productFields(b) {
    const f = {
      name: str(b.name, 200),
      category_id: int(b.category_id),
      description: str(b.description, 2000) || null,
      quality: str(b.quality, 60) || null,
      price: int(b.price),
      pro_price: int(b.pro_price),
      stock: int(b.stock, 0),
      image: str(b.image, 300) || null,
      is_active: b.is_active === false || b.is_active === 0 ? 0 : 1,
    };
    if (!f.name) throw bad('name_required');
    if (f.price === null || f.price < 0) throw bad('price_invalid');
    if (f.pro_price !== null && f.pro_price < 0) throw bad('price_invalid');
    if (f.image && !/^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/.test(f.image)) throw bad('image_invalid');
    const modelIds = Array.isArray(b.model_ids) ? [...new Set(b.model_ids.map((x) => int(x, 0)).filter((x) => x > 0))] : [];
    return { f, modelIds };
  }
  function saveModels(pid, modelIds) {
    db.prepare('DELETE FROM product_models WHERE product_id = ?').run(pid);
    const ins = db.prepare('INSERT OR IGNORE INTO product_models (product_id, model_id) SELECT ?, id FROM models WHERE id = ?');
    for (const m of modelIds) ins.run(pid, m);
  }
  admin.post('/products', (req, res) => {
    const { f, modelIds } = productFields(req.body || {});
    const id = tx(db, () => {
      const r = db.prepare(`INSERT INTO products (name, category_id, description, quality, price, pro_price, stock, image, is_active)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(f.name, f.category_id, f.description, f.quality, f.price, f.pro_price, f.stock, f.image, f.is_active);
      const pid = Number(r.lastInsertRowid);
      saveModels(pid, modelIds);
      return pid;
    });
    res.status(201).json({ id });
  });
  admin.put('/products/:id', (req, res) => {
    const id = int(req.params.id, 0);
    const { f, modelIds } = productFields(req.body || {});
    tx(db, () => {
      db.prepare(`UPDATE products SET name=?, category_id=?, description=?, quality=?, price=?, pro_price=?, stock=?, image=?, is_active=?
        WHERE id=?`).run(f.name, f.category_id, f.description, f.quality, f.price, f.pro_price, f.stock, f.image, f.is_active, id);
      saveModels(id, modelIds);
    });
    res.json({ ok: true });
  });
  admin.patch('/products/:id/stock', (req, res) => {
    const stock = int(req.body.stock);
    if (stock === null || stock < 0) throw bad('stock_invalid');
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, int(req.params.id, 0));
    res.json({ ok: true });
  });
  admin.delete('/products/:id', (req, res) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(int(req.params.id, 0));
    res.json({ ok: true });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => {
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
  });
  admin.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) throw bad('image_invalid');
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });

  // --- orders ---
  admin.get('/orders', (req, res) => {
    const per = 30;
    const page = Math.max(1, int(req.query.page, 1));
    const conds = ['1=1'];
    const params = [];
    if (ORDER_STATUSES.includes(req.query.status)) { conds.push('o.status = ?'); params.push(req.query.status); }
    const q = str(req.query.q, 60);
    if (q) {
      conds.push("(o.id = ? OR o.phone LIKE ? OR (o.first_name || ' ' || o.last_name) LIKE ?)");
      params.push(int(q.replace('#', ''), 0), `%${q}%`, `%${q}%`);
    }
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}`).get(...params).n;
    const orders = db.prepare(`SELECT o.*, w.name_fr AS wilaya_fr, u.email, u.shop_name,
        (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items
      FROM orders o LEFT JOIN delivery_fees w ON w.wilaya = o.wilaya LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...params, per, (page - 1) * per);
    res.json({ orders, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  });
  admin.get('/orders/:id', (req, res, next) => {
    const o = getOrder(int(req.params.id, 0));
    if (!o) return next(new HttpError(404, 'not_found'));
    o.user = o.user_id ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id)) : null;
    res.json({ order: o });
  });
  admin.put('/orders/:id/status', (req, res, next) => {
    const status = req.body.status;
    if (!ORDER_STATUSES.includes(status)) throw bad('status_invalid');
    const o = getOrder(int(req.params.id, 0));
    if (!o) return next(new HttpError(404, 'not_found'));
    setOrderStatus(o, status);
    res.json({ order: getOrder(o.id) });
  });

  // --- users ---
  admin.get('/users', (req, res) => {
    const conds = ['1=1'];
    const params = [];
    if (req.query.type === 'repairer' || req.query.type === 'client') { conds.push('u.type = ?'); params.push(req.query.type); }
    if (req.query.pro_status === 'pending') conds.push("u.pro_status = 'pending'");
    const q = str(req.query.q, 60);
    if (q) {
      conds.push("(u.email LIKE ? OR u.phone LIKE ? OR (u.first_name || ' ' || u.last_name) LIKE ? OR u.shop_name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const users = db.prepare(`SELECT u.*, w.name_fr AS wilaya_fr,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders
      FROM users u LEFT JOIN delivery_fees w ON w.wilaya = u.wilaya WHERE ${conds.join(' AND ')}
      ORDER BY (u.pro_status = 'pending') DESC, u.id DESC LIMIT 200`).all(...params);
    res.json({ users: users.map((u) => ({ ...publicUser(u), wilaya_fr: u.wilaya_fr, orders: u.orders, created_at: u.created_at })) });
  });
  admin.put('/users/:id', (req, res, next) => {
    const id = int(req.params.id, 0);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return next(new HttpError(404, 'not_found'));
    const b = req.body || {};
    const type = b.type === 'repairer' || b.type === 'client' ? b.type : u.type;
    let proStatus = ['none', 'pending', 'approved', 'rejected'].includes(b.pro_status) ? b.pro_status : u.pro_status;
    if (type === 'client') proStatus = 'none';
    if (type === 'repairer' && proStatus === 'none') proStatus = 'pending';
    let isAdmin = u.is_admin;
    if (typeof b.is_admin === 'boolean' && id !== req.user.id) isAdmin = b.is_admin ? 1 : 0;
    db.prepare('UPDATE users SET type = ?, pro_status = ?, is_admin = ? WHERE id = ?').run(type, proStatus, isAdmin, id);
    res.json({ ok: true });
  });

  // --- part requests ---
  admin.get('/requests', (req, res) => {
    res.json({ requests: db.prepare('SELECT * FROM part_requests ORDER BY (status = \'new\') DESC, id DESC LIMIT 300').all() });
  });
  admin.put('/requests/:id', (req, res) => {
    const status = req.body.status === 'done' ? 'done' : 'new';
    db.prepare('UPDATE part_requests SET status = ? WHERE id = ?').run(status, int(req.params.id, 0));
    res.json({ ok: true });
  });
  admin.delete('/requests/:id', (req, res) => {
    db.prepare('DELETE FROM part_requests WHERE id = ?').run(int(req.params.id, 0));
    res.json({ ok: true });
  });

  // --- settings & delivery ---
  const EDITABLE_SETTINGS = ['shop_name', 'shop_phone', 'shop_whatsapp', 'shop_address', 'shop_facebook', 'shop_instagram',
    'pro_discount_percent', 'announcement_ar', 'announcement_fr'];
  admin.get('/settings', (req, res) => res.json({ settings: getSettings() }));
  admin.put('/settings', (req, res) => {
    const b = req.body || {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    tx(db, () => {
      for (const k of EDITABLE_SETTINGS) {
        if (b[k] === undefined) continue;
        let v = str(b[k], 300);
        if (k === 'pro_discount_percent') v = String(Math.min(90, Math.max(0, int(v, 0))));
        up.run(k, v);
      }
    });
    res.json({ settings: getSettings() });
  });
  admin.get('/delivery', (req, res) => res.json({ wilayas: db.prepare('SELECT * FROM delivery_fees ORDER BY wilaya').all() }));
  admin.put('/delivery', (req, res) => {
    const rows = Array.isArray(req.body.wilayas) ? req.body.wilayas : [];
    const up = db.prepare('UPDATE delivery_fees SET home_fee = ?, desk_fee = ?, enabled = ? WHERE wilaya = ?');
    tx(db, () => {
      for (const w of rows) {
        const home = Math.max(0, int(w.home_fee, 0));
        const desk = Math.max(0, int(w.desk_fee, 0));
        up.run(home, desk, w.enabled === false || w.enabled === 0 ? 0 : 1, int(w.wilaya, 0));
      }
    });
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found')));

  // ---------- static ----------
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', fallthrough: false }));
  app.use(express.static(publicDir, { index: false, maxAge: opts.dev ? 0 : '1h' }));
  app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) err = bad('image_invalid', err.message);
    if (err.type === 'entity.parse.failed') err = bad('bad_json');
    if (err.status === 404 && !(err instanceof HttpError)) err = new HttpError(404, 'not_found');
    if (!(err instanceof HttpError)) {
      console.error(err);
      err = new HttpError(500, 'server_error');
    }
    res.status(err.status).json({ error: err.code, detail: err.message !== err.code ? err.message : undefined });
  });

  return app;
}

module.exports = { createApp };
