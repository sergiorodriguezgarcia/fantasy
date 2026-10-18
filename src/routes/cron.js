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
import { normalizeName, generarCombinacionesNombre } from '../scraper/nombres.js';
import { primerPartido } from '../services/alineaciones.js';

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

  // POST /api/cron/jornada-auto — importación automática (ver importarJornadaAutomatica)
  // Para un cron externo (también despierta el servicio si Render lo ha dormido).
  // Header: X-Cron-Secret: <CRON_SECRET>
  app.post('/jornada-auto', async (req, reply) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers['x-cron-secret'] !== cronSecret) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
    try {
      return await importarJornadaAutomatica();
    } catch (err) {
      console.error('[CRON] Error en la importación automática:', err.message);
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

let importacionAutomaticaEnCurso = false;

/**
 * Importación automática de jornadas, pensada para lanzarse periódicamente sin parámetros:
 * 1. Jornada a seguir: la EN_CURSO/PENDIENTE más baja o, si no hay, la siguiente a la última.
 * 2. En cuanto la jornada tiene calendario la crea (PENDIENTE) con el cierre de alineaciones en el
 *    inicio del primer partido. Si aún no hay partidos jugados, no hace nada más.
 * 3. Importa los partidos jugados que faltan (los ya importados no se vuelven a descargar).
 * 4. Calcula puntos y precios y cierra la jornada solo cuando están todos los partidos jugados
 *    e importados. Si hay un aplazado, se cierra igualmente en cuanto la jornada siguiente ha
 *    empezado (el aplazado queda fuera; se puede importar luego desde el admin).
 */
export async function importarJornadaAutomatica() {
  if (importacionAutomaticaEnCurso) return { ok: false, motivo: 'Ya hay una importación automática en curso' };
  importacionAutomaticaEnCurso = true;
  try {
    const { rows: [{ numero: numJornada }] } = await pool.query(
      `SELECT COALESCE(
         (SELECT MIN(numero) FROM jornadas WHERE estado IN ('EN_CURSO', 'PENDIENTE')),
         (SELECT COALESCE(MAX(numero), 0) + 1 FROM jornadas)
       ) AS numero`
    );

    resetSession();
    const { partidos } = parseJornada(await fetchJornada(numJornada));
    if (partidos.length === 0) {
      return { ok: true, jornada: numJornada, motivo: 'La jornada no tiene partidos publicados' };
    }
    const jugados = partidos.filter(p => p.jugado);

    // Crear la jornada en cuanto se publica su calendario, con el cierre de alineaciones en el
    // inicio del primer partido. El cierre se actualiza si cambian los horarios, salvo que ya se
    // haya guardado la foto de las alineaciones.
    const { rows: [{ id: idJornada, cierre_alineaciones: cierre }] } = await pool.query(
      `INSERT INTO jornadas (numero, estado, cierre_alineaciones)
       VALUES ($1, $2, $3::timestamp AT TIME ZONE 'Europe/Madrid')
       ON CONFLICT (numero) DO UPDATE
         SET estado = CASE WHEN jornadas.estado = 'PENDIENTE' THEN EXCLUDED.estado ELSE jornadas.estado END,
             cierre_alineaciones = CASE WHEN jornadas.alineaciones_guardadas THEN jornadas.cierre_alineaciones
                                        ELSE COALESCE(EXCLUDED.cierre_alineaciones, jornadas.cierre_alineaciones) END
       RETURNING id, cierre_alineaciones`,
      [numJornada, jugados.length > 0 ? 'EN_CURSO' : 'PENDIENTE', primerPartido(partidos)]
    );

    if (jugados.length === 0) {
      return { ok: true, jornada: numJornada, cierre_alineaciones: cierre, motivo: 'Todavía no hay partidos jugados' };
    }

    const { rows: yaImportados } = await pool.query(
      `SELECT cod_acta FROM partidos WHERE id_jornada = $1 AND procesado AND cod_acta IS NOT NULL`,
      [idJornada]
    );
    const importados = new Set(yaImportados.map(p => String(p.cod_acta)));

    const nuevos = [];
    const errores = [];
    for (const partido of jugados.filter(p => !importados.has(String(p.codActa)))) {
      try {
        await importarPartido(idJornada, partido);
        nuevos.push(`${partido.equipoLocal} - ${partido.equipoVisitante}`);
      } catch (err) {
        console.error(`[CRON] Error en acta ${partido.codActa}: ${err.message}`);
        errores.push({ codActa: partido.codActa, error: err.message });
      }
    }

    // ¿Se puede cerrar la jornada?
    let motivoCierre = null;
    if (jugados.length === partidos.length) {
      motivoCierre = 'todos los partidos jugados';
    } else {
      const { partidos: siguientes } = parseJornada(await fetchJornada(numJornada + 1));
      if (siguientes.some(p => p.jugado)) {
        motivoCierre = `la jornada ${numJornada + 1} ya ha empezado (${partidos.length - jugados.length} partido(s) sin jugar quedan fuera)`;
      }
    }

    let puntuacion = null;
    if (motivoCierre && errores.length === 0) {
      puntuacion = await calcularPuntosJornada(idJornada);
      await actualizarPrecios(idJornada);
      await pool.query(`UPDATE jornadas SET estado = 'CALCULADA' WHERE id = $1`, [idJornada]);
      console.log(`[CRON] Jornada ${numJornada} calculada: ${motivoCierre}`);
    }

    return {
      ok: true,
      jornada: numJornada,
      partidos_jugados: `${jugados.length}/${partidos.length}`,
      partidos_importados_ahora: nuevos,
      errores,
      calculada: puntuacion !== null,
      motivo: puntuacion
        ? motivoCierre
        : errores.length > 0 ? 'Hay actas con errores; se reintentará' : 'Faltan partidos por jugar',
      puntuacion,
    };
  } finally {
    importacionAutomaticaEnCurso = false;
  }
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
  // Las fotos de los jugadores ya no se actualizan al importar: las que hay son definitivas
}
