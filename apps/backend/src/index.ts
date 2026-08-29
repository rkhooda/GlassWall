// Backend entry point - Fastify server with routes
import Fastify from 'fastify';
import { registerRoutes } from './routes';

const app = Fastify({ 
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }
});

// Register routes
await registerRoutes(app);

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Backend listening on http://localhost:3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();