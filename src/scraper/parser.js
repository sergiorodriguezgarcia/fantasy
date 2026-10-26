import * as cheerio from 'cheerio';

export function parseJornada(html) {
  const $ = cheerio.load(html);

  const jornadaText = $('h3.jornada').text().trim();
  const jornada = parseInt(jornadaText.match(/\d+/)?.[0] ?? '0');

  const partidos = [];
  // Todos los partidos de la jornada, tengan o no previo/acta publicado (para mostrar el calendario)
  const calendario = [];

  $('table.table-bordered tr').each((_, trEl) => {
    const tr = $(trEl);
    const innerTable = tr.find('table').first();
    if (!innerTable.length) return;

    const equipoLocal =
      innerTable.find('.font_widgetL a').first().text().trim() ||
      innerTable.find('.font_widgetL h4').first().text().trim().replace(/\u00a0/g, '').trim();
    const equipoVisitante =
      innerTable.find('.font_widgetV a').first().text().trim() ||
      innerTable.find('.font_widgetV h4').first().text().trim();

    if (!equipoLocal || !equipoVisitante) return;

    const btnActa   = innerTable.find('a[href*="NFG_CmpPartido"]').first();
    const btnPrevio = innerTable.find('a[href*="NFG_CmpPrevio"]').first();

    let codActa = null;
    let jugado  = false;

    if (btnActa.length) {
      codActa = (btnActa.attr('href') ?? '').match(/CodActa=(\d+)/)?.[1] ?? null;
      jugado  = true;
    } else if (btnPrevio.length) {
      codActa = (btnPrevio.attr('href') ?? '').match(/CodActa=(\d+)/)?.[1] ?? null;
    }

    const horarios = innerTable.find('.horario');
    const fecha    = horarios.eq(0).text().trim();
    const hora     = horarios.eq(1).text().trim();

    if (codActa) {
      partidos.push({ codActa, equipoLocal, equipoVisitante, fecha, hora, jugado });
    }

    // La fila "Descansa" no es un partido
    if (![equipoLocal, equipoVisitante].some(e => /^descansa$/i.test(e))) {
      calendario.push({
        equipoLocal,
        equipoVisitante,
        escudoLocal:     escudo(innerTable.find('.escudo_widgetL img').first()),
        escudoVisitante: escudo(innerTable.find('.escudo_widgetV img').first()),
        fecha,
        hora,
        jugado,
      });
    }
  });

  return { jornada, partidos, calendario };
}

// URL del escudo, o null si el club no tiene (la web pone una imagen genérica)
function escudo(img) {
  const src = img.attr('src')?.trim();
  if (!src || src.includes('escudo_sm_resultados_')) return null;
  return src;
}

export function parseActa(html, codActa) {
  const $ = cheerio.load(html);

  const metaText = $('h5.font-grey-cascade').text();
  const jornada  = parseInt(metaText.match(/Jornada\s+(\d+)/i)?.[1] ?? '0');
  const fecha    = metaText.match(/(\d{2}-\d{2}-\d{4})/)?.[1] ?? '';

  const labelDivs = $('div[style*="font-size: 20px"]');

  const equiposData = [];
  let golesDiv = null;

  labelDivs.each((_, el) => {
    const texto = $(el).text().trim();
    const descDiv = $(el).next();

    if (texto === 'Goles') {
      golesDiv = descDiv;
      return;
    }
    if (texto === 'Árbitros' || texto === 'Arbitros' || !texto) return;

    const hTitulares = descDiv.find('h5').filter((_, h) => $(h).text().includes('Titulares')).first();
    const hSuplentes = descDiv.find('h5').filter((_, h) => $(h).text().includes('Suplentes')).first();

    const titulares  = parsePlayers($, hTitulares.next('table'), true);
    const suplentes  = parsePlayers($, hSuplentes.next('table'), false);

    equiposData.push({
      nombre: texto,
      jugadores: [...titulares, ...suplentes],
      goles: [],
      tarjetas: [],
      sustituciones: [],
    });
  });

  $('h4').each((_, h4) => {
    if (!$(h4).text().trim().includes('Tarjetas')) return;
    const tarjetas = parseTarjetas($, $(h4).next('table'));
    for (const t of tarjetas) {
      assignToEquipo(equiposData, (j) => normEq(j.nombre, t.jugadorNombre), (eq) => eq.tarjetas.push(t));
    }
  });

  $('h4').each((_, h4) => {
    if (!$(h4).text().trim().includes('Sustituciones')) return;
    const susts = parseSustituciones($, $(h4).nextUntil('h4', 'table'));
    for (const s of susts) {
      assignToEquipo(equiposData, (j) => normEq(j.nombre, s.jugadorSaleNombre), (eq) => eq.sustituciones.push(s));
    }
  });

  if (golesDiv) {
    const goles = parseGoles($, golesDiv);
    for (const g of goles) {
      assignToEquipo(equiposData, (j) => normEq(j.nombre, g.jugadorNombre), (eq) => eq.goles.push(g));
    }
  }

  for (const eq of equiposData) {
    calcularMinutos(eq);
  }

  const [equipoLocal, equipoVisitante] = equiposData;
  if (equipoLocal && equipoVisitante) {
    calcularEncajados(equipoLocal, equipoVisitante);
    calcularEncajados(equipoVisitante, equipoLocal);
  }
  for (const eq of equiposData) {
    for (const j of eq.jugadores) {
      delete j.entrada;
      delete j.salida;
    }
  }

  return { codActa, jornada, fecha, equipoLocal: equipoLocal ?? null, equipoVisitante: equipoVisitante ?? null };
}

function parsePlayers($, table, esTitular) {
  const jugadores = [];
  table.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 3) return;
    const dorsal  = parseInt(tds.eq(0).text().trim()) || null;
    const nombre  = tds.eq(2).text().trim();
    const onclick = $(tr).attr('onclick') ?? '';
    const id      = onclick.match(/jugador=(\d+)/)?.[1] ?? null;
    const imgSrc  = tds.eq(1).find('img').attr('src') ?? '';
    const foto    = imgSrc.startsWith('data:image') ? imgSrc : null;
    if (nombre) jugadores.push({ id, nombre, dorsal, esTitular, minutosJugados: esTitular ? 90 : 0, foto });
  });
  return jugadores;
}

function parseTarjetas($, table) {
  const tarjetas = [];
  table.find('tr').each((_, tr) => {
    const tds    = $(tr).find('td');
    if (tds.length < 2) return;
    const imgSrc = tds.eq(0).find('img').attr('src') ?? '';
    const tipo   = imgSrc.includes('tarj_roja') ? 'roja' : 'amarilla';
    const texto  = stripTags(tds.eq(1).html() ?? '');
    // El minuto va entre paréntesis delante del nombre: "(83')" o, en el descuento, "(45'+2)"
    const minMatch = texto.match(/\((\d+)[^)]*\)/);
    const minuto = minMatch ? parseInt(minMatch[1]) : null;
    const jugadorNombre = texto.replace(/\(\d+[^)]*\)/, '').trim();
    if (jugadorNombre) tarjetas.push({ jugadorNombre, minuto, tipo });
  });
  return tarjetas;
}

function parseGoles($, section) {
  const goles = [];
  section.find('tr').each((_, tr) => {
    const tdInfo = $(tr).find('td.font_responsive').first();
    if (!tdInfo.length) return;
    const minSpan = tdInfo.find('span.font-blue').first();
    const minuto  = minSpan.length ? parseInt(minSpan.text().match(/\d+/)?.[0] ?? '0') : null;
    if (minuto === null) return;
    const nombreRaw = tdInfo.text().replace(minSpan.text(), '').trim();
    if (!nombreRaw) return;
    const linkTitle = ($(tr).find('a').first().attr('title') ?? '').toLowerCase();
    const esPropio  = linkTitle.includes('propia') || linkTitle.includes('own');
    goles.push({ jugadorNombre: nombreRaw, minuto, esPropio });
  });
  return goles;
}

function parseSustituciones($, table) {
  const filas = [];
  table.find('tr').each((_, tr) => {
    const tds    = $(tr).find('td');
    if (tds.length < 2) return;
    const tdNombre = tds.eq(1);
    const minSpan  = tdNombre.find('span.font-blue').first();
    const minuto   = minSpan.length ? parseInt(minSpan.text().match(/\d+/)?.[0] ?? '0') : null;
    const nombre   = tdNombre.text().replace(minSpan.text(), '').trim();
    if (nombre) filas.push({ nombre, minuto });
  });
  const sustituciones = [];
  for (let i = 0; i + 1 < filas.length; i += 2) {
    const a = filas[i];
    const b = filas[i + 1];
    const entra = a.minuto === null ? a : b;
    const sale  = a.minuto !== null ? a : b;
    sustituciones.push({
      jugadorEntreNombre: entra.nombre,
      jugadorSaleNombre:  sale.nombre,
      minuto: sale.minuto ?? 90,
    });
  }
  return sustituciones;
}

// Minutos = salida - entrada. Los titulares entran en el 0 y los suplentes solo si hay sustitución;
// una roja (o la segunda amarilla) corta la participación en el minuto de la tarjeta.
// Deja entrada/salida en cada jugador para calcularEncajados(); parseActa() las borra después.
function calcularMinutos(equipo) {
  for (const j of equipo.jugadores) {
    j.entrada = j.esTitular ? 0 : null;
    j.salida = 90;
  }
  for (const s of equipo.sustituciones) {
    const min  = s.minuto ?? 90;
    const sale  = equipo.jugadores.find((j) => normEq(j.nombre, s.jugadorSaleNombre));
    const entra = equipo.jugadores.find((j) => normEq(j.nombre, s.jugadorEntreNombre));
    if (sale)  sale.salida  = min;
    if (entra) entra.entrada = min;
  }
  for (const j of equipo.jugadores) {
    const suyas = equipo.tarjetas.filter((t) => t.minuto !== null && normEq(j.nombre, t.jugadorNombre));
    const rojas = suyas.filter((t) => t.tipo === 'roja').map((t) => t.minuto);
    // El acta no marca la doble amarilla con una roja: la segunda amarilla es la expulsión
    const amarillas = suyas.filter((t) => t.tipo === 'amarilla').map((t) => t.minuto).sort((a, b) => a - b);
    const expulsiones = amarillas.length >= 2 ? [...rojas, amarillas[1]] : rojas;
    if (expulsiones.length) j.salida = Math.min(j.salida, ...expulsiones);
  }
  for (const j of equipo.jugadores) {
    j.minutosJugados = j.entrada === null ? 0 : Math.max(0, j.salida - j.entrada);
  }
}

// Goles que encajó el equipo con cada jugador en el campo (los del rival y los propios del equipo).
// Un gol en el minuto de un cambio cuenta para el que entra; quien acaba el partido se lleva
// también los del descuento (el acta los da como 90'+x).
function calcularEncajados(equipo, rival) {
  const minutosEncajados = [
    ...rival.goles.filter((g) => !g.esPropio),
    ...equipo.goles.filter((g) => g.esPropio),
  ].map((g) => g.minuto);
  for (const j of equipo.jugadores) {
    j.golesEncajados = j.entrada === null
      ? 0
      : minutosEncajados.filter((m) => m >= j.entrada && (m < j.salida || j.salida >= 90)).length;
  }
}

function assignToEquipo(equipos, jugadorPred, action) {
  for (const eq of equipos) {
    if (eq.jugadores.some(jugadorPred)) { action(eq); return; }
  }
}

function normEq(a, b) {
  return norm(a) === norm(b);
}

function norm(s) {
  return (s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function stripTags(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
