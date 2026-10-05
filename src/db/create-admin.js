/**
 * Crea (o actualiza) el usuario administrador en la base de datos.
 * El admin NO tiene equipo fantasy ni participa en ninguna liga.
 *
 * Uso:
 *   node src/db/create-admin.js [email] [password] [nombre]
 *
 * Defaults:
 *   email:    admin@fantasy.local
 *   password: admin1234
 *   nombre:   Administrador
 *
 * Si el email ya existe, actualiza la contraseña y fuerza rol=admin.
 * Si existía un equipo_fantasy para ese usuario, lo elimina.
 */

import bcrypt from 'bcrypt';
import { pool } from './pool.js';

const email    = process.argv[2] ?? 'admin@fantasy.local';
const password = process.argv[3] ?? 'admin1234';
const nombre   = process.argv[4] ?? 'Administrador';

async function createAdmin() {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insertar o actualizar usuario con rol=admin
    const { rows } = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             nombre        = EXCLUDED.nombre,
             rol           = 'admin'
       RETURNING id, nombre, email, rol`,
      [nombre, email.toLowerCase().trim(), hash]
    );
    const usuario = rows[0];

    // Eliminar equipo_fantasy si existiera (admin no participa en la liga)
    const { rowCount } = await client.query(
      `DELETE FROM equipos_fantasy WHERE id_usuario = $1`,
      [usuario.id]
    );
    if (rowCount > 0) {
      console.log(`  → Equipo fantasy previo eliminado para ${usuario.email}`);
    }

    await client.query('COMMIT');

    console.log('Admin creado/actualizado:');
    console.log(`  ID:     ${usuario.id}`);
    console.log(`  Nombre: ${usuario.nombre}`);
    console.log(`  Email:  ${usuario.email}`);
    console.log(`  Rol:    ${usuario.rol}`);
    console.log(`  Pass:   ${password}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

createAdmin().catch((err) => {
  console.error('Error creando admin:', err.message);
  process.exit(1);
});
