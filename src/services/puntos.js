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
 *
 * Premio: cada equipo cobra puntos_jornada × 100.000€ al calcularse la jornada.
 */

import { pool } from '../db/pool.js';
import { guardarAlineacionesCerradas } from './alineaciones.js';

// Premio en dinero por cada punto conseguido en una jornada (21 puntos → 2.100.000€)
export const PREMIO_POR_PUNTO = 100_000;

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
  // Si la jornada ya cerró alineaciones y aún no tiene foto (servicio dormido), tomarla ahora
  await guardarAlineacionesCerradas();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear la jornada: dos cálculos simultáneos (cron + admin) van de uno en uno
    const { rows: [jornada] } = await client.query(
      `SELECT numero, alineaciones_guardadas FROM jornadas WHERE id = $1 FOR UPDATE`, [idJornada]
    );
    if (!jornada) throw new Error(`Jornada ${idJornada} no encontrada`);

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

    // Acumulado = suma de las jornadas ANTERIORES + esta. No sirve MAX(puntos_acumulados):
    // al recalcular una jornada ya calculada incluiría esta misma jornada y la contaría dos veces.
    const acumuladoAnterior = async (idEquipo) => {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(pj.puntos_jornada), 0) AS acum
         FROM puntuaciones_jornada pj
         JOIN jornadas jo ON jo.id = pj.id_jornada
         WHERE pj.id_equipo_fantasy = $1 AND jo.numero < $2`,
        [idEquipo, jornada.numero]
      );
      return parseInt(rows[0].acum);
    };

    // Alineaciones con las que se juega la jornada: la foto tomada al cierre si existe (los
    // fichajes y ventas con la jornada empezada no cuentan); si no, la plantilla actual
    const conFoto = jornada.alineaciones_guardadas;
    const { rows: equiposConFoto } = conFoto
      ? await client.query(
          `SELECT DISTINCT id_equipo_fantasy FROM alineaciones_jornada WHERE id_jornada = $1`, [idJornada]
        )
      : { rows: [] };
    const alineadosAlCierre = new Set(equiposConFoto.map(r => r.id_equipo_fantasy));

    // Premio en dinero de la jornada: puntos × PREMIO_POR_PUNTO (nunca negativo). Al recalcular
    // solo se ingresa (o descuenta) la diferencia con lo ya pagado. Las jornadas calculadas antes
    // de existir los premios (premio NULL) no se pagan. Devuelve el premio a guardar.
    const pagarPremio = async (idEquipo, puntos) => {
      const { rows } = await client.query(
        `SELECT premio FROM puntuaciones_jornada WHERE id_equipo_fantasy = $1 AND id_jornada = $2`,
        [idEquipo, idJornada]
      );
      if (rows.length > 0 && rows[0].premio === null) return null;
      const yaPagado = Number(rows[0]?.premio ?? 0);
      const premio = Math.max(0, puntos) * PREMIO_POR_PUNTO;
      if (premio !== yaPagado) {
        await client.query(
          `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
          [premio - yaPagado, idEquipo]
        );
      }
      return premio;
    };

    for (const equipo of equipos) {
      // No puntúa si no tenía alineación guardada (al cierre, si hay foto) o tiene saldo negativo
      const sinAlineacion = conFoto ? !alineadosAlCierre.has(equipo.id) : !equipo.formacion;
      if (sinAlineacion || equipo.saldo_disponible < 0) {
        await client.query(
          `INSERT INTO puntuaciones_jornada
             (id_equipo_fantasy, id_jornada, puntos_jornada, puntos_acumulados, valor_plantilla, premio)
           VALUES ($1, $2, 0, $3, COALESCE(
             (SELECT SUM(j.precio_actual) FROM plantillas p JOIN jugadores j ON j.id = p.id_jugador WHERE p.id_equipo_fantasy = $1), 0
           ), $4)
           ON CONFLICT (id_equipo_fantasy, id_jornada) DO UPDATE
             SET puntos_jornada = 0,
                 puntos_acumulados = EXCLUDED.puntos_acumulados,
                 valor_plantilla = EXCLUDED.valor_plantilla,
                 premio = EXCLUDED.premio`,
          [equipo.id, idJornada, await acumuladoAnterior(equipo.id), await pagarPremio(equipo.id, 0)]
        );
        continue;
      }

      const { rows: plantilla } = await client.query(
        `SELECT p.id_jugador, p.es_titular, p.es_capitan, j.posicion,
                e.puntos, e.minutos_jugados
         FROM ${conFoto ? 'alineaciones_jornada' : 'plantillas'} p
         JOIN jugadores j ON j.id = p.id_jugador
         LEFT JOIN estadisticas e ON e.id_jugador = j.id AND e.id_jornada = $2
         WHERE p.id_equipo_fantasy = $1 ${conFoto ? 'AND p.id_jornada = $2' : ''}`,
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
            (s) => !s._usado && s.posicion === jugador.posicion && (s.minutos_jugados ?? 0) > 0
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

      const puntosAcum = await acumuladoAnterior(equipo.id) + puntosTotales;

      // Calcular valor de plantilla
      const { rows: valorRows } = await client.query(
        `SELECT COALESCE(SUM(j.precio_actual), 0) AS valor
         FROM plantillas p
         JOIN jugadores j ON j.id = p.id_jugador
         WHERE p.id_equipo_fantasy = $1`,
        [equipo.id]
      );
      const valorPlantilla = parseInt(valorRows[0].valor);

      const premio = await pagarPremio(equipo.id, puntosTotales);

      await client.query(
        `INSERT INTO puntuaciones_jornada
           (id_equipo_fantasy, id_jornada, puntos_jornada, puntos_acumulados, valor_plantilla, premio)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_equipo_fantasy, id_jornada) DO UPDATE
           SET puntos_jornada = EXCLUDED.puntos_jornada,
               puntos_acumulados = EXCLUDED.puntos_acumulados,
               valor_plantilla = EXCLUDED.valor_plantilla,
               premio = EXCLUDED.premio`,
        [equipo.id, idJornada, puntosTotales, puntosAcum, valorPlantilla, premio]
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
