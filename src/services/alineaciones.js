/**
 * Cierre de alineaciones.
 *
 * Cada jornada tiene `cierre_alineaciones` = inicio de su primer partido. Desde ese momento y
 * hasta que la jornada se calcula, nadie puede cambiar su alineación, y los puntos se calculan
 * con la foto de las plantillas tomada al cierre (alineaciones_jornada): los fichajes y ventas
 * hechos con la jornada empezada no suman ni restan puntos en esa jornada.
 */

import { pool } from '../db/pool.js';

/** Jornada con las alineaciones cerradas ahora mismo (empezó y aún no está calculada), o null. */
export async function jornadaConAlineacionesCerradas(db = pool) {
  const { rows } = await db.query(
    `SELECT id, numero, cierre_alineaciones FROM jornadas
     WHERE cierre_alineaciones <= NOW() AND estado <> 'CALCULADA'
     ORDER BY numero
     LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Próximo cierre de alineaciones conocido, o null. */
export async function proximoCierreAlineaciones(db = pool) {
  const { rows } = await db.query(
    `SELECT id, numero, cierre_alineaciones FROM jornadas
     WHERE cierre_alineaciones > NOW() AND estado <> 'CALCULADA'
     ORDER BY cierre_alineaciones
     LIMIT 1`
  );
  return rows[0] ?? null;
}

/**
 * Guarda la foto de las alineaciones de las jornadas cuyo cierre ya ha pasado y aún no la tienen.
 * Se llama periódicamente y antes de cualquier cambio de plantilla (venta, fichaje, cláusula),
 * para que la foto se tome antes del primer cambio aunque el servicio estuviera dormido.
 * Solo entran los equipos con alineación guardada (sin ella no puntúan).
 */
export async function guardarAlineacionesCerradas() {
  const { rows: pendientes } = await pool.query(
    `SELECT id FROM jornadas
     WHERE cierre_alineaciones <= NOW() AND NOT alineaciones_guardadas AND estado <> 'CALCULADA'`
  );

  for (const { id } of pendientes) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Bloquear la jornada: con dos llamadas a la vez solo una toma la foto
      const { rows } = await client.query(
        `SELECT id FROM jornadas WHERE id = $1 AND NOT alineaciones_guardadas FOR UPDATE`, [id]
      );
      if (rows.length > 0) {
        await client.query(
          `INSERT INTO alineaciones_jornada (id_jornada, id_equipo_fantasy, id_jugador, es_titular, es_capitan)
           SELECT $1, p.id_equipo_fantasy, p.id_jugador, p.es_titular, p.es_capitan
           FROM plantillas p
           JOIN equipos_fantasy ef ON ef.id = p.id_equipo_fantasy
           WHERE ef.formacion IS NOT NULL
           ON CONFLICT DO NOTHING`,
          [id]
        );
        await client.query(`UPDATE jornadas SET alineaciones_guardadas = TRUE WHERE id = $1`, [id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * De dónde sacar la alineación de los equipos en una jornada: la foto del cierre si existe; si no
 * (jornadas anteriores a esta función), la plantilla actual. Las dos tablas tienen
 * id_equipo_fantasy, id_jugador, es_titular y es_capitan, así que se usan con el alias `p`:
 *   FROM ${tabla} p ... WHERE p.id_equipo_fantasy = $1 ${filtro}
 * `paramJornada` es el parámetro SQL que lleva el id de la jornada (p. ej. '$2').
 */
export async function origenAlineacion(idJornada, paramJornada, db = pool) {
  const { rows } = await db.query(
    `SELECT alineaciones_guardadas FROM jornadas WHERE id = $1`, [idJornada]
  );
  return rows[0]?.alineaciones_guardadas
    ? { tabla: 'alineaciones_jornada', filtro: `AND p.id_jornada = ${paramJornada}` }
    : { tabla: 'plantillas', filtro: '' };
}

/**
 * Inicio del primer partido a partir de los horarios de asturfutbol.es ("18-10-2026" y "12:00",
 * hora de España). Devuelve "2026-10-18 12:00" (sin zona: se interpreta en Europe/Madrid en SQL)
 * o null si ningún partido tiene fecha.
 */
export function primerPartido(partidos) {
  const inicios = partidos
    .map(p => {
      const f = (p.fecha ?? '').match(/(\d{2})-(\d{2})-(\d{4})/);
      if (!f) return null;
      const h = (p.hora ?? '').match(/(\d{1,2}):(\d{2})/);
      return `${f[3]}-${f[2]}-${f[1]} ${h ? `${h[1].padStart(2, '0')}:${h[2]}` : '00:00'}`;
    })
    .filter(Boolean)
    .sort();
  return inicios[0] ?? null;
}
