/**
 * Script para insertar los 8 partidos de la Jornada 2
 * Jornada 2 → id_jornada = 3
 */
import { pool } from '../src/db/pool.js';

const ID_JORNADA = 3;

// Jugadores no encontrados en BD (nuevos, se omiten):
//  MORAN GARCIA PABLO (Real Titánico), LORENZO CANTELI ALEJANDRO (Llanera),
//  IZAGUIRRE GUZMÁN / BERJANO ALEN (Riaño), CRESPO PAZOS ADRIEL (Iberia suplente),
//  ROCES VENA YERAI / IZQUIER RODRIGUEZ ADRIAN (Lada), JORGE MENENDEZ PABLO (Santa Marina),
//  ALVAREZ MARTINEZ ALVARO (Lenense), BARROS GONZALEZ NICOLAS / GONZALEZ BERNARDO SAMUEL (Caudal),
//  SAS AMEZ MARCO / SERRANO ALVAREZ MIGUEL (Carbayin), ESTRADA VELASCO MAXIMINO (Ayer),
//  ESTRADA MARTINEZ MARIO / IGLESIAS CARBAJALES ALEJANDRO / CORDERO DIAZ MOISES (Berrón/Aboño)

const partidos = [
  // ── Partido 1: Real Titánico B 3 - 0 U.D. Llanera B ─────────
  {
    nombre_local: "REAL TITANICO 'B'",
    nombre_visitante: "U.D LLANERA 'B'",
    goles_local: 3,
    goles_visitante: 0,
    cod_acta: '25756798',
    jugadores: [
      // Local (Real Titánico)
      { id: 326, min: 90, gol: 1, am: 0, rj: 0 }, // DIEGO FERNANDEZ (FERNÁNDEZ BUENO)
      { id: 325, min: 90, gol: 1, am: 1, rj: 0 }, // CRISTIAN MONTILLA
      { id: 332, min: 45, gol: 1, am: 0, rj: 0 }, // JOSE ALEJANDRO (suplente, gol)
      { id: 323, min: 90, gol: 0, am: 0, rj: 0 }, // NICOLAS ALVAREZ
      { id: 319, min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN PELAEZ
      { id: 320, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER GUERRERO
      // MORAN GARCIA PABLO → no está en BD, se omite
      { id: 321, min: 90, gol: 0, am: 0, rj: 0 }, // NOEL CANTELI
      { id: 327, min: 90, gol: 0, am: 0, rj: 0 }, // IKER FERNANDEZ
      { id: 329, min: 90, gol: 0, am: 0, rj: 0 }, // YAGO CASTAÑO
      { id: 322, min: 90, gol: 0, am: 1, rj: 0 }, // MANUEL FERNANDEZ
      { id: 328, min: 45, gol: 0, am: 1, rj: 0 }, // ENZO GERMAN
      // Visitante (U.D. Llanera B)
      { id: 282, min: 90, gol: 0, am: 0, rj: 0 }, // NEL SERRANO
      { id: 283, min: 90, gol: 0, am: 0, rj: 0 }, // RUBEN SERRANO
      { id: 273, min: 90, gol: 0, am: 0, rj: 0 }, // MARTIN FONSECA
      { id: 274, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER MARTINEZ
      // LORENZO CANTELI ALEJANDRO → no está en BD, se omite
      { id: 275, min: 90, gol: 0, am: 0, rj: 0 }, // FERNANDO ORTEA
      { id: 276, min: 90, gol: 0, am: 0, rj: 0 }, // MARIO ALVAREZ
      { id: 278, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO RODRIGUEZ
      { id: 279, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL NUÑO
      { id: 286, min: 90, gol: 0, am: 0, rj: 0 }, // JOSE IGNACIO (LLAMES)
      { id: 284, min: 41, gol: 0, am: 0, rj: 0 }, // OLIVER MONTESERIN
      { id: 271, min: 49, gol: 0, am: 0, rj: 0 }, // MIGUEL LAVAYOS (suplente)
    ],
  },

  // ── Partido 2: C.N. Riaño C.F. A 3 - 1 C.D. San Luis ────────
  {
    nombre_local: 'C.N RIAÑO C.F',
    nombre_visitante: 'C.D SAN LUIS',
    goles_local: 3,
    goles_visitante: 1,
    cod_acta: '25756793',
    jugadores: [
      // Local (C.N. Riaño)
      // IZAGUIRRE RODRÍGUEZ GUZMÁN → no está en BD, se omite
      { id: 211, min: 45, gol: 1, am: 0, rj: 0 }, // PABLO CALDEVILLA (gol)
      { id: 212, min: 90, gol: 0, am: 0, rj: 0 }, // MARIO FRANCISCO
      { id: 213, min: 90, gol: 0, am: 0, rj: 0 }, // RAFAEL DA ROCHA
      { id: 214, min: 90, gol: 0, am: 0, rj: 0 }, // MATEUSZ DAWID
      { id: 216, min: 90, gol: 0, am: 0, rj: 0 }, // ANTON GARCIA
      { id: 208, min: 90, gol: 0, am: 0, rj: 0 }, // FRANCISCO JAVIER (AUGUSTO COSTALES)
      { id: 209, min: 90, gol: 0, am: 0, rj: 0 }, // RAUL ROMAN
      { id: 218, min: 90, gol: 0, am: 0, rj: 0 }, // MARCOS ALBERTO
      { id: 203, min: 90, gol: 0, am: 1, rj: 0 }, // JOSE MARCELINO (BLANS)
      { id: 204, min: 90, gol: 0, am: 1, rj: 0 }, // GABRIEL INSUA
      // BERJANO GARCIA ALEN → no está en BD, se omite
      // Visitante (C.D. San Luis)
      { id: 184, min: 90, gol: 1, am: 0, rj: 0 }, // NEL LOREDO (gol visitante)
      { id: 196, min: 90, gol: 0, am: 0, rj: 0 }, // MENEDEZ DANIEL (DANIEL GARCIA)
      { id: 191, min: 90, gol: 0, am: 0, rj: 0 }, // DAVID BRAGA
      { id: 190, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER MORENO
      { id: 185, min: 90, gol: 0, am: 1, rj: 0 }, // JAVIER VAZQUEZ
      { id: 187, min: 90, gol: 0, am: 1, rj: 0 }, // AITOR GONZALEZ
      { id: 188, min: 90, gol: 0, am: 1, rj: 0 }, // MARIO RIERA
      { id: 189, min: 90, gol: 0, am: 1, rj: 0 }, // IZAN MARTINEZ
      { id: 192, min: 45, gol: 0, am: 0, rj: 0 }, // JAVIER MARCOS
      { id: 193, min: 90, gol: 0, am: 1, rj: 0 }, // ISAAC SUAREZ
      { id: 200, min: 90, gol: 0, am: 1, rj: 0 }, // DIALLO MAMADOU
      { id: 198, min: 45, gol: 0, am: 0, rj: 0 }, // AIMAR GARCIA (suplente)
    ],
  },

  // ── Partido 3: C. Europa B 0 - 2 Iberia C.F. A ──────────────
  {
    nombre_local: "C. EUROPA 'B'",
    nombre_visitante: 'IBERIA C.F',
    goles_local: 0,
    goles_visitante: 2,
    cod_acta: '25756799',
    jugadores: [
      // Local (C. Europa B)
      { id: 110, min: 90, gol: 0, am: 0, rj: 0 }, // JAVIER RODRIGUEZ (PERUYERO)
      { id: 97,  min: 90, gol: 0, am: 0, rj: 0 }, // SAMUEL CRESPO
      { id: 107, min: 90, gol: 0, am: 0, rj: 0 }, // BORJA PALACIO
      { id: 104, min: 90, gol: 0, am: 0, rj: 0 }, // CHRISTIAN NOVAL
      { id: 108, min: 90, gol: 0, am: 0, rj: 0 }, // AITOR PIQUERO
      { id: 114, min: 90, gol: 0, am: 0, rj: 0 }, // ANGEL MARTINEZ
      { id: 105, min: 90, gol: 0, am: 0, rj: 0 }, // NOEL ONIS
      { id: 98,  min: 90, gol: 0, am: 0, rj: 0 }, // RUBEN CRISTOBAL
      { id: 92,  min: 90, gol: 0, am: 0, rj: 0 }, // ARENA (Hugo)
      { id: 111, min: 90, gol: 0, am: 0, rj: 0 }, // MARIO SIERRA
      { id: 112, min: 45, gol: 0, am: 0, rj: 0 }, // HECTOR SOLIS
      { id: 99,  min: 45, gol: 0, am: 0, rj: 0 }, // JUAN GONZALEZ (suplente)
      // Visitante (Iberia C.F.)
      { id: 306, min: 90, gol: 1, am: 0, rj: 0 }, // MARCOS ANTUÑA (gol)
      { id: 318, min: 90, gol: 1, am: 0, rj: 0 }, // JOSE GARCIA (gol) - GARCIA MERE
      { id: 314, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL GUZMAN (Guzmán Martinez)
      { id: 302, min: 90, gol: 0, am: 0, rj: 0 }, // PELAYO SANDINO
      { id: 308, min: 60, gol: 0, am: 0, rj: 0 }, // HECTOR TOYOS
      { id: 309, min: 90, gol: 0, am: 0, rj: 0 }, // AARON GARCIA
      { id: 310, min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO GARCIA
      { id: 315, min: 90, gol: 0, am: 0, rj: 0 }, // DENIS DIAZ (DIAZ RUBIO)
      { id: 316, min: 90, gol: 0, am: 0, rj: 0 }, // CHRISTIAN FERNANDEZ (DE BONIS)
      { id: 303, min: 90, gol: 0, am: 1, rj: 0 }, // ANGEL FERNANDEZ (ORVIZ)
      { id: 305, min: 90, gol: 0, am: 1, rj: 0 }, // IBAI FABIAN
      // CRESPO PAZOS ADRIEL → no está en BD, se omite
    ],
  },

  // ── Partido 4: Lada Langreo C.F. B 4 - 5 C.D. Santa Marina ──
  {
    nombre_local: "LADA LANGREO C.F 'B'",
    nombre_visitante: 'C.D SANTA MARINA',
    goles_local: 4,
    goles_visitante: 5,
    cod_acta: '25756795',
    jugadores: [
      // Local (Lada Langreo)
      { id: 243, min: 90, gol: 2, am: 0, rj: 0 }, // NAYIN BARRAL (2 goles)
      { id: 236, min: 90, gol: 0, am: 0, rj: 0 }, // JON ANDER
      { id: 237, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO MARTINEZ
      // ROCES VENA YERAI → no está en BD, se omite
      { id: 239, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO FERNANDEZ
      { id: 240, min: 90, gol: 0, am: 0, rj: 0 }, // LUIS MARIANO
      // IZQUIER RODRIGUEZ ADRIAN → no está en BD, se omite
      { id: 253, min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO BEDIC
      { id: 245, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO TRAPIELLO
      { id: 241, min: 70, gol: 0, am: 0, rj: 0 }, // ADRIAN NUÑEZ (suplente)
      { id: 238, min: 90, gol: 0, am: 1, rj: 0 }, // JEAN PIERRE
      { id: 246, min: 20, gol: 0, am: 0, rj: 0 }, // NOEL SUAREZ
      // Visitante (C.D. Santa Marina)
      { id: 164, min: 45, gol: 3, am: 1, rj: 0 }, // MOISES VAZQUEZ (suplente, 3 goles, am)
      // JORGE MENENDEZ PABLO → no está en BD, su gol no se puede atribuir
      { id: 161, min: 90, gol: 1, am: 1, rj: 0 }, // EL HADJI (gol, am)
      { id: 162, min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO VAZQUEZ
      { id: 156, min: 90, gol: 0, am: 0, rj: 0 }, // DAVID GOMEZ
      { id: 155, min: 90, gol: 0, am: 0, rj: 0 }, // RUBEN FREIRE
      { id: 150, min: 90, gol: 0, am: 0, rj: 0 }, // GERMAN ALVAREZ
      { id: 157, min: 90, gol: 0, am: 0, rj: 0 }, // MIGUEL GONZALEZ
      { id: 160, min: 90, gol: 0, am: 0, rj: 0 }, // CHEIKH AHMADOU
      { id: 165, min: 90, gol: 0, am: 0, rj: 0 }, // PABLO ZAPICO
      { id: 152, min: 45, gol: 0, am: 1, rj: 0 }, // GABRIEL BORGES
      { id: 336, min: 90, gol: 0, am: 0, rj: 1 }, // MOHAMMED KAMARA (roja)
    ],
  },

  // ── Partido 5: Campomanes A 1 - 1 S.D. Lenense B ────────────
  {
    nombre_local: 'SCD CAMPOMANES',
    nombre_visitante: "S.D LENENSE 'B'",
    goles_local: 1,
    goles_visitante: 1,
    cod_acta: '25756796',
    jugadores: [
      // Local (Campomanes) — quién marcó el gol local no aparece explícitamente en el acta
      { id: 60,  min: 90, gol: 0, am: 0, rj: 0 }, // IVAN FERNANDEZ
      { id: 63,  min: 90, gol: 0, am: 0, rj: 0 }, // MANUEL GARCIA
      { id: 71,  min: 90, gol: 0, am: 0, rj: 0 }, // IVÁN SAL
      { id: 68,  min: 90, gol: 0, am: 0, rj: 0 }, // GASPAR PRIETO
      { id: 166, min: 90, gol: 0, am: 0, rj: 0 }, // SERGIO QUIROS
      { id: 58,  min: 90, gol: 0, am: 0, rj: 0 }, // CRISTIAN ESPINEDO
      { id: 75,  min: 90, gol: 0, am: 0, rj: 0 }, // FELIPE TUÑÓN
      { id: 65,  min: 90, gol: 0, am: 0, rj: 0 }, // AITOR GONZALEZ
      { id: 57,  min: 45, gol: 0, am: 0, rj: 0 }, // ANTONIO AUGUSTO
      { id: 64,  min: 90, gol: 0, am: 1, rj: 0 }, // PABLO GONZALEZ
      { id: 72,  min: 45, gol: 0, am: 0, rj: 0 }, // JAIME SALAN (suplente)
      { id: 69,  min: 90, gol: 0, am: 0, rj: 1 }, // MIGUEL PRIETO (roja)
      // Visitante (S.D. Lenense B)
      { id: 221, min: 90, gol: 1, am: 0, rj: 0 }, // JORGE ALVAREZ (gol visitante)
      // ALVAREZ MARTINEZ ALVARO → no está en BD, se omite
      { id: 219, min: 90, gol: 0, am: 0, rj: 0 }, // MATEO VIESCA
      { id: 220, min: 90, gol: 0, am: 0, rj: 0 }, // ELIAS BARRAGAN
      { id: 222, min: 90, gol: 0, am: 0, rj: 0 }, // JORGE LOPEZ
      { id: 225, min: 90, gol: 0, am: 0, rj: 0 }, // CHRISTIAN ALVAREZ
      { id: 227, min: 90, gol: 0, am: 0, rj: 0 }, // UNAI FRAILE
      { id: 228, min: 90, gol: 0, am: 0, rj: 0 }, // IVAN BARRIO
      { id: 223, min: 90, gol: 0, am: 1, rj: 0 }, // GABINO GOMEZ
      { id: 224, min: 90, gol: 0, am: 1, rj: 0 }, // DIEGO ALDARIZ
      { id: 235, min: 45, gol: 0, am: 0, rj: 0 }, // ENOL ARGUELLES
      { id: 232, min: 45, gol: 0, am: 0, rj: 0 }, // IVAN FERNANDEZ (suplente)
    ],
  },

  // ── Partido 6: Caudal Deportivo B 5 - 0 Rayo Carbayin ────────
  {
    nombre_local: "CAUDAL DPTO 'B'",
    nombre_visitante: 'RAYO CARBAYIN C.F',
    goles_local: 5,
    goles_visitante: 0,
    cod_acta: '25756797',
    jugadores: [
      // Local (Caudal)
      { id: 264, min: 90, gol: 2, am: 0, rj: 0 }, // IZAN GONZALEZ (2 goles)
      // BARROS GONZALEZ NICOLAS → no está en BD, se omite (2 goles suplente)
      { id: 263, min: 90, gol: 1, am: 0, rj: 0 }, // NEL DEL CORRO (1 gol)
      // GONZALEZ BERNARDO SAMUEL → no está en BD, se omite
      { id: 266, min: 90, gol: 0, am: 0, rj: 0 }, // YONATHAN EMMANUEL
      { id: 257, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL RODRIGUEZ
      { id: 258, min: 90, gol: 0, am: 0, rj: 0 }, // ISAAC MARTIN
      { id: 268, min: 90, gol: 0, am: 0, rj: 0 }, // GONZALO FERNANDEZ
      { id: 260, min: 90, gol: 0, am: 0, rj: 0 }, // DAVID GARCIA
      { id: 262, min: 90, gol: 0, am: 0, rj: 0 }, // KEVIN MARTIN
      { id: 265, min: 90, gol: 0, am: 1, rj: 0 }, // IYAN MARTINEZ
      { id: 261, min: 45, gol: 0, am: 0, rj: 0 }, // SAMUEL VAZQUEZ
      // Visitante (Rayo Carbayin)
      { id: 299, min: 90, gol: 0, am: 0, rj: 0 }, // BRAULIO JAVIER
      { id: 294, min: 90, gol: 0, am: 0, rj: 0 }, // THIAGO RODRIGUES
      { id: 296, min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO MARTINEZ
      // SAS AMEZ MARCO → no está en BD, se omite
      { id: 295, min: 90, gol: 0, am: 0, rj: 0 }, // RUBEN VILLANUEVA
      { id: 290, min: 90, gol: 0, am: 0, rj: 0 }, // RAFAEL BEDIA
      { id: 289, min: 90, gol: 0, am: 0, rj: 0 }, // PELAYO CUETO
      { id: 297, min: 90, gol: 0, am: 1, rj: 0 }, // ADRIAN ALVAREZ (Alvarez Boto)
      { id: 292, min: 59, gol: 0, am: 0, rj: 0 }, // ROMARIO YAIR
      { id: 288, min: 90, gol: 0, am: 1, rj: 0 }, // ANTONIO MARTINEZ
      { id: 293, min: 31, gol: 0, am: 0, rj: 0 }, // GABRIEL MARTINEZ (suplente)
      // SERRANO ALVAREZ MIGUEL → no está en BD, se omite (roja)
    ],
  },

  // ── Partido 7: C.D. Riosa A 2 - 1 Ayer C.F. A ──────────────
  {
    nombre_local: 'C.D RIOSA',
    nombre_visitante: 'AYER C.F',
    goles_local: 2,
    goles_visitante: 1,
    cod_acta: '25756800',
    jugadores: [
      // Local (C.D. Riosa)
      { id: 130, min: 90, gol: 1, am: 0, rj: 0 }, // SANTIAGO FERNANDEZ
      { id: 143, min: 90, gol: 1, am: 1, rj: 0 }, // JOAQUIN RATO
      { id: 140, min: 90, gol: 0, am: 0, rj: 0 }, // ALVARO PEREZ (PEREZ ROJO)
      { id: 147, min: 90, gol: 0, am: 0, rj: 0 }, // PELAYO VIGIL
      { id: 145, min: 90, gol: 0, am: 0, rj: 0 }, // ENOL RODRIGUEZ
      { id: 139, min: 90, gol: 0, am: 0, rj: 0 }, // MIGUEL MARTINEZ
      { id: 132, min: 90, gol: 0, am: 0, rj: 0 }, // ALBERTO DIAZ
      { id: 141, min: 90, gol: 0, am: 0, rj: 0 }, // ALVARO PEREZ (PEREZ FERNANDEZ)
      { id: 133, min: 90, gol: 0, am: 0, rj: 0 }, // VICTOR ESTRADA
      { id: 137, min: 45, gol: 0, am: 0, rj: 0 }, // JAIME GRANDE (GRANDA)
      { id: 136, min: 45, gol: 0, am: 0, rj: 0 }, // LUCAS GARCIA (suplente)
      { id: 146, min: 90, gol: 0, am: 0, rj: 1 }, // ALFREDO SUAREZ (roja)
      // Visitante (Ayer C.F.)
      { id: 40,  min: 90, gol: 1, am: 0, rj: 0 }, // JESUS JOAQUIN (gol)
      { id: 33,  min: 90, gol: 0, am: 0, rj: 0 }, // AITOR ANIDO
      { id: 38,  min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO SUTIL
      { id: 51,  min: 90, gol: 0, am: 0, rj: 0 }, // PABLO RODRIGUEZ
      // ESTRADA VELASCO MAXIMINO → no está en BD, se omite
      { id: 49,  min: 90, gol: 0, am: 0, rj: 0 }, // ENOL PATINO
      { id: 39,  min: 90, gol: 0, am: 0, rj: 0 }, // PABLO LOPEZ
      { id: 52,  min: 90, gol: 0, am: 0, rj: 0 }, // GABRIEL RUJAS
      { id: 46,  min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN LOPEZ
      { id: 50,  min: 90, gol: 0, am: 0, rj: 0 }, // LUIS ALEJANDRO
      { id: 42,  min: 45, gol: 0, am: 0, rj: 0 }, // MARIO GONZALEZ (suplente)
      { id: 47,  min: 45, gol: 0, am: 1, rj: 0 }, // PABLO MENENDEZ
    ],
  },

  // ── Partido 8: Berrón C.F. B 3 - 4 Cultural Deportiva Aboño ─
  {
    nombre_local: "BERRON C.F 'B'",
    nombre_visitante: 'C.D ABOÑO',
    goles_local: 3,
    goles_visitante: 4,
    cod_acta: '25756794',
    jugadores: [
      // Local (Berrón)
      { id: 80,  min: 90, gol: 1, am: 0, rj: 0 }, // FRANKLIN ELEAZAR
      { id: 79,  min: 90, gol: 1, am: 0, rj: 0 }, // HECTOR CANAL
      { id: 90,  min: 90, gol: 1, am: 0, rj: 0 }, // WILMER RAFAEL
      // ESTRADA MARTINEZ MARIO → no está en BD, se omite
      { id: 84,  min: 90, gol: 0, am: 0, rj: 0 }, // ALEJANDRO FERNANDEZ
      { id: 81,  min: 90, gol: 0, am: 0, rj: 0 }, // GUILLERMO GIL
      { id: 85,  min: 90, gol: 0, am: 0, rj: 0 }, // DIEGO GARCIA
      { id: 86,  min: 90, gol: 0, am: 0, rj: 0 }, // FERNANDO
      { id: 78,  min: 90, gol: 0, am: 0, rj: 0 }, // IVAN ALCALA
      { id: 83,  min: 45, gol: 0, am: 0, rj: 0 }, // ISAAC CUETO
      { id: 88,  min: 90, gol: 0, am: 1, rj: 0 }, // ANGEL ORDOÑEZ
      { id: 87,  min: 45, gol: 0, am: 0, rj: 0 }, // MIGUEL ANGEL (suplente)
      // Visitante (C.D. Aboño)
      { id: 170, min: 90, gol: 2, am: 0, rj: 0 }, // IKER GARCIA (2 goles)
      { id: 168, min: 90, gol: 1, am: 0, rj: 0 }, // DIEGO FERNANDEZ (HEVIA)
      { id: 181, min: 90, gol: 1, am: 0, rj: 0 }, // PELAYO CANELLA
      { id: 167, min: 90, gol: 0, am: 0, rj: 0 }, // YASSIN EL YOUSFI
      { id: 176, min: 90, gol: 0, am: 0, rj: 0 }, // PEDRO IYAN
      { id: 169, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL GONZALEZ
      { id: 171, min: 90, gol: 0, am: 0, rj: 0 }, // DANIEL FERNANDEZ
      { id: 173, min: 90, gol: 0, am: 0, rj: 0 }, // BORJA TRABADELO
      { id: 175, min: 90, gol: 0, am: 0, rj: 0 }, // ADRIAN ESTRADA
      // IGLESIAS CARBAJALES ALEJANDRO → no está en BD, se omite
      // CORDERO DÍAZ MOISES → no está en BD, se omite
      { id: 177, min: 30, gol: 0, am: 1, rj: 0 }, // NEL FERNANDEZ (suplente, am)
    ],
  },
];

// ── Helpers (misma lógica que admin route) ─────────────────────
async function getEquipoJugador(client, idJugador) {
  const { rows } = await client.query(
    `SELECT er.nombre FROM jugadores j JOIN equipos_reales er ON er.id = j.id_equipo_real WHERE j.id = $1`,
    [idJugador]
  );
  return rows[0]?.nombre?.toUpperCase() ?? null;
}

async function insertarPartido(client, partido) {
  const { nombre_local, nombre_visitante, goles_local, goles_visitante, cod_acta, jugadores } = partido;

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

  // Deduplicar por id_jugador (en caso de duplicados en el array)
  const vistos = new Set();
  let insertados = 0;
  for (const j of jugadores) {
    if (vistos.has(j.id)) continue;
    vistos.add(j.id);

    const equipo = await getEquipoJugador(client, j.id);
    const esLocal = equipo === nombre_local.toUpperCase();
    const esVisitante = equipo === nombre_visitante.toUpperCase();
    const pcero = esLocal ? goles_visitante === 0 : esVisitante ? goles_local === 0 : false;
    const golesEnc = esLocal ? (goles_visitante ?? 0) : esVisitante ? (goles_local ?? 0) : 0;

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
        console.log(`✓ ${partido.nombre_local} ${partido.goles_local}-${partido.goles_visitante} ${partido.nombre_visitante} → id=${idPartido}, ${insertados} stats`);
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
