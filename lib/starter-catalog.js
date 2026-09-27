// Liste de base : catégories, marques et modèles courants en Algérie.
// Importée depuis l'admin (bouton « Importer la liste de base ») ; les produits restent à ajouter à la main.
const { slugify, tx } = require('./db');

const STARTER_CATEGORIES = [
  // [nom FR, nom AR, icône]
  ['Afficheur', 'شاشة', 'screen'],
  ['Batterie', 'بطارية', 'battery'],
  ['Connecteur de charge', 'موصل الشحن', 'plug'],
  ['Caméra', 'كاميرا', 'camera'],
  ['Vitre arrière', 'زجاج خلفي', 'glass'],
  ['Body / Coque', 'هيكل', 'body'],
  ['HP et Buzzer', 'سماعة وبازر', 'speaker'],
  ['Nappe / Flex', 'فلاكس', 'flex'],
  ['Circuit (IC)', 'دارة IC', 'chip'],
  ['Petite pièce', 'قطع صغيرة', 'screw'],
  ['Outillage', 'أدوات التصليح', 'tools'],
];

const STARTER_BRANDS = {
  Samsung: ['Galaxy A05', 'Galaxy A10', 'Galaxy A12', 'Galaxy A13', 'Galaxy A14', 'Galaxy A15', 'Galaxy A24', 'Galaxy A34', 'Galaxy A54', 'Galaxy S21', 'Galaxy S23'],
  Xiaomi: ['Redmi 9A', 'Redmi 9C', 'Redmi 10', 'Redmi 10A', 'Redmi 12', 'Redmi 13C', 'Redmi Note 11', 'Redmi Note 12', 'Redmi Note 13', 'Poco X5', 'Poco M6'],
  Apple: ['iPhone 7', 'iPhone 8', 'iPhone X', 'iPhone XR', 'iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15'],
  Oppo: ['Oppo A15', 'Oppo A16', 'Oppo A17', 'Oppo A57', 'Oppo A78', 'Oppo Reno 8'],
  Realme: ['Realme C11', 'Realme C21', 'Realme C30', 'Realme C53', 'Realme C55'],
  Infinix: ['Infinix Hot 12', 'Infinix Hot 20', 'Infinix Hot 30', 'Infinix Smart 7', 'Infinix Note 30'],
  Tecno: ['Tecno Spark 10', 'Tecno Spark 20', 'Tecno Camon 20', 'Tecno Pop 7'],
  Huawei: ['Huawei Y6 2019', 'Huawei Y7 2019', 'Huawei Y9 Prime', 'Huawei P30 Lite'],
  Honor: ['Honor X6', 'Honor X7', 'Honor X8'],
  Vivo: ['Vivo Y11', 'Vivo Y20', 'Vivo Y21'],
  Condor: ['Condor Allure M3', 'Condor Plume L8'],
  Itel: ['Itel A56', 'Itel A70'],
};

// Ajoute ce qui manque, sans rien modifier ni supprimer. Renvoie le nombre d'éléments ajoutés.
function importStarterCatalog(db) {
  const added = { categories: 0, brands: 0, models: 0 };
  tx(db, () => {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM categories').get().n;
    STARTER_CATEGORIES.forEach(([fr, ar, icon], i) => {
      const slug = slugify(fr);
      if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) return;
      db.prepare('INSERT INTO categories (slug, name_fr, name_ar, icon, sort) VALUES (?,?,?,?,?)').run(slug, fr, ar, icon, maxSort + i + 1);
      added.categories++;
    });

    const maxBrandSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM brands').get().n;
    Object.entries(STARTER_BRANDS).forEach(([brand, models], i) => {
      let b = db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(brand);
      if (!b) {
        const r = db.prepare('INSERT INTO brands (name, sort) VALUES (?, ?)').run(brand, maxBrandSort + i + 1);
        b = { id: Number(r.lastInsertRowid) };
        added.brands++;
      }
      for (const name of models) {
        if (db.prepare('SELECT 1 FROM models WHERE name = ? COLLATE NOCASE').get(name)) continue;
        const base = slugify(name);
        let slug = base;
        for (let n = 2; db.prepare('SELECT 1 FROM models WHERE slug = ?').get(slug); n++) slug = `${base}-${n}`;
        db.prepare('INSERT INTO models (brand_id, name, slug) VALUES (?,?,?)').run(b.id, name, slug);
        added.models++;
      }
    });
  });
  return added;
}

module.exports = { importStarterCatalog, STARTER_CATEGORIES, STARTER_BRANDS };
