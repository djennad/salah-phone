// Supprime la base de données locale (elle sera recréée au prochain démarrage).
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'salah-phone.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
console.log('Base supprimée :', file);
