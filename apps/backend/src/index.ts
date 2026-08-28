import Fastify from 'fastify';

const app = Fastify({ logger: true });

// eslint-disable-next-line @typescript-eslint/require-await
app.get('/v1/health', async () => ({ status: 'ok' }));

// eslint-disable-next-line @typescript-eslint/require-await
app.post('/v1/session', async (_request) => {
  return { session_id: 'test', budget: { steps: 20, ms: 300000 } };
});

// eslint-disable-next-line @typescript-eslint/require-await
app.post('/v1/step', async (_request) => {
  return {
    action: { type: 'DONE', summary: 'Scripted planner stub' },
  };
});

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
