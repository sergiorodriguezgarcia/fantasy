/**
 * Tamaño de las plantillas fantasy. El alta da 12 jugadores; nadie puede fichar (pujar, ofertar,
 * pagar una cláusula) si ya tiene MAX_JUGADORES.
 */

import { pool } from '../db/pool.js';

export const MAX_JUGADORES = 15;

export const MENSAJE_PLANTILLA_LLENA =
  `Tu plantilla está completa (${MAX_JUGADORES} jugadores): vende a alguien antes de fichar`;

export async function jugadoresEnPlantilla(idEquipo, db = pool) {
  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM plantillas WHERE id_equipo_fantasy = $1`, [idEquipo]
  );
  return n;
}

export async function plantillaLlena(idEquipo, db = pool) {
  return (await jugadoresEnPlantilla(idEquipo, db)) >= MAX_JUGADORES;
}
