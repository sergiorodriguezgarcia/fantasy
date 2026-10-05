/**
 * Seed inicial: carga los equipos y jugadores desde /tmp/equipos_jugadores.json
 * (generado por el scraper con `node src/index.js equipos`)
 *
 * También se puede importar un JSON manualmente con la misma estructura.
 *
 * Uso: node src/db/seed.js [ruta_json]
 *
 * Formato JSON esperado:
 * [
 *   {
 *     "nombre": "C.D. RAICES A",
 *     "codEquipo": "12345",
 *     "jugadores": [
 *       { "nombre": "JUAN GARCIA", "dorsal": 1, "posicion": "POR", "codJugador": "99999",
 *         "precioInicial": 5000000, "precioActual": 5000000 },
 *       ...
 *     ]
 *   },
 *   ...
 * ]
 */

import { readFileSync } from 'fs';
import { pool } from './pool.js';

const jsonPath = process.argv[2] ?? '/tmp/equipos_jugadores.json';

async function seed() {
  let data;
  try {
    data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    console.error(`No se pudo leer ${jsonPath}: ${err.message}`);
    console.error('Genera el JSON con: cd apps/scraper && node src/index.js equipos');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let totalEquipos = 0;
    let totalJugadores = 0;

    for (const equipo of data) {
      // Insertar o actualizar equipo real
      const resEq = await client.query(
        `INSERT INTO equipos_reales (nombre, cod_equipo)
         VALUES ($1, $2)
         ON CONFLICT (nombre) DO UPDATE SET cod_equipo = EXCLUDED.cod_equipo
         RETURNING id`,
        [equipo.nombre, equipo.codEquipo ?? null]
      );
      const idEquipo = resEq.rows[0].id;
      totalEquipos++;

      for (const j of (equipo.jugadores ?? [])) {
        await client.query(
          `INSERT INTO jugadores (nombre, posicion, id_equipo_real, cod_jugador, precio_actual, precio_inicial)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            j.nombre,
            j.posicion ?? null,
            idEquipo,
            j.codJugador ?? null,
            j.precioActual ?? 5_000_000,
            j.precioInicial ?? 5_000_000,
          ]
        );
        totalJugadores++;
      }

      console.log(`  ${equipo.nombre}: ${equipo.jugadores?.length ?? 0} jugadores`);
    }

    // Crear la liga global
    await client.query(
      `INSERT INTO ligas (nombre, codigo_invitacion, publica)
       VALUES ('Liga Global', 'GLOBAL', TRUE)
       ON CONFLICT (codigo_invitacion) DO NOTHING`
    );

    await client.query('COMMIT');
    console.log(`\nSeed completado: ${totalEquipos} equipos, ${totalJugadores} jugadores.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Error en el seed:', err);
  process.exit(1);
});
