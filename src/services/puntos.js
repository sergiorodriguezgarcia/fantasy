/**
 * Motor de cálculo de puntos por jornada.
 *
 * Tabla de puntos por posición (configurable):
 *
 * | Acción                        | POR | DEF | MED | DEL |
 * |-------------------------------|-----|-----|-----|-----|
 * | Gol marcado                   |  6  |  6  |  5  |  4  |
 * | Portería a cero (≥90 min)     |  4  |  3  |  1  |  0  |
 * | Gol en propia puerta          | -2  | -2  | -2  | -2  |
 * | Gol encajado                  | -1  | -1  | -1  | -1  |
 * |   POR/DEF: cada gol           |     |     | MED/DEL: cada 2 |
 * | Tarjeta amarilla              | -1  | -1  | -1  | -1  |
 * | Tarjeta roja                  | -3  | -3  | -3  | -3  |
 * | Jugar ≥60 min                 |  2  |  2  |  2  |  2  |
 * | Jugar <60 min                 |  1  |  1  |  1  |  1  |
 * | Capitán (multiplicador)       | ×2  | ×2  | ×2  | ×2  |
 */

import { pool } from '../db/pool.js';

const PUNTOS = {
  // penalizacionEncajado: puntos negativos por cada N goles encajados
  // POR y DEF: -1 por gol encajado (DEF se aplica cada 2, ver lógica abajo)
  POR: { gol: 6, porteriaCero: 4, golPropio: -2, penalizacionEncajado: -1, cadaXEncajados: 1, amarilla: -1, roja: -3, jugar60: 2, jugarMenos60: 1 },
  DEF: { gol: 6, porteriaCero: 3, golPropio: -2, penalizacionEncajado: -1, cadaXEncajados: 1, amarilla: -1, roja: -3, jugar60: 2, jugarMenos60: 1 },
  MED: { gol: 5, porteriaCero: 1, golPropio: -2, penalizacionEncajado: -1, cadaXEncajados: 2, amarilla: -1, roja: -3, jugar60: 2, jugarMenos60: 1 },
  DEL: { gol: 4, porteriaCero: 0, golPropio: -2, penalizacionEncajado: -1, cadaXEncajados: 2, amarilla: -1, roja: -3, jugar60: 2, jugarMenos60: 1 },
};

/**
 * Calcula los puntos de un jugador según sus estadísticas y posición.
 */
export function calcularPuntos(posicion, stats) {
  const tabla = PUNTOS[posicion] ?? PUNTOS.DEL;
  let puntos = 0;

  if (stats.minutos_jugados >= 60) {
    puntos += tabla.jugar60;
  } else if (stats.minutos_jugados > 0) {
    puntos += tabla.jugarMenos60;
  }

  puntos += (stats.goles ?? 0) * tabla.gol;
  puntos += (stats.goles_propio ?? 0) * tabla.golPropio;
  puntos += (stats.amarillas ?? 0) * tabla.amarilla;
  puntos += (stats.rojas ?? 0) * tabla.roja;

  if (stats.porteria_cero && stats.minutos_jugados >= 90) {
    puntos += tabla.porteriaCero;
  }

  // Penalización por goles encajados (solo POR y DEF)
  if (tabla.penalizacionEncajado < 0 && (stats.goles_encajados ?? 0) > 0) {
    puntos += Math.floor((stats.goles_encajados) / tabla.cadaXEncajados) * tabla.penalizacionEncajado;
  }

  return puntos;
}

/**
 * Calcula los puntos de todos los jugadores de una jornada
 * y actualiza la columna `puntos` en la tabla estadisticas.
 * Luego recalcula los puntos totales de cada equipo fantasy.
 */
export async function calcularPuntosJornada(idJornada) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Calcular puntos por estadística individual
    const { rows: stats } = await client.query(
      `SELECT e.id, e.minutos_jugados, e.goles, e.goles_propio,
              e.amarillas, e.rojas, e.porteria_cero, e.goles_encajados,
              j.posicion
       FROM estadisticas e
       JOIN jugadores j ON j.id = e.id_jugador
       WHERE e.id_jornada = $1`,
      [idJornada]
    );

    for (const s of stats) {
      const puntos = calcularPuntos(s.posicion, s);
      await client.query(
        `UPDATE estadisticas SET puntos = $1 WHERE id = $2`,
        [puntos, s.id]
      );
    }

    // 2. Calcular puntos de cada equipo fantasy
    // Para cada equipo, sumar puntos de sus jugadores titulares (o con sustitución automática)
    // El capitán multiplica × 2
    const { rows: equipos } = await client.query(
      `SELECT ef.id, ef.saldo_disponible, ef.formacion
       FROM equipos_fantasy ef`
    );

    let totalEquipos = 0;

    for (const equipo of equipos) {
      // No puntúa si no tiene alineación guardada o tiene saldo negativo
      if (!equipo.formacion || equipo.saldo_disponible < 0) {
        await client.query(
          `INSERT INTO puntuaciones_jornada
             (id_equipo_fantasy, id_jornada, puntos_jornada, puntos_acumulados, valor_plantilla)
           VALUES ($1, $2, 0, COALESCE(
             (SELECT MAX(puntos_acumulados) FROM puntuaciones_jornada WHERE id_equipo_fantasy = $1), 0
           ), COALESCE(
             (SELECT SUM(j.precio_actual) FROM plantillas p JOIN jugadores j ON j.id = p.id_jugador WHERE p.id_equipo_fantasy = $1), 0
           ))
           ON CONFLICT (id_equipo_fantasy, id_jornada) DO UPDATE
             SET puntos_jornada = 0,
                 puntos_acumulados = EXCLUDED.puntos_acumulados,
                 valor_plantilla = EXCLUDED.valor_plantilla`,
          [equipo.id, idJornada]
        );
        continue;
      }

      const { rows: plantilla } = await client.query(
        `SELECT p.id_jugador, p.es_titular, p.es_capitan, j.posicion,
                e.puntos, e.minutos_jugados
         FROM plantillas p
         JOIN jugadores j ON j.id = p.id_jugador
         LEFT JOIN estadisticas e ON e.id_jugador = j.id AND e.id_jornada = $2
         WHERE p.id_equipo_fantasy = $1`,
        [equipo.id, idJornada]
      );

      // Separar titulares y suplentes por posición
      const titulares = plantilla.filter((p) => p.es_titular);
      const suplentes = plantilla.filter((p) => !p.es_titular);

      let puntosTotales = 0;

      for (const jugador of titulares) {
        let pts = jugador.puntos ?? 0;

        // Sustitución automática: si el titular no jugó (0 min), buscar suplente de su posición
        if ((jugador.minutos_jugados ?? 0) === 0) {
          const suplente = suplentes.find(
            (s) => s.posicion === jugador.posicion && (s.minutos_jugados ?? 0) > 0
          );
          if (suplente) {
            pts = suplente.puntos ?? 0;
            // Marcar el suplente como usado para no contarlo dos veces
            suplente._usado = true;
          }
        }

        // Capitán × 2
        if (jugador.es_capitan) pts *= 2;
        puntosTotales += pts;
      }

      // Obtener puntos acumulados anteriores
      const { rows: prevPuntos } = await client.query(
        `SELECT COALESCE(MAX(puntos_acumulados), 0) AS acum
         FROM puntuaciones_jornada
         WHERE id_equipo_fantasy = $1`,
        [equipo.id]
      );
      const puntosAcum = parseInt(prevPuntos[0].acum) + puntosTotales;

      // Calcular valor de plantilla
      const { rows: valorRows } = await client.query(
        `SELECT COALESCE(SUM(j.precio_actual), 0) AS valor
         FROM plantillas p
         JOIN jugadores j ON j.id = p.id_jugador
         WHERE p.id_equipo_fantasy = $1`,
        [equipo.id]
      );
      const valorPlantilla = parseInt(valorRows[0].valor);

      await client.query(
        `INSERT INTO puntuaciones_jornada
           (id_equipo_fantasy, id_jornada, puntos_jornada, puntos_acumulados, valor_plantilla)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_equipo_fantasy, id_jornada) DO UPDATE
           SET puntos_jornada = EXCLUDED.puntos_jornada,
               puntos_acumulados = EXCLUDED.puntos_acumulados,
               valor_plantilla = EXCLUDED.valor_plantilla`,
        [equipo.id, idJornada, puntosTotales, puntosAcum, valorPlantilla]
      );

      totalEquipos++;
    }

    await client.query('COMMIT');
    return {
      jugadores_calculados: stats.length,
      equipos_calculados: totalEquipos,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
