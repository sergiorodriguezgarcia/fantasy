/**
 * Motor de actualización de precios de jugadores tras cada jornada.
 *
 * Fórmula:
 *   nuevo_precio = precio_actual × (1 + puntos_jornada × FACTOR_AJUSTE)
 *   con un mínimo de PRECIO_MINIMO (500.000€)
 *
 * Si el jugador no jugó esta jornada, precio no cambia.
 *
 * Tras actualizar precios, también se recalculan las cláusulas de rescisión
 * de los jugadores en plantillas fantasy:
 *   nueva_clausula_minima = nuevo_precio × 1.5
 *   Si el propietario había subido la cláusula por encima, se mantiene la más alta.
 */

import { pool } from '../db/pool.js';

const FACTOR_AJUSTE = 0.02;   // 2% por punto
const PRECIO_MINIMO = 500_000; // 500K€

/**
 * Actualiza precios de jugadores tras una jornada y guarda historial.
 */
export async function actualizarPrecios(idJornada) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener stats de la jornada (solo jugadores que tuvieron partidos procesados)
    const { rows: stats } = await client.query(
      `SELECT e.id_jugador, e.puntos, j.precio_actual, j.posicion
       FROM estadisticas e
       JOIN jugadores j ON j.id = e.id_jugador
       WHERE e.id_jornada = $1 AND e.puntos IS NOT NULL`,
      [idJornada]
    );

    for (const s of stats) {
      const factor = 1 + (s.puntos ?? 0) * FACTOR_AJUSTE;
      const nuevoPrecio = Math.max(
        PRECIO_MINIMO,
        Math.round(s.precio_actual * factor / 100_000) * 100_000 // redondear a 100K
      );

      await client.query(
        `UPDATE jugadores SET precio_actual = $1 WHERE id = $2`,
        [nuevoPrecio, s.id_jugador]
      );

      // Guardar historial
      await client.query(
        `INSERT INTO historial_precios (id_jugador, id_jornada, precio)
         VALUES ($1, $2, $3)
         ON CONFLICT (id_jugador, id_jornada) DO UPDATE SET precio = EXCLUDED.precio`,
        [s.id_jugador, idJornada, nuevoPrecio]
      );

      // Actualizar cláusula de rescisión en plantillas (solo si es menor que la vigente)
      const clausulaMinima = Math.round(nuevoPrecio * 1.5);
      await client.query(
        `UPDATE plantillas
         SET clausula_monto = GREATEST(clausula_monto, $1)
         WHERE id_jugador = $2`,
        [clausulaMinima, s.id_jugador]
      );
    }

    await client.query('COMMIT');
    return { jugadores_actualizados: stats.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
