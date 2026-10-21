/**
 * Tareas programadas (cron jobs internos del servidor).
 *
 * - Cada minuto: comprobar subastas vencidas y resolverlas (y caducar ofertas de usuario vencidas).
 * - Cada minuto: comprobar si son las 19:00 (hora española) y abrir ventana de mercado diaria.
 * - Cada 30 minutos: importar la jornada en juego y calcularla cuando acabe.
 *
 * Solo corren mientras el servidor está despierto. En Render free el servicio se duerme tras
 * 15 min sin peticiones: hay que mantenerlo despierto con un ping externo a /api/health o
 * llamar a los endpoints /api/cron/* desde un cron externo.
 */

import { pool } from '../db/pool.js';
import { resolverSubastasVencidas, abrirVentanaMercado } from '../routes/mercado.js';
import { importarJornadaAutomatica } from '../routes/cron.js';

async function cronJornada() {
  try {
    const r = await importarJornadaAutomatica();
    if (r.partidos_importados_ahora?.length || r.errores?.length || r.calculada) {
      console.log(`[CRON] Jornada ${r.jornada}: ${r.partidos_jugados} jugados, ` +
        `importados ahora ${r.partidos_importados_ahora.length}, ${r.motivo}`, r.errores);
    }
  } catch (err) {
    console.error('[CRON] Error importando jornada:', err.message);
  }
}

export function iniciarCrons() {
  // Importar la jornada y calcularla cuando acabe: cada 30 min y una vez al arrancar
  // (en Render free el servicio se duerme; al despertar no hay que esperar al siguiente intervalo)
  setTimeout(cronJornada, 60_000);
  setInterval(cronJornada, 30 * 60_000);

  // Comprobar subastas vencidas cada 60 segundos
  setInterval(async () => {
    try {
      const resultado = await resolverSubastasVencidas();
      if (resultado.procesadas > 0) {
        console.log(`[CRON] Subastas resueltas: ${resultado.procesadas}`, resultado.resultados);
      }
      if (resultado.ofertas_expiradas.length > 0) {
        console.log('[CRON] Ofertas caducadas, saldo devuelto:', resultado.ofertas_expiradas);
      }
    } catch (err) {
      console.error('[CRON] Error resolviendo subastas:', err.message);
    }
  }, 60_000);

  // Abrir ventana de mercado diaria a las 19:00 hora española, cuando cierra la anterior (comprueba cada minuto)
  setInterval(async () => {
    try {
      // Hora en Madrid: el servidor corre en UTC y así no le afecta el cambio de hora
      const [hora, minuto] = new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(new Date()).split(':').map(Number);
      // Disparar entre las 19:00 y las 19:29 (ventana de 30 min por si el servicio dormía)
      // La función abrirVentanaMercado ya evita abrir dos veces el mismo día
      if (hora !== 19 || minuto > 29) return;

      // Leer configuración
      const { rows } = await pool.query(
        `SELECT clave, valor FROM config_mercado WHERE clave IN ('jugadores_por_ventana', 'hora_apertura')`
      );
      const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
      const n = parseInt(cfg.jugadores_por_ventana ?? '5');

      const resultado = await abrirVentanaMercado({ n });
      if (resultado.ok) {
        console.log(`[CRON] Ventana de mercado abierta: ${resultado.subastas_creadas} subastas, cierre: ${resultado.cierre}`);
      } else {
        console.log(`[CRON] Ventana de mercado: ${resultado.motivo}`);
      }
    } catch (err) {
      console.error('[CRON] Error abriendo ventana de mercado:', err.message);
    }
  }, 60_000);

  console.log('[CRON] Resolución de subastas, apertura de mercado diario e importación de jornadas activados');
}
