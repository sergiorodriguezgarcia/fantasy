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
 *   nueva_clausula_minima = nuevo_precio × 1.5  (máximo 150M)
 *   Si el propietario había subido la cláusula por encima, se mantiene la más alta.
 */

import { pool } from '../db/pool.js';
import { clausulaInicial, CLAUSULA } from './clausulas.js';

const FACTOR_AJUSTE = 0.02;   // 2% por punto
const PRECIO_MINIMO = 500_000; // 500K€

/** Precio tras una jornada en la que el jugador sumó `puntos`. */
export function calcularNuevoPrecio(precio, puntos) {
  const factor = 1 + (puntos ?? 0) * FACTOR_AJUSTE;
  return Math.max(
    PRECIO_MINIMO,
    Math.round(precio * factor / 100_000) * 100_000 // redondear a 100K
  );
}

/**
 * Actualiza precios de jugadores tras una jornada y guarda historial.
 *
 * Es idempotente: recalcular una jornada ya calculada (acta corregida, cron + admin, doble clic)
 * parte del precio que el jugador tenía ANTES de esa jornada (el de la jornada anterior en el
 * historial, o precio_inicial), no del precio_actual que ya la incluye. Si después hay jornadas
 * ya calculadas, se rehacen encima del nuevo valor.
 */
export async function actualizarPrecios(idJornada) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear la jornada: dos recálculos simultáneos de la misma jornada van de uno en uno
    const { rows: [jornada] } = await client.query(
      `SELECT numero FROM jornadas WHERE id = $1 FOR UPDATE`, [idJornada]
    );
    if (!jornada) throw new Error(`Jornada ${idJornada} no encontrada`);

    // Puntos de la jornada (solo jugadores que tuvieron partidos procesados)
    const { rows: stats } = await client.query(
      `SELECT id_jugador, puntos FROM estadisticas
       WHERE id_jornada = $1 AND puntos IS NOT NULL`,
      [idJornada]
    );
    const puntosJornada = new Map(stats.map(s => [s.id_jugador, s.puntos]));

    // Afectados: los que puntúan ahora y los que ya tenían precio calculado en esta jornada
    // (si un acta corregida los quita, hay que deshacer su cambio)
    const { rows: yaCalculados } = await client.query(
      `SELECT id_jugador FROM historial_precios WHERE id_jornada = $1`, [idJornada]
    );
    const ids = [...new Set([...puntosJornada.keys(), ...yaCalculados.map(r => r.id_jugador)])];

    const { rows: jugadores } = await client.query(
      `SELECT id, precio_inicial, precio_actual FROM jugadores WHERE id = ANY($1) FOR UPDATE`, [ids]
    );

    // Historial de esos jugadores en orden de jornada, con los puntos de cada una
    const { rows: historial } = await client.query(
      `SELECT h.id, h.id_jugador, h.id_jornada, h.precio, jo.numero, e.puntos
       FROM historial_precios h
       JOIN jornadas jo ON jo.id = h.id_jornada
       LEFT JOIN estadisticas e ON e.id_jugador = h.id_jugador AND e.id_jornada = h.id_jornada
       WHERE h.id_jugador = ANY($1)
       ORDER BY h.id_jugador, jo.numero`,
      [ids]
    );
    const historialPorJugador = new Map();
    for (const h of historial) {
      if (!historialPorJugador.has(h.id_jugador)) historialPorJugador.set(h.id_jugador, []);
      historialPorJugador.get(h.id_jugador).push(h);
    }

    for (const j of jugadores) {
      const filas = historialPorJugador.get(j.id) ?? [];
      const anteriores = filas.filter(f => f.numero < jornada.numero);
      const filaJornada = filas.find(f => f.id_jornada === idJornada);
      const posteriores = filas.filter(f => f.numero > jornada.numero);
      const actual = Number(j.precio_actual);

      // Primer cálculo normal: se parte del precio actual (respeta ajustes manuales del admin).
      // Recálculo o jornada calculada fuera de orden: del precio de antes de esta jornada.
      const base = (filaJornada || posteriores.length > 0)
        ? Number(anteriores.at(-1)?.precio ?? j.precio_inicial)
        : actual;
      // Último precio calculado, del que sale el precio_actual de ahora
      const finAnterior = Number(posteriores.at(-1)?.precio ?? filaJornada?.precio ?? actual);

      let precio = base;
      if (puntosJornada.has(j.id)) {
        precio = calcularNuevoPrecio(base, puntosJornada.get(j.id));
        await client.query(
          `INSERT INTO historial_precios (id_jugador, id_jornada, precio)
           VALUES ($1, $2, $3)
           ON CONFLICT (id_jugador, id_jornada) DO UPDATE SET precio = EXCLUDED.precio`,
          [j.id, idJornada, precio]
        );
      } else {
        // Ya no puntúa en esta jornada: su precio no debe cambiar por ella
        await client.query(`DELETE FROM historial_precios WHERE id = $1`, [filaJornada.id]);
      }

      // Rehacer las jornadas posteriores ya calculadas encima del nuevo valor
      for (const f of posteriores) {
        if (f.puntos == null) continue;
        precio = calcularNuevoPrecio(precio, f.puntos);
        await client.query(`UPDATE historial_precios SET precio = $1 WHERE id = $2`, [precio, f.id]);
      }

      // Conservar cualquier ajuste manual hecho después del último cálculo
      const nuevoPrecio = Math.max(PRECIO_MINIMO, actual + precio - finAnterior);
      if (nuevoPrecio !== actual) {
        await client.query(
          `UPDATE jugadores SET precio_actual = $1 WHERE id = $2`,
          [nuevoPrecio, j.id]
        );
      }

      // Actualizar cláusula de rescisión en plantillas (solo si es menor que la vigente, con tope)
      await client.query(
        `UPDATE plantillas
         SET clausula_monto = LEAST(GREATEST(clausula_monto, $1), $3)
         WHERE id_jugador = $2`,
        [clausulaInicial(nuevoPrecio), j.id, CLAUSULA.MAXIMO]
      );
    }

    await client.query('COMMIT');
    return { jugadores_actualizados: jugadores.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
