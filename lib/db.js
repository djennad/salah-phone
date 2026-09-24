const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { WILAYAS, defaultFees } = require('./wilayas');
const { hashPassword } = require('./security');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT,
  type TEXT NOT NULL DEFAULT 'client' CHECK (type IN ('client','repairer')),
  shop_name TEXT,
  pro_status TEXT NOT NULL DEFAULT 'none' CHECK (pro_status IN ('none','pending','approved','rejected')),
  source TEXT,
  delivery_type TEXT DEFAULT 'home' CHECK (delivery_type IN ('home','desk')),
  wilaya INTEGER,
  commune TEXT,
  address TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  quality TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  pro_price INTEGER CHECK (pro_price IS NULL OR pro_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une pièce peut être compatible avec plusieurs modèles (ex. batterie Redmi 9A / 9C / 10A)
CREATE TABLE IF NOT EXISTS product_models (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, model_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  is_pro INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT,
  delivery_type TEXT NOT NULL,
  wilaya INTEGER NOT NULL,
  commune TEXT NOT NULL,
  address TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS part_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_model TEXT NOT NULL,
  part TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_fees (
  wilaya INTEGER PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  home_fee INTEGER NOT NULL,
  desk_fee INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_pm_model ON product_models(model_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
`;

const CATEGORIES = [
  ['afficheur', 'Afficheur', 'شاشة', 'screen', 1],
  ['batterie', 'Batterie', 'بطارية', 'battery', 2],
  ['body', 'Body / Coque', 'هيكل', 'body', 3],
  ['camera', 'Caméra', 'كاميرا', 'camera', 4],
  ['circuit-ic', 'Circuit (IC)', 'دارة IC', 'chip', 5],
  ['connecteur', 'Connecteur de charge', 'موصل الشحن', 'plug', 6],
  ['hp-buzzer', 'HP et Buzzer', 'سماعة وبازر', 'speaker', 7],
  ['petite-piece', 'Petite pièce', 'قطع صغيرة', 'screw', 8],
  ['tresse', 'Nappe / Tresse', 'فلاكس', 'flex', 9],
  ['vitre', 'Vitre arrière', 'زجاج خلفي', 'glass', 10],
  ['outillage', 'Outillage', 'أدوات التصليح', 'tools', 11],
];

const DEFAULT_SETTINGS = {
  shop_name: 'Salah Phone',
  shop_phone: '0550 00 00 00',
  shop_whatsapp: '213550000000',
  shop_address: 'Algérie',
  shop_facebook: '',
  shop_instagram: '',
  pro_discount_percent: '10',
  announcement_ar: 'افتح حساب مصلح (ريباراتور) واستفد من أسعار خاصة',
  announcement_fr: 'Ouvrez un compte réparateur et profitez de prix spéciaux',
};

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Données de base : catégories, wilayas, réglages, compte administrateur.
function ensureBaseData(db, { adminEmail, adminPassword }) {
  tx(db, () => {
    // Catégories par défaut : ajoutées une seule fois, pour que l'admin puisse les supprimer.
    if (!db.prepare("SELECT 1 FROM settings WHERE key = 'categories_initialized'").get()) {
      const insCat = db.prepare('INSERT OR IGNORE INTO categories (slug, name_fr, name_ar, icon, sort) VALUES (?,?,?,?,?)');
      for (const c of CATEGORIES) insCat.run(...c);
      db.prepare("INSERT INTO settings (key, value) VALUES ('categories_initialized', '1')").run();
    }

    const insW = db.prepare('INSERT OR IGNORE INTO delivery_fees (wilaya, name_fr, name_ar, home_fee, desk_fee) VALUES (?,?,?,?,?)');
    for (const [code, fr, ar] of WILAYAS) {
      const f = defaultFees(code);
      insW.run(code, fr, ar, f.home, f.desk);
    }

    const insS = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insS.run(k, v);

    const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
    if (!admin) {
      db.prepare(`INSERT INTO users (first_name, last_name, email, password_hash, phone, is_admin)
                  VALUES ('Salah', 'Admin', ?, ?, '0550000000', 1)`)
        .run(adminEmail, hashPassword(adminPassword));
      console.log(`[salah-phone] Compte admin créé : ${adminEmail} (changez le mot de passe !)`);
    }
  });
}

// Catalogue de démonstration : marques, modèles et pièces.
const DEMO_CATALOG = {
  Samsung: ['Galaxy A10', 'Galaxy A12', 'Galaxy A13', 'Galaxy A14', 'Galaxy A15', 'Galaxy A23', 'Galaxy A32', 'Galaxy A34', 'Galaxy A51', 'Galaxy A52', 'Galaxy A54', 'Galaxy S21', 'Galaxy S22 Ultra', 'Galaxy S23'],
  Xiaomi: ['Redmi 9A', 'Redmi 9C', 'Redmi 10A', 'Redmi 10C', 'Redmi 12', 'Redmi 13C', 'Redmi Note 8', 'Redmi Note 9', 'Redmi Note 10', 'Redmi Note 11', 'Redmi Note 12', 'Redmi Note 13', 'Poco X3', 'Poco X5 Pro'],
  Apple: ['iPhone 7', 'iPhone 8', 'iPhone X', 'iPhone XR', 'iPhone 11', 'iPhone 11 Pro', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15'],
  Oppo: ['A15', 'A16', 'A17', 'A57', 'A78', 'Reno 8'],
  Realme: ['C11', 'C21', 'C30', 'C53', 'C55', '11 Pro'],
  Infinix: ['Hot 10', 'Hot 11', 'Hot 12', 'Hot 20', 'Hot 30', 'Smart 6', 'Smart 7', 'Note 30'],
  Tecno: ['Spark 8', 'Spark 10', 'Spark 20', 'Camon 20', 'Pop 7'],
  Huawei: ['Y6 2019', 'Y7 2019', 'Y9 Prime', 'P30 Lite', 'Nova 3i'],
  Condor: ['Allure M3', 'Plume L8', 'Griffe T9'],
  Itel: ['A56', 'A70', 'S23'],
};

// Groupes de modèles qui partagent les mêmes pièces.
const SHARED = [
  { models: ['Redmi 9A', 'Redmi 9C', 'Redmi 10A'], parts: ['afficheur', 'batterie'] },
  { models: ['Galaxy A12', 'Galaxy A32'], parts: ['connecteur'] },
  { models: ['Oppo A15', 'Oppo A16'], parts: ['batterie'] },
  { models: ['Realme C11', 'Realme C21'], parts: ['batterie'] },
];

const PART_TEMPLATES = [
  { cat: 'afficheur', name: 'Afficheur {m} Original', quality: 'Original', base: 2800, step: 450 },
  { cat: 'afficheur', name: 'Afficheur {m} Incell', quality: 'Incell', base: 1900, step: 300, onlyTier: 2 },
  { cat: 'batterie', name: 'Batterie {m}', quality: 'Original', base: 1500, step: 180 },
  { cat: 'connecteur', name: 'Nappe de charge {m}', quality: 'Original', base: 450, step: 60 },
  { cat: 'camera', name: 'Caméra arrière {m}', quality: 'Original', base: 1200, step: 350 },
  { cat: 'camera', name: 'Caméra avant {m}', quality: 'Original', base: 600, step: 120 },
  { cat: 'hp-buzzer', name: 'Buzzer {m}', quality: 'Original', base: 400, step: 50 },
  { cat: 'hp-buzzer', name: 'Écouteur interne {m}', quality: 'Original', base: 300, step: 40 },
  { cat: 'body', name: 'Châssis / Body {m}', quality: 'Original', base: 1300, step: 250 },
  { cat: 'vitre', name: 'Vitre arrière {m}', quality: 'Original', base: 500, step: 120 },
  { cat: 'tresse', name: 'Nappe principale (FPC) {m}', quality: 'Original', base: 500, step: 80 },
  { cat: 'petite-piece', name: 'Bouton extérieur {m}', quality: 'Original', base: 250, step: 30 },
  { cat: 'petite-piece', name: 'Tiroir SIM {m}', quality: 'Original', base: 250, step: 30 },
];

function seedDemo(db) {
  // Le catalogue de démonstration n'est ajouté qu'une seule fois (jamais après un « vider le catalogue »).
  const markSeeded = () => db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('demo_seeded', '1')").run();
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'demo_seeded'").get()) return false;
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) {
    markSeeded();
    return false;
  }

  tx(db, () => {
    const cats = Object.fromEntries(db.prepare('SELECT slug, id FROM categories').all().map((c) => [c.slug, c.id]));
    const insBrand = db.prepare('INSERT INTO brands (name, sort) VALUES (?, ?)');
    const insModel = db.prepare('INSERT INTO models (brand_id, name, slug) VALUES (?,?,?)');
    const insProd = db.prepare(`INSERT INTO products (name, category_id, quality, price, pro_price, stock, description)
                                VALUES (?,?,?,?,?,?,?)`);
    const link = db.prepare('INSERT OR IGNORE INTO product_models (product_id, model_id) VALUES (?,?)');

    const modelIds = {}; // "Brand Model" -> id
    let bSort = 0;
    for (const [brand, models] of Object.entries(DEMO_CATALOG)) {
      const bId = Number(insBrand.run(brand, bSort++).lastInsertRowid);
      for (const m of models) {
        const full = brand === 'Apple' || brand === 'Samsung' || brand === 'Xiaomi' ? m : `${brand} ${m}`;
        modelIds[full] = Number(insModel.run(bId, full, slugify(full)).lastInsertRowid);
      }
    }

    // Pièces partagées entre plusieurs modèles
    const skip = new Set(); // "model|cat" déjà couverts
    for (const g of SHARED) {
      for (const cat of g.parts) {
        const tpl = PART_TEMPLATES.find((t) => t.cat === cat);
        const label = g.models.join(' / ');
        const price = tpl.base + 200;
        const pid = Number(insProd.run(tpl.name.replace('{m}', label), cats[cat], tpl.quality, price,
          Math.round(price * 0.85 / 50) * 50, 15, `Compatible : ${label}`).lastInsertRowid);
        for (const m of g.models) {
          link.run(pid, modelIds[m]);
          skip.add(`${m}|${cat}`);
        }
      }
    }

    // Pièces propres à chaque modèle (prix déterministes selon la gamme)
    let i = 0;
    for (const [full, mid] of Object.entries(modelIds)) {
      const tier = /S2\d|Ultra|iPhone 1[1-5]|Pro|Reno|X5/.test(full) ? 3 : /A5\d|Note 1[23]|iPhone X|Camon|P30/.test(full) ? 2 : 1;
      for (const tpl of PART_TEMPLATES) {
        if (tpl.onlyTier && tier < tpl.onlyTier) continue;
        if (skip.has(`${full}|${tpl.cat}`) && tpl.quality === 'Original' && tpl.cat !== 'camera' && tpl.cat !== 'hp-buzzer' && tpl.cat !== 'petite-piece') continue;
        i++;
        // Toutes les pièces ne sont pas disponibles pour chaque modèle
        if ((i * 7) % 11 === 0) continue;
        const raw = tpl.base + tpl.step * tier * (1 + (i % 3));
        const price = Math.round(raw / 50) * 50;
        const pro = Math.round(price * 0.85 / 50) * 50;
        const stock = (i * 13) % 9 === 0 ? 0 : 3 + ((i * 5) % 20);
        const pid = Number(insProd.run(tpl.name.replace('{m}', full), cats[tpl.cat], tpl.quality, price, pro, stock, null).lastInsertRowid);
        link.run(pid, mid);
      }
    }

    // Outillage (non lié à un modèle)
    const tools = [
      ['Station de soudure à air chaud 858D', 6500], ['Kit tournevis de précision 25 en 1', 900],
      ['Colle B-7000 (50 ml)', 350], ['Séparateur LCD chauffant', 4800], ['Multimètre numérique', 2200],
      ['Pince brucelles anti-statique (lot de 6)', 700],
    ];
    for (const [name, price] of tools) {
      insProd.run(name, cats.outillage, null, price, Math.round(price * 0.9 / 50) * 50, 10, null);
    }
    // Circuits intégrés (IC)
    const ics = [['IC de charge SM5703 (Samsung)', 900], ['IC PMI632 alimentation (Xiaomi)', 1500], ['IC audio 338S00105 (iPhone)', 1200], ['IC rétroéclairage U4020 (iPhone 7)', 800]];
    for (const [name, price] of ics) insProd.run(name, cats['circuit-ic'], 'Original', price, null, 6, null);
    // Seules quelques pièces apparaissent comme « nouvelles » dans la démo
    db.prepare("UPDATE products SET created_at = datetime('now', '-30 days') WHERE id NOT IN (SELECT id FROM products ORDER BY id DESC LIMIT 10)").run();
    markSeeded();
  });
  return true;
}

module.exports = { openDb, ensureBaseData, seedDemo, slugify, tx, CATEGORIES };
