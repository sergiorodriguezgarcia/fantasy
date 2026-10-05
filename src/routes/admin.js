/**
 * Rutas de administración.
 * Todas requieren rol 'admin'.
 *
 * Funciones principales:
 *  - Gestión de jugadores (CRUD, posiciones, precios)
 *  - Gestión de equipos reales
 *  - Jornadas (abrir, cerrar, calcular puntos)
 *  - Entrada manual de estadísticas de partido
 *  - Importación de equipos/jugadores desde JSON del scraper
 */

import { pool } from '../db/pool.js';
import { calcularPuntosJornada, calcularPuntos } from '../services/puntos.js';
import { actualizarPrecios } from '../services/precios.js';
import { abrirVentanaMercado } from './mercado.js';

export async function adminRoutes(app) {

  // ── Usuarios ──────────────────────────────────────────────

  // GET /api/admin/usuarios — lista todos los usuarios (sin password_hash)
  app.get('/usuarios', { preHandler: app.requireAdmin }, async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.creado_en,
              ef.id AS id_equipo, ef.nombre AS nombre_equipo,
              ef.saldo_disponible, ef.saldo_bloqueado
       FROM usuarios u
       LEFT JOIN equipos_fantasy ef ON ef.id_usuario = u.id
       ORDER BY u.creado_en DESC`
    );
    return rows;
  });

  // PUT /api/admin/usuarios/:id — editar usuario (nombre, email, rol)
  app.put('/usuarios/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { nombre, email, rol } = req.body ?? {};

    const sets = [];
    const params = [];
    if (nombre !== undefined) { params.push(nombre.trim()); sets.push(`nombre = $${params.length}`); }
    if (email !== undefined) { params.push(email.toLowerCase().trim()); sets.push(`email = $${params.length}`); }
    if (rol !== undefined) {
      if (!['user', 'admin'].includes(rol)) {
        return reply.code(400).send({ error: 'rol debe ser user o admin' });
      }
      params.push(rol); sets.push(`rol = $${params.length}`);
    }

    if (sets.length === 0) return reply.code(400).send({ error: 'Sin campos a actualizar' });

    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'Usuario no encontrado' });
    return { ok: true };
  });

  // DELETE /api/admin/usuarios/:id — eliminar usuario
  app.delete('/usuarios/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    // Evitar que el admin se borre a sí mismo
    if (id === req.user.id) {
      return reply.code(400).send({ error: 'No puedes eliminar tu propia cuenta de admin' });
    }
    const { rowCount } = await pool.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Usuario no encontrado' });
    return { ok: true };
  });

  // ── Jugadores ─────────────────────────────────────────────

  // POST /api/admin/jugadores — añadir jugador
  app.post('/jugadores', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { nombre, posicion, id_equipo_real, cod_jugador, precio_inicial } = req.body ?? {};
    if (!nombre || !posicion) {
      return reply.code(400).send({ error: 'nombre y posicion son obligatorios' });
    }
    const precio = precio_inicial ?? 5_000_000;
    const { rows } = await pool.query(
      `INSERT INTO jugadores (nombre, posicion, id_equipo_real, cod_jugador, precio_actual, precio_inicial)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [nombre.trim().toUpperCase(), posicion.toUpperCase(), id_equipo_real ?? null, cod_jugador ?? null, precio]
    );
    return { id: rows[0].id };
  });

  // PUT /api/admin/jugadores/:id — editar jugador (posición, equipo, precio, activo)
  app.put('/jugadores/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { nombre, posicion, id_equipo_real, precio_actual, activo } = req.body ?? {};

    const sets = [];
    const params = [];
    if (nombre !== undefined) { params.push(nombre.trim().toUpperCase()); sets.push(`nombre = $${params.length}`); }
    if (posicion !== undefined) { params.push(posicion.toUpperCase()); sets.push(`posicion = $${params.length}`); }
    if (id_equipo_real !== undefined) { params.push(id_equipo_real); sets.push(`id_equipo_real = $${params.length}`); }
    if (precio_actual !== undefined) { params.push(precio_actual); sets.push(`precio_actual = $${params.length}`); }
    if (activo !== undefined) { params.push(activo); sets.push(`activo = $${params.length}`); }

    if (sets.length === 0) return reply.code(400).send({ error: 'Sin campos a actualizar' });

    params.push(id);
    await pool.query(`UPDATE jugadores SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    return { ok: true };
  });

  // DELETE /api/admin/jugadores/:id — eliminar jugador
  app.delete('/jugadores/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    // Verificar que no tenga estadísticas registradas
    const { rows: stats } = await pool.query(
      `SELECT COUNT(*) AS total FROM estadisticas WHERE id_jugador = $1`, [id]
    );
    if (parseInt(stats[0].total) > 0) {
      return reply.code(409).send({ error: 'No se puede eliminar: el jugador tiene estadísticas registradas' });
    }
    // Eliminar de plantillas fantasy si está en alguna
    await pool.query(`DELETE FROM plantillas WHERE id_jugador = $1`, [id]);
    const { rowCount } = await pool.query(`DELETE FROM jugadores WHERE id = $1`, [id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Jugador no encontrado' });
    return { ok: true };
  });

  // POST /api/admin/equipos — añadir equipo real
  app.post('/equipos', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { nombre, cod_equipo } = req.body ?? {};
    if (!nombre) return reply.code(400).send({ error: 'nombre requerido' });
    const { rows } = await pool.query(
      `INSERT INTO equipos_reales (nombre, cod_equipo) VALUES ($1, $2) RETURNING id`,
      [nombre.trim().toUpperCase(), cod_equipo ?? null]
    );
    return { id: rows[0].id };
  });

  // GET /api/admin/equipos — lista todos los equipos reales
  app.get('/equipos', { preHandler: app.requireAdmin }, async () => {
    const { rows } = await pool.query(
      `SELECT er.id, er.nombre, er.cod_equipo,
              COUNT(j.id) AS total_jugadores
       FROM equipos_reales er
       LEFT JOIN jugadores j ON j.id_equipo_real = er.id AND j.activo = TRUE
       GROUP BY er.id, er.nombre, er.cod_equipo
       ORDER BY er.nombre`
    );
    return rows;
  });

  // ── Importación masiva ────────────────────────────────────

  // POST /api/admin/importar-jugadores — importa array de equipos+jugadores
  // Mismo formato que /tmp/equipos_jugadores.json del scraper
  app.post('/importar-jugadores', { preHandler: app.requireAdmin }, async (req, reply) => {
    const data = req.body;
    if (!Array.isArray(data)) {
      return reply.code(400).send({ error: 'El body debe ser un array de equipos' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let totalEq = 0, totalJ = 0;

      for (const equipo of data) {
        const { rows: eqRows } = await client.query(
          `INSERT INTO equipos_reales (nombre, cod_equipo)
           VALUES ($1, $2)
           ON CONFLICT (nombre) DO UPDATE SET cod_equipo = EXCLUDED.cod_equipo
           RETURNING id`,
          [equipo.nombre, equipo.codEquipo ?? null]
        );
        const idEq = eqRows[0].id;
        totalEq++;

        for (const j of (equipo.jugadores ?? [])) {
          await client.query(
            `INSERT INTO jugadores (nombre, posicion, id_equipo_real, cod_jugador, precio_actual, precio_inicial)
             VALUES ($1, $2, $3, $4, $5, $5)
             ON CONFLICT DO NOTHING`,
            [j.nombre, j.posicion ?? null, idEq, j.codJugador ?? null, j.precioActual ?? 5_000_000]
          );
          totalJ++;
        }
      }

      await client.query('COMMIT');
      return { ok: true, equipos: totalEq, jugadores: totalJ };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── Jornadas ──────────────────────────────────────────────

  // POST /api/admin/jornadas — crear jornada
  app.post('/jornadas', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { numero, fecha_inicio, fecha_fin } = req.body ?? {};
    if (!numero) return reply.code(400).send({ error: 'numero requerido' });
    const { rows } = await pool.query(
      `INSERT INTO jornadas (numero, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3) ON CONFLICT (numero) DO NOTHING RETURNING id`,
      [numero, fecha_inicio ?? null, fecha_fin ?? null]
    );
    return rows[0] ?? { error: 'La jornada ya existe' };
  });

  // PUT /api/admin/jornadas/:id/estado — cambiar estado de jornada
  app.put('/jornadas/:id/estado', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { estado } = req.body ?? {};
    const validos = ['PENDIENTE', 'EN_CURSO', 'CERRADA', 'CALCULADA'];
    if (!validos.includes(estado)) {
      return reply.code(400).send({ error: `estado debe ser uno de: ${validos.join(', ')}` });
    }
    await pool.query(`UPDATE jornadas SET estado = $1 WHERE id = $2`, [estado, id]);
    return { ok: true };
  });

  // ── Estadísticas manuales de partido ─────────────────────

  // GET /api/admin/partidos/:id — partido con estadísticas para edición
  app.get('/partidos/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows: partidos } = await pool.query(
      `SELECT id, id_jornada, nombre_local, nombre_visitante, goles_local, goles_visitante
       FROM partidos WHERE id = $1`, [id]
    );
    if (partidos.length === 0) return reply.code(404).send({ error: 'Partido no encontrado' });
    const partido = partidos[0];

    // Devolvemos TODOS los jugadores de ambos equipos con sus stats (o ceros si no jugaron)
    const { rows: stats } = await pool.query(
      `SELECT j.id AS id_jugador, j.nombre, j.posicion, er.nombre AS equipo_real,
              COALESCE(e.minutos_jugados, 0) AS minutos_jugados,
              COALESCE(e.goles, 0)           AS goles,
              COALESCE(e.goles_propio, 0)    AS goles_propio,
              COALESCE(e.amarillas, 0)       AS amarillas,
              COALESCE(e.rojas, 0)           AS rojas,
              (e.id IS NOT NULL)             AS jugo
       FROM jugadores j
       JOIN equipos_reales er ON er.id = j.id_equipo_real
       LEFT JOIN estadisticas e
              ON e.id_jugador = j.id AND e.id_jornada = $1
       WHERE j.activo = true
         AND (UPPER(er.nombre) = UPPER($2) OR UPPER(er.nombre) = UPPER($3))
       ORDER BY er.nombre, j.nombre`,
      [partido.id_jornada, partido.nombre_local, partido.nombre_visitante]
    );

    return { ...partido, estadisticas: stats };
  });

  // DELETE /api/admin/partidos/:id — eliminar partido y sus estadísticas
  app.delete('/partidos/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT id_jornada, nombre_local, nombre_visitante FROM partidos WHERE id = $1`, [id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Partido no encontrado' });
    const { id_jornada, nombre_local, nombre_visitante } = rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Borrar estadísticas de los jugadores de ambos equipos en esta jornada
      await client.query(
        `DELETE FROM estadisticas
         WHERE id_jornada = $1
           AND id_jugador IN (
             SELECT j.id FROM jugadores j
             JOIN equipos_reales er ON er.id = j.id_equipo_real
             WHERE UPPER(er.nombre) = UPPER($2) OR UPPER(er.nombre) = UPPER($3)
           )`,
        [id_jornada, nombre_local, nombre_visitante]
      );
      await client.query(`DELETE FROM partidos WHERE id = $1`, [id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/admin/partidos — registrar un partido y sus stats de forma manual
  app.post('/partidos', { preHandler: app.requireAdmin }, async (req, reply) => {
    /**
     * Body:
     * {
     *   id_jornada: number,
     *   nombre_local: string,
     *   nombre_visitante: string,
     *   goles_local: number,
     *   goles_visitante: number,
     *   cod_acta: string (opcional),
     *   jugadores: [
     *     {
     *       id_jugador: number,       -- ID en nuestra BD
     *       nombre: string,           -- para búsqueda si no hay id
     *       minutos_jugados: number,
     *       goles: number,
     *       goles_propio: number,
     *       amarillas: number,
     *       rojas: number
     *     }, ...
     *   ]
     * }
     */
    const { id_jornada, nombre_local, nombre_visitante,
            goles_local, goles_visitante, cod_acta, jugadores } = req.body ?? {};

    if (!id_jornada || !nombre_local || !nombre_visitante) {
      return reply.code(400).send({ error: 'id_jornada, nombre_local y nombre_visitante son obligatorios' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Crear o actualizar partido (upsert por jornada + equipos)
      const { rows: partRows } = await client.query(
        `INSERT INTO partidos
           (id_jornada, nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta, fuente, procesado)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', TRUE)
         ON CONFLICT (id_jornada, nombre_local, nombre_visitante) DO UPDATE
           SET goles_local     = EXCLUDED.goles_local,
               goles_visitante = EXCLUDED.goles_visitante,
               procesado       = TRUE
         RETURNING id`,
        [id_jornada, nombre_local, nombre_visitante,
         goles_local ?? null, goles_visitante ?? null, cod_acta ?? null]
      );
      const idPartido = partRows[0].id;

      // Borrar estadísticas previas de ambos equipos en esta jornada
      // (para que el guardado sea siempre un "reemplazo limpio" del estado del formulario)
      await client.query(
        `DELETE FROM estadisticas
         WHERE id_jornada = $1
           AND id_jugador IN (
             SELECT j.id FROM jugadores j
             JOIN equipos_reales er ON er.id = j.id_equipo_real
             WHERE UPPER(er.nombre) = UPPER($2) OR UPPER(er.nombre) = UPPER($3)
           )`,
        [id_jornada, nombre_local, nombre_visitante]
      );

      // Insertar estadísticas por jugador
      const statRows = [];
      for (const j of (jugadores ?? [])) {
        // Si el jugador viene marcado explícitamente como no jugó, omitir
        if (j.jugo === false) continue;

        // Buscar jugador por ID o por nombre
        let idJugador = j.id_jugador;
        if (!idJugador && j.nombre) {
          const { rows: jRows } = await client.query(
            `SELECT id FROM jugadores
             WHERE UPPER(nombre) = UPPER($1) LIMIT 1`,
            [j.nombre.trim()]
          );
          if (jRows.length > 0) idJugador = jRows[0].id;
        }
        if (!idJugador) continue;

        // Calcular portería a cero y goles encajados según nombre de equipo del jugador
        const [pcero, golesEnc] = await Promise.all([
          determinarPorteriaCero(client, idJugador, nombre_local, nombre_visitante, goles_local, goles_visitante),
          determinarGolesEncajados(client, idJugador, nombre_local, nombre_visitante, goles_local, goles_visitante),
        ]);

        const { rows: eRow } = await client.query(
          `INSERT INTO estadisticas
             (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
              amarillas, rojas, porteria_cero, goles_encajados)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [idJugador, id_jornada, idPartido,
           j.minutos_jugados ?? 0, j.goles ?? 0, j.goles_propio ?? 0,
           j.amarillas ?? 0, j.rojas ?? 0, pcero, golesEnc]
        );
        statRows.push(eRow[0].id);
      }

      await client.query('COMMIT');
      return { ok: true, id_partido: idPartido, estadisticas_insertadas: statRows.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/admin/jornadas/:id/preview-puntos — puntuaciones provisionales sin guardar nada
  app.get('/jornadas/:id/preview-puntos', { preHandler: app.requireAdmin }, async (req, reply) => {
    const idJornada = parseInt(req.params.id);

    const { rows: jornada } = await pool.query(
      `SELECT id FROM jornadas WHERE id = $1`, [idJornada]
    );
    if (jornada.length === 0) return reply.code(404).send({ error: 'Jornada no encontrada' });

    const { rows: stats } = await pool.query(
      `SELECT e.id_jugador, j.nombre, j.posicion, er.nombre AS equipo_real,
              e.minutos_jugados, e.goles, e.goles_propio,
              e.amarillas, e.rojas, e.porteria_cero, e.goles_encajados
       FROM estadisticas e
       JOIN jugadores j ON j.id = e.id_jugador
       JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE e.id_jornada = $1
       ORDER BY er.nombre, j.nombre`,
      [idJornada]
    );

    const resultado = stats.map(s => ({
      id_jugador:      s.id_jugador,
      nombre:          s.nombre,
      posicion:        s.posicion,
      equipo_real:     s.equipo_real,
      minutos_jugados: s.minutos_jugados,
      goles:           s.goles,
      goles_propio:    s.goles_propio,
      amarillas:       s.amarillas,
      rojas:           s.rojas,
      porteria_cero:   s.porteria_cero,
      goles_encajados: s.goles_encajados,
      puntos:          calcularPuntos(s.posicion, s),
    }));

    return resultado;
  });

  // POST /api/admin/jornadas/:id/calcular — calcular puntos de todos los equipos de la jornada
  app.post('/jornadas/:id/calcular', { preHandler: app.requireAdmin }, async (req, reply) => {
    const idJornada = parseInt(req.params.id);

    const { rows: jornada } = await pool.query(
      `SELECT id, numero, estado FROM jornadas WHERE id = $1`, [idJornada]
    );
    if (jornada.length === 0) return reply.code(404).send({ error: 'Jornada no encontrada' });

    try {
      const resultado = await calcularPuntosJornada(idJornada);
      await actualizarPrecios(idJornada);

      // Marcar jornada como CALCULADA
      await pool.query(
        `UPDATE jornadas SET estado = 'CALCULADA' WHERE id = $1`, [idJornada]
      );

      return { ok: true, ...resultado };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/admin/activaciones-clausula — lista de activaciones pendientes
  app.get('/activaciones-clausula', { preHandler: app.requireAdmin }, async () => {
    const { rows } = await pool.query(
      `SELECT ac.id, ac.monto_pagado, ac.estado, ac.creado_en,
              j.nombre AS jugador,
              ef_c.nombre AS comprador,
              ef_v.nombre AS vendedor
       FROM activaciones_clausula ac
       JOIN plantillas p ON p.id = ac.id_plantilla
       JOIN jugadores j ON j.id = p.id_jugador
       JOIN equipos_fantasy ef_c ON ef_c.id = ac.id_comprador
       JOIN equipos_fantasy ef_v ON ef_v.id = p.id_equipo_fantasy
       WHERE ac.estado = 'PENDIENTE'
       ORDER BY ac.creado_en DESC`
    );
    return rows;
  });

  // PUT /api/admin/activaciones-clausula/:id — confirmar o rechazar
  app.put('/activaciones-clausula/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { accion } = req.body ?? {}; // 'COMPLETADA' o 'RECHAZADA'

    if (!['COMPLETADA', 'RECHAZADA'].includes(accion)) {
      return reply.code(400).send({ error: 'accion debe ser COMPLETADA o RECHAZADA' });
    }

    const { rows: act } = await pool.query(
      `SELECT ac.id, ac.id_plantilla, ac.id_comprador, ac.monto_pagado
       FROM activaciones_clausula ac WHERE ac.id = $1 AND ac.estado = 'PENDIENTE'`,
      [id]
    );
    if (act.length === 0) return reply.code(404).send({ error: 'Activación no encontrada o ya procesada' });
    const activacion = act[0];

    if (accion === 'RECHAZADA') {
      // Devolver dinero al comprador
      await pool.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
        [activacion.monto_pagado, activacion.id_comprador]
      );
      await pool.query(
        `UPDATE activaciones_clausula SET estado = 'RECHAZADA' WHERE id = $1`, [id]
      );
      return { ok: true, accion: 'RECHAZADA' };
    }

    // COMPLETADA: transferir jugador
    const { rows: plant } = await pool.query(
      `SELECT id_equipo_fantasy, id_jugador FROM plantillas WHERE id = $1`,
      [activacion.id_plantilla]
    );
    if (plant.length === 0) return reply.code(400).send({ error: 'Plantilla no encontrada' });
    const { id_equipo_fantasy: idVendedor, id_jugador } = plant[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cobrar al comprador y pagar al vendedor
      await client.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible - $1 WHERE id = $2`,
        [activacion.monto_pagado, activacion.id_comprador]
      );
      await client.query(
        `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
        [activacion.monto_pagado, idVendedor]
      );

      // Transferir jugador
      await client.query(
        `DELETE FROM plantillas WHERE id_equipo_fantasy = $1 AND id_jugador = $2`,
        [idVendedor, id_jugador]
      );

      const clausulaDesde = new Date(Date.now() + 15 * 86_400_000).toISOString().split('T')[0];
      const clausulaInicial = Math.round(activacion.monto_pagado * 1.5);

      await client.query(
        `INSERT INTO plantillas
           (id_equipo_fantasy, id_jugador, precio_compra, clausula_monto,
            clausula_activa_desde, fecha_fichaje)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
         ON CONFLICT (id_equipo_fantasy, id_jugador) DO UPDATE
           SET precio_compra = EXCLUDED.precio_compra,
               clausula_monto = EXCLUDED.clausula_monto,
               clausula_activa_desde = EXCLUDED.clausula_activa_desde,
               fecha_fichaje = EXCLUDED.fecha_fichaje`,
        [activacion.id_comprador, id_jugador, activacion.monto_pagado,
         clausulaInicial, clausulaDesde]
      );

      await client.query(
        `UPDATE jugadores SET precio_actual = $1 WHERE id = $2`,
        [activacion.monto_pagado, id_jugador]
      );

      await client.query(
        `UPDATE activaciones_clausula SET estado = 'COMPLETADA' WHERE id = $1`, [id]
      );

      await client.query('COMMIT');
      return { ok: true, accion: 'COMPLETADA' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── Mercado diario ────────────────────────────────────────

  // POST /api/admin/mercado/abrir-ventana — abre una ventana de mercado manual
  // Body opcional: { n: número de jugadores (default 5) }
  app.post('/mercado/abrir-ventana', { preHandler: app.requireAdmin }, async (req, reply) => {
    const n = parseInt(req.body?.n ?? 5);
    if (isNaN(n) || n < 1 || n > 50) {
      return reply.code(400).send({ error: 'n debe ser entre 1 y 50' });
    }
    const resultado = await abrirVentanaMercado({ n });
    if (!resultado.ok) return reply.code(409).send({ error: resultado.motivo });
    return resultado;
  });

  // GET /api/admin/mercado/config — leer configuración del mercado
  app.get('/mercado/config', { preHandler: app.requireAdmin }, async () => {
    const { rows } = await pool.query(`SELECT clave, valor FROM config_mercado ORDER BY clave`);
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  });

  // PUT /api/admin/mercado/config — actualizar configuración del mercado
  app.put('/mercado/config', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { jugadores_por_ventana, hora_apertura, duracion_horas } = req.body ?? {};
    const updates = [];
    if (jugadores_por_ventana !== undefined) updates.push(['jugadores_por_ventana', String(parseInt(jugadores_por_ventana))]);
    if (hora_apertura !== undefined) updates.push(['hora_apertura', String(parseInt(hora_apertura))]);
    if (duracion_horas !== undefined) updates.push(['duracion_horas', String(parseInt(duracion_horas))]);
    if (updates.length === 0) return reply.code(400).send({ error: 'Sin campos a actualizar' });
    for (const [clave, valor] of updates) {
      await pool.query(
        `INSERT INTO config_mercado (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, valor]
      );
    }
    return { ok: true };
  });
}

// ─── Helper: determinar portería a cero de un jugador ────────────────────────
async function determinarPorteriaCero(client, idJugador, nombreLocal, nombreVisitante, golesLocal, golesVisitante) {
  if (golesLocal === null || golesVisitante === null) return false;

  const { rows } = await client.query(
    `SELECT er.nombre AS equipo
     FROM jugadores j
     LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
     WHERE j.id = $1`,
    [idJugador]
  );
  if (rows.length === 0) return false;

  const nombreEquipo = (rows[0].equipo ?? '').toUpperCase();
  const local = nombreLocal.toUpperCase();
  const visitante = nombreVisitante.toUpperCase();

  if (nombreEquipo.includes(local) || local.includes(nombreEquipo)) {
    return golesVisitante === 0;
  }
  if (nombreEquipo.includes(visitante) || visitante.includes(nombreEquipo)) {
    return golesLocal === 0;
  }
  return false;
}

// ─── Helper: goles encajados por el equipo de un jugador ─────────────────────
async function determinarGolesEncajados(client, idJugador, nombreLocal, nombreVisitante, golesLocal, golesVisitante) {
  if (golesLocal === null || golesVisitante === null) return 0;

  const { rows } = await client.query(
    `SELECT er.nombre AS equipo
     FROM jugadores j
     LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
     WHERE j.id = $1`,
    [idJugador]
  );
  if (rows.length === 0) return 0;

  const nombreEquipo = (rows[0].equipo ?? '').toUpperCase();
  const local = nombreLocal.toUpperCase();
  const visitante = nombreVisitante.toUpperCase();

  if (nombreEquipo.includes(local) || local.includes(nombreEquipo)) {
    return golesVisitante ?? 0;
  }
  if (nombreEquipo.includes(visitante) || visitante.includes(nombreEquipo)) {
    return golesLocal ?? 0;
  }
  return 0;
}
