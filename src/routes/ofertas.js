import { pool } from '../db/pool.js';

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
      `SELECT id_equipo_fantasy FROM plantillas WHERE id_jugador = $1`, [id_jugador]
    );
    if (plant.length === 0) {
      return reply.code(400).send({ error: 'Este jugador es agente libre. Puja en las subastas del mercado.' });
    }
    if (plant[0].id_equipo_fantasy === comprador.id) {
      return reply.code(400).send({ error: 'No puedes hacerte una oferta por tu propio jugador' });
    }
    const idVendedor = plant[0].id_equipo_fantasy;

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
    const { rows } = await pool.query(
      `INSERT INTO ofertas (id_jugador, id_equipo_vendedor, id_equipo_comprador, tipo, monto, fecha_expiracion)
       VALUES ($1, $2, $3, 'USUARIO', $4, $5)
       RETURNING id`,
      [id_jugador, idVendedor, comprador.id, monto, expira]
    );

    return { ok: true, id_oferta: rows[0].id };
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
              j.nombre AS jugador
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
      return reply.code(400).send({ error: 'Esta oferta ha expirado' });
    }

    // Para oferta de usuario: verificar saldo del comprador
    const compradorId = oferta.id_equipo_comprador;
    if (oferta.tipo === 'USUARIO' && compradorId) {
      const { rows: comprRows } = await pool.query(
        `SELECT saldo_disponible FROM equipos_fantasy WHERE id = $1`, [compradorId]
      );
      if (comprRows.length === 0) return reply.code(400).send({ error: 'El comprador ya no existe' });
      if (comprRows[0].saldo_disponible < oferta.monto) {
        return reply.code(400).send({ error: 'El comprador ya no tiene saldo suficiente' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pagar al vendedor
      await client.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
        [oferta.monto, vendedor.id]
      );

      // Cobrar al comprador (solo oferta de usuario)
      if (oferta.tipo === 'USUARIO' && compradorId) {
        await client.query(
          `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible - $1 WHERE id = $2`,
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
        const clausulaDesde = new Date(fechaFichaje.getTime() + 15 * 86_400_000);
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
           Math.round(oferta.monto * 1.5),
           clausulaDesde.toISOString().split('T')[0], fechaFichaje]
        );
      }

      // Actualizar precio de mercado del jugador
      await client.query(
        `UPDATE jugadores SET precio_actual = $1 WHERE id = $2`,
        [oferta.monto, oferta.id_jugador]
      );

      // Marcar esta oferta como ACEPTADA
      await client.query(`UPDATE ofertas SET estado = 'ACEPTADA' WHERE id = $1`, [idOferta]);

      // Expirar el resto de ofertas PENDIENTE para este jugador
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

    const { rows } = await pool.query(
      `UPDATE ofertas SET estado = 'RECHAZADA'
       WHERE id = $1 AND id_equipo_vendedor = $2 AND estado = 'PENDIENTE'
       RETURNING id`,
      [idOferta, ef[0].id]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Oferta no encontrada o ya procesada' });
    }
    return { ok: true };
  });
}
