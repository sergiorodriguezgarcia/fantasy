/**
 * Endpoint de cron para importación automática de jornadas.
 *
 * Protegido por CRON_SECRET (variable de entorno).
 * Railway cron llama: POST /api/cron/importar-jornada con header X-Cron-Secret.
 *
 * También puede llamarse manualmente desde el panel admin con JWT de admin.
 */

import { pool } from '../db/pool.js';
import { fetchJornada, fetchActa, resetSession } from '../scraper/fetcher.js';
import { parseJornada, parseActa } from '../scraper/parser.js';
import { calcularPuntosJornada } from '../services/puntos.js';
import { actualizarPrecios } from '../services/precios.js';

export async function cronRoutes(app) {

  // POST /api/cron/importar-jornada
  // Body: { numero_jornada: number, calcular_puntos: boolean }
  // Header: X-Cron-Secret: <CRON_SECRET> o JWT de admin
  app.post('/importar-jornada', async (req, reply) => {
    // Autenticación: cron secret o admin JWT
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = req.headers['x-cron-secret'];

    if (cronSecret && headerSecret === cronSecret) {
      // OK: llamada desde cron externo
    } else {
      // Intentar validar JWT de admin
      try {
        await req.jwtVerify();
        if (req.user?.rol !== 'admin') {
          return reply.code(403).send({ error: 'Se requiere rol administrador' });
        }
      } catch {
        return reply.code(401).send({ error: 'No autorizado: falta X-Cron-Secret o token admin' });
      }
    }

    const { numero_jornada, calcular_puntos = false } = req.body ?? {};

    // Si no se indica número, usar la jornada actual EN_CURSO o la primera PENDIENTE
    let numJornada = parseInt(numero_jornada);
    if (isNaN(numJornada)) {
      const { rows } = await pool.query(
        `SELECT numero FROM jornadas
         WHERE estado IN ('EN_CURSO', 'PENDIENTE')
         ORDER BY CASE estado WHEN 'EN_CURSO' THEN 0 ELSE 1 END, numero
         LIMIT 1`
      );
      if (rows.length === 0) {
        return reply.code(400).send({ error: 'No hay jornada activa y no se indicó numero_jornada' });
      }
      numJornada = rows[0].numero;
    }

    console.log(`[CRON] Importando jornada ${numJornada} desde asturfutbol.es...`);

    try {
      resetSession();
      const resultado = await importarJornada(numJornada, calcular_puntos);
      console.log(`[CRON] Jornada ${numJornada} importada: ${resultado.partidos_importados} partidos`);
      return resultado;
    } catch (err) {
      console.error(`[CRON] Error importando jornada ${numJornada}:`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/cron/estado — estado del último import (para Railway healthcheck)
  app.get('/estado', async () => {
    const { rows } = await pool.query(
      `SELECT j.numero, j.estado, j.fecha_inicio, j.fecha_fin,
              COUNT(p.id) AS partidos_totales,
              COUNT(p.id) FILTER (WHERE p.procesado = true) AS partidos_procesados
       FROM jornadas j
       LEFT JOIN partidos p ON p.id_jornada = j.id
       WHERE j.estado IN ('EN_CURSO', 'CALCULADA')
       GROUP BY j.id
       ORDER BY j.numero DESC
       LIMIT 3`
    );
    return { jornadas: rows };
  });
}

/**
 * Lógica principal de importación de una jornada.
 * 1. Scrape página de jornada → lista de partidos
 * 2. Para cada partido jugado → scrape acta → insertar en BD
 * 3. Opcionalmente calcular puntos
 */
async function importarJornada(numJornada, calcularPuntos) {
  // 1. Obtener o crear jornada en BD
  let { rows: jRows } = await pool.query(
    `SELECT id, estado FROM jornadas WHERE numero = $1`, [numJornada]
  );

  let idJornada;
  if (jRows.length === 0) {
    const { rows: ins } = await pool.query(
      `INSERT INTO jornadas (numero, estado) VALUES ($1, 'EN_CURSO') RETURNING id`,
      [numJornada]
    );
    idJornada = ins[0].id;
  } else {
    idJornada = jRows[0].id;
  }

  // 2. Scrape de la página de jornada
  const htmlJornada = await fetchJornada(numJornada);
  const { partidos } = parseJornada(htmlJornada);

  const jugados = partidos.filter(p => p.jugado);
  const errores = [];
  let importados = 0;

  for (const partido of jugados) {
    try {
      await importarPartido(idJornada, partido);
      importados++;
    } catch (err) {
      console.error(`[CRON] Error en acta ${partido.codActa}: ${err.message}`);
      errores.push({ codActa: partido.codActa, error: err.message });
    }
  }

  // 3. Calcular puntos si se pide
  let puntuacion = null;
  if (calcularPuntos && importados > 0) {
    puntuacion = await calcularPuntosJornada(idJornada);
    await actualizarPrecios(idJornada);
    await pool.query(`UPDATE jornadas SET estado = 'CALCULADA' WHERE id = $1`, [idJornada]);
  } else if (importados > 0) {
    // Marcar como EN_CURSO si aún no está calculada
    await pool.query(
      `UPDATE jornadas SET estado = 'EN_CURSO' WHERE id = $1 AND estado = 'PENDIENTE'`,
      [idJornada]
    );
  }

  return {
    ok: true,
    jornada: numJornada,
    id_jornada: idJornada,
    partidos_scrapeados: partidos.length,
    partidos_jugados: jugados.length,
    partidos_importados: importados,
    errores,
    puntuacion,
  };
}

/**
 * Importa un partido desde el acta al que apunta `partido.codActa`.
 */
async function importarPartido(idJornada, partido) {
  const htmlActa = await fetchActa(partido.codActa);
  const acta = parseActa(htmlActa, partido.codActa);

  if (!acta.equipoLocal || !acta.equipoVisitante) {
    throw new Error(`No se pudieron parsear los equipos del acta ${partido.codActa}`);
  }

  const golesLocal = acta.equipoLocal.goles.filter(g => !g.esPropio).length
    + acta.equipoVisitante.goles.filter(g => g.esPropio).length;
  const golesVisitante = acta.equipoVisitante.goles.filter(g => !g.esPropio).length
    + acta.equipoLocal.goles.filter(g => g.esPropio).length;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert partido
    const { rows: pRows } = await client.query(
      `INSERT INTO partidos
         (id_jornada, nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta, fuente, procesado)
       VALUES ($1, $2, $3, $4, $5, $6, 'scraper', TRUE)
       ON CONFLICT (id_jornada, nombre_local, nombre_visitante) DO UPDATE
         SET goles_local = EXCLUDED.goles_local,
             goles_visitante = EXCLUDED.goles_visitante,
             procesado = TRUE,
             fuente = 'scraper'
       RETURNING id`,
      [idJornada, acta.equipoLocal.nombre, acta.equipoVisitante.nombre,
       golesLocal, golesVisitante, partido.codActa]
    );
    const idPartido = pRows[0].id;

    // Borrar stats previas del partido (para reimport limpio)
    const localNorm = normalizeName(acta.equipoLocal.nombre);
    const visitanteNorm = normalizeName(acta.equipoVisitante.nombre);
    await client.query(
      `DELETE FROM estadisticas
       WHERE id_jornada = $1
         AND id_jugador IN (
           SELECT j.id FROM jugadores j
           JOIN equipos_reales er ON er.id = j.id_equipo_real
           WHERE translate(upper(er.nombre), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC') = $2
              OR translate(upper(er.nombre), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC') = $3
         )`,
      [idJornada, localNorm, visitanteNorm]
    );

    // Insertar estadísticas de ambos equipos
    for (const [equipoData, golesContra] of [
      [acta.equipoLocal,     golesVisitante],
      [acta.equipoVisitante, golesLocal],
    ]) {
      const porteriaCero = golesContra === 0;

      for (const j of equipoData.jugadores) {
        if (j.minutosJugados === 0) continue;

        // Buscar jugador en BD por cod_jugador o nombre.
        // El scraper devuelve "APELLIDO1 APELLIDO2, NOMBRE" pero la BD tiene "NOMBRE APELLIDO1".
        // Generamos todas las combinaciones posibles para hacer match.
        const equipoNorm = normalizeName(equipoData.nombre);
        const candidatos = generarCombinacionesNombre(j.nombre);
        const { rows: jRows } = await client.query(
          `SELECT id FROM jugadores
           WHERE (cod_jugador = $1 AND cod_jugador IS NOT NULL)
              OR (
                translate(upper(nombre), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC') = ANY($2::text[])
                AND id_equipo_real IN (
                  SELECT id FROM equipos_reales
                  WHERE translate(upper(nombre), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC') = $3
                )
              )
           LIMIT 1`,
          [j.id, candidatos, equipoNorm]
        );
        if (jRows.length === 0) continue;
        const idJugador = jRows[0].id;

        const goles = equipoData.goles.filter(
          g => !g.esPropio && normalizeName(g.jugadorNombre) === normalizeName(j.nombre)
        ).length;
        const golesPropio = equipoData.goles.filter(
          g => g.esPropio && normalizeName(g.jugadorNombre) === normalizeName(j.nombre)
        ).length;
        const amarillas = equipoData.tarjetas.filter(
          t => t.tipo === 'amarilla' && normalizeName(t.jugadorNombre) === normalizeName(j.nombre)
        ).length;
        const rojas = equipoData.tarjetas.filter(
          t => t.tipo === 'roja' && normalizeName(t.jugadorNombre) === normalizeName(j.nombre)
        ).length;

        await client.query(
          `INSERT INTO estadisticas
             (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
              amarillas, rojas, porteria_cero, goles_encajados)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id_jugador, id_jornada) DO UPDATE
             SET minutos_jugados = EXCLUDED.minutos_jugados,
                 goles           = EXCLUDED.goles,
                 goles_propio    = EXCLUDED.goles_propio,
                 amarillas       = EXCLUDED.amarillas,
                 rojas           = EXCLUDED.rojas,
                 porteria_cero   = EXCLUDED.porteria_cero,
                 goles_encajados = EXCLUDED.goles_encajados`,
          [idJugador, idJornada, idPartido,
           j.minutosJugados, goles, golesPropio,
           amarillas, rojas,
           porteriaCero && j.minutosJugados >= 90,
           golesContra]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function normalizeName(name) {
  return (name ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * El scraper devuelve nombres en formato federación: "APELLIDO1 APELLIDO2, NOMBRE"
 * La BD los tiene como los introdujo el admin: "NOMBRE APELLIDO1" o "NOMBRE APELLIDO1 APELLIDO2"
 * Genera todas las combinaciones posibles para hacer match.
 * Ej: "ALDARIZ ALVAREZ, DIEGO" → ["DIEGO ALDARIZ", "DIEGO ALDARIZ ALVAREZ", "DIEGO ALVAREZ", ...]
 */
function generarCombinacionesNombre(nombreScraper) {
  const norm = normalizeName(nombreScraper);
  if (!norm.includes(',')) return [norm]; // nombre simple tipo "BETO"

  const [apellidosParte, nombresParte] = norm.split(',').map(s => s.trim());
  const apellidosTokens = apellidosParte.split(' ').filter(Boolean);
  const nombresTokens = nombresParte.split(' ').filter(Boolean);

  const combinaciones = new Set();
  // Combinación completa invertida: "NOMBRE1 NOMBRE2 APELLIDO1 APELLIDO2"
  combinaciones.add(`${nombresParte} ${apellidosParte}`);

  // Combinaciones parciales: cada nombre con cada subconjunto de apellidos
  for (const nombre of nombresTokens) {
    combinaciones.add(nombre);
    for (let i = 1; i <= apellidosTokens.length; i++) {
      combinaciones.add(`${nombre} ${apellidosTokens.slice(0, i).join(' ')}`);
    }
  }

  return [...combinaciones];
}
