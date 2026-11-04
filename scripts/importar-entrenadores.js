/**
 * Carga inicial de entrenadores (posicion 'ENT', 1.000.000€) a partir de las actas ya importadas.
 * Recorre las actas de la más reciente a la más antigua y da de alta el entrenador de cada equipo
 * la primera vez que aparece (el más reciente). Los equipos que ya tienen entrenador no se tocan,
 * así que se puede relanzar sin duplicar. Para por sí solo cuando todos los equipos tienen uno.
 *
 * Uso: node scripts/importar-entrenadores.js
 */
import { pool } from '../src/db/pool.js';
import { fetchActa } from '../src/scraper/fetcher.js';
import { parseActa } from '../src/scraper/parser.js';
import { altaEntrenador } from '../src/services/entrenadores.js';

async function equiposSinEntrenador() {
  const { rows } = await pool.query(
    `SELECT er.nombre FROM equipos_reales er
     WHERE er.activo = TRUE
       AND NOT EXISTS (SELECT 1 FROM jugadores j
                       WHERE j.id_equipo_real = er.id AND j.posicion = 'ENT' AND j.activo = TRUE)
     ORDER BY er.nombre`
  );
  return rows.map(r => r.nombre);
}

async function main() {
  const { rows: partidos } = await pool.query(
    `SELECT p.cod_acta, jo.numero AS jornada
     FROM partidos p
     JOIN jornadas jo ON jo.id = p.id_jornada
     WHERE p.cod_acta IS NOT NULL
     ORDER BY jo.numero DESC, p.id DESC`
  );
  console.log(`${partidos.length} actas disponibles`);

  let creados = 0;
  for (const { cod_acta, jornada } of partidos) {
    if ((await equiposSinEntrenador()).length === 0) break;
    try {
      const acta = parseActa(await fetchActa(cod_acta), cod_acta);
      for (const equipo of [acta.equipoLocal, acta.equipoVisitante]) {
        if (!equipo?.entrenador) continue;
        const resultado = await altaEntrenador(pool, equipo.nombre, equipo.entrenador);
        if (resultado === 'creado') {
          creados++;
          console.log(`  J${jornada} ${equipo.nombre}: ${equipo.entrenador.nombre}`);
        } else if (resultado === 'sin_equipo') {
          console.warn(`  J${jornada} equipo no encontrado en la BD: ${equipo.nombre}`);
        }
      }
    } catch (err) {
      console.error(`  J${jornada} acta ${cod_acta}: ERROR ${err.message}`);
    }
  }

  const pendientes = await equiposSinEntrenador();
  console.log(`\n${creados} entrenadores creados.`);
  if (pendientes.length > 0) {
    console.log(`Equipos sin entrenador (darlo de alta a mano en admin con posición ENT): ${pendientes.join(', ')}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
