/**
 * Normalización de nombres de jugadores/equipos del scraper para hacer match con la BD.
 */

export function normalizeName(name) {
  return (name ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * El scraper devuelve nombres en formato federación: "APELLIDO1 APELLIDO2, NOMBRE"
 * La BD los tiene como los introdujo el admin: "NOMBRE APELLIDO1" o "NOMBRE APELLIDO1 APELLIDO2"
 * Genera todas las combinaciones posibles para hacer match.
 * Ej: "ALDARIZ ALVAREZ, DIEGO" → ["DIEGO ALDARIZ", "DIEGO ALDARIZ ALVAREZ", "DIEGO ALVAREZ", ...]
 */
export function generarCombinacionesNombre(nombreScraper) {
  const norm = normalizeName(nombreScraper);
  if (!norm.includes(',')) return [norm]; // nombre simple tipo "BETO"

  const [apellidosParte, nombresParte] = norm.split(',').map(s => s.trim());
  const apellidosTokens = apellidosParte.split(' ').filter(Boolean);
  const nombresTokens = nombresParte.split(' ').filter(Boolean);

  const combinaciones = new Set();
  // Combinación completa invertida: "NOMBRE1 NOMBRE2 APELLIDO1 APELLIDO2"
  combinaciones.add(`${nombresParte} ${apellidosParte}`);

  // Combinaciones parciales: cada nombre (y el nombre compuesto entero, p. ej. "MATEUSZ DAWID",
  // con o sin apellidos) con cada subconjunto de apellidos
  const nombres = nombresTokens.length > 1 ? [...nombresTokens, nombresParte] : nombresTokens;
  for (const nombre of nombres) {
    combinaciones.add(nombre);
    for (let i = 1; i <= apellidosTokens.length; i++) {
      combinaciones.add(`${nombre} ${apellidosTokens.slice(0, i).join(' ')}`);
    }
  }

  return [...combinaciones];
}

// Palabras que no distinguen a un club de otro (siglas de la entidad, artículos...)
const PALABRAS_GENERICAS = new Set([
  'CF', 'CD', 'SD', 'UD', 'AD', 'CP', 'SAD', 'UP', 'CLUB', 'DEPORTIVO', 'DEPORTIVA', 'FUTBOL',
  'REAL', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y',
]);

/**
 * Nombre de un equipo → palabras que lo identifican + letra del filial.
 * Ej: 'S.D. Lenense Proinastur "B"' → { palabras: ['LENENSE', 'PROINASTUR'], letra: 'B' }
 */
function claveEquipo(nombre) {
  const tokens = normalizeName(nombre).replace(/\./g, '').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const letra = tokens.length > 1 && /^[A-Z]$/.test(tokens.at(-1)) ? tokens.pop() : null;
  const palabras = tokens.filter(t => t.length > 1 && !PALABRAS_GENERICAS.has(t));
  return { palabras, letra };
}

/**
 * Busca el equipo real que corresponde a un nombre de la federación (calendario, actas), que no
 * siempre se escribe igual que en la BD: 'Ayer C.F. "A"' ↔ 'AYER CF A'.
 * Casa si las palabras de uno están todas en el otro y la letra del filial no se contradice;
 * gana el que comparte más palabras. Devuelve el id, o null si no hay ninguno o hay empate.
 */
export function buscarEquipoReal(nombre, equipos) {
  const exacto = equipos.find(e => normalizeName(e.nombre) === normalizeName(nombre));
  if (exacto) return exacto.id;

  const buscado = claveEquipo(nombre);
  if (buscado.palabras.length === 0) return null;

  let mejor = null, mejorComunes = 0, empate = false;
  for (const e of equipos) {
    const clave = claveEquipo(e.nombre);
    if (clave.palabras.length === 0) continue;
    if (buscado.letra && clave.letra && buscado.letra !== clave.letra) continue;
    const comunes = clave.palabras.filter(p => buscado.palabras.includes(p)).length;
    const contenido = comunes === clave.palabras.length || comunes === buscado.palabras.length;
    if (!contenido) continue;
    // A igualdad de palabras, el que tiene la misma letra de filial gana al que no tiene letra
    const puntos = comunes * 2 + (buscado.letra && clave.letra === buscado.letra ? 1 : 0);
    if (puntos > mejorComunes) { mejor = e.id; mejorComunes = puntos; empate = false; }
    else if (puntos === mejorComunes) empate = true;
  }
  return empate ? null : mejor;
}
