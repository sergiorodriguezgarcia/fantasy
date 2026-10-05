import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { authRoutes } from './routes/auth.js';
import { jugadoresRoutes } from './routes/jugadores.js';
import { equiposRoutes } from './routes/equipos.js';
import { jornadasRoutes } from './routes/jornadas.js';
import { mercadoRoutes } from './routes/mercado.js';
import { adminRoutes } from './routes/admin.js';
import { clasificacionRoutes } from './routes/clasificacion.js';
import { ofertasRoutes } from './routes/ofertas.js';
import { cronRoutes } from './routes/cron.js';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'production' });

  await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev_secret_inseguro',
  });

  app.decorate('authenticate', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'No autenticado' });
    }
  });

  app.decorate('requireAdmin', async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (req.user?.rol !== 'admin') {
      return reply.code(403).send({ error: 'Se requiere rol administrador' });
    }
  });

  await app.register(authRoutes,          { prefix: '/api/auth' });
  await app.register(jugadoresRoutes,     { prefix: '/api/jugadores' });
  await app.register(equiposRoutes,       { prefix: '/api/equipos' });
  await app.register(jornadasRoutes,      { prefix: '/api/jornadas' });
  await app.register(mercadoRoutes,       { prefix: '/api/mercado' });
  await app.register(adminRoutes,         { prefix: '/api/admin' });
  await app.register(clasificacionRoutes, { prefix: '/api/clasificacion' });
  await app.register(ofertasRoutes,       { prefix: '/api/ofertas' });
  await app.register(cronRoutes,          { prefix: '/api/cron' });

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
