const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { openDb, ensureBaseData, seedDemo } = require('../lib/db');
const { createApp } = require('../lib/app');

let server;
let base;
let db;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));

before(async () => {
  db = openDb(':memory:');
  ensureBaseData(db, { adminEmail: 'admin@test.dz', adminPassword: 'secret123' });
  seedDemo(db);
  const app = createApp(db, { uploadDir: tmp });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const profile = (extra) => ({
  first_name: 'Ali', last_name: 'Test', email: `u${Math.random().toString(36).slice(2)}@test.dz`, password: 'motdepasse',
  phone: '0550123456', delivery_type: 'home', wilaya: 16, commune: 'Bab Ezzouar', address: 'Cité 1', ...extra,
});

test('search finds a phone model and its parts', async () => {
  const c = client();
  const s = await c('GET', '/api/suggest?q=redmi%209a');
  assert.equal(s.body.models[0].slug, 'redmi-9a');
  const compact = await c('GET', '/api/search?q=redmi9a');
  assert.equal(compact.body.models[0].slug, 'redmi-9a');
  const m = await c('GET', '/api/models/redmi-9a');
  assert.ok(m.body.products.length > 5);
  assert.ok(m.body.products.some((p) => p.name.includes('Redmi 9A / Redmi 9C')));
});

test('registration validates input', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/register', profile({ phone: '123' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'phone_invalid');
  const r2 = await c('POST', '/api/auth/register', profile({ type: 'repairer' }));
  assert.equal(r2.body.error, 'shop_required');
});

test('repairer gets pro prices only after admin approval', async () => {
  const pro = client();
  const reg = await pro('POST', '/api/auth/register', profile({ type: 'repairer', shop_name: 'Atelier Ali' }));
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.pro_status, 'pending');
  const before1 = (await pro('GET', '/api/products/1')).body.product;
  assert.equal(before1.price, before1.price_public);

  const admin = client();
  assert.equal((await admin('POST', '/api/auth/login', { email: 'admin@test.dz', password: 'secret123' })).status, 200);
  assert.equal((await admin('PUT', `/api/admin/users/${reg.body.user.id}`, { pro_status: 'approved' })).status, 200);

  const after1 = (await pro('GET', '/api/products/1')).body.product;
  assert.ok(after1.price < after1.price_public, 'pro price should be lower');
});

test('order uses server prices, decrements stock and cancel restocks', async () => {
  const c = client();
  await c('POST', '/api/auth/register', profile());
  const prodBefore = db.prepare('SELECT * FROM products WHERE id = 2').get();
  const r = await c('POST', '/api/orders', { items: [{ id: 2, qty: 2, price: 1 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = r.body.order;
  assert.equal(o.items[0].unit_price, prodBefore.price);
  assert.equal(o.delivery_fee, db.prepare('SELECT home_fee FROM delivery_fees WHERE wilaya = 16').get().home_fee);
  assert.equal(o.total, prodBefore.price * 2 + o.delivery_fee);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 2').get().stock, prodBefore.stock - 2);

  const cancel = await c('POST', `/api/me/orders/${o.id}/cancel`, {});
  assert.equal(cancel.body.order.status, 'cancelled');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 2').get().stock, prodBefore.stock);
});

test('ordering more than stock fails', async () => {
  const c = client();
  await c('POST', '/api/auth/register', profile());
  const p = db.prepare('SELECT id, stock FROM products WHERE stock > 0 LIMIT 1').get();
  const r = await c('POST', '/api/orders', { items: [{ id: p.id, qty: p.stock + 1 }] });
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(p.id).stock, p.stock);
});

test('orders require login and admin API requires admin', async () => {
  const anon = client();
  assert.equal((await anon('POST', '/api/orders', { items: [{ id: 1, qty: 1 }] })).status, 401);
  assert.equal((await anon('GET', '/api/admin/stats')).status, 401);
  const u = client();
  await u('POST', '/api/auth/register', profile());
  assert.equal((await u('GET', '/api/admin/stats')).status, 403);
});

test('cross-site writes are rejected', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email: 'admin@test.dz', password: 'secret123' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('users cannot read other users orders', async () => {
  const a = client();
  await a('POST', '/api/auth/register', profile());
  const o = (await a('POST', '/api/orders', { items: [{ id: 3, qty: 1 }] })).body.order;
  const b = client();
  await b('POST', '/api/auth/register', profile());
  assert.equal((await b('GET', `/api/me/orders/${o.id}`)).status, 404);
});

test('admin can wipe the catalog and it stays empty after restart', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@test.dz', password: 'secret123' });
  assert.equal((await admin('POST', '/api/admin/catalog/wipe', { confirm: 'non' })).status, 400);
  const u = client();
  await u('POST', '/api/auth/register', profile());
  assert.equal((await u('POST', '/api/admin/catalog/wipe', { confirm: 'SUPPRIMER' })).status, 403);

  const ordersBefore = db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n;
  const r = await admin('POST', '/api/admin/catalog/wipe', { confirm: 'SUPPRIMER' });
  assert.equal(r.status, 200);
  assert.ok(r.body.deleted.products > 0);
  for (const t of ['products', 'categories', 'brands', 'models']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
  // Les commandes passées restent lisibles
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n, ordersBefore);

  // Simule un redémarrage du serveur : rien ne doit revenir
  ensureBaseData(db, { adminEmail: 'admin@test.dz', adminPassword: 'secret123' });
  assert.equal(seedDemo(db), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 0);

  const cfg = await client()('GET', '/api/config');
  assert.deepEqual(cfg.body.categories, []);
});

test('existing databases with products are not re-seeded', () => {
  const fresh = openDb(':memory:');
  ensureBaseData(fresh, { adminEmail: 'a@b.dz', adminPassword: 'secret123' });
  assert.equal(seedDemo(fresh), true);
  // Base créée avant l'ajout du marqueur : le marqueur est posé sans ré-ajouter la démo
  fresh.prepare("DELETE FROM settings WHERE key = 'demo_seeded'").run();
  assert.equal(seedDemo(fresh), false);
  assert.ok(fresh.prepare("SELECT 1 FROM settings WHERE key = 'demo_seeded'").get());
});

test('pages and scripts are revalidated so updates show up immediately', async () => {
  for (const url of ['/', '/admin', '/js/admin.js', '/js/app.js', '/css/style.css']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('cache-control'), 'no-cache', url);
    const etag = res.headers.get('etag');
    if (url.startsWith('/js') || url.startsWith('/css')) {
      assert.ok(etag, url);
      // node:http plutôt que fetch : fetch ajoute ses propres en-têtes de cache à une requête conditionnelle
      const status = await new Promise((resolve, reject) => {
        http.get(base + url, { headers: { 'If-None-Match': etag } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
      });
      assert.equal(status, 304, url);
    }
  }
});

test('admins can add other admins with the same rights, and remove them', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@test.dz', password: 'secret123' });

  // Création d'un nouveau compte administrateur
  assert.equal((await admin('POST', '/api/admin/admins', { email: 'x', password: '12345678' })).body.error, 'email_invalid');
  assert.equal((await admin('POST', '/api/admin/admins', { email: 'b@test.dz', first_name: 'B', last_name: 'C', phone: '0550111222', password: 'court' })).body.error, 'password_short');
  const created = await admin('POST', '/api/admin/admins', { email: 'Second@Test.dz', first_name: 'Karim', last_name: 'B', phone: '0550111222', password: 'motdepasse2' });
  assert.equal(created.status, 201);
  const second = client();
  assert.equal((await second('POST', '/api/auth/login', { email: 'second@test.dz', password: 'motdepasse2' })).status, 200);
  assert.equal((await second('GET', '/api/admin/stats')).status, 200);
  // Même droits : il peut à son tour gérer les utilisateurs
  assert.equal((await second('GET', '/api/admin/users?type=admin')).body.users.length >= 2, true);

  // Promotion d'un compte client existant (mot de passe inchangé)
  const cust = client();
  const reg = await cust('POST', '/api/auth/register', profile({ email: 'client-admin@test.dz' }));
  assert.equal((await cust('GET', '/api/admin/stats')).status, 403);
  const promoted = await second('POST', '/api/admin/admins', { email: 'client-admin@test.dz' });
  assert.equal(promoted.body.created, false);
  assert.equal((await cust('GET', '/api/admin/stats')).status, 200);

  // Retrait des droits : effet immédiat
  assert.equal((await admin('PUT', `/api/admin/users/${reg.body.user.id}`, { is_admin: false })).status, 200);
  assert.equal((await cust('GET', '/api/admin/stats')).status, 403);

  // On ne peut pas se retirer ses propres droits
  const meId = (await admin('GET', '/api/me')).body.user.id;
  const self = await admin('PUT', `/api/admin/users/${meId}`, { is_admin: false });
  assert.equal(self.body.error, 'cannot_change_self');
  assert.equal((await admin('GET', '/api/admin/stats')).status, 200);
});
