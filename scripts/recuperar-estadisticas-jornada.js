/**
 * Recupera las estadísticas de los jugadores que jugaron una jornada pero no se importaron porque
 * el nombre del acta no casaba con el de la BD (p. ej. "KWIATKOWSKI, MATEUSZ DAWID" con el
 * jugador "MATEUSZ DAWID": antes no se probaba el nombre compuesto sin apellidos).
 *
 * Vuelve a leer las actas de la jornada y solo inserta las estadísticas que faltan (las que ya
 * hay no se tocan, ni sus puntos). Con --aplicar, después recalcula los puntos de los equipos en
 * la jornada: los premios se ajustan por diferencia con lo ya pagado. Los precios de los jugadores NO se recalculan (ya se
 * ajustaron al calcular la jornada y repetirlo los movería dos veces).
 *
 * Solo recalcula jornadas con foto de alineaciones del cierre: sin ella el cálculo usaría las
 * plantillas actuales, que ya no son las de esa jornada.
 *
 * Uso (por defecto solo muestra lo que haría, sin tocar nada):
 *   node scripts/recuperar-estadisticas-jornada.js --jornada N
 *   node scripts/recuperar-estadisticas-jornada.js --jornada N --aplicar
 */
import { pool } from '../src/db/pool.js';
import { fetchActa } from '../src/scraper/fetcher.js';
import { parseActa } from '../src/scraper/parser.js';
import { normalizeName, generarCombinacionesNombre } from '../src/scraper/nombres.js';
import { calcularPuntos, calcularPuntosJornada } from '../src/services/puntos.js';

const aplicar = process.argv.includes('--aplicar');
const iJornada = process.argv.indexOf('--jornada');
const numeroJornada = iJornada >= 0 ? parseInt(process.argv[iJornada + 1]) : NaN;

const SIN_TILDES = `'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC'`;

async function main() {
  if (isNaN(numeroJornada)) throw new Error('Indica la jornada: --jornada N');

  const { rows: [jornada] } = await pool.query(
    `SELECT id, numero, alineaciones_guardadas FROM jornadas WHERE numero = $1`, [numeroJornada]
  );
  if (!jornada) throw new Error(`Jornada ${numeroJornada} no encontrada`);

  const { rows: partidos } = await pool.query(
    `SELECT id, cod_acta FROM partidos WHERE id_jornada = $1 AND cod_acta IS NOT NULL ORDER BY id`, [jornada.id]
  );

  // Mismo emparejamiento y mismas cuentas que importarPartido() (routes/cron.js)
  const nuevas = [];
  for (const partido of partidos) {
    const acta = parseActa(await fetchActa(partido.cod_acta), partido.cod_acta);
    const golesLocal = acta.equipoLocal.goles.filter(g => !g.esPropio).length
      + acta.equipoVisitante.goles.filter(g => g.esPropio).length;
    const golesVisitante = acta.equipoVisitante.goles.filter(g => !g.esPropio).length
      + acta.equipoLocal.goles.filter(g => g.esPropio).length;

    for (const [equipoData, victoria] of [
      [acta.equipoLocal, golesLocal > golesVisitante],
      [acta.equipoVisitante, golesVisitante > golesLocal],
    ]) {
      for (const j of equipoData.jugadores) {
        if (j.minutosJugados === 0) continue;
        const { rows: [jugador] } = await pool.query(
          `SELECT jg.id, jg.nombre, jg.posicion, e.id AS id_estadistica
           FROM jugadores jg
           LEFT JOIN estadisticas e ON e.id_jugador = jg.id AND e.id_jornada = $4
           WHERE (jg.cod_jugador = $1 AND jg.cod_jugador IS NOT NULL)
              OR (
                (jg.cod_jugador IS NULL OR jg.cod_jugador = $1)
                AND translate(upper(jg.nombre), ${SIN_TILDES}) = ANY($2::text[])
                AND jg.id_equipo_real IN (
                  SELECT id FROM equipos_reales WHERE translate(upper(nombre), ${SIN_TILDES}) = $3
                )
              )
           ORDER BY (jg.cod_jugador = $1) DESC NULLS LAST
           LIMIT 1`,
          [j.id, generarCombinacionesNombre(j.nombre), normalizeName(equipoData.nombre), jornada.id]
        );
        if (!jugador || jugador.id_estadistica) continue;

        const delJugador = x => normalizeName(x.jugadorNombre) === normalizeName(j.nombre);
        const stats = {
          minutos_jugados: j.minutosJugados,
          goles: equipoData.goles.filter(g => !g.esPropio && delJugador(g)).length,
          goles_propio: equipoData.goles.filter(g => g.esPropio && delJugador(g)).length,
          amarillas: equipoData.tarjetas.filter(t => t.tipo === 'amarilla' && delJugador(t)).length,
          rojas: equipoData.tarjetas.filter(t => t.tipo === 'roja' && delJugador(t)).length,
          porteria_cero: j.golesEncajados === 0,
          goles_encajados: j.golesEncajados,
          victoria,
        };
        nuevas.push({ jugador, idPartido: partido.id, equipo: equipoData.nombre, stats });
      }
    }
  }

  // Equipos fantasy que tenían a cada jugador en la alineación de la jornada
  const tabla = jornada.alineaciones_guardadas ? 'alineaciones_jornada' : 'plantillas';
  for (const n of nuevas) {
    const { rows } = await pool.query(
      `SELECT ef.nombre, p.es_titular, p.es_capitan FROM ${tabla} p
       JOIN equipos_fantasy ef ON ef.id = p.id_equipo_fantasy
       WHERE p.id_jugador = $1 ${jornada.alineaciones_guardadas ? 'AND p.id_jornada = $2' : ''}`,
      jornada.alineaciones_guardadas ? [n.jugador.id, jornada.id] : [n.jugador.id]
    );
    const s = n.stats;
    const dueños = rows.map(r => `${r.nombre}${r.es_titular ? ' (titular' + (r.es_capitan ? ', capitán)' : ')') : ' (suplente)'}`);
    console.log(
      `  ${n.jugador.nombre} (${n.jugador.posicion}, ${n.equipo}): ${s.minutos_jugados}' · ${s.goles} gol(es)` +
      ` · ${s.amarillas}A ${s.rojas}R · ${s.goles_encajados} encajados → ${calcularPuntos(n.jugador.posicion, s)} pts` +
      (dueños.length ? ` · en ${dueños.join(', ')}` : '')
    );
  }
  console.log(`\nJornada ${jornada.numero}: ${nuevas.length} estadística(s) que faltaban.`);

  if (!aplicar) {
    console.log('Simulación: no se ha cambiado nada. Lanza con --aplicar para ejecutarlo.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { jugador, idPartido, stats: s } of nuevas) {
      await client.query(
        `INSERT INTO estadisticas
           (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
            amarillas, rojas, porteria_cero, goles_encajados, victoria, puntos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id_jugador, id_jornada) DO NOTHING`,
        [jugador.id, jornada.id, idPartido, s.minutos_jugados, s.goles, s.goles_propio,
         s.amarillas, s.rojas, s.porteria_cero, s.goles_encajados, s.victoria,
         calcularPuntos(jugador.posicion, s)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log('Estadísticas insertadas.');

  if (!jornada.alineaciones_guardadas) {
    console.log('La jornada no tiene foto de alineaciones: NO se recalculan los puntos de los equipos.');
    return;
  }

  const { rows: antes } = await pool.query(
    `SELECT id_equipo_fantasy, puntos_jornada, premio FROM puntuaciones_jornada WHERE id_jornada = $1`, [jornada.id]
  );
  // Los puntos de los jugadores que ya estaban no se tocan: solo cambian los de los equipos
  await calcularPuntosJornada(jornada.id, { recalcularJugadores: false });
  const { rows: despues } = await pool.query(
    `SELECT pj.id_equipo_fantasy, ef.nombre, pj.puntos_jornada, pj.premio
     FROM puntuaciones_jornada pj JOIN equipos_fantasy ef ON ef.id = pj.id_equipo_fantasy
     WHERE pj.id_jornada = $1 ORDER BY ef.nombre`,
    [jornada.id]
  );
  const previo = new Map(antes.map(r => [r.id_equipo_fantasy, r]));
  console.log('\nPuntos recalculados (solo los equipos que cambian):');
  for (const r of despues) {
    const a = previo.get(r.id_equipo_fantasy);
    if (a && a.puntos_jornada === r.puntos_jornada) continue;
    const dif = Number(r.premio ?? 0) - Number(a?.premio ?? 0);
    console.log(`  ${r.nombre}: ${a?.puntos_jornada ?? '-'} → ${r.puntos_jornada} pts · saldo ${dif >= 0 ? '+' : ''}${dif.toLocaleString('es-ES')}€`);
  }
}

main()
  .catch((err) => {
    console.error('Error recuperando estadísticas:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
