/**
 * Script para insertar los 7 partidos restantes de la Jornada 1
 * (Carbayin vs Campomanes ya estaba añadido)
 */
import { pool } from '../src/db/pool.js';

const ID_JORNADA = 2;

// Datos de los 7 partidos con IDs de jugadores de la BD
const partidos = [
  // ── Partido 1: Iberia C.F. A 1 - 2 Real Titanico B ──────────
  {
    nombre_local: 'IBERIA C.F',
    nombre_visitante: "REAL TITANICO 'B'",
    goles_local: 1,
    goles_visitante: 2,
    cod_acta: '25756789',
    jugadores: [
      // Local (Iberia)
      { id: 302, min: 90, gol: 0, am: 0, rj: 0 }, // PELAYO SANDINO
      { id: 303, min: 90, gol: 0, am: 0, rj: 0 }, // ANGEL FERNANDEZ
      { id: 304, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO CUETO
      { id: 305, min: 90, gol: 0, am: 1, rj: 0 }, // IBAI FABIAN
      { id: 306, min: 90, gol: 0, am: 0, rj: 0 }, // MARCOS ANTUÑA
      { id: 307, min: 45, gol: 0, am: 0, rj: 0 }, // ANDRES JOSE COTO
      { id: 308, min: 90, gol: 0, am: 0, rj: 0 }, // HECTOR TOYOS
      { id: 309, min: 90, gol: 0, am: 0, rj: 0 }, // AARON GARCIA
      { id: 310, min: 90, gol: 0, am: 1, rj: 0 }, // ALEJANDRO GARCIA
      { id: 311, min: 90, gol: 0, am: 0, rj: 0 }, // ALBERTO SANCHEZ
      { id: 301, min: 90, gol: 0, am: 1, rj: 0 }, // JUAN JOSE CONDE
      { id: 313, min: 45, gol: 0, am: 0, rj: 0 }, // BORJA SANGUINO (suplente)
      // Visitante (Real Titanico)
      { id: 322, min: 90, gol: 1, am: 0, rj: 0 }, // MANUEL FERNANDEZ
      { id: 325, min: 90, gol: 1, am: 0, rj: 0 }, // CRISTIAN MONTILLA
      { id: 319, min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN PELAEZ
      { id: 323, min: 90, gol: 0, am: 0, rj: 0 }, // NICOLAS ALVAREZ
      { id: 320, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER GUERRERO
      { id: 321, min: 90, gol: 0, am: 0, rj: 0 }, // NOEL CANTELI
      { id: 324, min: 69, gol: 0, am: 0, rj: 0 }, // ERIK DE CAMARGO
      { id: 326, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO FERNANDEZ
      { id: 327, min: 90, gol: 0, am: 0, rj: 0 }, // IKER FERNANDEZ
      { id: 329, min: 90, gol: 0, am: 0, rj: 0 }, // YAGO CASTAÑO
      { id: 328, min: 90, gol: 0, am: 1, rj: 0 }, // ENZO GERMAN
      { id: 332, min: 21, gol: 0, am: 0, rj: 0 }, // JOSE ALEJANDRO (suplente)
    ],
  },

  // ── Partido 2: C.D. San Luis 2 - 2 Santiago de Aller ─────────
  {
    nombre_local: 'C.D SAN LUIS',
    nombre_visitante: 'SANTIAGO DE ALLER',
    goles_local: 2,
    goles_visitante: 2,
    cod_acta: '25756783',
    jugadores: [
      // Local (San Luis)
      { id: 189, min: 90, gol: 2, am: 0, rj: 0 }, // IZAN MARTINEZ
      { id: 183, min: 90, gol: 0, am: 0, rj: 0 }, // MARTIN SAN JUAN
      { id: 184, min: 90, gol: 0, am: 0, rj: 0 }, // NEL LOREDO
      { id: 185, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER VAZQUEZ
      { id: 188, min: 90, gol: 0, am: 0, rj: 0 }, // MARIO RIERA
      { id: 190, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER MORENO
      { id: 193, min: 90, gol: 0, am: 0, rj: 0 }, // ISAAC SUAREZ
      { id: 186, min: 90, gol: 0, am: 1, rj: 0 }, // DAVID VALDES
      { id: 187, min: 90, gol: 0, am: 1, rj: 0 }, // AITOR GONZALEZ
      { id: 191, min: 90, gol: 0, am: 1, rj: 0 }, // DAVID BRAGA
      { id: 192, min: 45, gol: 0, am: 0, rj: 0 }, // JAVIER MARCOS
      { id: 200, min: 45, gol: 0, am: 1, rj: 0 }, // DIALLO MAMADOU (suplente)
      // Visitante (Santiago de Aller)
      { id: 123, min: 90, gol: 1, am: 0, rj: 0 }, // ANGEL MERCHANTE
      { id: 129, min: 90, gol: 1, am: 1, rj: 0 }, // IVAN TORRE
      { id: 115, min: 90, gol: 0, am: 0, rj: 0 }, // JONATHAN GOMEZ
      { id: 116, min: 90, gol: 0, am: 0, rj: 0 }, // JAIRO AIR LACHEN
      { id: 121, min: 90, gol: 0, am: 0, rj: 0 }, // JOSE ROBERTO
      { id: 118, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO ALEXANDER
      { id: 128, min: 90, gol: 0, am: 0, rj: 0 }, // YOMIL SMERLIN
      { id: 120, min: 90, gol: 0, am: 0, rj: 0 }, // VICTOR JIMENEZ
      { id: 127, min: 90, gol: 0, am: 0, rj: 0 }, // ALAN STEVEN
      { id: 122, min: 56, gol: 0, am: 0, rj: 0 }, // SERGIO LOBO
      { id: 126, min: 34, gol: 0, am: 0, rj: 0 }, // SAMUEL PLAZA (suplente)
      { id: 117, min: 90, gol: 0, am: 2, rj: 0 }, // IVAN ARIAS (2 amarillas)
    ],
  },

  // ── Partido 3: Ayer C.F. A 1 - 0 C. Europa B ─────────────────
  {
    nombre_local: 'AYER C.F',
    nombre_visitante: "C. EUROPA 'B'",
    goles_local: 1,
    goles_visitante: 0,
    cod_acta: '25756790',
    jugadores: [
      // Local (Ayer)
      { id: 37,  min: 58, gol: 1, am: 0, rj: 0 }, // ALEJANDRO SENDINO
      { id: 33,  min: 90, gol: 0, am: 0, rj: 0 }, // AITOR ANIDO
      { id: 38,  min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO SUTIL
      { id: 51,  min: 90, gol: 0, am: 0, rj: 0 }, // PABLO RODRIGUEZ
      { id: 40,  min: 90, gol: 0, am: 0, rj: 0 }, // JESUS JOAQUIN
      { id: 49,  min: 90, gol: 0, am: 0, rj: 0 }, // ENOL PATINO
      { id: 42,  min: 90, gol: 0, am: 0, rj: 0 }, // MARIO GONZALEZ
      { id: 39,  min: 90, gol: 0, am: 0, rj: 0 }, // PABLO LOPEZ
      { id: 34,  min: 90, gol: 0, am: 0, rj: 0 }, // PABLO BLANCO
      { id: 50,  min: 90, gol: 0, am: 0, rj: 0 }, // LUIS ALEJANDRO
      { id: 46,  min: 90, gol: 0, am: 1, rj: 0 }, // ADRIAN LOPEZ
      { id: 52,  min: 32, gol: 0, am: 0, rj: 0 }, // GABRIEL RUJAS (suplente)
      // Visitante (C. Europa B)
      { id: 97,  min: 90, gol: 0, am: 0, rj: 0 }, // SAMUEL CRESPO
      { id: 107, min: 90, gol: 0, am: 0, rj: 0 }, // BORJA PALACIO
      { id: 104, min: 90, gol: 0, am: 0, rj: 0 }, // CHRISTIAN NOVAL
      { id: 102, min: 90, gol: 0, am: 0, rj: 0 }, // DAVID MONTES
      { id: 114, min: 90, gol: 0, am: 0, rj: 0 }, // ANGEL MARTINEZ
      { id: 105, min: 90, gol: 0, am: 0, rj: 0 }, // NOEL ONIS
      { id: 98,  min: 90, gol: 0, am: 0, rj: 0 }, // RUBEN CRISTOBAL
      { id: 92,  min: 90, gol: 0, am: 0, rj: 0 }, // ARENA (Hugo Arena)
      { id: 106, min: 90, gol: 0, am: 1, rj: 0 }, // HUGO OTERO
      { id: 111, min: 90, gol: 0, am: 1, rj: 0 }, // MARIO SIERRA
      { id: 95,  min: 45, gol: 0, am: 0, rj: 0 }, // DIEGO CARRANZA (suplente)
      { id: 93,  min: 45, gol: 0, am: 1, rj: 0 }, // ALVARO AZORIN
    ],
  },

  // ── Partido 4: C.D. Santa Marina 3 - 2 Berron C.F. B ─────────
  {
    nombre_local: 'C.D SANTA MARINA',
    nombre_visitante: "BERRON C.F 'B'",
    goles_local: 3,
    goles_visitante: 2,
    cod_acta: '25756785',
    jugadores: [
      // Local (Santa Marina)
      { id: 161, min: 34, gol: 2, am: 0, rj: 0 }, // EL HADJI (suplente, 2 goles)
      { id: 162, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO VAZQUEZ
      { id: 154, min: 90, gol: 0, am: 0, rj: 0 }, // YAHYA KHOUMANE
      { id: 157, min: 90, gol: 0, am: 0, rj: 0 }, // MIGUEL GONZALEZ
      { id: 164, min: 90, gol: 0, am: 0, rj: 0 }, // MOISES VAZQUEZ
      { id: 160, min: 90, gol: 0, am: 0, rj: 0 }, // CHEIKH AHMADOU
      { id: 165, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO ZAPICO
      { id: 149, min: 56, gol: 0, am: 0, rj: 0 }, // MARCOS ALONSO
      { id: 159, min: 90, gol: 0, am: 1, rj: 0 }, // LUIS IGLESIAS
      { id: 150, min: 90, gol: 0, am: 1, rj: 0 }, // GERMAN ALVAREZ
      { id: 156, min: 90, gol: 0, am: 0, rj: 0 }, // DAVID GOMEZ (portero)
      // Visitante (Berron)
      { id: 79,  min: 90, gol: 1, am: 0, rj: 0 }, // HECTOR CANAL
      { id: 77,  min: 90, gol: 0, am: 0, rj: 0 }, // AARON TRIVER
      { id: 83,  min: 90, gol: 0, am: 0, rj: 0 }, // ISAAC CUETO
      { id: 84,  min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO FERNANDEZ
      { id: 81,  min: 90, gol: 0, am: 0, rj: 0 }, // GUILLERMO GIL
      { id: 88,  min: 90, gol: 0, am: 0, rj: 0 }, // ANGEL ORDOÑEZ
      { id: 85,  min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO GARCIA
      { id: 78,  min: 90, gol: 0, am: 0, rj: 0 }, // IVAN ALCALA
      { id: 90,  min: 90, gol: 0, am: 0, rj: 0 }, // WILMER RAFAEL
      { id: 86,  min: 45, gol: 0, am: 0, rj: 0 }, // FERNANDO
      { id: 80,  min: 90, gol: 0, am: 1, rj: 0 }, // FRANKLIN ELEAZAR
      { id: 89,  min: 45, gol: 0, am: 0, rj: 0 }, // NEL PIEDRA (suplente)
    ],
  },

  // ── Partido 5: U.D. Llanera B 0 - 2 Caudal Deportivo B ───────
  {
    nombre_local: "U.D LLANERA 'B'",
    nombre_visitante: "CAUDAL DPTO 'B'",
    goles_local: 0,
    goles_visitante: 2,
    cod_acta: '25756788',
    jugadores: [
      // Local (Llanera)
      { id: 271, min: 90, gol: 0, am: 0, rj: 0 }, // MIGUEL LAVAYOS
      { id: 274, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER MARTINEZ
      { id: 276, min: 90, gol: 0, am: 0, rj: 0 }, // MARIO ALVAREZ
      { id: 277, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO DIAZ
      { id: 278, min: 65, gol: 0, am: 0, rj: 0 }, // PABLO RODRIGUEZ
      { id: 279, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL NUÑO
      { id: 280, min: 90, gol: 0, am: 0, rj: 0 }, // MIGUEL RODRIGUEZ
      { id: 281, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO IGLESIAS (PELAYO IGLESIAS en acta)
      { id: 272, min: 90, gol: 0, am: 1, rj: 0 }, // SERGIO RODRIGUEZ
      { id: 275, min: 90, gol: 0, am: 1, rj: 0 }, // FERNANDO ORTEA
      { id: 286, min: 25, gol: 0, am: 0, rj: 0 }, // JOSE IGNACIO (suplente)
      { id: 273, min: 90, gol: 0, am: 1, rj: 1 }, // MARTIN FONSECA (am+rj = expulsado)
      // Visitante (Caudal)
      { id: 260, min: 45, gol: 1, am: 0, rj: 0 }, // DAVID GARCIA
      { id: 254, min: 90, gol: 0, am: 0, rj: 0 }, // HECTOR ALVAREZ
      { id: 255, min: 90, gol: 0, am: 0, rj: 0 }, // BRIAN SAMPAIO
      { id: 256, min: 90, gol: 0, am: 0, rj: 0 }, // LUCAS GARCIA
      { id: 257, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL RODRIGUEZ
      { id: 259, min: 90, gol: 0, am: 0, rj: 0 }, // ABEL GONZALEZ
      { id: 261, min: 90, gol: 0, am: 0, rj: 0 }, // SAMUEL VAZQUEZ
      { id: 262, min: 90, gol: 0, am: 0, rj: 0 }, // KEVIN MARTIN
      { id: 263, min: 90, gol: 0, am: 0, rj: 0 }, // NEL DEL CORRO
      { id: 258, min: 90, gol: 0, am: 1, rj: 0 }, // ISAAC MARTIN
      { id: 264, min: 90, gol: 0, am: 1, rj: 0 }, // IZAN GONZALEZ
      { id: 268, min: 45, gol: 0, am: 0, rj: 0 }, // GONZALO FERNANDEZ (suplente)
    ],
  },

  // ── Partido 6: Cultural Deportiva Aboño 2 - 4 C.N. Riaño ──────
  {
    nombre_local: 'C.D ABOÑO',
    nombre_visitante: 'C.N RIAÑO C.F',
    goles_local: 2,
    goles_visitante: 4,
    cod_acta: '25756784',
    jugadores: [
      // Local (Aboño)
      { id: 170, min: 90, gol: 1, am: 0, rj: 0 }, // IKER GARCIA
      { id: 171, min: 90, gol: 1, am: 1, rj: 0 }, // DANIEL FERNANDEZ
      { id: 167, min: 90, gol: 0, am: 0, rj: 0 }, // YASSIN EL YOUSFI
      { id: 173, min: 90, gol: 0, am: 0, rj: 0 }, // BORJA TRABADELO
      { id: 174, min: 90, gol: 0, am: 0, rj: 0 }, // HUGO CALVO
      { id: 175, min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN ESTRADA
      { id: 176, min: 90, gol: 0, am: 0, rj: 0 }, // PEDRO IYAN
      { id: 177, min: 90, gol: 0, am: 0, rj: 0 }, // NEL FERNANDEZ
      { id: 168, min: 57, gol: 0, am: 0, rj: 0 }, // DIEGO FERNANDEZ
      { id: 169, min: 90, gol: 0, am: 1, rj: 0 }, // DANIEL GONZALEZ
      { id: 172, min: 90, gol: 0, am: 1, rj: 0 }, // JAVIER NIETO
      { id: 180, min: 33, gol: 0, am: 0, rj: 1 }, // ADRIAN GONZALEZ (suplente, roja)
      // Visitante (C.N. Riaño)
      { id: 209, min: 90, gol: 2, am: 0, rj: 0 }, // RAUL ROMAN
      { id: 207, min: 90, gol: 1, am: 0, rj: 0 }, // ALEX VALENTIN
      { id: 210, min: 90, gol: 1, am: 0, rj: 0 }, // LUIS FERNANDO
      { id: 206, min: 90, gol: 0, am: 0, rj: 0 }, // JULIO ALVAREZ
      { id: 202, min: 90, gol: 0, am: 0, rj: 0 }, // YAGO FERNANDEZ
      { id: 203, min: 90, gol: 0, am: 0, rj: 0 }, // JOSE MARCELINO
      { id: 205, min: 90, gol: 0, am: 0, rj: 0 }, // MAURO FANJUL
      { id: 211, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO CALDEVILLA
      { id: 201, min: 90, gol: 0, am: 1, rj: 0 }, // ALEJANDRO VIESCA
      { id: 208, min: 90, gol: 0, am: 1, rj: 0 }, // FRANCISCO JAVIER
      { id: 216, min: 45, gol: 0, am: 0, rj: 0 }, // ANTON GARCIA (suplente)
      { id: 204, min: 45, gol: 0, am: 1, rj: 0 }, // GABRIEL INSUA
    ],
  },

  // ── Partido 7: S.D. Lenense B 3 - 3 Lada Langreo C.F. B ──────
  {
    nombre_local: "S.D LENENSE 'B'",
    nombre_visitante: "LADA LANGREO C.F 'B'",
    goles_local: 3,
    goles_visitante: 3,
    cod_acta: '25756786',
    jugadores: [
      // Local (Lenense)
      { id: 229, min: 90, gol: 1, am: 0, rj: 0 }, // MANUEL FLOREZ
      { id: 226, min: 90, gol: 0, am: 0, rj: 0 }, // IZAN GARCIA
      { id: 219, min: 90, gol: 0, am: 0, rj: 0 }, // MATEO VIESCA
      { id: 220, min: 90, gol: 0, am: 0, rj: 0 }, // ELIAS BARRAGAN
      { id: 221, min: 90, gol: 0, am: 0, rj: 0 }, // JORGE ALVAREZ
      { id: 222, min: 90, gol: 0, am: 0, rj: 0 }, // JORGE LOPEZ
      { id: 223, min: 90, gol: 0, am: 0, rj: 0 }, // GABINO GOMEZ
      { id: 225, min: 90, gol: 0, am: 0, rj: 0 }, // CHRISTIAN ALVAREZ
      { id: 227, min: 90, gol: 0, am: 0, rj: 0 }, // UNAI FRAILE
      { id: 224, min: 90, gol: 0, am: 1, rj: 0 }, // DIEGO ALDARIZ
      { id: 228, min: 54, gol: 0, am: 0, rj: 0 }, // IVAN BARRIO
      { id: 230, min: 36, gol: 0, am: 0, rj: 0 }, // ALBERTO FLOREZ (suplente)
      // Visitante (Lada Langreo)
      { id: 240, min: 45, gol: 2, am: 0, rj: 0 }, // LUIS MARIANO (2 goles)
      { id: 236, min: 90, gol: 0, am: 0, rj: 0 }, // JON ANDER
      { id: 237, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO MARTINEZ
      { id: 239, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO FERNANDEZ
      { id: 241, min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN NUÑEZ
      { id: 242, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO MENENDEZ
      { id: 243, min: 90, gol: 0, am: 0, rj: 0 }, // NAYIN BARRAL
      { id: 244, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO GONZALEZ
      { id: 245, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO TRAPIELLO
      { id: 238, min: 90, gol: 0, am: 1, rj: 0 }, // JEAN PIERRE
      { id: 246, min: 90, gol: 0, am: 1, rj: 0 }, // NOEL SUAREZ
      { id: 252, min: 45, gol: 0, am: 1, rj: 0 }, // MARIO VAZ (suplente)
    ],
  },
];

// ── Función equivalente a la del admin route ──────────────────────
async function determinarPorteriaCero(client, idJugador, nombreLocal, nombreVisitante, golesLocal, golesVisitante) {
  const { rows } = await client.query(
    `SELECT er.nombre AS equipo
     FROM jugadores j
     JOIN equipos_reales er ON er.id = j.id_equipo_real
     WHERE j.id = $1`,
    [idJugador]
  );
  if (!rows.length) return false;
  const equipo = rows[0].equipo.toUpperCase();
  if (equipo === nombreLocal.toUpperCase()) return golesVisitante === 0;
  if (equipo === nombreVisitante.toUpperCase()) return golesLocal === 0;
  return false;
}

async function determinarGolesEncajados(client, idJugador, nombreLocal, nombreVisitante, golesLocal, golesVisitante) {
  const { rows } = await client.query(
    `SELECT er.nombre AS equipo
     FROM jugadores j
     JOIN equipos_reales er ON er.id = j.id_equipo_real
     WHERE j.id = $1`,
    [idJugador]
  );
  if (!rows.length) return 0;
  const equipo = rows[0].equipo.toUpperCase();
  if (equipo === nombreLocal.toUpperCase()) return golesVisitante ?? 0;
  if (equipo === nombreVisitante.toUpperCase()) return golesLocal ?? 0;
  return 0;
}

async function insertarPartido(client, partido) {
  const { nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta, jugadores } = partido;

  // Upsert partido
  const { rows: partRows } = await client.query(
    `INSERT INTO partidos
       (id_jornada, nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta, fuente, procesado)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', TRUE)
     ON CONFLICT (id_jornada, nombre_local, nombre_visitante) DO UPDATE
       SET goles_local = EXCLUDED.goles_local, goles_visitante = EXCLUDED.goles_visitante, procesado = TRUE
     RETURNING id`,
    [ID_JORNADA, nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta]
  );
  const idPartido = partRows[0].id;

  // Limpiar estadísticas previas
  await client.query(
    `DELETE FROM estadisticas
     WHERE id_jornada = $1
       AND id_jugador IN (
         SELECT j.id FROM jugadores j
         JOIN equipos_reales er ON er.id = j.id_equipo_real
         WHERE UPPER(er.nombre) = UPPER($2) OR UPPER(er.nombre) = UPPER($3)
       )`,
    [ID_JORNADA, nombre_local, nombre_visitante]
  );

  // Insertar estadísticas
  let insertados = 0;
  for (const j of jugadores) {
    const pcero = await determinarPorteriaCero(client, j.id, nombre_local, nombre_visitante, goles_local, goles_visitante);
    const golesEnc = await determinarGolesEncajados(client, j.id, nombre_local, nombre_visitante, goles_local, goles_visitante);

    await client.query(
      `INSERT INTO estadisticas
         (id_jugador, id_jornada, id_partido, minutos_jugados, goles, goles_propio,
          amarillas, rojas, porteria_cero, goles_encajados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [j.id, ID_JORNADA, idPartido, j.min, j.gol, 0, j.am, j.rj, pcero, golesEnc]
    );
    insertados++;
  }

  return { idPartido, insertados };
}

async function main() {
  const client = await pool.connect();
  try {
    for (const partido of partidos) {
      await client.query('BEGIN');
      try {
        const { idPartido, insertados } = await insertarPartido(client, partido);
        await client.query('COMMIT');
        console.log(`✓ ${partido.nombre_local} ${partido.goles_local}-${partido.goles_visitante} ${partido.nombre_visitante} → id_partido=${idPartido}, ${insertados} estadísticas`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${partido.nombre_local} vs ${partido.nombre_visitante}: ${err.message}`);
      }
    }
    console.log('\nListo.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
