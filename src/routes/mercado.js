import { pool } from '../db/pool.js';
import { clausulaInicial, finProteccion } from '../services/clausulas.js';
import { expirarOfertasVencidas } from './ofertas.js';
import { guardarAlineacionesCerradas } from '../services/alineaciones.js';
import { avisarSubastaGanada } from '../services/email.js';

// Hora a la que cierran todas las subastas (hora española)
const HORA_CIERRE = '19:00';

// Próximo cierre a las HORA_CIERRE en Europe/Madrid, sin depender de la zona horaria del servidor
// ni del cambio de hora. Hoy si aún no ha pasado la hora; si no (o con diaSiguiente), mañana.
async function proximoCierre({ diaSiguiente = false } = {}) {
  const { rows: [r] } = await pool.query(
    `SELECT ((NOW() AT TIME ZONE 'Europe/Madrid')::date
             + CASE WHEN $1::boolean OR (NOW() AT TIME ZONE 'Europe/Madrid')::time >= $2::time
                    THEN 1 ELSE 0 END
             + $2::time) AT TIME ZONE 'Europe/Madrid' AS cierre`,
    [diaSiguiente, HORA_CIERRE]
  );
  return r.cierre;
}

export async function mercadoRoutes(app) {

  // GET /api/mercado/subastas — subastas activas del día
  // Resuelve subastas vencidas antes de devolver la lista (lazy resolution para Render free tier)
  app.get('/subastas', { preHandler: app.authenticate }, async (req) => {
    await resolverSubastasVencidas();

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    const idEf = ef[0]?.id ?? null;

    const { rows } = await pool.query(
      `SELECT s.id, s.tipo, j.id AS id_jugador, j.nombre AS jugador,
              j.posicion, er.nombre AS equipo_real,
              j.precio_actual,
              s.precio_minimo, s.fecha_cierre,
              GREATEST(s.precio_minimo, j.precio_actual) AS puja_minima,
              ef_v.nombre AS vendedor,
              (s.id_vendedor = $1) AS es_mia,
              (
                SELECT json_build_object('monto', max(pu.monto), 'total', count(*))
                FROM pujas pu WHERE pu.id_subasta = s.id
              ) AS puja_info,
              (
                SELECT pu.monto FROM pujas pu
                WHERE pu.id_subasta = s.id AND pu.id_equipo_fantasy = $1
              ) AS mi_puja
       FROM subastas s
       JOIN jugadores j ON j.id = s.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       LEFT JOIN equipos_fantasy ef_v ON ef_v.id = s.id_vendedor
       WHERE s.estado = 'ACTIVA' AND s.fecha_cierre > NOW()
       ORDER BY s.tipo DESC, s.fecha_cierre ASC`,
      [idEf]
    );
    return rows;
  });

  // GET /api/mercado/historico — fichajes: subastas resueltas, ofertas aceptadas y clausulazos
  // vendedor = NULL cuando el jugador se compró al mercado (subasta del sistema)
  app.get('/historico', { preHandler: app.authenticate }, async () => {
    const { rows } = await pool.query(
      `SELECT h.tipo, h.fecha, h.monto, h.id_jugador, j.nombre AS jugador, j.posicion,
              uc.nombre AS comprador, uv.nombre AS vendedor
       FROM (
         SELECT 'SUBASTA' AS tipo, s.fecha_cierre AS fecha, s.precio_final AS monto,
                s.id_jugador, s.id_ganador AS id_comprador,
                CASE WHEN s.tipo = 'USUARIO' THEN s.id_vendedor END AS id_vendedor
         FROM subastas s
         WHERE s.estado = 'RESUELTA' AND s.id_ganador IS NOT NULL
         UNION ALL
         SELECT 'OFERTA', COALESCE(o.fecha_respuesta, o.fecha_creacion), o.monto,
                o.id_jugador, o.id_equipo_comprador, o.id_equipo_vendedor
         FROM ofertas o
         WHERE o.estado = 'ACEPTADA' AND o.tipo = 'USUARIO' AND o.id_equipo_comprador IS NOT NULL
         UNION ALL
         SELECT 'CLAUSULA', c.creado_en, c.monto, c.id_jugador, c.id_comprador, c.id_vendedor
         FROM clausulazos c
       ) h
       JOIN jugadores j ON j.id = h.id_jugador
       JOIN equipos_fantasy efc ON efc.id = h.id_comprador
       JOIN usuarios uc ON uc.id = efc.id_usuario
       LEFT JOIN equipos_fantasy efv ON efv.id = h.id_vendedor
       LEFT JOIN usuarios uv ON uv.id = efv.id_usuario
       ORDER BY h.fecha DESC
       LIMIT 100`
    );
    return rows;
  });

  // POST /api/mercado/subastas/:id/cancelar — el vendedor cancela su propia subasta
  app.post('/subastas/:id/cancelar', { preHandler: app.authenticate }, async (req, reply) => {
    const idSubasta = parseInt(req.params.id);

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const idEf = ef[0].id;

    const { rows: sub } = await pool.query(
      `SELECT id, id_vendedor, tipo FROM subastas WHERE id = $1 AND estado = 'ACTIVA'`,
      [idSubasta]
    );
    if (sub.length === 0) return reply.code(404).send({ error: 'Subasta no encontrada o ya cerrada' });
    if (sub[0].tipo === 'SISTEMA') return reply.code(403).send({ error: 'No puedes cancelar subastas del sistema' });
    if (sub[0].id_vendedor !== idEf) return reply.code(403).send({ error: 'Solo el vendedor puede cancelar la subasta' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cerrar la subasta primero: si llegan dos cancelaciones a la vez solo una devuelve las pujas
      const { rowCount } = await client.query(
        `UPDATE subastas SET estado = 'DESIERTA' WHERE id = $1 AND estado = 'ACTIVA'`, [idSubasta]
      );
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Subasta no encontrada o ya cerrada' });
      }

      // Devolver saldo bloqueado a todos los pujadores
      const { rows: pujas } = await client.query(
        `SELECT id_equipo_fantasy, monto FROM pujas WHERE id_subasta = $1`, [idSubasta]
      );
      for (const puja of pujas) {
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [puja.monto, puja.id_equipo_fantasy]
        );
      }

      await client.query('COMMIT');
      return { ok: true, mensaje: 'Subasta cancelada. Las pujas han sido devueltas.' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

    const precioActual = Number(plant[0].precio_actual);
    if (precio_minimo < precioActual) {
      return reply.code(400).send({
        error: `El precio mínimo no puede ser inferior al valor actual del jugador (${precioActual.toLocaleString('es-ES')}€)`,
      });
    }

    // Verificar que no tenga ya una subasta activa
    const { rows: subActiva } = await pool.query(
      `SELECT id FROM subastas WHERE id_vendedor = $1 AND estado = 'ACTIVA'`, [idEf]
    );
    if (subActiva.length > 0) {
      return reply.code(400).send({ error: 'Ya tienes un jugador en subasta. Solo puedes tener una activa a la vez.' });
    }

    // Crear subasta que cierra en el próximo cierre diario (19:00 hora española)
    const cierre = await proximoCierre();

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
      `SELECT s.id, s.id_vendedor, s.id_jugador, s.precio_minimo, s.fecha_cierre, s.estado,
              GREATEST(s.precio_minimo, j.precio_actual) AS puja_minima
       FROM subastas s
       JOIN jugadores j ON j.id = s.id_jugador
       WHERE s.id = $1`,
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

    // Mínimo: el valor actual del jugador (o el precio mínimo de la subasta si es mayor)
    const pujaMinima = Number(subasta.puja_minima);
    if (monto < pujaMinima) {
      return reply.code(400).send({
        error: `La puja no puede ser inferior al valor actual del jugador (${pujaMinima.toLocaleString('es-ES')}€)`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Bloquear subasta y equipo: evita pujar mientras se resuelve y las pujas duplicadas (doble clic)
      const { rows: activa } = await client.query(
        `SELECT id FROM subastas WHERE id = $1 AND estado = 'ACTIVA' FOR UPDATE`, [idSubasta]
      );
      if (activa.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'La subasta ya no está activa' });
      }
      const { rows: [saldo] } = await client.query(
        `SELECT saldo_disponible FROM equipos_fantasy WHERE id = $1 FOR UPDATE`, [comprador.id]
      );

      // Verificar saldo (disponible + bloqueado anterior de esta subasta)
      const { rows: pujaAnterior } = await client.query(
        `SELECT monto FROM pujas WHERE id_subasta = $1 AND id_equipo_fantasy = $2`,
        [idSubasta, comprador.id]
      );
      const montoAnterior = Number(pujaAnterior[0]?.monto ?? 0);
      if (Number(saldo.saldo_disponible) + montoAnterior < monto) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Saldo insuficiente' });
      }

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

  // POST /api/mercado/subastas/:id/retirar-puja — el pujador retira su puja
  app.post('/subastas/:id/retirar-puja', { preHandler: app.authenticate }, async (req, reply) => {
    const idSubasta = parseInt(req.params.id);

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const idEf = ef[0].id;

    const { rows: sub } = await pool.query(
      `SELECT estado, fecha_cierre FROM subastas WHERE id = $1`, [idSubasta]
    );
    if (sub.length === 0) return reply.code(404).send({ error: 'Subasta no encontrada' });
    if (sub[0].estado !== 'ACTIVA' || new Date(sub[0].fecha_cierre) <= new Date()) {
      return reply.code(400).send({ error: 'La subasta ya no está activa' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Bloquear la subasta (no retirar mientras se resuelve) y borrar la puja dentro de la
      // transacción: si llegan dos peticiones a la vez solo una borra la puja y devuelve el saldo
      const { rows: activa } = await client.query(
        `SELECT id FROM subastas WHERE id = $1 AND estado = 'ACTIVA' FOR UPDATE`, [idSubasta]
      );
      if (activa.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'La subasta ya no está activa' });
      }
      const { rows: puja } = await client.query(
        `DELETE FROM pujas WHERE id_subasta = $1 AND id_equipo_fantasy = $2 RETURNING monto`,
        [idSubasta, idEf]
      );
      if (puja.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'No tienes ninguna puja en esta subasta' });
      }
      const monto = Number(puja[0].monto);
      await client.query(
        `UPDATE equipos_fantasy
         SET saldo_disponible = saldo_disponible + $1,
             saldo_bloqueado  = saldo_bloqueado  - $1
         WHERE id = $2`,
        [monto, idEf]
      );
      await client.query('COMMIT');
      return { ok: true, mensaje: 'Puja retirada. El saldo ha sido devuelto.' };
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

  // POST /api/mercado/cron/abrir-ventana — llamado por cron externo a las 19:00 (hora española)
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
  // Foto de las alineaciones antes de mover jugadores (también sirve de comprobación periódica)
  await guardarAlineacionesCerradas();

  // Aprovechar la misma pasada para liberar el saldo de ofertas de usuario caducadas
  const ofertasExpiradas = await expirarOfertasVencidas();

  const { rows: vencidas } = await pool.query(
    `SELECT id, tipo, id_jugador, id_vendedor, precio_minimo
     FROM subastas
     WHERE estado = 'ACTIVA' AND fecha_cierre <= NOW()`
  );

  const resultados = [];

  for (const sub of vencidas) {
    let aviso = null; // ganador al que avisar por correo, solo si la transacción se confirma
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Bloquear la subasta: la resolución se lanza en cada carga del mercado y dos peticiones
      // simultáneas la resolvían dos veces (devolviendo pujas y descontando saldo bloqueado dos veces)
      const { rows: sigueActiva } = await client.query(
        `SELECT id FROM subastas WHERE id = $1 AND estado = 'ACTIVA' FOR UPDATE`, [sub.id]
      );
      if (sigueActiva.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      // Mejor puja
      const { rows: mejorPuja } = await client.query(
        `SELECT id_equipo_fantasy, monto
         FROM pujas
         WHERE id_subasta = $1
         ORDER BY monto DESC
         LIMIT 1`,
        [sub.id]
      );

      // Subasta del sistema de un jugador que ya tiene dueño: anularla devolviendo las pujas
      const { rows: duenyo } = sub.tipo === 'SISTEMA'
        ? await client.query(`SELECT 1 FROM plantillas WHERE id_jugador = $1`, [sub.id_jugador])
        : { rows: [] };

      if (duenyo.length > 0) {
        await client.query(
          `UPDATE equipos_fantasy ef
           SET saldo_disponible = ef.saldo_disponible + pu.monto,
               saldo_bloqueado  = ef.saldo_bloqueado  - pu.monto
           FROM pujas pu
           WHERE pu.id_subasta = $1 AND pu.id_equipo_fantasy = ef.id`,
          [sub.id]
        );
        await client.query(`UPDATE subastas SET estado = 'CANCELADA' WHERE id = $1`, [sub.id]);
        resultados.push({ id: sub.id, resultado: 'CANCELADA' });
      } else if (mejorPuja.length === 0) {
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
           clausulaInicial(ganador.monto), finProteccion(fechaFichaje), fechaFichaje]
        );

        // El valor de mercado no cambia: solo lo actualiza el recálculo tras cada jornada (services/precios.js)

        await client.query(
          `UPDATE subastas
           SET estado = 'RESUELTA', id_ganador = $1, precio_final = $2
           WHERE id = $3`,
          [ganador.id_equipo_fantasy, ganador.monto, sub.id]
        );

        resultados.push({ id: sub.id, resultado: 'RESUELTA', precio: ganador.monto });
        aviso = { idEquipo: ganador.id_equipo_fantasy, idJugador: sub.id_jugador, monto: ganador.monto };
      }

      await client.query('COMMIT');
      // Sin esperar: un fallo de correo no debe frenar la resolución del resto de subastas
      if (aviso) avisarSubastaGanada(aviso);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Error resolviendo subasta ${sub.id}:`, err);
      resultados.push({ id: sub.id, resultado: 'ERROR', error: err.message });
    } finally {
      client.release();
    }
  }

  return { procesadas: resultados.length, resultados, ofertas_expiradas: ofertasExpiradas };
}

/**
 * Abre la ventana de mercado diaria:
 * - Selecciona agentes libres (jugadores sin propietario activo)
 * - Crea subastas de tipo SISTEMA con precio_minimo = precio_actual
 * - Cierre: mañana a las 19:00 hora española
 * - No crea subastas si ya hay una ventana abierta hoy
 */
export async function abrirVentanaMercado({ n = 5 } = {}) {
  // Comprobar si ya se abrió ventana hoy
  const { rows: yaAbierta } = await pool.query(
    `SELECT COUNT(*) AS total FROM subastas
     WHERE tipo = 'SISTEMA' AND estado = 'ACTIVA'
       AND DATE(fecha_inicio AT TIME ZONE 'Europe/Madrid') = (NOW() AT TIME ZONE 'Europe/Madrid')::date`
  );
  if (parseInt(yaAbierta[0].total) > 0) {
    return { ok: false, motivo: 'Ya hay una ventana de mercado abierta hoy' };
  }

  // fecha_cierre = mañana a las 19:00 hora española
  const cierre = await proximoCierre({ diaSiguiente: true });

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
    const precioMinimo = Number(jugador.precio_actual);
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

  // Solo generar oferta del sistema para jugadores que su dueño ha puesto en subasta activa
  const { rows: propietarios } = await pool.query(
    `SELECT p.id_jugador, p.id_equipo_fantasy, j.precio_actual
     FROM plantillas p
     JOIN jugadores j ON j.id = p.id_jugador
     JOIN subastas s ON s.id_jugador = p.id_jugador
                     AND s.id_vendedor = p.id_equipo_fantasy
                     AND s.tipo = 'USUARIO'
                     AND s.estado = 'ACTIVA'
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
