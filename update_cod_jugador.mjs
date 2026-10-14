/**
 * Script: actualizar cod_jugador en la BD usando los datos del scraper de jornada 5.
 * Estrategia de matching por equipo + nombre (prefijo NOMBRE APELLIDO1).
 */
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_HEALi7TGrsF9@ep-cold-hat-b1aszth2.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false },
});

// Lista de jugadores no encontrados en el último import de jornada 5
const noEncontrados = [
  { nombre: "ALVAREZ MARTINEZ, ALVARO", equipo: "S.D. Lenense Proinastur B", cod: "9532096" },
  { nombre: "VIESCA ALVAREZ, MATEO", equipo: "S.D. Lenense Proinastur B", cod: "23794944" },
  { nombre: "ALVAREZ QUIROS, JORGE", equipo: "S.D. Lenense Proinastur B", cod: "23802257" },
  { nombre: "FLOREZ NUÑEZ, ALBERTO", equipo: "S.D. Lenense Proinastur B", cod: "17936920" },
  { nombre: "LOPEZ OTERO, JORGE", equipo: "S.D. Lenense Proinastur B", cod: "2240430" },
  { nombre: "GOMEZ GRANDOSO, GABINO", equipo: "S.D. Lenense Proinastur B", cod: "21806690" },
  { nombre: "ALDARIZ ALVAREZ, DIEGO", equipo: "S.D. Lenense Proinastur B", cod: "23798351" },
  { nombre: "RODRIGUEZ FERNANDEZ, PELAYO", equipo: "S.D. Lenense Proinastur B", cod: "24755723" },
  { nombre: "FRAILE ALONSO, UNAI", equipo: "S.D. Lenense Proinastur B", cod: "23802757" },
  { nombre: "FLOREZ NUÑEZ, MANUEL", equipo: "S.D. Lenense Proinastur B", cod: "23795762" },
  { nombre: "PULGAR FERNANDEZ, GAEL", equipo: "S.D. Lenense Proinastur B", cod: "9531174" },
  { nombre: "OTERO REDONDO, HUGO", equipo: "C. Europa B", cod: "22366918" },
  { nombre: "PALACIO CUELLO, BORJA", equipo: "C. Europa B", cod: "22366901" },
  { nombre: "AZORIN ORTUÑO, ALVARO", equipo: "C. Europa B", cod: "23794176" },
  { nombre: "CARRANZA LLAMEDO, DIEGO", equipo: "C. Europa B", cod: "23792259" },
  { nombre: "MONTES FONCUEVA, DAVID", equipo: "C. Europa B", cod: "22645641" },
  { nombre: "ONIS VEGA, NOEL", equipo: "C. Europa B", cod: "22394018" },
  { nombre: "CRISTOBAL NICOLAS, RUBEN", equipo: "C. Europa B", cod: "9531418" },
  { nombre: "ARENA ALVAREZ, HUGO", equipo: "C. Europa B", cod: "9676392" },
  { nombre: "SOLIS CRESPO, HECTOR", equipo: "C. Europa B", cod: "17938061" },
  { nombre: "GONZALEZ PANDIELLA, SAMUEL", equipo: "C. Europa B", cod: "9531074" },
  { nombre: "SIERRA SANCHEZ, MARIO", equipo: "C. Europa B", cod: "23790720" },
  { nombre: "CRESPO MEGIDO, SAMUEL", equipo: "C. Europa B", cod: "21722073" },
  { nombre: "ALVAREZ FERNANDEZ, JULIO", equipo: "C.N.Riaño C.F. A", cod: "23792474" },
  { nombre: "VIESCA SOBERO, ALEJANDRO", equipo: "C.N.Riaño C.F. A", cod: "17934369" },
  { nombre: "VALVUENA RIVERA, JOSE MANUEL", equipo: "C.N.Riaño C.F. A", cod: "9532447" },
  { nombre: "INSUA ALVAREZ, GABRIEL", equipo: "C.N.Riaño C.F. A", cod: "23793917" },
  { nombre: "IZAGUIRRE RODRÍGUEZ, GUZMÁN", equipo: "C.N.Riaño C.F. A", cod: "23793729" },
  { nombre: "FANJUL ALVAREZ, MAURO", equipo: "C.N.Riaño C.F. A", cod: "2179802" },
  { nombre: "LOPEZ ALVAREZ, ALVARO", equipo: "C.N.Riaño C.F. A", cod: "23794009" },
  { nombre: "BERJANO GARCIA, ALEN", equipo: "C.N.Riaño C.F. A", cod: "23800529" },
  { nombre: "AUGUSTO COSTALES, FRANCISCO JAVIER", equipo: "C.N.Riaño C.F. A", cod: "23797060" },
  { nombre: "ROMAN CASTELLANOS, RAUL", equipo: "C.N.Riaño C.F. A", cod: "2068913" },
  { nombre: "FLOREZ BUSTAMANTE, LUIS FERNANDO", equipo: "C.N.Riaño C.F. A", cod: "23790299" },
  { nombre: "CALDEVILLA LOBETO, PABLO", equipo: "C.N.Riaño C.F. A", cod: "17938690" },
  { nombre: "ESTRADA MARTINEZ, MARIO", equipo: "Berron C.F. B", cod: "22411544" },
  { nombre: "MOLINA PALACIO, MIGUEL ANGEL", equipo: "Berron C.F. B", cod: "23800443" },
  { nombre: "ALVAREZ FERNANDEZ, JUAN CARLOS", equipo: "Berron C.F. B", cod: "23794189" },
  { nombre: "GIL NAVES, GUILLERMO", equipo: "Berron C.F. B", cod: "21762281" },
  { nombre: "TENIAS GUEVARA, FRANKLIN ELEAZAR", equipo: "Berron C.F. B", cod: "9814068" },
  { nombre: "ALCALA BASTIAN, IVAN", equipo: "Berron C.F. B", cod: "23800799" },
  { nombre: "CANAL FERRERA, HECTOR", equipo: "Berron C.F. B", cod: "23802548" },
  { nombre: "GARCIA VAZQUEZ, DIEGO", equipo: "Berron C.F. B", cod: "17938732" },
  { nombre: "INFANZON GONZALEZ, FERNANDO", equipo: "Berron C.F. B", cod: "23790563" },
  { nombre: "PIEDRA RODRIGUEZ, NEL", equipo: "Berron C.F. B", cod: "17938080" },
  { nombre: "CANAL PRIETO, ANDRES", equipo: "Berron C.F. B", cod: "23799236" },
  { nombre: "ORDOÑEZ ALVAREZ, ANGEL", equipo: "Berron C.F. B", cod: "23802082" },
  { nombre: "GOMEZ ESTEVEZ, JONATHAN", equipo: "C. Santiago de Aller A", cod: "2219512" },
  { nombre: "ELVIRA GONZALEZ, HECTOR IVAN", equipo: "C. Santiago de Aller A", cod: "23792603" },
  { nombre: "AIT LAHCEN DOMINGUEZ, JAIRO", equipo: "C. Santiago de Aller A", cod: "9860430" },
  { nombre: "ALONSO SANZO, GASPAR", equipo: "C. Santiago de Aller A", cod: "22065450" },
  { nombre: "MERCHANTE TERCERO, ANGEL", equipo: "C. Santiago de Aller A", cod: "9915045" },
  { nombre: "JIMENEZ MANZANO, JOSE ROBERTO", equipo: "C. Santiago de Aller A", cod: "9816967" },
  { nombre: "JAIMEZ VELAZQUEZ, RAUL", equipo: "C. Santiago de Aller A", cod: "9531843" },
  { nombre: "PAÍNO FUEGO, EMILIO", equipo: "C. Santiago de Aller A", cod: "28157" },
  { nombre: "SOSA FRANCIS, YOMIL SMERLIN", equipo: "C. Santiago de Aller A", cod: "23791969" },
  { nombre: "JIMENEZ GONZALEZ, VICTOR", equipo: "C. Santiago de Aller A", cod: "23794079" },
  { nombre: "RAMOS VALENCIA, ALAN STIVEN", equipo: "C. Santiago de Aller A", cod: "22070361" },
  { nombre: "PLAZA SARASUA, SAMUEL", equipo: "C. Santiago de Aller A", cod: "23793666" },
  { nombre: "IGLESIAS GARCIA, JON ANDER", equipo: "Lada Langreo C.F. B", cod: "9532436" },
  { nombre: "MARTÍNEZ PÉREZ, SERGIO", equipo: "Lada Langreo C.F. B", cod: "2206404" },
  { nombre: "ROCES VENA, YERAI", equipo: "Lada Langreo C.F. B", cod: "9532063" },
  { nombre: "FERNANDEZ VILLANUEVA, DIEGO", equipo: "Lada Langreo C.F. B", cod: "2187111" },
  { nombre: "SEBASTIAO MADROÑO, ALEX", equipo: "Lada Langreo C.F. B", cod: "23792544" },
  { nombre: "RUIZ FERNANDEZ, LUIS MARIANO", equipo: "Lada Langreo C.F. B", cod: "2197701" },
  { nombre: "NUÑEZ GARCIA, ADRIAN", equipo: "Lada Langreo C.F. B", cod: "23797338" },
  { nombre: "GONZALEZ SANCHEZ, PABLO", equipo: "Lada Langreo C.F. B", cod: "22007725" },
  { nombre: "CIMADEVILLA BARDO, MOISES", equipo: "Lada Langreo C.F. B", cod: "23801107" },
  { nombre: "BEDIC MENENDEZ, ALEJANDRO", equipo: "Lada Langreo C.F. B", cod: "2136723" },
  { nombre: "GONZALEZ BLANCO, JUAN DIEGO", equipo: "Lada Langreo C.F. B", cod: "21715324" },
  { nombre: "MENENDEZ OVIEDO, PABLO", equipo: "Lada Langreo C.F. B", cod: "22516967" },
  { nombre: "SAN JUAN GUTIERREZ, MARTIN", equipo: "Club Deportivo San Luis", cod: "23793892" },
  { nombre: "VAZQUEZ SUAREZ, JAVIER", equipo: "Club Deportivo San Luis", cod: "23793727" },
  { nombre: "RICO GONZALEZ, ALEJANDRO", equipo: "Club Deportivo San Luis", cod: "22444953" },
  { nombre: "RIERA GARCIA, MARIO", equipo: "Club Deportivo San Luis", cod: "2165164" },
  { nombre: "MARTINEZ BELTRAN, IZAN", equipo: "Club Deportivo San Luis", cod: "23793726" },
  { nombre: "MORENO TOMAS, JAVIER", equipo: "Club Deportivo San Luis", cod: "22444777" },
  { nombre: "BRAGA PEREZ, DAVID", equipo: "Club Deportivo San Luis", cod: "23794180" },
  { nombre: "GARCIA ODRIOSOLO, AIMAR", equipo: "Club Deportivo San Luis", cod: "2223630" },
  { nombre: "SUAREZ MARCOS, ISAAC", equipo: "Club Deportivo San Luis", cod: "23795650" },
  { nombre: "SIERRA ANTOLIN, EDGAR", equipo: "Club Deportivo San Luis", cod: "23796001" },
  { nombre: "MAMADOU BOBO, DIALLO", equipo: "Club Deportivo San Luis", cod: "22446538" },
  { nombre: "PALACIO GARCIA, IYAN", equipo: "Club Deportivo San Luis", cod: "23797084" },
  { nombre: "ALVAREZ GONZALEZ, JORGE", equipo: "Sociedad C.Dª.Campomanes A", cod: "23796650" },
  { nombre: "LOPEZ ACEBAL, JAVIER", equipo: "Sociedad C.Dª.Campomanes A", cod: "9531673" },
  { nombre: "SAL PEREZ, IVAN", equipo: "Sociedad C.Dª.Campomanes A", cod: "22733323" },
  { nombre: "PRIETO DIAZ, GASPAR", equipo: "Sociedad C.Dª.Campomanes A", cod: "1836394" },
  { nombre: "RODRIGUEZ ALVAREZ, JUAN JOSE", equipo: "Sociedad C.Dª.Campomanes A", cod: "17936132" },
  { nombre: "QUIRÓS FARPÓN, SERGIO", equipo: "Sociedad C.Dª.Campomanes A", cod: "23798841" },
  { nombre: "GARCIA PULGAR, AARON", equipo: "Sociedad C.Dª.Campomanes A", cod: "23800575" },
  { nombre: "PEREZ VILLANUEVA, DANIEL", equipo: "Sociedad C.Dª.Campomanes A", cod: "22307217" },
  { nombre: "FERNANDEZ RODRIGUEZ, JAVIER", equipo: "Sociedad C.Dª.Campomanes A", cod: "23793289" },
  { nombre: "ESPINEDO ALVAREZ, CRISTIAN", equipo: "Sociedad C.Dª.Campomanes A", cod: "22307226" },
  { nombre: "RODRIGUEZ GARCIA, SERGIO", equipo: "Sociedad C.Dª.Campomanes A", cod: "22036079" },
  { nombre: "SALAN ALVAREZ, JAIME", equipo: "Sociedad C.Dª.Campomanes A", cod: "14735" },
  { nombre: "CABRERA BONILLA, BRAULIO JAVIER", equipo: "Rayo Carbayin C.F. A", cod: "22410519" },
  { nombre: "DIEYE, DJILY", equipo: "Rayo Carbayin C.F. A", cod: "23038092" },
  { nombre: "MARTINEZ RODRIGUEZ, ALEJANDRO", equipo: "Rayo Carbayin C.F. A", cod: "23798941" },
  { nombre: "MARTINEZ ANTUÑA, GABRIEL", equipo: "Rayo Carbayin C.F. A", cod: "23792179" },
  { nombre: "Alvarez Boto, Adrian", equipo: "Rayo Carbayin C.F. A", cod: "2165310" },
  { nombre: "RODRIGUES DE ALMEIDA, THIAGO", equipo: "Rayo Carbayin C.F. A", cod: "24724277" },
  { nombre: "VILLANUEVA CORBELLA, RUBEN", equipo: "Rayo Carbayin C.F. A", cod: "2328581" },
  { nombre: "BEDIA BLANCO, RAFAEL", equipo: "Rayo Carbayin C.F. A", cod: "9930684" },
  { nombre: "SERRANO ALVAREZ, MIGUEL", equipo: "Rayo Carbayin C.F. A", cod: "23792180" },
  { nombre: "CADENAS FERNÁNDEZ, ÁLVARO", equipo: "Rayo Carbayin C.F. A", cod: "21704566" },
  { nombre: "BESADA CHILLON, XACOBE", equipo: "Rayo Carbayin C.F. A", cod: "23097653" },
  { nombre: "Hector", equipo: "Rayo Carbayin C.F. A", cod: "23802417" },
  { nombre: "AMORES HERRERO, JOEL", equipo: "C.D. Riosa A", cod: "22333534" },
  { nombre: "CAGIGAL CALZON, SERGIO", equipo: "C.D. Riosa A", cod: "23801378" },
  { nombre: "VIGIL FANJUL, PELAYO", equipo: "C.D. Riosa A", cod: "21707535" },
  { nombre: "RODRIGUEZ FERNANDEZ, ENOL", equipo: "C.D. Riosa A", cod: "23795695" },
  { nombre: "MARTINEZ RODRIGUEZ, MIGUEL", equipo: "C.D. Riosa A", cod: "23792692" },
  { nombre: "RATO VAZQUEZ, JOAQUIN", equipo: "C.D. Riosa A", cod: "9635328" },
  { nombre: "ESTRADA GARCIA, VICTOR", equipo: "C.D. Riosa A", cod: "9530990" },
  { nombre: "GRANDA SAEZ, JAIME", equipo: "C.D. Riosa A", cod: "21832123" },
  { nombre: "GARCIA AZQUETA, LUCAS", equipo: "C.D. Riosa A", cod: "21768737" },
  { nombre: "FERNANDEZ VALVIDARES, SERGIO", equipo: "C.D. Riosa A", cod: "23802305" },
  { nombre: "SUAREZ CAO, ALFREDO", equipo: "C.D. Riosa A", cod: "23799464" },
  { nombre: "PUMAR GONZALEZ, FERNANDO", equipo: "C.D. Riosa A", cod: "23796102" },
  { nombre: "LAVAYOS NOGUEIRA, MIGUEL", equipo: "U.D. Llanera B", cod: "17938654" },
  { nombre: "RODRIGUEZ RODRIGUEZ, SERGIO", equipo: "U.D. Llanera B", cod: "2229427" },
  { nombre: "FONSECA FERNANDEZ, MARTIN", equipo: "U.D. Llanera B", cod: "23797579" },
  { nombre: "MARTINEZ GONZALEZ, JAVIER", equipo: "U.D. Llanera B", cod: "17938038" },
  { nombre: "LORENZO CANTELI, ALEJANDRO", equipo: "U.D. Llanera B", cod: "23792711" },
  { nombre: "IGLESIAS LOPEZ, PELAYO", equipo: "U.D. Llanera B", cod: "17935598" },
  { nombre: "ORTEA SANCHEZ, FERNANDO", equipo: "U.D. Llanera B", cod: "23794392" },
  { nombre: "DIAZ FUENTE, PABLO", equipo: "U.D. Llanera B", cod: "17936185" },
  { nombre: "RODRIGUEZ FERNANDEZ, MIGUEL", equipo: "U.D. Llanera B", cod: "24755437" },
  { nombre: "NUÑO CARRERO, DANIEL", equipo: "U.D. Llanera B", cod: "9778849" },
  { nombre: "ALVAREZ GRANDA, MARIO", equipo: "U.D. Llanera B", cod: "23802456" },
  { nombre: "SERRANO CASADO, RUBEN", equipo: "U.D. Llanera B", cod: "21957471" },
  { nombre: "GARRIDO FERNANDEZ, DANIEL", equipo: "Ayer C.F. A", cod: "23801421" },
  { nombre: "FERNANDEZ SUTIL, ALEJANDRO", equipo: "Ayer C.F. A", cod: "10011055" },
  { nombre: "RODRIGUEZ FERNANDEZ, PABLO", equipo: "Ayer C.F. A", cod: "2318721" },
  { nombre: "ESTRADA VELASCO, MAXIMINO", equipo: "Ayer C.F. A", cod: "10011089" },
  { nombre: "FERNANDEZ SENDINO, ALEJANDRO", equipo: "Ayer C.F. A", cod: "23797106" },
  { nombre: "PATINO CORTA, ENOL", equipo: "Ayer C.F. A", cod: "23792310" },
  { nombre: "GONZÁLEZ ARIAS, MARIO", equipo: "Ayer C.F. A", cod: "22576407" },
  { nombre: "GARCIA LOPEZ, PABLO", equipo: "Ayer C.F. A", cod: "23797111" },
  { nombre: "RUJAS MODINO, GABRIEL", equipo: "Ayer C.F. A", cod: "2323652" },
  { nombre: "LOPEZ GALA, ADRIAN", equipo: "Ayer C.F. A", cod: "17937446" },
  { nombre: "RODRIGUEZ ARISMENDI, LUIS ALEJANDRO", equipo: "Ayer C.F. A", cod: "24724287" },
  { nombre: "BLANCO AGÜERO, PABLO", equipo: "Ayer C.F. A", cod: "22475607" },
  { nombre: "VAZQUEZ FELIX, DIEGO", equipo: "C.D. Santa Marina de Mieres A", cod: "2042570" },
  { nombre: "AREVALO LOPEZ, FERNAN", equipo: "C.D. Santa Marina de Mieres A", cod: "22425068" },
  { nombre: "VAZQUEZ PARADIÑEIRO, ENOL", equipo: "C.D. Santa Marina de Mieres A", cod: "10035060" },
  { nombre: "GOMEZ CABALLERO, DAVID", equipo: "C.D. Santa Marina de Mieres A", cod: "22701577" },
  { nombre: "ALONSO LOPEZ, MARCOS", equipo: "C.D. Santa Marina de Mieres A", cod: "1877136" },
  { nombre: "JORGE MENENDEZ, PABLO", equipo: "C.D. Santa Marina de Mieres A", cod: "22678356" },
  { nombre: "IGLESIAS RODRIGUEZ, LUIS", equipo: "C.D. Santa Marina de Mieres A", cod: "1958803" },
  { nombre: "GONZALEZ MUÑIZ, MIGUEL", equipo: "C.D. Santa Marina de Mieres A", cod: "22479645" },
  { nombre: "SENE MISBA, EL HADJI TAMSIR", equipo: "C.D. Santa Marina de Mieres A", cod: "9839683" },
  { nombre: "VAZQUEZ YAÑEZ, MOISES", equipo: "C.D. Santa Marina de Mieres A", cod: "21860506" },
  { nombre: "ZAPICO VAZQUEZ, PABLO", equipo: "C.D. Santa Marina de Mieres A", cod: "20016" },
  { nombre: "KARAMA, MOHAMMED", equipo: "C.D. Santa Marina de Mieres A", cod: "22403522" },
  { nombre: "ALVAREZ TORRADO, NICOLAS", equipo: "Real Titanico B", cod: "9531018" },
  { nombre: "GUERRERO GALLO, JAVIER", equipo: "Real Titanico B", cod: "23802274" },
  { nombre: "PELAEZ MARTINEZ, ADRIAN", equipo: "Real Titanico B", cod: "21674056" },
  { nombre: "CALLEJA SALCEDO, JOSE ALEJANDRO", equipo: "Real Titanico B", cod: "22470074" },
  { nombre: "MUÑOZ OSSA, JUAN MANUEL", equipo: "Real Titanico B", cod: "23113973" },
  { nombre: "GARCIA PILOÑETA, DANIEL", equipo: "Real Titanico B", cod: "23792156" },
  { nombre: "CANTELI PEREZ, NOEL", equipo: "Real Titanico B", cod: "32428" },
  { nombre: "PLEITE SUCO, ADRIAN", equipo: "Real Titanico B", cod: "22523856" },
  { nombre: "MORAN GARCIA, PABLO", equipo: "Real Titanico B", cod: "32456" },
  { nombre: "FERNÁNDEZ BUENO, DIEGO", equipo: "Real Titanico B", cod: "22261296" },
  { nombre: "CASTAÑO AVILA, YAGO", equipo: "Real Titanico B", cod: "9539711" },
  { nombre: "FERNANDEZ ALVAREZ, ALEXANDER", equipo: "Real Titanico B", cod: "9531212" },
  { nombre: "SANCHEZ TASCON, DAVID", equipo: "Cultural Deportiva de Aboño A", cod: "17937942" },
  { nombre: "FERNANDEZ HEVIA, DIEGO", equipo: "Cultural Deportiva de Aboño A", cod: "17934413" },
  { nombre: "AYUSO FUENTES, VICTOR", equipo: "Cultural Deportiva de Aboño A", cod: "23797377" },
  { nombre: "GONZALEZ PIEDRA, DANIEL", equipo: "Cultural Deportiva de Aboño A", cod: "1941484" },
  { nombre: "GONZÁLEZ RODRÍGUEZ, ADRIÁN", equipo: "Cultural Deportiva de Aboño A", cod: "9738075" },
  { nombre: "GARCIA RAMIREZ, IKER", equipo: "Cultural Deportiva de Aboño A", cod: "17936358" },
  { nombre: "TRABADELO SUAREZ, BORJA", equipo: "Cultural Deportiva de Aboño A", cod: "23792003" },
  { nombre: "CANELLA DE LORENZO, PELAYO", equipo: "Cultural Deportiva de Aboño A", cod: "17938571" },
  { nombre: "ESTRADA GARCIA, ADRIAN", equipo: "Cultural Deportiva de Aboño A", cod: "23800517" },
  { nombre: "FERNANDEZ PUENTE, DANIEL", equipo: "Cultural Deportiva de Aboño A", cod: "2122329" },
  { nombre: "FERNANDEZ TOSTON, PEDRO IYAN", equipo: "Cultural Deportiva de Aboño A", cod: "23797044" },
  { nombre: "CORDERO DÍAZ, MOISES", equipo: "Cultural Deportiva de Aboño A", cod: "22394746" },
  { nombre: "RODRIGUEZ GARCIA, CESAR", equipo: "Caudal Deportivo B", cod: "23799788" },
  { nombre: "SILVA DÍAZ, GABRIEL", equipo: "Caudal Deportivo B", cod: "23800146" },
  { nombre: "MARTIN LOPEZ, KEVIN", equipo: "Caudal Deportivo B", cod: "22940213" },
  { nombre: "RODRIGUEZ SANCHEZ, DANIEL", equipo: "Caudal Deportivo B", cod: "22460419" },
  { nombre: "MARTIN JARO, ISAAC", equipo: "Caudal Deportivo B", cod: "9531037" },
  { nombre: "FERNANDEZ GARCIA, GONZALO", equipo: "Caudal Deportivo B", cod: "17935017" },
  { nombre: "GARCIA ALVAREZ, DAVID", equipo: "Caudal Deportivo B", cod: "17937388" },
  { nombre: "VAZQUEZ SOLE, SAMUEL", equipo: "Caudal Deportivo B", cod: "2159026" },
  { nombre: "DEL CORRO VAZQUEZ, NEL", equipo: "Caudal Deportivo B", cod: "9531122" },
  { nombre: "GARCIA GONZALEZ, LUCAS", equipo: "Caudal Deportivo B", cod: "9532117" },
  { nombre: "GONZALEZ GARCIA, IZAN", equipo: "Caudal Deportivo B", cod: "9614430" },
  { nombre: "CASANOVA GARCIA, SEVERINO", equipo: "Caudal Deportivo B", cod: "23791640" },
];

function norm(s) {
  return (s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Convierte "APELLIDO1 APELLIDO2, NOMBRE" → "NOMBRE APELLIDO1 APELLIDO2"
function convertir(nombre) {
  const partes = nombre.split(',');
  if (partes.length === 2) return `${partes[1].trim()} ${partes[0].trim()}`;
  return nombre.trim();
}

// Cuenta tokens compartidos entre dos nombres normalizados
function tokenScore(a, b) {
  const ta = new Set(norm(a).split(' '));
  const tb = new Set(norm(b).split(' '));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared;
}

async function main() {
  // Cargar todos los jugadores de la BD agrupados por equipo
  const { rows: jugadores } = await pool.query(`
    SELECT j.id, j.nombre, j.cod_jugador, er.nombre AS equipo
    FROM jugadores j
    JOIN equipos_reales er ON er.id = j.id_equipo_real
    WHERE j.activo = TRUE
  `);

  const porEquipo = {};
  for (const j of jugadores) {
    if (!porEquipo[j.equipo]) porEquipo[j.equipo] = [];
    porEquipo[j.equipo].push(j);
  }

  const updates = [];
  const noMatch = [];

  for (const scraperJ of noEncontrados) {
    const candidatos = porEquipo[scraperJ.equipo] ?? [];
    if (candidatos.length === 0) {
      noMatch.push({ ...scraperJ, razon: 'equipo no encontrado en BD' });
      continue;
    }

    const nombreConv = convertir(scraperJ.nombre);

    // Puntuar cada candidato: tokens en común (mayor = mejor)
    let mejor = null;
    let mejorScore = 0;
    for (const c of candidatos) {
      if (c.cod_jugador) continue; // ya tiene ID, no tocar
      const score = tokenScore(nombreConv, c.nombre);
      if (score > mejorScore) {
        mejorScore = score;
        mejor = c;
      }
    }

    if (!mejor || mejorScore < 1) {
      noMatch.push({ ...scraperJ, razon: 'sin candidato con score >= 1', nombreConv });
      continue;
    }

    updates.push({
      id: mejor.id,
      nombreBD: mejor.nombre,
      nombreScraper: scraperJ.nombre,
      nombreConv,
      cod: scraperJ.cod,
      score: mejorScore,
      equipo: scraperJ.equipo,
    });
  }

  console.log(`\n=== MATCHES ENCONTRADOS (${updates.length}) ===`);
  for (const u of updates) {
    console.log(`  [${u.equipo}] BD:"${u.nombreBD}" ← Scraper:"${u.nombreScraper}" (score:${u.score}) → cod=${u.cod}`);
  }

  if (noMatch.length > 0) {
    console.log(`\n=== SIN MATCH (${noMatch.length}) ===`);
    for (const n of noMatch) {
      console.log(`  [${n.equipo}] ${n.nombre} → ${n.razon}`);
    }
  }

  // Detectar conflictos: mismo jugador BD asignado a dos scrapers
  const usados = new Map();
  const conflictos = [];
  for (const u of updates) {
    if (usados.has(u.id)) {
      conflictos.push({ id: u.id, nombreBD: u.nombreBD, a: usados.get(u.id), b: u });
    } else {
      usados.set(u.id, u);
    }
  }
  if (conflictos.length > 0) {
    console.log(`\n⚠️  CONFLICTOS (mismo jugador BD para 2 scrapers):`);
    for (const c of conflictos) console.log(`  id=${c.id} "${c.nombreBD}": "${c.a.nombreScraper}" vs "${c.b.nombreScraper}"`);
  }

  if (updates.length === 0) {
    console.log('Nada que actualizar.');
    await pool.end();
    return;
  }

  // Aplicar updates
  console.log('\n=== APLICANDO UPDATES ===');
  let ok = 0, err = 0;
  for (const u of updates) {
    if (conflictos.some(c => c.id === u.id)) {
      console.log(`  SKIP conflicto: id=${u.id} "${u.nombreBD}"`);
      continue;
    }
    try {
      await pool.query(`UPDATE jugadores SET cod_jugador = $1 WHERE id = $2`, [u.cod, u.id]);
      console.log(`  ✓ id=${u.id} "${u.nombreBD}" → cod=${u.cod}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ id=${u.id}: ${e.message}`);
      err++;
    }
  }

  console.log(`\nFin: ${ok} actualizados, ${err} errores, ${noMatch.length} sin match`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
