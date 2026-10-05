import { pool } from '../db/pool.js';

export async function clasificacionRoutes(app) {

  // GET /api/clasificacion — clasificación general (liga global), ordenada por puntos acumulados
  // ?liga=ID para ligas privadas
  app.get('/', async (req) => {
    const idLiga = req.query.liga
      ? parseInt(req.query.liga)
      : null;

    let ligaFilter = idLiga
      ? `JOIN equipos_en_liga eel ON eel.id_equipo_fantasy = ef.id AND eel.id_liga = ${idLiga}`
      : `JOIN equipos_en_liga eel ON eel.id_equipo_fantasy = ef.id
         JOIN ligas l ON l.id = eel.id_liga AND l.publica = TRUE`;

    const { rows } = await pool.query(
      `SELECT ef.id, ef.nombre, u.nombre AS propietario,
              COALESCE(SUM(pj.puntos_jornada), 0) AS puntos_total,
              MAX(pj.puntos_acumulados) AS puntos_acumulados,
              MAX(pj.valor_plantilla) AS valor_plantilla_actual
       FROM equipos_fantasy ef
       JOIN usuarios u ON u.id = ef.id_usuario
       ${ligaFilter}
       LEFT JOIN puntuaciones_jornada pj ON pj.id_equipo_fantasy = ef.id
       GROUP BY ef.id, ef.nombre, u.nombre
       ORDER BY puntos_total DESC, ef.nombre`
    );
    return rows;
  });

  // GET /api/clasificacion/jornada/:n — clasificación de una jornada concreta
  app.get('/jornada/:n', async (req, reply) => {
    const numero = parseInt(req.params.n);

    const { rows: jornada } = await pool.query(
      `SELECT id FROM jornadas WHERE numero = $1`, [numero]
    );
    if (jornada.length === 0) return reply.code(404).send({ error: 'Jornada no encontrada' });
    const idJornada = jornada[0].id;

    const { rows } = await pool.query(
      `SELECT ef.id, ef.nombre, u.nombre AS propietario,
              pj.puntos_jornada, pj.puntos_acumulados, pj.valor_plantilla
       FROM equipos_fantasy ef
       JOIN usuarios u ON u.id = ef.id_usuario
       LEFT JOIN puntuaciones_jornada pj ON pj.id_equipo_fantasy = ef.id AND pj.id_jornada = $1
       ORDER BY pj.puntos_jornada DESC NULLS LAST, ef.nombre`,
      [idJornada]
    );
    return rows;
  });
}
