/**
 * Entrenadores.
 *
 * Son filas de jugadores con posicion 'ENT', una por equipo real, y se fichan, venden y clausulan
 * como cualquier jugador (máximo MAX_ENTRENADORES por plantilla). No juegan: puntúan según el
 * resultado de su equipo en la jornada, sea quien sea el que se sentó en el banquillo ese día.
 * Tener entrenador es opcional: sin él el equipo puntúa igual, solo sin sus puntos.
 * Valen como mucho 10M (precios.js) y su cláusula como mucho 50M (clausulas.js).
 * Se cargan una sola vez desde las actas (scripts/importar-entrenadores.js).
 */

import { normalizeName } from '../scraper/nombres.js';
import { decodificarFoto } from './fotos.js';

export const PRECIO_INICIAL_ENTRENADOR = 1_000_000;

const SQL_NORM = (col) =>
  `translate(upper(${col}), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC')`;

/**
 * Guarda la estadística de la jornada de los entrenadores de los dos equipos de un partido: solo
 * el resultado (victoria / empate), del que salen sus puntos. Sin marcador no guarda nada.
 * Se llama después de guardar las de los jugadores, así que sobrescribe lo que hubiera.
 */
export async function guardarEstadisticasEntrenadores(client, {
  idJornada, idPartido, nombreLocal, nombreVisitante, golesLocal, golesVisitante,
}) {
  if (golesLocal == null || golesVisitante == null) return;

  for (const [nombre, propios, rivales] of [
    [nombreLocal, golesLocal, golesVisitante],
    [nombreVisitante, golesVisitante, golesLocal],
  ]) {
    await client.query(
      `INSERT INTO estadisticas (id_jugador, id_jornada, id_partido, victoria, empate)
       SELECT j.id, $1, $2, $4, $5
       FROM jugadores j
       JOIN equipos_reales er ON er.id = j.id_equipo_real
       WHERE j.posicion = 'ENT' AND j.activo = TRUE AND ${SQL_NORM('er.nombre')} = $3
       ON CONFLICT (id_jugador, id_jornada) DO UPDATE
         SET id_partido = EXCLUDED.id_partido,
             victoria   = EXCLUDED.victoria,
             empate     = EXCLUDED.empate,
             minutos_jugados = 0, goles = 0, goles_propio = 0, amarillas = 0, rojas = 0,
             porteria_cero = FALSE, goles_encajados = 0`,
      [idJornada, idPartido, normalizeName(nombre), propios > rivales, propios === rivales]
    );
  }
}

/**
 * Da de alta el entrenador de un equipo a partir del acta ({ nombre, foto }) si ese equipo real aún
 * no tiene uno activo. Devuelve 'creado', 'ya_tiene' o 'sin_equipo' (el equipo no está en la BD).
 */
export async function altaEntrenador(db, nombreEquipo, entrenador) {
  const { rows: [equipo] } = await db.query(
    `SELECT er.id,
            EXISTS (SELECT 1 FROM jugadores j
                    WHERE j.id_equipo_real = er.id AND j.posicion = 'ENT' AND j.activo = TRUE) AS tiene
     FROM equipos_reales er
     WHERE ${SQL_NORM('er.nombre')} = $1`,
    [normalizeName(nombreEquipo)]
  );
  if (!equipo) return 'sin_equipo';
  if (equipo.tiene) return 'ya_tiene';

  const foto = decodificarFoto(entrenador.foto);
  await db.query(
    `INSERT INTO jugadores (nombre, posicion, id_equipo_real, precio_actual, precio_inicial, foto, foto_mime)
     VALUES ($1, 'ENT', $2, $3, $3, $4, $5)`,
    [nombreEntrenador(entrenador.nombre), equipo.id, PRECIO_INICIAL_ENTRENADOR, foto?.buffer ?? null, foto?.mime ?? null]
  );
  return 'creado';
}

// "MERCHANTE FERNANDEZ, ALFREDO GABRIEL" → "ALFREDO GABRIEL MERCHANTE FERNANDEZ" (como los jugadores)
function nombreEntrenador(nombreActa) {
  const norm = nombreActa.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!norm.includes(',')) return norm;
  const [apellidos, nombre] = norm.split(',').map(s => s.trim());
  return `${nombre} ${apellidos}`;
}
