/**
 * Fotos de jugadores.
 *
 * Las actas de asturfutbol.es incluyen la foto de cada jugador incrustada como
 * data URI en base64. Se decodifica y se guarda en jugadores.foto (BYTEA).
 */

import { normalizeName, generarCombinacionesNombre } from '../scraper/nombres.js';

const SQL_NORM = (col) =>
  `translate(upper(${col}), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑÇ', 'AEIOUAEIOUAEIOUAEIOUAONC')`;

/**
 * "data:image/png;base64,..." → { buffer, mime } | null
 * El mime se deduce de los bytes: la web declara png pero sirve jpeg.
 */
export function decodificarFoto(dataUri) {
  const base64 = dataUri?.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i)?.[1];
  if (!base64) return null;
  const buffer = Buffer.from(base64, 'base64');
  const mime = detectarMime(buffer);
  if (!mime) return null;
  return { buffer, mime };
}

function detectarMime(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Guarda las fotos de todos los jugadores (titulares y suplentes) de un acta parseada.
 * Match por cod_jugador o, si no, por nombre dentro del mismo equipo real.
 * Solo escribe si la foto ha cambiado. Devuelve el número de fotos actualizadas.
 */
export async function guardarFotosActa(client, acta) {
  let actualizadas = 0;

  for (const equipo of [acta.equipoLocal, acta.equipoVisitante]) {
    if (!equipo) continue;
    const equipoNorm = normalizeName(equipo.nombre);

    for (const j of equipo.jugadores) {
      const foto = decodificarFoto(j.foto);
      if (!foto) continue;

      const { rowCount } = await client.query(
        `UPDATE jugadores SET foto = $4, foto_mime = $5
         WHERE id = (
           SELECT id FROM jugadores
           WHERE (cod_jugador = $1 AND cod_jugador IS NOT NULL)
              OR (
                ${SQL_NORM('nombre')} = ANY($2::text[])
                AND id_equipo_real IN (
                  SELECT id FROM equipos_reales WHERE ${SQL_NORM('nombre')} = $3
                )
              )
           ORDER BY (cod_jugador = $1) DESC NULLS LAST
           LIMIT 1
         )
         AND foto IS DISTINCT FROM $4`,
        [j.id, generarCombinacionesNombre(j.nombre), equipoNorm, foto.buffer, foto.mime]
      );
      actualizadas += rowCount;
    }
  }

  return actualizadas;
}
