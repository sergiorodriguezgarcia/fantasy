/**
 * Inserta jugadores nuevos detectados en jornadas 1 y 2
 * y añade sus estadísticas retroactivamente.
 *
 * NOTA: ESTRADA MARTINEZ, MARIO = MARIO ESTRADA (id=76, POR, BERRON) → ya estaba en BD.
 *       Solo necesitamos añadir sus stats de jornada 2 partido 46.
 */
import { pool } from '../src/db/pool.js';

// equipos_reales IDs
const EQ = {
  AYER:       3,
  BERRON:     5,
  RIAÑO:     10,
  CAUDAL:    11,
  SANTA_MARINA: 9,
  IBERIA:    14,
  LADA:      15,
  CARBAYIN:  16,
  TITANICO:  17,
  LENENSE:   18,
  LLANERA:   19,
};

// Nuevos jugadores a insertar
// Posición inferida de los puntos del scraper:
//   ≥60min da +2, <60min da +1 (según scraper), por tanto:
//   gol+2 (DEL), gol+2 (MED), etc.
//   - 1 gol 90min → 6pts = DEL (4+2) ✓
//   - 2 goles 45min → 9pts = DEL (2×4+1) ✓
const nuevosJugadores = [
  // ── Jornada 1 ──
  { nombre: 'PABLO JORGE',       posicion: 'DEL', eq: EQ.SANTA_MARINA }, // JORGE MENENDEZ, PABLO (Santa Marina J1)

  // ── Jornada 2 ──
  { nombre: 'PABLO MORAN',       posicion: 'MED', eq: EQ.TITANICO  }, // MORAN GARCIA, PABLO
  { nombre: 'ALEJANDRO LORENZO', posicion: 'MED', eq: EQ.LLANERA   }, // LORENZO CANTELI, ALEJANDRO
  { nombre: 'GUZMAN IZAGUIRRE',  posicion: 'DEL', eq: EQ.RIAÑO     }, // IZAGUIRRE RODRÍGUEZ, GUZMÁN (1 gol 90min, 6pts)
  { nombre: 'ALEN BERJANO',      posicion: 'MED', eq: EQ.RIAÑO     }, // BERJANO GARCIA, ALEN
  { nombre: 'ADRIEL CRESPO',     posicion: 'MED', eq: EQ.IBERIA    }, // CRESPO PAZOS, ADRIEL
  { nombre: 'YERAI ROCES',       posicion: 'MED', eq: EQ.LADA      }, // ROCES VENA, YERAI
  { nombre: 'ADRIAN IZQUIER',    posicion: 'MED', eq: EQ.LADA      }, // IZQUIER RODRIGUEZ, ADRIAN
  { nombre: 'ALVARO ALVAREZ',    posicion: 'MED', eq: EQ.LENENSE   }, // ALVAREZ MARTINEZ, ALVARO
  { nombre: 'NICOLAS BARROS',    posicion: 'DEL', eq: EQ.CAUDAL    }, // BARROS GONZALEZ, NICOLAS (2 goles suplente, 9pts)
  { nombre: 'SAMUEL GONZALEZ',   posicion: 'MED', eq: EQ.CAUDAL    }, // GONZALEZ BERNARDO, SAMUEL
  { nombre: 'MARCO SAS',         posicion: 'MED', eq: EQ.CARBAYIN  }, // SAS AMEZ, MARCO
  { nombre: 'MIGUEL SERRANO',    posicion: 'DEF', eq: EQ.CARBAYIN  }, // SERRANO ALVAREZ, MIGUEL (roja, -1pts 90min → DEF)
  { nombre: 'MAXIMINO ESTRADA',  posicion: 'MED', eq: EQ.AYER      }, // ESTRADA VELASCO, MAXIMINO
  { nombre: 'ALEJANDRO IGLESIAS',posicion: 'MED', eq: EQ.RIAÑO     }, // IGLESIAS CARBAJALES, ALEJANDRO (Aboño → verificar equipo)
  { nombre: 'MOISES CORDERO',    posicion: 'MED', eq: EQ.RIAÑO     }, // CORDERO DÍAZ, MOISES (Aboño → verificar equipo)
];

// Corrección: IGLESIAS CARBAJALES y CORDERO DÍAZ son de C.D ABOÑO (id=13), no Riaño
nuevosJugadores[14].eq = 13; // ALEJANDRO IGLESIAS → C.D ABOÑO
nuevosJugadores[15].eq = 13; // MOISES CORDERO → C.D ABOÑO

// Stats retroactivas de los nuevos jugadores
// (y de MARIO ESTRADA id=76 que se saltó en jornada 2)
// Formato: { id_jugador (null=recién insertado→usar nombre), id_jornada, id_partido, min, gol, am, rj, pcero, golesEnc }
// Los id_jugador nulos se rellenan después de insertar.

// Estructura: por nombre de jugador (tal como se insertó), sus stats
const statsPorJugador = [
  // ── Jornada 1 (id_jornada=2) ──────────────────────────────
  {
    nombre: 'PABLO JORGE',
    stats: [
      // Santa Marina 3-2 Berron, partido 35. Santa Marina concedió 2 → golesEnc=2, pcero=false
      { id_jornada: 2, id_partido: 35, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 2 },
    ],
  },

  // ── Jornada 2 (id_jornada=3) ──────────────────────────────
  {
    nombre: 'PABLO MORAN',
    stats: [
      // Real Titánico 3-0 Llanera, partido 39. Titánico pcero=true → golesEnc=0
      { id_jornada: 3, id_partido: 39, min: 90, gol: 0, am: 0, rj: 0, pcero: true, golesEnc: 0 },
    ],
  },
  {
    nombre: 'ALEJANDRO LORENZO',
    stats: [
      // Real Titánico 3-0 Llanera, partido 39. Llanera concedió 3 → golesEnc=3, pcero=false
      { id_jornada: 3, id_partido: 39, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 3 },
    ],
  },
  {
    nombre: 'GUZMAN IZAGUIRRE',
    stats: [
      // Riaño 3-1 San Luis, partido 40. Riaño concedió 1 → golesEnc=1, pcero=false
      { id_jornada: 3, id_partido: 40, min: 90, gol: 1, am: 0, rj: 0, pcero: false, golesEnc: 1 },
    ],
  },
  {
    nombre: 'ALEN BERJANO',
    stats: [
      // Riaño 3-1 San Luis, partido 40. Suplente 45min. Riaño pcero=false, golesEnc=1
      { id_jornada: 3, id_partido: 40, min: 45, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 1 },
    ],
  },
  {
    nombre: 'ADRIEL CRESPO',
    stats: [
      // Europa 0-2 Iberia, partido 41. Iberia pcero=true → golesEnc=0
      { id_jornada: 3, id_partido: 41, min: 30, gol: 0, am: 0, rj: 0, pcero: true, golesEnc: 0 },
    ],
  },
  {
    nombre: 'YERAI ROCES',
    stats: [
      // Lada 4-5 Santa Marina, partido 42. Lada concedió 5 → golesEnc=5, pcero=false
      { id_jornada: 3, id_partido: 42, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 5 },
    ],
  },
  {
    nombre: 'ADRIAN IZQUIER',
    stats: [
      // Lada 4-5 Santa Marina, partido 42. pcero=false, golesEnc=5
      { id_jornada: 3, id_partido: 42, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 5 },
    ],
  },
  {
    nombre: 'ALVARO ALVAREZ',
    stats: [
      // Campomanes 1-1 Lenense, partido 43. Lenense concedió 1 → golesEnc=1, pcero=false
      { id_jornada: 3, id_partido: 43, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 1 },
    ],
  },
  {
    nombre: 'NICOLAS BARROS',
    stats: [
      // Caudal 5-0 Carbayin, partido 44. Caudal pcero=true → golesEnc=0
      { id_jornada: 3, id_partido: 44, min: 45, gol: 2, am: 0, rj: 0, pcero: true, golesEnc: 0 },
    ],
  },
  {
    nombre: 'SAMUEL GONZALEZ',
    stats: [
      // Caudal 5-0 Carbayin, partido 44. Caudal pcero=true → golesEnc=0
      { id_jornada: 3, id_partido: 44, min: 90, gol: 0, am: 0, rj: 0, pcero: true, golesEnc: 0 },
    ],
  },
  {
    nombre: 'MARCO SAS',
    stats: [
      // Caudal 5-0 Carbayin, partido 44. Carbayin concedió 5 → golesEnc=5, pcero=false
      { id_jornada: 3, id_partido: 44, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 5 },
    ],
  },
  {
    nombre: 'MIGUEL SERRANO',
    stats: [
      // Caudal 5-0 Carbayin, partido 44. Carbayin pcero=false, golesEnc=5, roja
      { id_jornada: 3, id_partido: 44, min: 90, gol: 0, am: 0, rj: 1, pcero: false, golesEnc: 5 },
    ],
  },
  {
    nombre: 'MAXIMINO ESTRADA',
    stats: [
      // Riosa 2-1 Ayer, partido 45. Ayer concedió 2 → golesEnc=2, pcero=false
      { id_jornada: 3, id_partido: 45, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 2 },
    ],
  },
  {
    nombre: 'ALEJANDRO IGLESIAS',
    stats: [
      // Berron 3-4 Aboño, partido 46. Aboño concedió 3 → golesEnc=3, pcero=false
      { id_jornada: 3, id_partido: 46, min: 60, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 3 },
    ],
  },
  {
    nombre: 'MOISES CORDERO',
    stats: [
      // Berron 3-4 Aboño, partido 46. Aboño pcero=false, golesEnc=3, am
      { id_jornada: 3, id_partido: 46, min: 90, gol: 0, am: 1, rj: 0, pcero: false, golesEnc: 3 },
    ],
  },
];

// Stat retroactiva de MARIO ESTRADA (id=76, BERRON, POR) saltada en jornada 2
const statsMarioEstrada = {
  id_jugador: 76,
  // Berron 3-4 Aboño, partido 46. Berron concedió 4 → golesEnc=4, pcero=false
  stats: [
    { id_jornada: 3, id_partido: 46, min: 90, gol: 0, am: 0, rj: 0, pcero: false, golesEnc: 4 },
  ],
};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insertar nuevos jugadores y obtener sus IDs
    const idsPorNombre = {};
    for (const j of nuevosJugadores) {
      const { rows } = await client.query(
        `INSERT INTO jugadores (nombre, posicion, id_equipo_real, precio_actual, precio_inicial)
         VALUES ($1, $2, $3, 5000000, 5000000)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [j.nombre, j.posicion, j.eq]
      );
      if (rows.length > 0) {
        idsPorNombre[j.nombre] = rows[0].id;
        console.log(`  ✓ Jugador insertado: ${j.nombre} (${j.posicion}) → id=${rows[0].id}`);
      } else {
        // Ya existía, buscarlo
        const { rows: existente } = await client.query(
          `SELECT id FROM jugadores WHERE nombre = $1 AND id_equipo_real = $2`,
          [j.nombre, j.eq]
        );
        if (existente.length > 0) {
          idsPorNombre[j.nombre] = existente[0].id;
          console.log(`  ~ Ya existía: ${j.nombre} → id=${existente[0].id}`);
        }
      }
    }

    // 2. Insertar stats retroactivas de los nuevos jugadores
    let statsInsertadas = 0;
    for (const entry of statsPorJugador) {
      const idJugador = idsPorNombre[entry.nombre];
      if (!idJugador) {
        console.warn(`  ⚠ No se encontró id para ${entry.nombre}`);
        continue;
      }
      for (const s of entry.stats) {
        await client.query(
          `INSERT INTO estadisticas
             (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
              amarillas, rojas, porteria_cero, goles_encajados)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT DO NOTHING`,
          [idJugador, s.id_jornada, s.id_partido, s.min, s.gol, 0, s.am, s.rj, s.pcero, s.golesEnc]
        );
        statsInsertadas++;
      }
    }

    // 3. Stat de MARIO ESTRADA (id=76) en jornada 2
    for (const s of statsMarioEstrada.stats) {
      await client.query(
        `INSERT INTO estadisticas
           (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
            amarillas, rojas, porteria_cero, goles_encajados)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [statsMarioEstrada.id_jugador, s.id_jornada, s.id_partido, s.min, s.gol, 0, s.am, s.rj, s.pcero, s.golesEnc]
      );
      statsInsertadas++;
      console.log(`  ✓ Stats MARIO ESTRADA (id=76) jornada 2 partido 46`);
    }

    await client.query('COMMIT');
    console.log(`\nTotal jugadores insertados: ${Object.keys(idsPorNombre).length}`);
    console.log(`Total stats insertadas: ${statsInsertadas}`);
    console.log('Listo.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
