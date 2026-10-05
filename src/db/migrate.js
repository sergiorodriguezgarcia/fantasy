/**
 * Ejecuta el esquema SQL para crear/actualizar las tablas.
 * Es idempotente (usa CREATE IF NOT EXISTS).
 * Uso: node src/db/migrate.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Ejecutando migraciones...');
    await client.query(schemaSql);
    console.log('Migraciones completadas.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
