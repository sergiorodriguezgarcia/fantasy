/**
 * Tamaño de las plantillas fantasy. El alta da 12 jugadores; nadie puede fichar (pujar, ofertar,
 * pagar una cláusula) si ya tiene MAX_JUGADORES. Los entrenadores van aparte: no cuentan entre
 * los jugadores y como mucho se tiene MAX_ENTRENADORES.
 */

import { pool } from '../db/pool.js';

export const MAX_JUGADORES = 15;
export const MAX_ENTRENADORES = 1;

export const MENSAJE_PLANTILLA_LLENA =
  `Tu plantilla está completa (${MAX_JUGADORES} jugadores): vende a alguien antes de fichar`;
export const MENSAJE_YA_TIENE_ENTRENADOR =
  'Ya tienes entrenador: véndelo antes de fichar otro';

/**
 * Por qué el equipo no puede fichar a `idJugador` (MENSAJE_PLANTILLA_LLENA o
 * MENSAJE_YA_TIENE_ENTRENADOR), o null si tiene hueco para él.
 */
export async function sinHuecoPara(idEquipo, idJugador, db = pool) {
  const { rows: [r] } = await db.query(
    `SELECT (SELECT posicion = 'ENT' FROM jugadores WHERE id = $2) AS es_entrenador,
            COUNT(*) FILTER (WHERE j.posicion = 'ENT')::int AS entrenadores,
            COUNT(*) FILTER (WHERE j.posicion IS DISTINCT FROM 'ENT')::int AS jugadores
     FROM plantillas p
     JOIN jugadores j ON j.id = p.id_jugador
     WHERE p.id_equipo_fantasy = $1`,
    [idEquipo, idJugador]
  );
  if (r.es_entrenador) return r.entrenadores >= MAX_ENTRENADORES ? MENSAJE_YA_TIENE_ENTRENADOR : null;
  return r.jugadores >= MAX_JUGADORES ? MENSAJE_PLANTILLA_LLENA : null;
}
