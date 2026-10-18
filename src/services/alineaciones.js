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
 * Once que puntúa en una jornada a partir de los jugadores de un equipo ({ id_jugador, posicion,
 * es_titular, es_capitan, puntos, minutos_jugados, ... }):
 * - cada titular que no jugó (0 min) lo sustituye el primer suplente de su posición que sí jugó;
 *   cada suplente solo puede sustituir a uno
 * - el capitán puntúa ×2 (si no jugó, el doble pasa a quien entra por él)
 * Devuelve { total, campo, banquillo }: en `campo` cada hueco titular con el jugador que puntúa en
 * él (`entra_por` = titular sustituido) y sus puntos efectivos; en `banquillo` el resto.
 */
export function aplicarSustituciones(jugadores) {
  const titulares = jugadores.filter(j => j.es_titular);
  const suplentes = jugadores.filter(j => !j.es_titular);
  const usados = new Set();
  let total = 0;

  const campo = titulares.map(titular => {
    let juega = titular;
    if ((titular.minutos_jugados ?? 0) === 0) {
      const suplente = suplentes.find(
        s => !usados.has(s.id_jugador) && s.posicion === titular.posicion && (s.minutos_jugados ?? 0) > 0
      );
      if (suplente) {
        usados.add(suplente.id_jugador);
        juega = suplente;
      }
    }
    const puntos = (juega.puntos ?? 0) * (titular.es_capitan ? 2 : 1);
    total += puntos;
    return {
      ...juega,
      posicion: titular.posicion,
      es_capitan: titular.es_capitan,
      puntos_campo: puntos,
      entra_por: juega === titular ? null : { id_jugador: titular.id_jugador, nombre: titular.nombre },
    };
  });

  // Banquillo: suplentes que no entraron y titulares que fueron sustituidos
  const enCampo = new Set(campo.map(j => j.id_jugador));
  const banquillo = jugadores.filter(j => !enCampo.has(j.id_jugador));

  return { total, campo, banquillo };
}

/**
 * Alineación de un equipo en una jornada lista para pintar en el campo, con los puntos de cada
 * jugador y las sustituciones aplicadas igual que en el cálculo. Usa la foto del cierre si existe.
 */
export async function alineacionJornada(idEquipo, idJornada, db = pool) {
  const { tabla, filtro } = await origenAlineacion(idJornada, '$2', db);
  const { rows: jugadores } = await db.query(
    `SELECT j.id AS id_jugador, j.nombre, j.posicion, er.nombre AS equipo_real,
            p.es_titular, p.es_capitan,
            e.minutos_jugados, e.goles, e.amarillas, e.rojas, e.porteria_cero, e.puntos
     FROM ${tabla} p
     JOIN jugadores j ON j.id = p.id_jugador
     LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
     LEFT JOIN estadisticas e ON e.id_jugador = j.id AND e.id_jornada = $2
     WHERE p.id_equipo_fantasy = $1 ${filtro}
     ORDER BY j.posicion, j.nombre`,
    [idEquipo, idJornada]
  );

  const { campo, banquillo } = aplicarSustituciones(jugadores);
  const cuenta = pos => campo.filter(j => j.posicion === pos).length;
  return { formacion: `${cuenta('DEF')}-${cuenta('MED')}-${cuenta('DEL')}`, campo, banquillo };
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
