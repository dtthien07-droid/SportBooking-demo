'use strict';

const { createApp } = require('./app');
const { closePool, getPool } = require('./config/database');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

const server = createApp({ pool: getPool() }).listen(port);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        process.exitCode = 1;
      }
      closePool().catch(() => {
        console.error('Failed to close database connections.');
        process.exitCode = 1;
      });
    });
  });
}
