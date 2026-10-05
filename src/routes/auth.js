import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

export async function authRoutes(app) {

  // POST /api/auth/registro
  app.post('/registro', async (req, reply) => {
    const { nombre, email, password } = req.body ?? {};
    if (!nombre || !email || !password) {
      return reply.code(400).send({ error: 'nombre, email y password son obligatorios' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO usuarios (nombre, email, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, nombre, email, rol`,
        [nombre.trim(), email.toLowerCase().trim(), hash]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'El email ya está registrado' });
      }

      const usuario = rows[0];

      // Los admins no participan en la liga: no tienen equipo fantasy
      if (usuario.rol !== 'admin') {
        // Crear equipo fantasy automáticamente
        const { rows: equipoRows } = await client.query(
          `INSERT INTO equipos_fantasy (id_usuario, nombre, saldo_disponible)
           VALUES ($1, $2, 100000000)
           RETURNING id`,
          [usuario.id, `Equipo de ${nombre.trim()}`]
        );
        const idEquipo = equipoRows[0].id;

        // Asignar jugadores iniciales aleatorios (1 POR, 4 DEF, 4 MED, 3 DEL)
        const CUOTAS = [['POR', 1], ['DEF', 4], ['MED', 4], ['DEL', 3]];
        const clausulaDesde = new Date(Date.now() + 15 * 86_400_000)
          .toISOString().split('T')[0];

        for (const [pos, cantidad] of CUOTAS) {
          const { rows: jugadores } = await client.query(
            `SELECT id, precio_actual FROM jugadores
             WHERE posicion = $1 AND activo = TRUE
               AND id NOT IN (SELECT id_jugador FROM plantillas)
             ORDER BY RANDOM()
             LIMIT $2`,
            [pos, cantidad]
          );
          for (const j of jugadores) {
            const clausula = Math.round(j.precio_actual * 1.5);
            await client.query(
              `INSERT INTO plantillas
                 (id_equipo_fantasy, id_jugador, precio_compra,
                  clausula_monto, clausula_activa_desde)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT DO NOTHING`,
              [idEquipo, j.id, j.precio_actual, clausula, clausulaDesde]
            );
          }
        }

        // Apuntarse a la liga global
        const { rows: ligaRows } = await client.query(
          `SELECT id FROM ligas WHERE publica = TRUE LIMIT 1`
        );
        if (ligaRows.length > 0) {
          await client.query(
            `INSERT INTO equipos_en_liga (id_equipo_fantasy, id_liga)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [idEquipo, ligaRows[0].id]
          );
        }
      }

      await client.query('COMMIT');

      const token = app.jwt.sign({ id: usuario.id, email: usuario.email, rol: usuario.rol });
      return { token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/auth/login
  app.post('/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email y password son obligatorios' });
    }

    const { rows } = await pool.query(
      `SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return reply.code(401).send({ error: 'Credenciales incorrectas' });
    }

    const usuario = rows[0];
    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: 'Credenciales incorrectas' });
    }

    const token = app.jwt.sign({ id: usuario.id, email: usuario.email, rol: usuario.rol });
    return {
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    };
  });

  // GET /api/auth/me  (requiere token)
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, ef.id AS id_equipo, ef.nombre AS nombre_equipo,
              ef.saldo_disponible, ef.saldo_bloqueado
       FROM usuarios u
       LEFT JOIN equipos_fantasy ef ON ef.id_usuario = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return app.httpErrors?.notFound() ?? { error: 'Usuario no encontrado' };
    return rows[0];
  });
}
