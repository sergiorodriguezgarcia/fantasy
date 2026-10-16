/**
 * Completa las fotos de los jugadores activos que aún no tienen.
 *
 * Qué actas reprocesa:
 *  - por defecto: los partidos en los que esos jugadores tienen estadísticas (han jugado)
 *  - con --equipos: además todos los partidos de sus equipos (por si figuran como suplentes
 *    sin jugar; son muchas más actas)
 *  - con códigos de acta como argumentos: solo esas actas
 *
 * asturfutbol.es corta si se le hacen muchas peticiones seguidas, por eso la pausa
 * entre actas es larga (configurable). Es idempotente: se puede relanzar cuantas veces haga falta.
 *
 * Uso:
 *   DATABASE_URL='postgresql://...' node scripts/completar-fotos.js
 *   DATABASE_URL='postgresql://...' node scripts/completar-fotos.js --equipos
 *   DATABASE_URL='postgresql://...' node scripts/completar-fotos.js 25756813 25756814
 *   FOTOS_DELAY_MS=10000 DATABASE_URL='postgresql://...' node scripts/completar-fotos.js
 */
import { pool } from '../src/db/pool.js';
import { CONFIG } from '../src/scraper/config.js';
import { fetchActa } from '../src/scraper/fetcher.js';
import { parseActa } from '../src/scraper/parser.js';
import { guardarFotosActa } from '../src/services/fotos.js';

CONFIG.DELAY_MS = parseInt(process.env.FOTOS_DELAY_MS ?? '6000');

const args = process.argv.slice(2);
const incluirEquipos = args.includes('--equipos');
const actasManuales = args.filter(a => /^\d+$/.test(a));

const NORM = (col) =>
  `translate(upper(${col}), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC')`;

async function jugadoresSinFoto() {
  const { rows } = await pool.query(
    `SELECT j.nombre, er.nombre AS equipo
     FROM jugadores j
     LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
     WHERE j.activo AND j.foto IS NULL
     ORDER BY er.nombre, j.nombre`
  );
  return rows;
}

async function main() {
  const pendientes = await jugadoresSinFoto();
  console.log(`Jugadores activos sin foto: ${pendientes.length}`);
  if (pendientes.length === 0) return;

  const actas = actasManuales.length
    ? actasManuales.map(cod_acta => ({ cod_acta }))
    : (await pool.query(
        `WITH sin_foto AS (
           SELECT j.id, j.id_equipo_real FROM jugadores j WHERE j.activo AND j.foto IS NULL
         )
         SELECT DISTINCT p.cod_acta
         FROM partidos p
         WHERE p.cod_acta IS NOT NULL
           AND (
             p.id IN (SELECT e.id_partido FROM estadisticas e JOIN sin_foto s ON s.id = e.id_jugador)
             OR ($1 AND EXISTS (
               SELECT 1 FROM sin_foto s
               JOIN equipos_reales er ON er.id = s.id_equipo_real
               WHERE ${NORM('er.nombre')} IN (${NORM('p.nombre_local')}, ${NORM('p.nombre_visitante')})
             ))
           )
         ORDER BY p.cod_acta DESC`,
        [incluirEquipos]
      )).rows;
  console.log(`${actas.length} actas a revisar (pausa de ${CONFIG.DELAY_MS} ms entre actas)\n`);

  let total = 0;
  const fallidas = [];
  for (const { cod_acta } of actas) {
    try {
      const n = await guardarFotosActa(pool, parseActa(await fetchActa(cod_acta), cod_acta));
      total += n;
      console.log(`  acta ${cod_acta}: ${n} fotos`);
    } catch (err) {
      fallidas.push(cod_acta);
      console.error(`  acta ${cod_acta}: ERROR ${err.message}`);
    }
  }

  const siguen = await jugadoresSinFoto();
  console.log(`\n${total} fotos nuevas. Siguen sin foto: ${siguen.length}`);
  for (const j of siguen) console.log(`  - ${j.nombre} (${j.equipo ?? 'sin equipo'})`);
  if (fallidas.length) {
    console.log(`\n${fallidas.length} actas no se pudieron descargar (relanza más tarde): ${fallidas.join(' ')}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
