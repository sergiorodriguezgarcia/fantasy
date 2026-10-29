/**
 * Anula los puntos (y el premio cobrado) de los equipos que puntuaron en una jornada sin una
 * alineación válida al cierre: sin alineación guardada, o con ella incompleta (menos de 11
 * titulares, sin portero, formación no permitida o sin capitán titular), p. ej. porque vendieron
 * un titular después de guardarla.
 *
 * Por cada equipo afectado:
 *   puntos_jornada → 0 · premio → 0 · saldo_disponible −= premio cobrado
 *   puntos_acumulados de esa jornada y de las siguientes −= puntos anulados
 *
 * Usa la misma regla que el cálculo de puntos (alineacionValida) y la misma fuente de la
 * alineación: la foto del cierre si existe; si no, la plantilla actual.
 *
 * Uso (por defecto la última jornada CALCULADA y solo muestra lo que haría, sin tocar nada):
 *   node scripts/anular-puntos-alineacion-incompleta.js [--jornada N]
 *   node scripts/anular-puntos-alineacion-incompleta.js [--jornada N] --aplicar
 */
import { pool } from '../src/db/pool.js';
import { alineacionValida } from '../src/services/alineaciones.js';

const aplicar = process.argv.includes('--aplicar');
const iJornada = process.argv.indexOf('--jornada');
const numeroJornada = iJornada >= 0 ? parseInt(process.argv[iJornada + 1]) : null;

const fmt = (n) => `${Number(n).toLocaleString('es-ES')}€`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [jornada] } = numeroJornada
      ? await client.query(
          `SELECT id, numero, alineaciones_guardadas FROM jornadas WHERE numero = $1 FOR UPDATE`, [numeroJornada]
        )
      : await client.query(
          `SELECT id, numero, alineaciones_guardadas FROM jornadas
           WHERE estado = 'CALCULADA' ORDER BY numero DESC LIMIT 1 FOR UPDATE`
        );
    if (!jornada) throw new Error('Jornada no encontrada');
    const conFoto = jornada.alineaciones_guardadas;
    console.log(`Jornada ${jornada.numero} (alineaciones: ${conFoto ? 'foto del cierre' : 'plantilla actual'})\n`);

    const { rows: puntuaciones } = await client.query(
      `SELECT pj.id, pj.id_equipo_fantasy, pj.puntos_jornada, pj.premio, ef.nombre, ef.formacion
       FROM puntuaciones_jornada pj
       JOIN equipos_fantasy ef ON ef.id = pj.id_equipo_fantasy
       WHERE pj.id_jornada = $1 AND (pj.puntos_jornada <> 0 OR COALESCE(pj.premio, 0) <> 0)
       ORDER BY ef.nombre
       FOR UPDATE OF pj, ef`,
      [jornada.id]
    );

    let anulados = 0;
    let premiosRetirados = 0;

    for (const p of puntuaciones) {
      const { rows: alineacion } = await client.query(
        `SELECT p.es_titular, p.es_capitan, j.posicion
         FROM ${conFoto ? 'alineaciones_jornada' : 'plantillas'} p
         JOIN jugadores j ON j.id = p.id_jugador
         WHERE p.id_equipo_fantasy = $1 ${conFoto ? 'AND p.id_jornada = $2' : ''}`,
        conFoto ? [p.id_equipo_fantasy, jornada.id] : [p.id_equipo_fantasy]
      );
      const alineado = conFoto ? alineacion.length > 0 : !!p.formacion;
      if (alineado && alineacionValida(alineacion)) continue;

      const titulares = alineacion.filter(j => j.es_titular).length;
      const premio = Number(p.premio ?? 0);
      console.log(
        `  ${p.nombre}: ${alineado ? `${alineacion.length} jugadores, ${titulares} titulares` : 'sin alineación'}` +
        ` · ${p.puntos_jornada} pts → 0 · retirar premio ${fmt(premio)}`
      );

      if (aplicar) {
        await client.query(
          `UPDATE puntuaciones_jornada SET puntos_jornada = 0, premio = CASE WHEN premio IS NULL THEN NULL ELSE 0 END
           WHERE id = $1`,
          [p.id]
        );
        // El acumulado de esta jornada y de las posteriores incluía los puntos anulados
        await client.query(
          `UPDATE puntuaciones_jornada pj SET puntos_acumulados = pj.puntos_acumulados - $1
           FROM jornadas jo
           WHERE jo.id = pj.id_jornada AND pj.id_equipo_fantasy = $2 AND jo.numero >= $3`,
          [p.puntos_jornada, p.id_equipo_fantasy, jornada.numero]
        );
        if (premio !== 0) {
          await client.query(
            `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible - $1 WHERE id = $2`,
            [premio, p.id_equipo_fantasy]
          );
        }
      }
      anulados++;
      premiosRetirados += premio;
    }

    console.log(`\n${anulados} equipo(s) con puntos anulados · ${fmt(premiosRetirados)} en premios retirados.`);

    if (aplicar) {
      await client.query('COMMIT');
      console.log('Cambios aplicados.');
    } else {
      await client.query('ROLLBACK');
      console.log('Simulación: no se ha cambiado nada. Lanza con --aplicar para ejecutarlo.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error anulando puntos de alineaciones incompletas:', err);
  process.exit(1);
});
