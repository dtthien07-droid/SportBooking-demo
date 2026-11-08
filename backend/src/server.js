'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { createApp } = require('./app');
const { closePool, getPool } = require('./config/database');
const {
  readSlotDaysAhead,
  readSlotGeneratorEnabled,
  runSlotGenerator
} = require('./facilities/slot-generator');

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

const slotGeneratorEnabled = readSlotGeneratorEnabled();
const slotDaysAhead = readSlotDaysAhead();
console.info(`[Slot Generator] Config: APP_ENV=${process.env.APP_ENV}, DB_NAME=${process.env.DB_NAME}, enabled=${slotGeneratorEnabled}, days=${slotDaysAhead}.`);
let slotGeneratorRunning = false;
let slotGeneratorTimer = null;

function runSlotGeneration() {
  if (slotGeneratorRunning) return;
  slotGeneratorRunning = true;
  Promise.resolve()
    .then(() => runSlotGenerator(getPool(), { daysAhead: slotDaysAhead, logger: console }))
    .catch((error) => {
      console.error(`[Slot Generator] Failed: ${error.message}`);
    })
    .finally(() => {
      slotGeneratorRunning = false;
    });
}

if (slotGeneratorEnabled) {
  runSlotGeneration();
  slotGeneratorTimer = setInterval(runSlotGeneration, 60 * 60 * 1000);
  slotGeneratorTimer.unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    clearInterval(expiryTimer);
    if (slotGeneratorTimer) clearInterval(slotGeneratorTimer);
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
