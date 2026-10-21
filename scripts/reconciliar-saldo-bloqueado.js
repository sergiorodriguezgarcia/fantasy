/**
 * Cuadra el saldo_bloqueado de cada equipo con lo que realmente tiene reservado:
 *   esperado = pujas en subastas ACTIVA + ofertas de usuario PENDIENTE que ha hecho como comprador
 *
 * Saldo bloqueado de más (sobrante > 0): dinero que se quedó atascado, sobre todo por la versión
 * inicial de aceptar oferta, que marcaba como EXPIRADA el resto de ofertas por el jugador sin
 * devolver el importe al comprador. Se devuelve a saldo_disponible.
 * Saldo bloqueado de menos (sobrante < 0): devoluciones dobles por peticiones simultáneas antes de
 * los bloqueos FOR UPDATE. Solo se listan: corregirlo quitaría dinero disponible al usuario.
 *
 * Uso (por defecto solo muestra lo que haría, sin tocar nada):
 *   node scripts/reconciliar-saldo-bloqueado.js
 *   node scripts/reconciliar-saldo-bloqueado.js --aplicar
 */
import { pool } from '../src/db/pool.js';

const aplicar = process.argv.includes('--aplicar');

const fmt = (n) => `${Number(n).toLocaleString('es-ES')}€`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear los equipos: nadie puja ni oferta mientras se cuadra
    await client.query(`SELECT id FROM equipos_fantasy ORDER BY id FOR UPDATE`);

    const { rows } = await client.query(
      `SELECT ef.id, ef.nombre AS equipo, u.email, ef.saldo_disponible, ef.saldo_bloqueado,
              COALESCE(pu.total, 0) AS en_pujas,
              COALESCE(o.total, 0)  AS en_ofertas,
              ef.saldo_bloqueado - COALESCE(pu.total, 0) - COALESCE(o.total, 0) AS sobrante
       FROM equipos_fantasy ef
       JOIN usuarios u ON u.id = ef.id_usuario
       LEFT JOIN (
         SELECT p.id_equipo_fantasy, SUM(p.monto) AS total
         FROM pujas p JOIN subastas s ON s.id = p.id_subasta
         WHERE s.estado = 'ACTIVA'
         GROUP BY p.id_equipo_fantasy
       ) pu ON pu.id_equipo_fantasy = ef.id
       LEFT JOIN (
         SELECT id_equipo_comprador, SUM(monto) AS total
         FROM ofertas
         WHERE tipo = 'USUARIO' AND estado = 'PENDIENTE'
         GROUP BY id_equipo_comprador
       ) o ON o.id_equipo_comprador = ef.id
       WHERE ef.saldo_bloqueado <> COALESCE(pu.total, 0) + COALESCE(o.total, 0)
       ORDER BY ef.nombre`
    );

    const deMas = rows.filter(r => Number(r.sobrante) > 0);
    const deMenos = rows.filter(r => Number(r.sobrante) < 0);

    console.log(`Saldo bloqueado de más (se devuelve a disponible):`);
    for (const r of deMas) {
      console.log(`  ${r.equipo} <${r.email}>: bloqueado ${fmt(r.saldo_bloqueado)} · `
        + `pujas ${fmt(r.en_pujas)} · ofertas ${fmt(r.en_ofertas)} · devolver ${fmt(r.sobrante)}`);
      if (aplicar) {
        await client.query(
          `UPDATE equipos_fantasy
           SET saldo_disponible = saldo_disponible + $1,
               saldo_bloqueado  = saldo_bloqueado  - $1
           WHERE id = $2`,
          [r.sobrante, r.id]
        );
      }
    }

    if (deMenos.length > 0) {
      console.log(`\n⚠ Saldo bloqueado de menos (no se toca, revisar a mano):`);
      for (const r of deMenos) {
        console.log(`  ${r.equipo} <${r.email}>: bloqueado ${fmt(r.saldo_bloqueado)} · `
          + `pujas ${fmt(r.en_pujas)} · ofertas ${fmt(r.en_ofertas)} · falta ${fmt(-r.sobrante)}`);
      }
    }

    console.log(`\n${deMas.length} equipo(s) a corregir, ${deMenos.length} a revisar.`);

    if (aplicar) {
      await client.query('COMMIT');
      console.log('Cambios aplicados.');
    } else {
      await client.query('ROLLBACK');
      console.log('Simulación: no se ha cambiado nada. Lanza con --aplicar para ejecutarlo.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error cuadrando saldo bloqueado:', err);
  process.exit(1);
});
