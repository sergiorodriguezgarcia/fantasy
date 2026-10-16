/**
 * Deshace las subidas de cláusula hechas cuando subirla costaba solo el 10% del incremento.
 *
 * Antes no se guardaba historial de subidas, así que se reconstruyen:
 *   cláusula sin subidas = clausulaInicial(MAX(precio_compra, precio_actual))
 *     (la de fichaje y la que fija el recálculo de precios tras cada jornada)
 *   subido   = clausula_monto − cláusula sin subidas
 *   devuelto = 10% de lo subido (lo que costó con la regla antigua)
 * Cada cláusula vuelve a su valor sin subidas y se devuelve el dinero al dueño actual.
 *
 * Se saltan las plantillas que ya tengan filas en subidas_clausula: esas subidas son con la
 * regla nueva (100%) y no deben deshacerse con esta cuenta.
 *
 * Uso (por defecto solo muestra lo que haría, sin tocar nada):
 *   node scripts/revertir-subidas-clausula.js
 *   node scripts/revertir-subidas-clausula.js --aplicar
 */
import { pool } from '../src/db/pool.js';
import { clausulaInicial } from '../src/services/clausulas.js';

const COSTE_SUBIDA_ANTIGUO = 0.10;
const aplicar = process.argv.includes('--aplicar');

const fmt = (n) => `${Number(n).toLocaleString('es-ES')}€`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [{ existe }] } = await client.query(
      `SELECT to_regclass('public.subidas_clausula') IS NOT NULL AS existe`
    );

    const { rows } = await client.query(
      `SELECT p.id, p.id_equipo_fantasy, p.clausula_monto, p.precio_compra,
              j.precio_actual, j.nombre AS jugador, ef.nombre AS equipo
       FROM plantillas p
       JOIN jugadores j ON j.id = p.id_jugador
       JOIN equipos_fantasy ef ON ef.id = p.id_equipo_fantasy
       ORDER BY ef.nombre, j.nombre
       FOR UPDATE OF p`
    );

    const conSubidaNueva = new Set();
    if (existe) {
      const { rows: log } = await client.query(`SELECT DISTINCT id_plantilla FROM subidas_clausula`);
      log.forEach(r => conSubidaNueva.add(r.id_plantilla));
    }

    const devolucionPorEquipo = new Map();
    let revertidas = 0;

    for (const p of rows) {
      const base = clausulaInicial(Math.max(Number(p.precio_compra), Number(p.precio_actual)));
      const actual = Number(p.clausula_monto);
      if (actual <= base) continue;

      if (conSubidaNueva.has(p.id)) {
        console.log(`  ⚠ Saltada (tiene subidas con la regla nueva): ${p.equipo} · ${p.jugador} (${fmt(actual)})`);
        continue;
      }

      const devolucion = Math.ceil((actual - base) * COSTE_SUBIDA_ANTIGUO);
      console.log(`  ${p.equipo} · ${p.jugador}: ${fmt(actual)} → ${fmt(base)} · devolver ${fmt(devolucion)}`);

      if (aplicar) {
        await client.query(`UPDATE plantillas SET clausula_monto = $1 WHERE id = $2`, [base, p.id]);
      }
      const prev = devolucionPorEquipo.get(p.id_equipo_fantasy) ?? { equipo: p.equipo, total: 0 };
      prev.total += devolucion;
      devolucionPorEquipo.set(p.id_equipo_fantasy, prev);
      revertidas++;
    }

    console.log(`\nDevoluciones por equipo:`);
    for (const [idEquipo, { equipo, total }] of devolucionPorEquipo) {
      console.log(`  ${equipo}: +${fmt(total)}`);
      if (aplicar) {
        await client.query(
          `UPDATE equipos_fantasy SET saldo_disponible = saldo_disponible + $1 WHERE id = $2`,
          [total, idEquipo]
        );
      }
    }

    console.log(`\n${revertidas} cláusula(s) a revertir en ${devolucionPorEquipo.size} equipo(s).`);

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
  console.error('Error revirtiendo subidas de cláusula:', err);
  process.exit(1);
});
