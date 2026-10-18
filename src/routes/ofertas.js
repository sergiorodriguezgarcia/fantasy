import { pool } from '../db/pool.js';
import { clausulaInicial, finProteccion } from '../services/clausulas.js';
import { guardarAlineacionesCerradas } from '../services/alineaciones.js';

/**
 * Marca como EXPIRADA las ofertas de usuario pendientes cuya fecha_expiracion ya pasó y devuelve
 * su importe bloqueado al comprador. Sin esto, una oferta que el vendedor no responde se queda
 * PENDIENTE (oculta en los listados) con el saldo del comprador bloqueado para siempre.
 * Una sola sentencia: el WHERE estado = 'PENDIENTE' evita devolver dos veces si se lanza en paralelo.
 */
export async function expirarOfertasVencidas() {
  const { rows } = await pool.query(
    `WITH vencidas AS (
       UPDATE ofertas SET estado = 'EXPIRADA'
       WHERE tipo = 'USUARIO' AND estado = 'PENDIENTE' AND fecha_expiracion <= NOW()
       RETURNING id_equipo_comprador, monto
     ), por_equipo AS (
       SELECT id_equipo_comprador, SUM(monto) AS total, COUNT(*) AS n
       FROM vencidas
       WHERE id_equipo_comprador IS NOT NULL
       GROUP BY id_equipo_comprador
     )
     UPDATE equipos_fantasy ef
     SET saldo_disponible = ef.saldo_disponible + pe.total,
         saldo_bloqueado  = ef.saldo_bloqueado  - pe.total
     FROM por_equipo pe
     WHERE ef.id = pe.id_equipo_comprador
     RETURNING ef.id AS id_equipo, pe.n::int AS ofertas, pe.total AS devuelto`
  );
  return rows;
}

export async function ofertasRoutes(app) {

  // GET /api/ofertas/recibidas — ofertas pendientes para mis jugadores
  app.get('/recibidas', { preHandler: app.authenticate }, async (req) => {
    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return [];

    const { rows } = await pool.query(
      `SELECT o.id, o.tipo, o.monto, o.estado, o.fecha_creacion, o.fecha_expiracion,
              j.id AS id_jugador, j.nombre AS jugador, j.posicion, j.precio_actual,
              ef_c.nombre AS comprador
       FROM ofertas o
       JOIN jugadores j ON j.id = o.id_jugador
       LEFT JOIN equipos_fantasy ef_c ON ef_c.id = o.id_equipo_comprador
       WHERE o.id_equipo_vendedor = $1
         AND o.estado = 'PENDIENTE'
         AND (o.fecha_expiracion IS NULL OR o.fecha_expiracion > NOW())
       ORDER BY o.tipo DESC, o.fecha_creacion DESC`,
      [ef[0].id]
    );
    return rows;
  });

  // GET /api/ofertas/enviadas — mis ofertas pendientes a otros equipos
  app.get('/enviadas', { preHandler: app.authenticate }, async (req) => {
    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return [];

    const { rows } = await pool.query(
      `SELECT o.id, o.tipo, o.monto, o.estado, o.fecha_creacion, o.fecha_expiracion,
              j.id AS id_jugador, j.nombre AS jugador, j.posicion, j.precio_actual,
              ef_v.nombre AS vendedor
       FROM ofertas o
       JOIN jugadores j ON j.id = o.id_jugador
       LEFT JOIN equipos_fantasy ef_v ON ef_v.id = o.id_equipo_vendedor
       WHERE o.id_equipo_comprador = $1
         AND o.estado = 'PENDIENTE'
         AND (o.fecha_expiracion IS NULL OR o.fecha_expiracion > NOW())
       ORDER BY o.fecha_creacion DESC`,
      [ef[0].id]
    );
    return rows;
  });

  // POST /api/ofertas — hacer una oferta por un jugador ajeno
  app.post('/', { preHandler: app.authenticate }, async (req, reply) => {
    const { id_jugador, monto } = req.body ?? {};
    if (!id_jugador || !monto || monto <= 0) {
      return reply.code(400).send({ error: 'id_jugador y monto (> 0) son obligatorios' });
    }

    const { rows: ef } = await pool.query(
      `SELECT id, saldo_disponible FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const comprador = ef[0];

    if (comprador.saldo_disponible < monto) {
      return reply.code(400).send({ error: 'Saldo insuficiente para esta oferta' });
    }

    // Verificar que el jugador pertenece a OTRO equipo
    const { rows: plant } = await pool.query(
      `SELECT p.id_equipo_fantasy, j.precio_actual
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id_jugador = $1`,
      [id_jugador]
    );
    if (plant.length === 0) {
      return reply.code(400).send({ error: 'Este jugador es agente libre. Puja en las subastas del mercado.' });
    }
    if (plant[0].id_equipo_fantasy === comprador.id) {
      return reply.code(400).send({ error: 'No puedes hacerte una oferta por tu propio jugador' });
    }
    const idVendedor = plant[0].id_equipo_fantasy;

    // Mínimo: el valor actual del jugador (evita traspasos amañados a precio simbólico)
    const precioActual = Number(plant[0].precio_actual);
    if (monto < precioActual) {
      return reply.code(400).send({
        error: `La oferta no puede ser inferior al valor actual del jugador (${precioActual.toLocaleString('es-ES')}€)`,
      });
    }

    // No duplicar oferta pendiente del mismo comprador por este jugador
    const { rows: yaOferta } = await pool.query(
      `SELECT id FROM ofertas
       WHERE id_equipo_comprador = $1 AND id_jugador = $2 AND estado = 'PENDIENTE'`,
      [comprador.id, id_jugador]
    );
    if (yaOferta.length > 0) {
      return reply.code(400).send({ error: 'Ya tienes una oferta pendiente por este jugador' });
    }

    const expira = new Date(Date.now() + 48 * 3_600_000); // 48h

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Repetir las comprobaciones con el equipo bloqueado (dos peticiones a la vez no pasan ambas)
      const { rows: [saldo] } = await client.query(
        `SELECT saldo_disponible FROM equipos_fantasy WHERE id = $1 FOR UPDATE`, [comprador.id]
      );
      if (Number(saldo.saldo_disponible) < monto) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Saldo insuficiente para esta oferta' });
      }
      const { rows: duplicada } = await client.query(
        `SELECT id FROM ofertas
         WHERE id_equipo_comprador = $1 AND id_jugador = $2 AND estado = 'PENDIENTE'`,
        [comprador.id, id_jugador]
      );
      if (duplicada.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Ya tienes una oferta pendiente por este jugador' });
      }

      // Bloquear saldo del comprador para garantizar que puede pagar
      await client.query(
        `UPDATE equipos_fantasy
         SET saldo_disponible = saldo_disponible - $1,
             saldo_bloqueado  = saldo_bloqueado  + $1
         WHERE id = $2`,
        [monto, comprador.id]
      );

      const { rows } = await client.query(
        `INSERT INTO ofertas (id_jugador, id_equipo_vendedor, id_equipo_comprador, tipo, monto, fecha_expiracion)
         VALUES ($1, $2, $3, 'USUARIO', $4, $5)
         RETURNING id`,
        [id_jugador, idVendedor, comprador.id, monto, expira]
      );

      await client.query('COMMIT');
      return { ok: true, id_oferta: rows[0].id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/ofertas/:id/aceptar — aceptar oferta (soy el dueño del jugador)
  app.post('/:id/aceptar', { preHandler: app.authenticate }, async (req, reply) => {
    const idOferta = parseInt(req.params.id);

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const vendedor = ef[0];

    const { rows: ofRows } = await pool.query(
      `SELECT o.id, o.id_jugador, o.id_equipo_comprador, o.tipo, o.monto, o.estado, o.fecha_expiracion,
              j.nombre AS jugador, j.precio_actual
       FROM ofertas o
       JOIN jugadores j ON j.id = o.id_jugador
       WHERE o.id = $1 AND o.id_equipo_vendedor = $2`,
      [idOferta, vendedor.id]
    );
    if (ofRows.length === 0) return reply.code(403).send({ error: 'Oferta no encontrada o no autorizado' });
    const oferta = ofRows[0];

    if (oferta.estado !== 'PENDIENTE') {
      return reply.code(400).send({ error: 'Esta oferta ya no está pendiente' });
    }
    if (oferta.fecha_expiracion && new Date(oferta.fecha_expiracion) < new Date()) {
      // Marcar como expirada y, solo si este proceso la ha cambiado, desbloquear el saldo del comprador
      const { rowCount } = await pool.query(
        `UPDATE ofertas SET estado = 'EXPIRADA' WHERE id = $1 AND estado = 'PENDIENTE'`, [idOferta]
      );
      if (rowCount > 0 && oferta.id_equipo_comprador) {
        await pool.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [oferta.monto, oferta.id_equipo_comprador]
        );
      }
      return reply.code(400).send({ error: 'Esta oferta ha expirado' });
    }

    // Ofertas creadas antes del mínimo (o si el jugador se ha revalorizado): no se pueden aceptar
    if (oferta.tipo === 'USUARIO' && Number(oferta.monto) < Number(oferta.precio_actual)) {
      return reply.code(400).send({
        error: `La oferta es inferior al valor actual del jugador (${Number(oferta.precio_actual).toLocaleString('es-ES')}€). Recházala.`,
      });
    }

    // El saldo ya está bloqueado desde la creación — solo verificar que el comprador existe
    const compradorId = oferta.id_equipo_comprador;
    if (oferta.tipo === 'USUARIO' && compradorId) {
      const { rows: comprRows } = await pool.query(
        `SELECT id FROM equipos_fantasy WHERE id = $1`, [compradorId]
      );
      if (comprRows.length === 0) return reply.code(400).send({ error: 'El comprador ya no existe' });
    }

    // Foto de las alineaciones antes de mover el jugador
    await guardarAlineacionesCerradas();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Marcar la oferta como ACEPTADA antes de mover dinero: si llegan dos aceptaciones a la vez
      // (doble clic) la segunda no encuentra la oferta pendiente y no vuelve a pagar
      const { rowCount: aceptada } = await client.query(
        `UPDATE ofertas SET estado = 'ACEPTADA', fecha_respuesta = NOW()
         WHERE id = $1 AND estado = 'PENDIENTE'`,
        [idOferta]
      );
      if (aceptada === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Esta oferta ya no está pendiente' });
      }

      // Pagar al vendedor
      await client.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
        [oferta.monto, vendedor.id]
      );

      // Consumir el saldo bloqueado del comprador (ya estaba reservado al crear la oferta)
      if (oferta.tipo === 'USUARIO' && compradorId) {
        await client.query(
          `UPDATE equipos_fantasy SET saldo_bloqueado = saldo_bloqueado - $1 WHERE id = $2`,
          [oferta.monto, compradorId]
        );
      }

      // Quitar jugador de la plantilla del vendedor
      await client.query(
        `DELETE FROM plantillas WHERE id_equipo_fantasy = $1 AND id_jugador = $2`,
        [vendedor.id, oferta.id_jugador]
      );

      // Añadir al comprador (solo oferta de usuario)
      if (oferta.tipo === 'USUARIO' && compradorId) {
        const fechaFichaje = new Date();
        await client.query(
          `INSERT INTO plantillas
             (id_equipo_fantasy, id_jugador, precio_compra, clausula_monto, clausula_activa_desde, fecha_fichaje)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id_equipo_fantasy, id_jugador) DO UPDATE
             SET precio_compra = EXCLUDED.precio_compra,
                 clausula_monto = EXCLUDED.clausula_monto,
                 clausula_activa_desde = EXCLUDED.clausula_activa_desde,
                 fecha_fichaje = EXCLUDED.fecha_fichaje`,
          [compradorId, oferta.id_jugador, oferta.monto,
           clausulaInicial(oferta.monto), finProteccion(fechaFichaje), fechaFichaje]
        );
      }

      // El valor de mercado no cambia: un acuerdo entre dos usuarios no debe fijar el precio del jugador

      // Expirar y DESBLOQUEAR el resto de ofertas PENDIENTE para este jugador
      const { rows: otrasOfertas } = await client.query(
        `SELECT id, id_equipo_comprador, monto, tipo FROM ofertas
         WHERE id_jugador = $1 AND estado = 'PENDIENTE' AND id != $2`,
        [oferta.id_jugador, idOferta]
      );
      for (const otra of otrasOfertas) {
        if (otra.tipo === 'USUARIO' && otra.id_equipo_comprador) {
          await client.query(
            `UPDATE equipos_fantasy
             SET saldo_disponible = saldo_disponible + $1,
                 saldo_bloqueado  = saldo_bloqueado  - $1
             WHERE id = $2`,
            [otra.monto, otra.id_equipo_comprador]
          );
        }
      }
      await client.query(
        `UPDATE ofertas SET estado = 'EXPIRADA'
         WHERE id_jugador = $1 AND estado = 'PENDIENTE' AND id != $2`,
        [oferta.id_jugador, idOferta]
      );

      // Cancelar subastas activas del jugador y devolver pujas bloqueadas
      const { rows: subActivas } = await client.query(
        `SELECT id FROM subastas WHERE id_jugador = $1 AND estado = 'ACTIVA'`,
        [oferta.id_jugador]
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

      await client.query('COMMIT');
      return { ok: true, mensaje: `${oferta.jugador} vendido por ${Number(oferta.monto).toLocaleString()}€` };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/ofertas/:id/rechazar — rechazar oferta (soy el dueño)
  app.post('/:id/rechazar', { preHandler: app.authenticate }, async (req, reply) => {
    const idOferta = parseInt(req.params.id);

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });

    const { rows: ofRows } = await pool.query(
      `SELECT id, id_equipo_comprador, monto, tipo FROM ofertas
       WHERE id = $1 AND id_equipo_vendedor = $2 AND estado = 'PENDIENTE'`,
      [idOferta, ef[0].id]
    );
    if (ofRows.length === 0) {
      return reply.code(404).send({ error: 'Oferta no encontrada o ya procesada' });
    }
    const oferta = ofRows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cambiar el estado primero: con dos peticiones a la vez solo una desbloquea el saldo
      const { rowCount } = await client.query(
        `UPDATE ofertas SET estado = 'RECHAZADA' WHERE id = $1 AND estado = 'PENDIENTE'`, [idOferta]
      );
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Oferta no encontrada o ya procesada' });
      }

      // Desbloquear saldo del comprador
      if (oferta.tipo === 'USUARIO' && oferta.id_equipo_comprador) {
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [oferta.monto, oferta.id_equipo_comprador]
        );
      }

      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/ofertas/:id/cancelar — el comprador cancela su propia oferta pendiente
  app.post('/:id/cancelar', { preHandler: app.authenticate }, async (req, reply) => {
    const idOferta = parseInt(req.params.id);

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });

    const { rows: ofRows } = await pool.query(
      `SELECT id, monto, tipo FROM ofertas
       WHERE id = $1 AND id_equipo_comprador = $2 AND estado = 'PENDIENTE'`,
      [idOferta, ef[0].id]
    );
    if (ofRows.length === 0) {
      return reply.code(404).send({ error: 'Oferta no encontrada o ya procesada' });
    }
    const oferta = ofRows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cambiar el estado primero: con dos peticiones a la vez solo una devuelve el saldo
      const { rowCount } = await client.query(
        `UPDATE ofertas SET estado = 'RECHAZADA' WHERE id = $1 AND estado = 'PENDIENTE'`, [idOferta]
      );
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Oferta no encontrada o ya procesada' });
      }

      // Devolver saldo bloqueado
      if (oferta.tipo === 'USUARIO') {
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [oferta.monto, ef[0].id]
        );
      }

      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
