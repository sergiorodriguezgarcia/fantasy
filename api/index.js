// Vercel Serverless Function — envuelve la app Fastify
import { buildApp } from '../src/app.js';

let app;

async function getApp() {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export default async function handler(req, res) {
  const fastify = await getApp();
  fastify.server.emit('request', req, res);
}
