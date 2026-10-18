/**
 * Corrige el valor de mercado de los jugadores comprados en subasta.
 *
 * Antes, al resolver una subasta el precio_actual del jugador pasaba a ser lo pagado por él, y
 * los recálculos de jornadas posteriores partían de ese valor. El valor solo debe moverse tras
 * cada jornada, así que se reconstruye desde precio_inicial aplicando, en orden de jornada, los
 * puntos de cada jornada en la que se le recalculó el precio (las filas de historial_precios).
 * También se corrigen esas filas del historial.
 *
 * Solo se tocan jugadores con alguna subasta RESUELTA. Ojo: si un admin cambió a mano el precio
 * de alguno de ellos, ese cambio también se pierde (revisa la simulación antes de aplicar).
 * Las cláusulas no se tocan.
 *
 * Uso (por defecto solo muestra lo que haría, sin tocar nada):
 *   node scripts/recalcular-precios-subastas.js
 *   node scripts/recalcular-precios-subastas.js --aplicar
 */
import { pool } from '../src/db/pool.js';
import { calcularNuevoPrecio } from '../src/services/precios.js';

const aplicar = process.argv.includes('--aplicar');

const fmt = (n) => `${Number(n).toLocaleString('es-ES')}€`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: jugadores } = await client.query(
      `SELECT j.id, j.nombre, j.precio_inicial, j.precio_actual
       FROM jugadores j
       WHERE EXISTS (SELECT 1 FROM subastas s WHERE s.id_jugador = j.id AND s.estado = 'RESUELTA')
       ORDER BY j.nombre
       FOR UPDATE OF j`
    );

    let corregidos = 0;

    for (const j of jugadores) {
      const { rows: historial } = await client.query(
        `SELECT h.id, h.precio, jo.numero, e.puntos
         FROM historial_precios h
         JOIN jornadas jo ON jo.id = h.id_jornada
         LEFT JOIN estadisticas e ON e.id_jugador = h.id_jugador AND e.id_jornada = h.id_jornada
         WHERE h.id_jugador = $1
         ORDER BY jo.numero`,
        [j.id]
      );

      let precio = Number(j.precio_inicial);
      const historialCorregido = [];
      for (const h of historial) {
        precio = calcularNuevoPrecio(precio, h.puntos);
        if (precio !== Number(h.precio)) historialCorregido.push({ id: h.id, numero: h.numero, antes: h.precio, despues: precio });
      }

      const actual = Number(j.precio_actual);
      if (precio === actual && historialCorregido.length === 0) continue;

      console.log(`  ${j.nombre}: ${fmt(actual)} → ${fmt(precio)}`);
      for (const h of historialCorregido) {
        console.log(`      historial J${h.numero}: ${fmt(h.antes)} → ${fmt(h.despues)}`);
      }

      if (aplicar) {
        await client.query(`UPDATE jugadores SET precio_actual = $1 WHERE id = $2`, [precio, j.id]);
        for (const h of historialCorregido) {
          await client.query(`UPDATE historial_precios SET precio = $1 WHERE id = $2`, [h.despues, h.id]);
        }
      }
      corregidos++;
    }

    console.log(`\n${corregidos} de ${jugadores.length} jugador(es) comprados en subasta con valor a corregir.`);

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
  console.error('Error recalculando precios:', err);
  process.exit(1);
});
