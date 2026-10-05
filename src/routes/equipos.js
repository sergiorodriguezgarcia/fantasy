import { pool } from '../db/pool.js';

export async function equiposRoutes(app) {

  // GET /api/equipos/mi-equipo — plantilla del usuario autenticado
  app.get('/mi-equipo', { preHandler: app.authenticate }, async (req, reply) => {
    const { rows: equipo } = await pool.query(
      `SELECT ef.id, ef.nombre, ef.saldo_disponible, ef.saldo_bloqueado, ef.formacion
       FROM equipos_fantasy ef
       WHERE ef.id_usuario = $1`,
      [req.user.id]
    );
    if (equipo.length === 0) return reply.code(404).send({ error: 'No tienes equipo creado' });

    const ef = equipo[0];

    const { rows: jugadores } = await pool.query(
      `SELECT p.id AS id_plantilla, j.id AS id_jugador, j.nombre, j.posicion,
              er.nombre AS equipo_real, j.precio_actual,
              p.es_titular, p.es_capitan, p.fecha_fichaje, p.precio_compra,
              p.clausula_monto, p.clausula_activa_desde,
              (p.clausula_activa_desde <= CURRENT_DATE) AS clausula_activa
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE p.id_equipo_fantasy = $1
       ORDER BY p.es_titular DESC, j.posicion, j.nombre`,
      [ef.id]
    );

    return { ...ef, jugadores };
  });

  // PUT /api/equipos/mi-equipo — actualizar nombre del equipo
  app.put('/mi-equipo', { preHandler: app.authenticate }, async (req, reply) => {
    const { nombre } = req.body ?? {};
    if (!nombre?.trim()) return reply.code(400).send({ error: 'nombre requerido' });

    await pool.query(
      `UPDATE equipos_fantasy SET nombre = $1 WHERE id_usuario = $2`,
      [nombre.trim(), req.user.id]
    );
    return { ok: true };
  });

  // PUT /api/equipos/mi-equipo/formacion — guardar alineación (formación, titulares y capitán)
  app.put('/mi-equipo/formacion', { preHandler: app.authenticate }, async (req, reply) => {
    const { formacion, titulares, capitan } = req.body ?? {};

    const FORMACIONES = {
      '4-3-3': { DEF: 4, MED: 3, DEL: 3 },
      '4-4-2': { DEF: 4, MED: 4, DEL: 2 },
      '3-5-2': { DEF: 3, MED: 5, DEL: 2 },
      '3-4-3': { DEF: 3, MED: 4, DEL: 3 },
    };

    if (!FORMACIONES[formacion]) {
      return reply.code(400).send({ error: `Formación inválida. Permitidas: ${Object.keys(FORMACIONES).join(', ')}` });
    }
    if (!Array.isArray(titulares) || titulares.length !== 11) {
      return reply.code(400).send({ error: 'Debes indicar exactamente 11 titulares' });
    }
    if (!capitan || !titulares.includes(capitan)) {
      return reply.code(400).send({ error: 'El capitán debe ser uno de los 11 titulares' });
    }

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const idEf = ef[0].id;

    // Verificar que todos los titulares pertenecen al equipo y obtener sus posiciones
    const { rows: jugadoresTitulares } = await pool.query(
      `SELECT j.id, j.posicion FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id_equipo_fantasy = $1 AND j.id = ANY($2::int[])`,
      [idEf, titulares]
    );

    if (jugadoresTitulares.length !== 11) {
      return reply.code(400).send({ error: 'Alguno de los titulares no pertenece a tu plantilla' });
    }

    // Validar composición por posición
    const cuota = FORMACIONES[formacion];
    const conteo = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
    for (const j of jugadoresTitulares) conteo[j.posicion] = (conteo[j.posicion] ?? 0) + 1;

    if (conteo.POR !== 1) {
      return reply.code(400).send({ error: 'Debe haber exactamente 1 portero' });
    }
    for (const [pos, n] of Object.entries(cuota)) {
      if (conteo[pos] !== n) {
        return reply.code(400).send({ error: `La formación ${formacion} requiere ${n} ${pos} (tienes ${conteo[pos] ?? 0})` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE plantillas SET es_titular = FALSE, es_capitan = FALSE WHERE id_equipo_fantasy = $1`,
        [idEf]
      );
      await client.query(
        `UPDATE plantillas SET es_titular = TRUE
         WHERE id_equipo_fantasy = $1 AND id_jugador = ANY($2::int[])`,
        [idEf, titulares]
      );
      await client.query(
        `UPDATE plantillas SET es_capitan = TRUE
         WHERE id_equipo_fantasy = $1 AND id_jugador = $2`,
        [idEf, capitan]
      );
      await client.query(
        `UPDATE equipos_fantasy SET formacion = $1 WHERE id = $2`,
        [formacion, idEf]
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PUT /api/equipos/mi-equipo/clausula/:idPlantilla — subir cláusula de rescisión
  app.put('/mi-equipo/clausula/:idPlantilla', { preHandler: app.authenticate }, async (req, reply) => {
    const idPlantilla = parseInt(req.params.idPlantilla);
    const { clausula_monto } = req.body ?? {};

    if (!clausula_monto || clausula_monto <= 0) {
      return reply.code(400).send({ error: 'clausula_monto debe ser mayor que cero' });
    }

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });

    // Verificar que la plantilla pertenece al usuario y que la nueva cláusula sea mayor
    const { rows: plant } = await pool.query(
      `SELECT clausula_monto FROM plantillas
       WHERE id = $1 AND id_equipo_fantasy = $2`,
      [idPlantilla, ef[0].id]
    );
    if (plant.length === 0) return reply.code(404).send({ error: 'Jugador no encontrado en tu plantilla' });
    if (clausula_monto <= plant[0].clausula_monto) {
      return reply.code(400).send({ error: 'Solo puedes subir la cláusula, no bajarla' });
    }

    await pool.query(
      `UPDATE plantillas SET clausula_monto = $1 WHERE id = $2`,
      [clausula_monto, idPlantilla]
    );
    return { ok: true, clausula_monto };
  });

  // POST /api/equipos/mi-equipo/clausula/:idPlantilla/activar — activar cláusula (comprar por cláusula)
  app.post('/mi-equipo/clausula/:idPlantilla/activar', { preHandler: app.authenticate }, async (req, reply) => {
    const idPlantilla = parseInt(req.params.idPlantilla);

    const { rows: ef } = await pool.query(
      `SELECT id, saldo_disponible FROM equipos_fantasy WHERE id_usuario = $1`,
      [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const comprador = ef[0];

    const { rows: plant } = await pool.query(
      `SELECT p.id, p.id_equipo_fantasy, p.id_jugador, p.clausula_monto,
              p.clausula_activa_desde, j.nombre
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id = $1`,
      [idPlantilla]
    );
    if (plant.length === 0) return reply.code(404).send({ error: 'Jugador no encontrado' });
    const plantilla = plant[0];

    if (plantilla.id_equipo_fantasy === comprador.id) {
      return reply.code(400).send({ error: 'No puedes comprar tu propio jugador por cláusula' });
    }
    if (new Date(plantilla.clausula_activa_desde) > new Date()) {
      return reply.code(400).send({
        error: `La cláusula no está activa hasta el ${plantilla.clausula_activa_desde}`,
      });
    }
    if (comprador.saldo_disponible < plantilla.clausula_monto) {
      return reply.code(400).send({ error: 'Saldo insuficiente para activar la cláusula' });
    }

    // Crear activación pendiente (el admin puede confirmar/rechazar)
    const { rows: activ } = await pool.query(
      `INSERT INTO activaciones_clausula (id_plantilla, id_comprador, monto_pagado)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [idPlantilla, comprador.id, plantilla.clausula_monto]
    );

    return {
      ok: true,
      id_activacion: activ[0].id,
      mensaje: `Cláusula de ${plantilla.nombre} activada por ${plantilla.clausula_monto.toLocaleString()}€. Pendiente de confirmación.`,
    };
  });

  // GET /api/equipos/ligas — ligas en las que participa el usuario
  app.get('/ligas', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await pool.query(
      `SELECT l.id, l.nombre, l.codigo_invitacion, l.publica
       FROM ligas l
       JOIN equipos_en_liga eel ON eel.id_liga = l.id
       JOIN equipos_fantasy ef ON ef.id = eel.id_equipo_fantasy
       WHERE ef.id_usuario = $1`,
      [req.user.id]
    );
    return rows;
  });

  // GET /api/equipos/:id — plantilla pública de cualquier equipo (sólo titulares + info básica)
  app.get('/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'id inválido' });

    const { rows: equipo } = await pool.query(
      `SELECT ef.id, ef.nombre, ef.formacion, u.nombre AS propietario
       FROM equipos_fantasy ef
       JOIN usuarios u ON u.id = ef.id_usuario
       WHERE ef.id = $1`,
      [id]
    );
    if (equipo.length === 0) return reply.code(404).send({ error: 'Equipo no encontrado' });

    const { rows: jugadores } = await pool.query(
      `SELECT j.id AS id_jugador, j.nombre, j.posicion,
              er.nombre AS equipo_real, j.precio_actual,
              p.es_titular, p.es_capitan,
              COALESCE((
                SELECT SUM(e.puntos) FROM estadisticas e WHERE e.id_jugador = j.id
              ), 0) AS puntos_total
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE p.id_equipo_fantasy = $1
       ORDER BY p.es_titular DESC, j.posicion, j.nombre`,
      [id]
    );

    return { ...equipo[0], jugadores };
  });

  // POST /api/equipos/ligas/unirse — unirse a una liga por código
  app.post('/ligas/unirse', { preHandler: app.authenticate }, async (req, reply) => {
    const { codigo } = req.body ?? {};
    if (!codigo) return reply.code(400).send({ error: 'codigo requerido' });

    const { rows: liga } = await pool.query(
      `SELECT id FROM ligas WHERE codigo_invitacion = $1`, [codigo.toUpperCase()]
    );
    if (liga.length === 0) return reply.code(404).send({ error: 'Liga no encontrada' });

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });

    await pool.query(
      `INSERT INTO equipos_en_liga (id_equipo_fantasy, id_liga)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ef[0].id, liga[0].id]
    );
    return { ok: true };
  });

  // POST /api/equipos/ligas — crear una liga privada
  app.post('/ligas', { preHandler: app.authenticate }, async (req, reply) => {
    const { nombre } = req.body ?? {};
    if (!nombre?.trim()) return reply.code(400).send({ error: 'nombre requerido' });

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });

    // Generar código único de 6 caracteres
    const codigo = Math.random().toString(36).toUpperCase().slice(2, 8);

    const { rows } = await pool.query(
      `INSERT INTO ligas (nombre, codigo_invitacion, id_creador)
       VALUES ($1, $2, $3) RETURNING id, nombre, codigo_invitacion`,
      [nombre.trim(), codigo, ef[0].id]
    );

    // El creador entra automáticamente
    await pool.query(
      `INSERT INTO equipos_en_liga (id_equipo_fantasy, id_liga) VALUES ($1, $2)`,
      [ef[0].id, rows[0].id]
    );

    return rows[0];
  });
}
