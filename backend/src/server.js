'use strict';

const { createApp } = require('./app');
const { closePool, getPool } = require('./config/database');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

const app = createApp({ pool: getPool() });
const server = app.listen(port);
const expiryTimer = setInterval(() => {
  app.locals.bookingsService.releaseExpiredBookings().catch((error) => {
    console.error(`[Booking Expiry Job] Failed: ${error.message}`);
  });
}, 60_000);
expiryTimer.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    clearInterval(expiryTimer);
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
