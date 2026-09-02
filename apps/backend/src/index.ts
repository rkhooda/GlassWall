// Gateway entry point: Fastify server exposing /v1/health, /v1/session, /v1/step.
import Fastify from 'fastify';
import { registerRoutes } from './routes/index.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await registerRoutes(app);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
