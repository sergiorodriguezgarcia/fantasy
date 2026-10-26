import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { clausulaInicial, finProteccion } from '../services/clausulas.js';
import { enviarRecuperacionPassword } from '../services/email.js';

// Recuperar contraseña: caducidad del enlace y máximo de correos por usuario y hora
const MINUTOS_ENLACE = 60;
const MAX_ENLACES_HORA = 3;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

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
        const clausulaDesde = finProteccion();

        for (const [pos, cantidad] of CUOTAS) {
          const { rows: jugadores } = await client.query(
            `SELECT id, precio_actual FROM jugadores
             WHERE posicion = $1 AND activo = TRUE
               AND id NOT IN (SELECT id_jugador FROM plantillas)
               AND id NOT IN (SELECT id_jugador FROM subastas WHERE estado = 'ACTIVA')
             ORDER BY RANDOM()
             LIMIT $2`,
            [pos, cantidad]
          );
          for (const j of jugadores) {
            const clausula = clausulaInicial(j.precio_actual);
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

  // POST /api/auth/recuperar — envía un enlace para restablecer la contraseña.
  // Responde siempre lo mismo, exista o no el email, para no desvelar quién está registrado
  app.post('/recuperar', async (req, reply) => {
    const { email } = req.body ?? {};
    if (!email) return reply.code(400).send({ error: 'email es obligatorio' });
    const respuesta = {
      ok: true,
      mensaje: 'Si hay una cuenta con ese email, te hemos enviado un enlace para restablecer la contraseña.',
    };

    const { rows: [usuario] } = await pool.query(
      `SELECT id, nombre, email FROM usuarios WHERE email = $1`, [email.toLowerCase().trim()]
    );
    if (!usuario) return respuesta;

    // Límite de correos: evita usar el formulario para llenar el buzón de alguien
    const { rows: [{ recientes }] } = await pool.query(
      `SELECT COUNT(*)::int AS recientes FROM recuperaciones_password
       WHERE id_usuario = $1 AND creado_en > NOW() - INTERVAL '1 hour'`,
      [usuario.id]
    );
    if (recientes >= MAX_ENLACES_HORA) return respuesta;

    // Solo vale el último enlace pedido
    const token = randomBytes(32).toString('hex');
    await pool.query(
      `UPDATE recuperaciones_password SET usado = TRUE WHERE id_usuario = $1 AND NOT usado`, [usuario.id]
    );
    await pool.query(
      `INSERT INTO recuperaciones_password (id_usuario, token_hash, expira_en)
       VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
      [usuario.id, hashToken(token), MINUTOS_ENLACE]
    );

    // Sin await: la respuesta no espera a Brevo y tarda lo mismo exista o no la cuenta
    // (enviarCorreo nunca lanza error)
    enviarRecuperacionPassword({
      para: usuario.email, nombre: usuario.nombre, token, minutos: MINUTOS_ENLACE,
    });
    return respuesta;
  });

  // POST /api/auth/restablecer — cambia la contraseña con el token del enlace y deja la sesión iniciada
  app.post('/restablecer', async (req, reply) => {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      return reply.code(400).send({ error: 'token y password son obligatorios' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Marcar el enlace como usado en la misma consulta que lo valida: no se puede usar dos veces
      const { rows: [enlace] } = await client.query(
        `UPDATE recuperaciones_password SET usado = TRUE
         WHERE token_hash = $1 AND NOT usado AND expira_en > NOW()
         RETURNING id_usuario`,
        [hashToken(String(token))]
      );
      if (!enlace) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'El enlace no es válido o ha caducado. Pide uno nuevo.' });
      }

      const { rows: [usuario] } = await client.query(
        `UPDATE usuarios SET password_hash = $1 WHERE id = $2 RETURNING id, nombre, email, rol`,
        [hash, enlace.id_usuario]
      );
      await client.query('COMMIT');

      const tokenSesion = app.jwt.sign({ id: usuario.id, email: usuario.email, rol: usuario.rol });
      return { token: tokenSesion, usuario };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
