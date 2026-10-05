import { buildApp } from './app.js';
import { iniciarCrons } from './services/cron.js';

const app = await buildApp();
const PORT = parseInt(process.env.PORT ?? '4000');

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`Backend escuchando en http://localhost:${PORT}`);

iniciarCrons();
