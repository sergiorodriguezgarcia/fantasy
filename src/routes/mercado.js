import { pool } from '../db/pool.js';

export async function mercadoRoutes(app) {

  // GET /api/mercado/subastas — subastas activas del día
  app.get('/subastas', async () => {
    const { rows } = await pool.query(
      `SELECT s.id, s.tipo, j.id AS id_jugador, j.nombre AS jugador,
              j.posicion, er.nombre AS equipo_real,
              j.precio_actual,
              s.precio_minimo, s.fecha_cierre,
              ef_v.nombre AS vendedor,
              (
                SELECT json_build_object('monto', max(pu.monto), 'total', count(*))
                FROM pujas pu WHERE pu.id_subasta = s.id
              ) AS puja_info
       FROM subastas s
       JOIN jugadores j ON j.id = s.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       LEFT JOIN equipos_fantasy ef_v ON ef_v.id = s.id_vendedor
       WHERE s.estado = 'ACTIVA' AND s.fecha_cierre > NOW()
       ORDER BY s.tipo DESC, s.fecha_cierre ASC`
    );
    return rows;
  });

  // GET /api/mercado/subastas/:id — detalle de subasta con pujas
  app.get('/subastas/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows: sub } = await pool.query(
      `SELECT s.id, s.tipo, j.id AS id_jugador, j.nombre AS jugador,
              j.posicion, er.nombre AS equipo_real, j.precio_actual,
              s.precio_minimo, s.fecha_inicio, s.fecha_cierre, s.estado,
              ef_v.nombre AS vendedor,
              ef_g.nombre AS ganador, s.precio_final
       FROM subastas s
       JOIN jugadores j ON j.id = s.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       LEFT JOIN equipos_fantasy ef_v ON ef_v.id = s.id_vendedor
       LEFT JOIN equipos_fantasy ef_g ON ef_g.id = s.id_ganador
       WHERE s.id = $1`,
      [id]
    );
    if (sub.length === 0) return reply.code(404).send({ error: 'Subasta no encontrada' });

    const { rows: pujas } = await pool.query(
      `SELECT pu.id, ef.nombre AS equipo, pu.monto, pu.creado_en
       FROM pujas pu
       JOIN equipos_fantasy ef ON ef.id = pu.id_equipo_fantasy
       WHERE pu.id_subasta = $1
       ORDER BY pu.monto DESC`,
      [id]
    );

    return { ...sub[0], pujas };
  });

  // POST /api/mercado/subastas — poner un jugador a subasta
  app.post('/subastas', { preHandler: app.authenticate }, async (req, reply) => {
    const { id_jugador, precio_minimo } = req.body ?? {};
    if (!id_jugador || !precio_minimo) {
      return reply.code(400).send({ error: 'id_jugador y precio_minimo son obligatorios' });
    }

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const idEf = ef[0].id;

    // Verificar propiedad y obtener precio actual del jugador
    const { rows: plant } = await pool.query(
      `SELECT p.id, j.precio_actual
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id_equipo_fantasy = $1 AND p.id_jugador = $2`,
      [idEf, id_jugador]
    );
    if (plant.length === 0) {
      return reply.code(400).send({ error: 'Ese jugador no está en tu plantilla' });
    }

    const precioMinAceptable = Math.round(parseInt(plant[0].precio_actual) * 0.9);
    if (precio_minimo < precioMinAceptable) {
      return reply.code(400).send({
        error: `El precio mínimo no puede ser inferior al 90% del valor actual del jugador (${precioMinAceptable.toLocaleString()}€)`,
      });
    }

    // Verificar que no tenga ya una subasta activa
    const { rows: subActiva } = await pool.query(
      `SELECT id FROM subastas WHERE id_vendedor = $1 AND estado = 'ACTIVA'`, [idEf]
    );
    if (subActiva.length > 0) {
      return reply.code(400).send({ error: 'Ya tienes un jugador en subasta. Solo puedes tener una activa a la vez.' });
    }

    // Crear subasta que cierra a las 23:59:59 de hoy
    const hoy = new Date();
    const cierre = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

    const { rows: sub } = await pool.query(
      `INSERT INTO subastas (id_jugador, id_vendedor, precio_minimo, fecha_inicio, fecha_cierre)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING id, fecha_cierre`,
      [id_jugador, idEf, precio_minimo, cierre]
    );

    return { ok: true, id_subasta: sub[0].id, fecha_cierre: sub[0].fecha_cierre };
  });

  // POST /api/mercado/subastas/:id/pujar — hacer una puja
  app.post('/subastas/:id/pujar', { preHandler: app.authenticate }, async (req, reply) => {
    const idSubasta = parseInt(req.params.id);
    const { monto } = req.body ?? {};
    if (!monto || monto <= 0) return reply.code(400).send({ error: 'monto debe ser mayor que cero' });

    const { rows: ef } = await pool.query(
      `SELECT id, saldo_disponible, saldo_bloqueado FROM equipos_fantasy WHERE id_usuario = $1`,
      [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const comprador = ef[0];

    const { rows: sub } = await pool.query(
      `SELECT id, id_vendedor, id_jugador, precio_minimo, fecha_cierre, estado
       FROM subastas WHERE id = $1`,
      [idSubasta]
    );
    if (sub.length === 0) return reply.code(404).send({ error: 'Subasta no encontrada' });
    const subasta = sub[0];

    if (subasta.estado !== 'ACTIVA' || new Date(subasta.fecha_cierre) <= new Date()) {
      return reply.code(400).send({ error: 'La subasta ya no está activa' });
    }
    if (subasta.id_vendedor === comprador.id) {
      return reply.code(400).send({ error: 'No puedes pujar en tu propia subasta' });
    }

    // Verificar que el monto supera el mínimo y la puja más alta actual
    const { rows: maxPuja } = await pool.query(
      `SELECT COALESCE(MAX(monto), 0) AS max_monto FROM pujas WHERE id_subasta = $1`,
      [idSubasta]
    );
    const pujaActual = Math.max(parseInt(maxPuja[0].max_monto), subasta.precio_minimo);
    const pujaMinima = pujaActual + 100_000; // incremento mínimo 100K

    if (monto < pujaMinima) {
      return reply.code(400).send({
        error: `La puja mínima es ${pujaMinima.toLocaleString()}€ (actual: ${pujaActual.toLocaleString()}€ + 100.000€)`,
      });
    }

    // Verificar saldo (disponible + bloqueado anterior de esta subasta)
    const { rows: pujaAnterior } = await pool.query(
      `SELECT COALESCE(monto, 0) AS monto FROM pujas
       WHERE id_subasta = $1 AND id_equipo_fantasy = $2`,
      [idSubasta, comprador.id]
    );
    const montoAnterior = parseInt(pujaAnterior[0]?.monto ?? 0);
    const saldoEfectivo = comprador.saldo_disponible + montoAnterior;

    if (saldoEfectivo < monto) {
      return reply.code(400).send({ error: 'Saldo insuficiente' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Devolver saldo anterior bloqueado
      if (montoAnterior > 0) {
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [montoAnterior, comprador.id]
        );
      }

      // Bloquear nueva puja
      await client.query(
        `UPDATE equipos_fantasy
         SET saldo_disponible = saldo_disponible - $1,
             saldo_bloqueado  = saldo_bloqueado  + $1
         WHERE id = $2`,
        [monto, comprador.id]
      );

      // Insertar o actualizar puja
      await client.query(
        `INSERT INTO pujas (id_subasta, id_equipo_fantasy, monto)
         VALUES ($1, $2, $3)
         ON CONFLICT (id_subasta, id_equipo_fantasy)
         DO UPDATE SET monto = EXCLUDED.monto, creado_en = NOW()`,
        [idSubasta, comprador.id, monto]
      );

      await client.query('COMMIT');
      return { ok: true, monto_puja: monto };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/mercado/subastas/resolver — (cron job o admin) resuelve subastas cerradas
  // Nota: también llamado por el cron interno del servidor
  app.post('/subastas/resolver', { preHandler: app.requireAdmin }, async () => {
    return resolverSubastasVencidas();
  });

  // POST /api/mercado/cron/resolver-subastas — llamado por cron externo (protegido por CRON_SECRET)
  app.post('/cron/resolver-subastas', async (req, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
    return resolverSubastasVencidas();
  });

  // POST /api/mercado/cron/abrir-ventana — llamado por cron externo a las 17:00
  app.post('/cron/abrir-ventana', async (req, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
    const { rows } = await pool.query(
      `SELECT valor FROM config_mercado WHERE clave = 'jugadores_por_ventana'`
    );
    const n = parseInt(rows[0]?.valor ?? '5');
    return abrirVentanaMercado({ n });
  });
}

/**
 * Resuelve todas las subastas cuya fecha_cierre ya pasó y están ACTIVA.
 * Llama a esta función desde un cron job o manualmente.
 */
export async function resolverSubastasVencidas() {
  const { rows: vencidas } = await pool.query(
    `SELECT id, tipo, id_jugador, id_vendedor, precio_minimo
     FROM subastas
     WHERE estado = 'ACTIVA' AND fecha_cierre <= NOW()`
  );

  const resultados = [];

  for (const sub of vencidas) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mejor puja
      const { rows: mejorPuja } = await client.query(
        `SELECT id_equipo_fantasy, monto
         FROM pujas
         WHERE id_subasta = $1
         ORDER BY monto DESC
         LIMIT 1`,
        [sub.id]
      );

      if (mejorPuja.length === 0) {
        // Desierta: devolver el jugador al vendedor (ya lo tiene)
        await client.query(
          `UPDATE subastas SET estado = 'DESIERTA' WHERE id = $1`, [sub.id]
        );
        resultados.push({ id: sub.id, resultado: 'DESIERTA' });
      } else {
        const ganador = mejorPuja[0];

        // Cobrar al ganador (ya bloqueado)
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_bloqueado = saldo_bloqueado - $1
           WHERE id = $2`,
          [ganador.monto, ganador.id_equipo_fantasy]
        );
        // Solo pagar al vendedor si es subasta entre usuarios (no de sistema)
        if (sub.tipo === 'USUARIO' && sub.id_vendedor) {
          await client.query(
            `UPDATE equipos_fantasy
             SET saldo_disponible = saldo_disponible + $1
             WHERE id = $2`,
            [ganador.monto, sub.id_vendedor]
          );
        }

        // Devolver pujas perdedoras
        const { rows: pujasOtras } = await client.query(
          `SELECT id_equipo_fantasy, monto FROM pujas
           WHERE id_subasta = $1 AND id_equipo_fantasy != $2`,
          [sub.id, ganador.id_equipo_fantasy]
        );
        for (const p of pujasOtras) {
          await client.query(
            `UPDATE equipos_fantasy
             SET saldo_disponible = saldo_disponible + $1,
                 saldo_bloqueado  = saldo_bloqueado  - $1
             WHERE id = $2`,
            [p.monto, p.id_equipo_fantasy]
          );
        }

        // Transferir jugador: quitar del vendedor (solo si no es sistema), añadir al ganador
        if (sub.tipo === 'USUARIO' && sub.id_vendedor) {
          await client.query(
            `DELETE FROM plantillas WHERE id_equipo_fantasy = $1 AND id_jugador = $2`,
            [sub.id_vendedor, sub.id_jugador]
          );
        }

        const fechaFichaje = new Date();
        const clausulaDesde = new Date(fechaFichaje.getTime() + 15 * 86_400_000);
        const clausulaInicial = Math.round(ganador.monto * 1.5);

        await client.query(
          `INSERT INTO plantillas
             (id_equipo_fantasy, id_jugador, precio_compra, clausula_monto,
              clausula_activa_desde, fecha_fichaje)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id_equipo_fantasy, id_jugador) DO UPDATE
             SET precio_compra = EXCLUDED.precio_compra,
                 clausula_monto = EXCLUDED.clausula_monto,
                 clausula_activa_desde = EXCLUDED.clausula_activa_desde,
                 fecha_fichaje = EXCLUDED.fecha_fichaje`,
          [ganador.id_equipo_fantasy, sub.id_jugador, ganador.monto,
           clausulaInicial, clausulaDesde.toISOString().split('T')[0], fechaFichaje]
        );

        // Actualizar precio de mercado del jugador
        await client.query(
          `UPDATE jugadores SET precio_actual = $1 WHERE id = $2`,
          [ganador.monto, sub.id_jugador]
        );

        await client.query(
          `UPDATE subastas
           SET estado = 'RESUELTA', id_ganador = $1, precio_final = $2
           WHERE id = $3`,
          [ganador.id_equipo_fantasy, ganador.monto, sub.id]
        );

        resultados.push({ id: sub.id, resultado: 'RESUELTA', precio: ganador.monto });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Error resolviendo subasta ${sub.id}:`, err);
      resultados.push({ id: sub.id, resultado: 'ERROR', error: err.message });
    } finally {
      client.release();
    }
  }

  return { procesadas: resultados.length, resultados };
}

/**
 * Abre la ventana de mercado diaria:
 * - Selecciona agentes libres (jugadores sin propietario activo)
 * - Crea subastas de tipo SISTEMA con precio_minimo = precio_actual * 0.5
 * - Cierre: mañana a la misma hora de apertura (24h)
 * - No crea subastas si ya hay una ventana abierta hoy
 */
export async function abrirVentanaMercado({ n = 5 } = {}) {
  // Comprobar si ya se abrió ventana hoy
  const { rows: yaAbierta } = await pool.query(
    `SELECT COUNT(*) AS total FROM subastas
     WHERE tipo = 'SISTEMA' AND estado = 'ACTIVA'
       AND DATE(fecha_inicio AT TIME ZONE 'Europe/Madrid') = CURRENT_DATE`
  );
  if (parseInt(yaAbierta[0].total) > 0) {
    return { ok: false, motivo: 'Ya hay una ventana de mercado abierta hoy' };
  }

  // fecha_cierre = mañana a las 17:00
  const ahora = new Date();
  const cierre = new Date(ahora);
  cierre.setDate(cierre.getDate() + 1);
  cierre.setHours(17, 0, 0, 0);

  // === SUBASTAS para agentes libres ===
  const { rows: libres } = await pool.query(
    `SELECT j.id, j.precio_actual
     FROM jugadores j
     WHERE j.activo = TRUE
       AND j.id NOT IN (SELECT id_jugador FROM plantillas)
     ORDER BY RANDOM()
     LIMIT $1`,
    [n]
  );

  const creadas = [];
  for (const jugador of libres) {
    const precioMinimo = Math.round(jugador.precio_actual * 0.5);
    const { rows } = await pool.query(
      `INSERT INTO subastas
         (id_jugador, id_vendedor, precio_minimo, fecha_inicio, fecha_cierre, tipo)
       VALUES ($1, NULL, $2, NOW(), $3, 'SISTEMA')
       RETURNING id`,
      [jugador.id, precioMinimo, cierre]
    );
    creadas.push({ id: rows[0].id, id_jugador: jugador.id, precio_minimo: precioMinimo });
  }

  // === OFERTAS DEL SISTEMA para jugadores en plantillas (±10% precio actual) ===
  // Expirar ofertas de sistema anteriores que aún estén pendientes
  await pool.query(
    `UPDATE ofertas SET estado = 'EXPIRADA'
     WHERE tipo = 'SISTEMA' AND estado = 'PENDIENTE'`
  );

  const { rows: propietarios } = await pool.query(
    `SELECT p.id_jugador, p.id_equipo_fantasy, j.precio_actual
     FROM plantillas p
     JOIN jugadores j ON j.id = p.id_jugador
     WHERE j.activo = TRUE`
  );

  let ofertasSistema = 0;
  for (const p of propietarios) {
    const factor = 0.9 + Math.random() * 0.2; // entre 0.90 y 1.10
    const monto = Math.round(parseInt(p.precio_actual) * factor);
    await pool.query(
      `INSERT INTO ofertas (id_jugador, id_equipo_vendedor, tipo, monto, fecha_expiracion)
       VALUES ($1, $2, 'SISTEMA', $3, $4)`,
      [p.id_jugador, p.id_equipo_fantasy, monto, cierre]
    );
    ofertasSistema++;
  }

  return {
    ok: true,
    subastas_creadas: creadas.length,
    ofertas_sistema: ofertasSistema,
    cierre,
    subastas: creadas,
  };
}
