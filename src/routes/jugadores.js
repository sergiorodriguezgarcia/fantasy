import { pool } from '../db/pool.js';

export async function jugadoresRoutes(app) {

  // GET /api/jugadores  — catálogo completo con filtros
  // ?posicion=POR|DEF|MED|DEL  &equipo=ID  &nombre=texto  &disponible=true
  app.get('/', async (req) => {
    const { posicion, equipo, nombre, disponible } = req.query ?? {};

    const conditions = ['j.activo = TRUE'];
    const params = [];

    if (posicion) {
      params.push(posicion.toUpperCase());
      conditions.push(`j.posicion = $${params.length}`);
    }
    if (equipo) {
      params.push(parseInt(equipo));
      conditions.push(`j.id_equipo_real = $${params.length}`);
    }
    if (nombre) {
      params.push(`%${nombre.toUpperCase()}%`);
      conditions.push(`UPPER(j.nombre) LIKE $${params.length}`);
    }

    let disponibleJoin = '';
    if (disponible === 'true') {
      // Solo jugadores que NO están en ninguna plantilla fantasy
      disponibleJoin = `AND j.id NOT IN (SELECT id_jugador FROM plantillas)`;
    }

    const sql = `
      SELECT j.id, j.nombre, j.posicion, j.precio_actual,
             er.nombre AS equipo_real,
             j.cod_jugador,
             EXISTS (
               SELECT 1 FROM plantillas p WHERE p.id_jugador = j.id
             ) AS en_plantilla
      FROM jugadores j
      LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
      WHERE ${conditions.join(' AND ')} ${disponibleJoin}
      ORDER BY j.precio_actual DESC, j.nombre
    `;

    const { rows } = await pool.query(sql, params);
    return rows;
  });

  // GET /api/jugadores/:id  — detalle con historial de precio
  app.get('/:id', async (req, reply) => {
    const id = parseInt(req.params.id);

    const { rows } = await pool.query(
      `SELECT j.id, j.nombre, j.posicion, j.precio_actual, j.precio_inicial,
              er.nombre AS equipo_real, j.cod_jugador, j.activo,
              (SELECT json_build_object('id', ef.id, 'nombre', ef.nombre)
               FROM plantillas p
               JOIN equipos_fantasy ef ON ef.id = p.id_equipo_fantasy
               WHERE p.id_jugador = j.id
               LIMIT 1) AS equipo_fantasy,
              (
                SELECT json_agg(json_build_object(
                  'jornada', jo.numero,
                  'precio', hp.precio
                ) ORDER BY jo.numero)
                FROM historial_precios hp
                JOIN jornadas jo ON jo.id = hp.id_jornada
                WHERE hp.id_jugador = j.id
              ) AS historial_precio,
              (
                SELECT json_agg(json_build_object(
                  'jornada', jo.numero,
                  'minutos', e.minutos_jugados,
                  'goles', e.goles,
                  'goles_propio', e.goles_propio,
                  'amarillas', e.amarillas,
                  'rojas', e.rojas,
                  'porteria_cero', e.porteria_cero,
                  'goles_encajados', e.goles_encajados,
                  'es_capitan', e.es_capitan,
                  'puntos', e.puntos,
                  'partido', CASE WHEN pt.id IS NOT NULL
                    THEN json_build_object('local', pt.nombre_local, 'visitante', pt.nombre_visitante,
                                          'goles_local', pt.goles_local, 'goles_visitante', pt.goles_visitante)
                    ELSE NULL END
                ) ORDER BY jo.numero)
                FROM estadisticas e
                JOIN jornadas jo ON jo.id = e.id_jornada
                LEFT JOIN partidos pt ON pt.id = e.id_partido
                WHERE e.id_jugador = j.id
              ) AS estadisticas
       FROM jugadores j
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE j.id = $1`,
      [id]
    );

    if (rows.length === 0) return reply.code(404).send({ error: 'Jugador no encontrado' });
    return rows[0];
  });
}
