import { pool } from '../db/pool.js';

export async function jornadasRoutes(app) {

  // GET /api/jornadas — lista de jornadas
  app.get('/', async () => {
    const { rows } = await pool.query(
      `SELECT id, numero, fecha_inicio, fecha_fin, estado
       FROM jornadas
       ORDER BY numero`
    );
    return rows;
  });

  // GET /api/jornadas/actual — jornada activa o la última calculada
  app.get('/actual', async () => {
    const { rows } = await pool.query(
      `SELECT id, numero, fecha_inicio, fecha_fin, estado
       FROM jornadas
       WHERE estado IN ('EN_CURSO', 'CALCULADA')
       ORDER BY numero DESC
       LIMIT 1`
    );
    return rows[0] ?? null;
  });

  // GET /api/jornadas/:id — detalle de jornada con partidos
  app.get('/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows: jornada } = await pool.query(
      `SELECT id, numero, fecha_inicio, fecha_fin, estado FROM jornadas WHERE id = $1`,
      [id]
    );
    if (jornada.length === 0) return reply.code(404).send({ error: 'Jornada no encontrada' });

    const { rows: partidos } = await pool.query(
      `SELECT p.id, p.nombre_local, p.nombre_visitante,
              er_l.nombre AS equipo_local, er_v.nombre AS equipo_visitante,
              p.goles_local, p.goles_visitante, p.procesado, p.fuente, p.cod_acta
       FROM partidos p
       LEFT JOIN equipos_reales er_l ON er_l.id = p.id_equipo_local
       LEFT JOIN equipos_reales er_v ON er_v.id = p.id_equipo_visitante
       WHERE p.id_jornada = $1
       ORDER BY p.id`,
      [id]
    );

    return { ...jornada[0], partidos };
  });

  // GET /api/jornadas/:id/estadisticas — puntuaciones de todos los jugadores en la jornada
  app.get('/:id/estadisticas', async (req, reply) => {
    const id = parseInt(req.params.id);

    const { rows } = await pool.query(
      `SELECT e.id, j.id AS id_jugador, j.nombre AS jugador,
              j.posicion, er.nombre AS equipo_real,
              e.minutos_jugados, e.goles, e.goles_propio,
              e.amarillas, e.rojas, e.porteria_cero, e.puntos
       FROM estadisticas e
       JOIN jugadores j ON j.id = e.id_jugador
       LEFT JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE e.id_jornada = $1
       ORDER BY e.puntos DESC NULLS LAST, j.nombre`,
      [id]
    );

    return rows;
  });

  // GET /api/jornadas/:id/mi-puntuacion — puntuación del equipo del usuario en la jornada
  app.get('/:id/mi-puntuacion', { preHandler: app.authenticate }, async (req, reply) => {
    const idJornada = parseInt(req.params.id);

    const { rows: pj } = await pool.query(
      `SELECT pj.puntos_jornada, pj.puntos_acumulados, pj.valor_plantilla
       FROM puntuaciones_jornada pj
       JOIN equipos_fantasy ef ON ef.id = pj.id_equipo_fantasy
       WHERE ef.id_usuario = $1 AND pj.id_jornada = $2`,
      [req.user.id, idJornada]
    );

    if (pj.length === 0) return { puntos_jornada: 0, puntos_acumulados: 0, detalle: [] };

    // Detalle de cada jugador de la plantilla en esa jornada
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
       JOIN equipos_fantasy ef ON ef.id = p.id_equipo_fantasy
       WHERE ef.id_usuario = $1`,
      [req.user.id, idJornada]
    );

    return { ...pj[0], detalle };
  });
}
