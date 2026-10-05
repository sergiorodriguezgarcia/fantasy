import * as cheerio from 'cheerio';

export function parseJornada(html) {
  const $ = cheerio.load(html);

  const jornadaText = $('h3.jornada').text().trim();
  const jornada = parseInt(jornadaText.match(/\d+/)?.[0] ?? '0');

  const partidos = [];

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
  });

  return { jornada, partidos };
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
    const susts = parseSustituciones($, $(h4).next('table'));
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
    if (nombre) jugadores.push({ id, nombre, dorsal, esTitular, minutosJugados: esTitular ? 90 : 0 });
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
    const minMatch = texto.match(/\((\d+)[''`']\)/);
    const minuto = minMatch ? parseInt(minMatch[1]) : null;
    const jugadorNombre = texto.replace(/\(\d+[''`']\)/, '').trim();
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

function calcularMinutos(equipo) {
  for (const s of equipo.sustituciones) {
    const min  = s.minuto ?? 90;
    const sale  = equipo.jugadores.find((j) => normEq(j.nombre, s.jugadorSaleNombre));
    const entra = equipo.jugadores.find((j) => normEq(j.nombre, s.jugadorEntreNombre));
    if (sale)  sale.minutosJugados  = min;
    if (entra) entra.minutosJugados = 90 - min;
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
