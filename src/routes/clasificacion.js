import { pool } from '../db/pool.js';
import { fetchClasificacion } from '../scraper/fetcher.js';
import { parseClasificacion } from '../scraper/parser.js';
import { buscarEquipoReal } from '../scraper/nombres.js';

// La clasificación de la federación se guarda en memoria para no consultarla en cada visita a Inicio
const CACHE_LIGA_MS = 30 * 60_000;
let cacheLiga = null; // { filas, fecha }

/**
 * Clasificación real del grupo en asturfutbol.es, con el escudo de cada club (sacado de los
 * calendarios guardados) y su id de equipo real para abrir la plantilla.
 * Si la federación no responde, devuelve la última que se consiguió.
 */
async function clasificacionLiga() {
  if (cacheLiga && Date.now() - cacheLiga.fecha < CACHE_LIGA_MS) return cacheLiga.filas;

  let filas;
  try {
    filas = parseClasificacion(await fetchClasificacion());
  } catch (err) {
    console.error('[clasificacion] Error leyendo la clasificación de la federación:', err.message);
    filas = [];
  }
  if (filas.length === 0) return cacheLiga?.filas ?? [];

  const { rows: calendarios } = await pool.query(
    `SELECT calendario FROM jornadas WHERE calendario IS NOT NULL ORDER BY numero DESC`
  );
  // Un escudo por club (el del calendario más reciente). buscarEquipoReal casa nombres de la
  // federación escritos distinto; aquí el "id" es la URL del escudo
  const escudoPorNombre = new Map();
  for (const { calendario } of calendarios) {
    for (const p of calendario) {
      if (p.escudo_local && !escudoPorNombre.has(p.local)) escudoPorNombre.set(p.local, p.escudo_local);
      if (p.escudo_visitante && !escudoPorNombre.has(p.visitante)) escudoPorNombre.set(p.visitante, p.escudo_visitante);
    }
  }
  const escudos = [...escudoPorNombre].map(([nombre, id]) => ({ id, nombre }));
  const { rows: equipos } = await pool.query(`SELECT id, nombre FROM equipos_reales`);

  filas = filas.map(f => ({
    ...f,
    escudo:          buscarEquipoReal(f.equipo, escudos),
    id_equipo_real:  buscarEquipoReal(f.equipo, equipos),
  }));
  cacheLiga = { filas, fecha: Date.now() };
  return filas;
}

export async function clasificacionRoutes(app) {

  // GET /api/clasificacion/liga — clasificación real de la liga de asturfutbol
  app.get('/liga', async () => clasificacionLiga());

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
