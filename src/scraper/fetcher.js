import { execFile } from 'child_process';
import { promisify } from 'util';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CONFIG } from './config.js';

const execFileAsync = promisify(execFile);

const COOKIE_JAR = join(tmpdir(), 'asturfutbol_cookies.txt');

let sessionInitialized = false;

async function initSession() {
  if (sessionInitialized) return;

  if (existsSync(COOKIE_JAR)) {
    unlinkSync(COOKIE_JAR);
  }

  await curlGet(`${CONFIG.BASE_URL}/NLogin`, { isInit: true });
  sessionInitialized = true;
}

export function resetSession() {
  sessionInitialized = false;
  if (existsSync(COOKIE_JAR)) unlinkSync(COOKIE_JAR);
}

async function curlGet(url, { isInit = false, intentos = 3 } = {}) {
  const args = [
    '-s', '-L',
    '-c', COOKIE_JAR,
    '-b', COOKIE_JAR,
    '--connect-timeout', '30',
    '-A', CONFIG.USER_AGENT,
    '--compressed',
    url,
  ];

  for (let i = 0; i < intentos; i++) {
    try {
      const { stdout } = await execFileAsync('curl', args, {
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'buffer',
      });

      const html = new TextDecoder('iso-8859-1').decode(stdout);
      if (html.length > 0) return html;

      if (isInit) return html;

      console.warn(`  [scraper] Respuesta vacía (intento ${i + 1}/${intentos}). Renovando sesión...`);
      sessionInitialized = false;
      if (existsSync(COOKIE_JAR)) unlinkSync(COOKIE_JAR);
      await delay(5000 * (i + 1));
      await initSession();

    } catch (err) {
      if (i === intentos - 1) throw new Error(`Error en curl GET ${url}: ${err.message}`);
      await delay(2000);
    }
  }

  throw new Error(`No se pudo obtener contenido de ${url} tras ${intentos} intentos`);
}

export async function fetchJornada(numJornada) {
  await initSession();
  await delay(CONFIG.DELAY_MS);

  const url =
    `${CONFIG.BASE_URL}/NPcd/NFG_CmpJornada` +
    `?cod_primaria=${CONFIG.COD_PRIMARIA}` +
    `&CodCompeticion=${CONFIG.COD_COMPETICION}` +
    `&CodGrupo=${CONFIG.COD_GRUPO}` +
    `&CodTemporada=${CONFIG.COD_TEMPORADA}` +
    `&CodJornada=${numJornada}` +
    `&Sch_Tipo_Juego=1`;

  return curlGet(url);
}

export async function fetchActa(codActa) {
  await initSession();
  await delay(CONFIG.DELAY_MS);

  const url =
    `${CONFIG.BASE_URL}/NPcd/NFG_CmpPartido` +
    `?cod_primaria=${CONFIG.COD_PRIMARIA}` +
    `&CodActa=${codActa}` +
    `&cod_acta=${codActa}`;

  return curlGet(url);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
