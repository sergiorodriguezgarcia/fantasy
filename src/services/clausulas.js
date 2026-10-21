/**
 * Cláusulas de rescisión.
 *
 * Reglas:
 *  - Al fichar a un jugador (por cualquier vía) su cláusula es precio × 1,5, con un máximo de 150M,
 *    y queda protegido 15 días: nadie puede pagar su cláusula hasta entonces.
 *  - Pasada la protección, cualquier otro usuario puede pagar la cláusula y el jugador pasa a su
 *    equipo al instante, sin negociación (clausulazo). El fichaje reinicia la protección.
 *  - El dueño puede subir la cláusula pagando el 100% del incremento (máximo 150M): blindar a un
 *    jugador cuesta lo mismo que la protección que gana.
 *  - Cada usuario puede hacer como máximo 4 clausulazos por jornada. El periodo de una jornada va
 *    desde que se calcula una jornada hasta que se calcula la siguiente.
 */

import { pool } from '../db/pool.js';
import { avisarClausulazo } from './email.js';

export const CLAUSULA = {
  MULTIPLICADOR: 1.5,
  MAXIMO: 150_000_000,
  DIAS_PROTECCION: 15,
  COSTE_SUBIDA: 1,      // sobre el incremento
  MAX_POR_JORNADA: 4,
};

export class ErrorClausula extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

export function clausulaInicial(precio) {
  return Math.min(CLAUSULA.MAXIMO, Math.round(Number(precio) * CLAUSULA.MULTIPLICADOR));
}

// Fecha (YYYY-MM-DD) a partir de la cual se puede pagar la cláusula de un fichaje hecho en `desde`
export function finProteccion(desde = new Date()) {
  return new Date(desde.getTime() + CLAUSULA.DIAS_PROTECCION * 86_400_000).toISOString().split('T')[0];
}

export function costeSubida(actual, nueva) {
  return Math.ceil((Number(nueva) - Number(actual)) * CLAUSULA.COSTE_SUBIDA);
}

// Periodo actual para el límite de clausulazos: nº de la última jornada calculada (0 si ninguna)
export async function periodoJornada(db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(numero), 0) AS periodo FROM jornadas WHERE estado = 'CALCULADA'`
  );
  return Number(rows[0].periodo);
}

export async function clausulazosRestantes(idEquipo, db = pool) {
  const periodo = await periodoJornada(db);
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n FROM clausulazos WHERE id_comprador = $1 AND periodo_jornada = $2`,
    [idEquipo, periodo]
  );
  return Math.max(0, CLAUSULA.MAX_POR_JORNADA - Number(rows[0].n));
}

/**
 * Cancela todo lo que el jugador tenga abierto en el mercado (subastas activas y ofertas
 * pendientes) devolviendo el saldo bloqueado de pujas y ofertas. Usar dentro de una transacción.
 */
export async function liberarJugadorDelMercado(client, idJugador) {
  const { rows: subActivas } = await client.query(
    // FOR UPDATE: espera a una resolución en curso y, si la subasta ya no está activa, la descarta
    `SELECT id FROM subastas WHERE id_jugador = $1 AND estado = 'ACTIVA' FOR UPDATE`, [idJugador]
  );
  for (const sub of subActivas) {
    const { rows: pujas } = await client.query(
      `SELECT id_equipo_fantasy, monto FROM pujas WHERE id_subasta = $1`, [sub.id]
    );
    for (const puja of pujas) {
      await client.query(
        `UPDATE equipos_fantasy
         SET saldo_disponible = saldo_disponible + $1, saldo_bloqueado = saldo_bloqueado - $1
         WHERE id = $2`,
        [puja.monto, puja.id_equipo_fantasy]
      );
    }
    await client.query(`UPDATE subastas SET estado = 'DESIERTA' WHERE id = $1`, [sub.id]);
  }

  const { rows: ofertasPend } = await client.query(
    `SELECT id, id_equipo_comprador, monto, tipo FROM ofertas
     WHERE id_jugador = $1 AND estado = 'PENDIENTE'
     FOR UPDATE`, [idJugador]
  );
  for (const o of ofertasPend) {
    if (o.tipo === 'USUARIO' && o.id_equipo_comprador) {
      await client.query(
        `UPDATE equipos_fantasy
         SET saldo_disponible = saldo_disponible + $1, saldo_bloqueado = saldo_bloqueado - $1
         WHERE id = $2`,
        [o.monto, o.id_equipo_comprador]
      );
    }
  }
  await client.query(
    `UPDATE ofertas SET estado = 'EXPIRADA' WHERE id_jugador = $1 AND estado = 'PENDIENTE'`,
    [idJugador]
  );
}

/**
 * Clausulazo: el usuario paga la cláusula del jugador y se lo lleva a su equipo al instante.
 */
export async function pagarClausula(idUsuario, idJugador) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [comprador] } = await client.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [idUsuario]
    );
    if (!comprador) throw new ErrorClausula('No tienes equipo', 404);

    // Bloquear la fila de plantilla: evita que dos usuarios paguen la misma cláusula a la vez
    const { rows: [plantilla] } = await client.query(
      `SELECT p.id, p.id_equipo_fantasy, p.clausula_monto, p.clausula_activa_desde,
              (p.clausula_activa_desde <= CURRENT_DATE) AS activa,
              j.nombre
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id_jugador = $1
       FOR UPDATE OF p`,
      [idJugador]
    );
    if (!plantilla) throw new ErrorClausula('Este jugador no tiene dueño: puedes ficharlo en el mercado');
    if (plantilla.id_equipo_fantasy === comprador.id) {
      throw new ErrorClausula('Este jugador ya es tuyo');
    }
    if (!plantilla.activa) {
      const fecha = new Date(plantilla.clausula_activa_desde).toLocaleDateString('es-ES');
      throw new ErrorClausula(`${plantilla.nombre} está protegido: su cláusula se puede pagar a partir del ${fecha}`);
    }

    const monto = Number(plantilla.clausula_monto);
    const idVendedor = plantilla.id_equipo_fantasy;

    // Bloquear ambos equipos siempre en el mismo orden para evitar interbloqueos
    const { rows: equipos } = await client.query(
      `SELECT id, saldo_disponible FROM equipos_fantasy WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
      [[comprador.id, idVendedor]]
    );
    const saldoComprador = Number(equipos.find(e => e.id === comprador.id).saldo_disponible);
    if (saldoComprador < monto) {
      throw new ErrorClausula(`Saldo insuficiente: la cláusula cuesta ${monto.toLocaleString('es-ES')}€`);
    }

    const periodo = await periodoJornada(client);
    const { rows: [{ n: hechos }] } = await client.query(
      `SELECT COUNT(*) AS n FROM clausulazos WHERE id_comprador = $1 AND periodo_jornada = $2`,
      [comprador.id, periodo]
    );
    if (Number(hechos) >= CLAUSULA.MAX_POR_JORNADA) {
      throw new ErrorClausula(`Ya has pagado ${CLAUSULA.MAX_POR_JORNADA} cláusulas esta jornada`);
    }

    await liberarJugadorDelMercado(client, idJugador);

    await client.query(`DELETE FROM plantillas WHERE id = $1`, [plantilla.id]);
    await client.query(
      `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible - $1 WHERE id = $2`,
      [monto, comprador.id]
    );
    await client.query(
      `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
      [monto, idVendedor]
    );

    // Entra como suplente para no descuadrar la alineación guardada del comprador
    await client.query(
      `INSERT INTO plantillas
         (id_equipo_fantasy, id_jugador, es_titular, es_capitan, precio_compra,
          clausula_monto, clausula_activa_desde, fecha_fichaje)
       VALUES ($1, $2, FALSE, FALSE, $3, $4, $5, CURRENT_DATE)`,
      [comprador.id, idJugador, monto, clausulaInicial(monto), finProteccion()]
    );

    await client.query(
      `INSERT INTO clausulazos (id_jugador, id_vendedor, id_comprador, monto, periodo_jornada)
       VALUES ($1, $2, $3, $4, $5)`,
      [idJugador, idVendedor, comprador.id, monto, periodo]
    );

    await client.query('COMMIT');
    // Aviso por correo al dueño anterior, sin esperar (un fallo de correo no afecta al clausulazo)
    avisarClausulazo({ idVendedor, idComprador: comprador.id, idJugador, monto });
    return {
      ok: true,
      monto,
      restantes: CLAUSULA.MAX_POR_JORNADA - Number(hechos) - 1,
      mensaje: `¡Clausulazo! ${plantilla.nombre} es tuyo por ${monto.toLocaleString('es-ES')}€`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * El dueño sube la cláusula de un jugador pagando el incremento (COSTE_SUBIDA × incremento).
 */
export async function subirClausula(idUsuario, idPlantilla, nuevaClausula) {
  const nueva = Math.round(Number(nuevaClausula));
  if (!Number.isFinite(nueva) || nueva <= 0) throw new ErrorClausula('Importe de cláusula no válido');
  if (nueva > CLAUSULA.MAXIMO) {
    throw new ErrorClausula(`La cláusula no puede superar ${CLAUSULA.MAXIMO.toLocaleString('es-ES')}€`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [equipo] } = await client.query(
      `SELECT id, saldo_disponible FROM equipos_fantasy WHERE id_usuario = $1 FOR UPDATE`, [idUsuario]
    );
    if (!equipo) throw new ErrorClausula('No tienes equipo', 404);

    const { rows: [plantilla] } = await client.query(
      `SELECT id_jugador, clausula_monto FROM plantillas WHERE id = $1 AND id_equipo_fantasy = $2 FOR UPDATE`,
      [idPlantilla, equipo.id]
    );
    if (!plantilla) throw new ErrorClausula('Jugador no encontrado en tu plantilla', 404);

    const actual = Number(plantilla.clausula_monto);
    if (nueva <= actual) throw new ErrorClausula('Solo puedes subir la cláusula, no bajarla');

    const coste = costeSubida(actual, nueva);
    if (Number(equipo.saldo_disponible) < coste) {
      throw new ErrorClausula(`Saldo insuficiente: subir la cláusula cuesta ${coste.toLocaleString('es-ES')}€`);
    }

    await client.query(
      `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible - $1 WHERE id = $2`,
      [coste, equipo.id]
    );
    await client.query(
      `UPDATE plantillas SET clausula_monto = $1 WHERE id = $2`,
      [nueva, idPlantilla]
    );
    await client.query(
      `INSERT INTO subidas_clausula
         (id_plantilla, id_equipo_fantasy, id_jugador, clausula_anterior, clausula_nueva, coste)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [idPlantilla, equipo.id, plantilla.id_jugador, actual, nueva, coste]
    );

    await client.query('COMMIT');
    return { ok: true, clausula_monto: nueva, coste };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
