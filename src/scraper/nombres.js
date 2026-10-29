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
