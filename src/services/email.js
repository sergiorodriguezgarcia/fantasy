/**
 * Avisos por correo a los usuarios (subasta ganada, clausulazo recibido).
 *
 * Se envían con la API HTTP de Brevo: Render free bloquea los puertos SMTP.
 * Variables de entorno:
 *   BREVO_API_KEY    clave de API de Brevo (SMTP & API > API Keys)
 *   EMAIL_FROM       remitente verificado en Brevo (Senders)
 *   EMAIL_FROM_NAME  nombre del remitente (opcional)
 *   FRONTEND_URL     para el enlace a la app
 * Sin BREVO_API_KEY no se envía nada (solo se registra en consola), así en local no hace falta configurarlo.
 * Los avisos nunca lanzan error: un fallo de correo no debe deshacer ni bloquear un fichaje.
 */

import { pool } from '../db/pool.js';

const API_URL = 'https://api.brevo.com/v3/smtp/email';

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function euros(n) {
  return `${Number(n).toLocaleString('es-ES')}€`;
}

function plantilla(titulo, parrafos, textoBoton, ruta) {
  const url = `${(process.env.FRONTEND_URL ?? '').replace(/\/$/, '')}${ruta}`;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827">
      <h2 style="margin:0 0 16px;color:#15803d">${titulo}</h2>
      ${parrafos.map(p => `<p style="margin:0 0 12px;line-height:1.5">${p}</p>`).join('')}
      ${process.env.FRONTEND_URL ? `
        <p style="margin:24px 0">
          <a href="${escapar(url)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${textoBoton}</a>
        </p>` : ''}
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280">AsturFútbol Fantasy</p>
    </div>`;
}

export async function enviarCorreo({ para, nombre, asunto, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || !process.env.EMAIL_FROM) {
    console.log(`[EMAIL] Sin configurar, no se envía "${asunto}" a ${para}`);
    return;
  }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME ?? 'AsturFútbol Fantasy' },
        to: [{ email: para, name: nombre }],
        subject: asunto,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[EMAIL] Error ${res.status} enviando "${asunto}" a ${para}:`, await res.text());
  } catch (err) {
    console.error(`[EMAIL] Error enviando "${asunto}" a ${para}:`, err.message);
  }
}

// Usuario dueño de un equipo fantasy
async function usuarioDeEquipo(idEquipo) {
  const { rows: [u] } = await pool.query(
    `SELECT u.nombre, u.email, ef.nombre AS equipo
     FROM equipos_fantasy ef JOIN usuarios u ON u.id = ef.id_usuario
     WHERE ef.id = $1`,
    [idEquipo]
  );
  return u;
}

async function nombreJugador(idJugador) {
  const { rows: [j] } = await pool.query(`SELECT nombre FROM jugadores WHERE id = $1`, [idJugador]);
  return j?.nombre ?? 'el jugador';
}

export async function avisarSubastaGanada({ idEquipo, idJugador, monto }) {
  try {
    const [u, jugador] = await Promise.all([usuarioDeEquipo(idEquipo), nombreJugador(idJugador)]);
    if (!u) return;
    await enviarCorreo({
      para: u.email,
      nombre: u.nombre,
      asunto: `Has ganado la subasta de ${jugador}`,
      html: plantilla(
        '¡Subasta ganada! 🎉',
        [
          `Hola ${escapar(u.nombre)},`,
          `Has ganado la subasta de <strong>${escapar(jugador)}</strong> por <strong>${euros(monto)}</strong>. Ya está en tu plantilla.`,
        ],
        'Ver mi equipo',
        '/mi-equipo'
      ),
    });
  } catch (err) {
    console.error('[EMAIL] Error preparando aviso de subasta ganada:', err.message);
  }
}

export async function avisarClausulazo({ idVendedor, idComprador, idJugador, monto }) {
  try {
    const [vendedor, comprador, jugador] = await Promise.all([
      usuarioDeEquipo(idVendedor), usuarioDeEquipo(idComprador), nombreJugador(idJugador),
    ]);
    if (!vendedor) return;
    await enviarCorreo({
      para: vendedor.email,
      nombre: vendedor.nombre,
      asunto: `Te han hecho un clausulazo: ${jugador}`,
      html: plantilla(
        'Te han hecho un clausulazo 🔓',
        [
          `Hola ${escapar(vendedor.nombre)},`,
          `<strong>${escapar(comprador?.nombre ?? 'Otro usuario')}</strong> ha pagado la cláusula de <strong>${escapar(jugador)}</strong> y se lo ha llevado de tu equipo.`,
          `Has recibido <strong>${euros(monto)}</strong> en tu saldo.`,
        ],
        'Ver mi equipo',
        '/mi-equipo'
      ),
    });
  } catch (err) {
    console.error('[EMAIL] Error preparando aviso de clausulazo:', err.message);
  }
}
