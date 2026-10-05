/**
 * Tareas programadas (cron jobs internos del servidor).
 *
 * - Cada minuto: comprobar subastas vencidas y resolverlas.
 * - Cada minuto: comprobar si son las 17:00 y abrir ventana de mercado diaria.
 *
 * En producción se puede reemplazar por un cron externo (Railway cron).
 */

import { pool } from '../db/pool.js';
import { resolverSubastasVencidas, abrirVentanaMercado } from '../routes/mercado.js';

export function iniciarCrons() {
  // Comprobar subastas vencidas cada 60 segundos
  setInterval(async () => {
    try {
      const resultado = await resolverSubastasVencidas();
      if (resultado.procesadas > 0) {
        console.log(`[CRON] Subastas resueltas: ${resultado.procesadas}`, resultado.resultados);
      }
    } catch (err) {
      console.error('[CRON] Error resolviendo subastas:', err.message);
    }
  }, 60_000);

  // Abrir ventana de mercado diaria a las 17:00 (comprueba cada minuto)
  setInterval(async () => {
    try {
      const ahora = new Date();
      // Disparar entre las 17:00 y las 17:29 (ventana de 30 min por si el servicio dormía)
      // La función abrirVentanaMercado ya evita abrir dos veces el mismo día
      if (ahora.getHours() !== 17 || ahora.getMinutes() > 29) return;

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

  console.log('[CRON] Resolución de subastas y apertura de mercado diario activados');
}
