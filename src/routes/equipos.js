import { pool } from '../db/pool.js';
import {
  pagarClausula, subirClausula, ErrorClausula, liberarJugadorDelMercado, clausulazosRestantes,
} from '../services/clausulas.js';

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

    return { ...ef, jugadores, clausulazos_restantes: await clausulazosRestantes(ef.id) };
  });

  // POST /api/equipos/mi-equipo/vender — vender un jugador al instante por su precio actual
  app.post('/mi-equipo/vender', { preHandler: app.authenticate }, async (req, reply) => {
    const { id_jugador } = req.body ?? {};
    if (!id_jugador) return reply.code(400).send({ error: 'id_jugador requerido' });

    const { rows: ef } = await pool.query(
      `SELECT id FROM equipos_fantasy WHERE id_usuario = $1`, [req.user.id]
    );
    if (ef.length === 0) return reply.code(404).send({ error: 'No tienes equipo' });
    const idEf = ef[0].id;

    const { rows: plant } = await pool.query(
      `SELECT p.id, j.nombre, j.precio_actual
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       WHERE p.id_equipo_fantasy = $1 AND p.id_jugador = $2`,
      [idEf, id_jugador]
    );
    if (plant.length === 0) return reply.code(404).send({ error: 'Jugador no encontrado en tu plantilla' });
    const { nombre, precio_actual } = plant[0];
    const monto = parseInt(precio_actual);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Quitar de la plantilla: si llegan dos ventas a la vez (doble clic) solo una borra y cobra
      const { rowCount: borrado } = await client.query(
        `DELETE FROM plantillas WHERE id_equipo_fantasy = $1 AND id_jugador = $2`,
        [idEf, id_jugador]
      );
      if (borrado === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Jugador no encontrado en tu plantilla' });
      }

      // Ingresar el dinero al vendedor
      await client.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
        [monto, idEf]
      );

      // Cancelar subastas y ofertas abiertas del jugador devolviendo el saldo bloqueado
      await liberarJugadorDelMercado(client, id_jugador);

      await client.query('COMMIT');
      return { ok: true, monto, mensaje: `${nombre} vendido por ${monto.toLocaleString()}€` };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

  // PUT /api/equipos/mi-equipo/clausula/:idPlantilla — subir cláusula (cuesta el 100% del incremento)
  app.put('/mi-equipo/clausula/:idPlantilla', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return await subirClausula(req.user.id, parseInt(req.params.idPlantilla), req.body?.clausula_monto);
    } catch (err) {
      if (err instanceof ErrorClausula) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /api/equipos/clausulazo — pagar la cláusula de un jugador de otro equipo (fichaje instantáneo)
  app.post('/clausulazo', { preHandler: app.authenticate }, async (req, reply) => {
    const idJugador = parseInt(req.body?.id_jugador);
    if (!idJugador) return reply.code(400).send({ error: 'id_jugador requerido' });
    try {
      return await pagarClausula(req.user.id, idJugador);
    } catch (err) {
      if (err instanceof ErrorClausula) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
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

  // GET /api/equipos/:id/jornada/:idJornada — puntuación de un equipo rival en una jornada
  app.get('/:id/jornada/:idJornada', { preHandler: app.authenticate }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const idJornada = parseInt(req.params.idJornada);
    if (isNaN(id) || isNaN(idJornada)) return reply.code(400).send({ error: 'id inválido' });

    const { rows: equipo } = await pool.query(
      `SELECT ef.id, ef.nombre FROM equipos_fantasy ef WHERE ef.id = $1`, [id]
    );
    if (equipo.length === 0) return reply.code(404).send({ error: 'Equipo no encontrado' });

    const { rows: pj } = await pool.query(
      `SELECT pj.puntos_jornada, pj.puntos_acumulados
       FROM puntuaciones_jornada pj
       WHERE pj.id_equipo_fantasy = $1 AND pj.id_jornada = $2`,
      [id, idJornada]
    );

    const { rows: detalle } = await pool.query(
      `SELECT j.id AS id_jugador, j.nombre, j.posicion, er.nombre AS equipo_real,
              p.es_capitan,
              e.minutos_jugados, e.goles, e.amarillas, e.rojas, e.porteria_cero,
              e.puntos AS puntos_base,
              CASE WHEN p.es_capitan THEN e.puntos * 2 ELSE e.puntos END AS puntos_efectivos
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       LEFT JOIN estadisticas e ON e.id_jugador = j.id AND e.id_jornada = $2
       WHERE p.id_equipo_fantasy = $1
       ORDER BY p.es_titular DESC, j.posicion, j.nombre`,
      [id, idJornada]
    );

    return {
      puntos_jornada: pj[0]?.puntos_jornada ?? 0,
      puntos_acumulados: pj[0]?.puntos_acumulados ?? 0,
      detalle,
    };
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
              p.clausula_monto, p.clausula_activa_desde,
              (p.clausula_activa_desde <= CURRENT_DATE) AS clausula_activa,
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
