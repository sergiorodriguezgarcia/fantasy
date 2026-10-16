/**
 * Carga inicial de fotos de jugadores a partir de las actas de los partidos ya importados.
 * Las importaciones de jornada nuevas ya guardan las fotos automáticamente.
 *
 * Uso: node scripts/importar-fotos.js [jornadaDesde] [jornadaHasta]
 */
import { pool } from '../src/db/pool.js';
import { fetchActa } from '../src/scraper/fetcher.js';
import { parseActa } from '../src/scraper/parser.js';
import { guardarFotosActa } from '../src/services/fotos.js';

const desde = parseInt(process.argv[2] ?? '1');
const hasta = parseInt(process.argv[3] ?? '999');

async function main() {
  const { rows: partidos } = await pool.query(
    `SELECT DISTINCT p.cod_acta, jo.numero AS jornada
     FROM partidos p
     JOIN jornadas jo ON jo.id = p.id_jornada
     WHERE p.cod_acta IS NOT NULL AND jo.numero BETWEEN $1 AND $2
     ORDER BY jo.numero DESC`,
    [desde, hasta]
  );
  console.log(`${partidos.length} actas a procesar (jornadas ${desde}-${hasta})`);

  let total = 0;
  for (const { cod_acta, jornada } of partidos) {
    try {
      const acta = parseActa(await fetchActa(cod_acta), cod_acta);
      const n = await guardarFotosActa(pool, acta);
      total += n;
      console.log(`  J${jornada} acta ${cod_acta}: ${n} fotos`);
    } catch (err) {
      console.error(`  J${jornada} acta ${cod_acta}: ERROR ${err.message}`);
    }
  }

  const { rows: [{ con_foto, total_jugadores }] } = await pool.query(
    `SELECT COUNT(foto) AS con_foto, COUNT(*) AS total_jugadores FROM jugadores WHERE activo = TRUE`
  );
  console.log(`\n${total} fotos actualizadas. Jugadores activos con foto: ${con_foto}/${total_jugadores}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
