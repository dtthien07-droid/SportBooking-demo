'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { getAllowedPool, readDatabaseTarget } = require('./facilities-db');

const BASE_TABLES = ['users', 'courts', 'time_slots', 'facilities'];
const BOOKING_TABLES = ['bookings', 'booking_slots'];
const BOOKING_FOREIGN_KEYS = [
  'fk_bookings_user',
  'fk_booking_slots_booking',
  'fk_booking_slots_time_slot',
  'fk_booking_slots_court',
  'fk_time_slots_current_booking'
];
const FOREIGN_KEYS = [
  ...BOOKING_FOREIGN_KEYS,
  'fk_payments_booking',
  'fk_payment_attempts_payment',
  'fk_booking_tickets_booking'
];
const PAYMENT_TICKET_TABLES = ['payment_attempts', 'booking_tickets'];
const MIGRATION_TABLES = [...BASE_TABLES, ...BOOKING_TABLES, 'payments', ...PAYMENT_TICKET_TABLES];

async function getMigrationState(connection) {
  const [tableRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    MIGRATION_TABLES
  );
  const tables = new Map(tableRows.map((row) => [row.table_name, row.engine]));

  const [foreignKeyRows] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN (?, ?, ?, ?, ?, ?, ?, ?)`,
    FOREIGN_KEYS
  );

  return {
    tables,
    foreignKeys: new Set(foreignKeyRows.map((row) => row.constraint_name))
  };
}

async function applyBookingPreferencesMigration(connection, databaseName) {
  const [columnRows] = await connection.execute(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bookings'
       AND column_name = 'match_preference'`
  );
  const [paymentRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'payments'`
  );
  const [foreignKeyRows] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_payments_booking'`
  );
  const hasPreference = columnRows.length > 0;
  const hasPayments = paymentRows.length > 0;
  const hasPaymentForeignKey = foreignKeyRows.length > 0;

  if (hasPreference && hasPayments && paymentRows[0].engine === 'InnoDB' && hasPaymentForeignKey) {
    console.log(`${databaseName}: migration 004 already applied.`);
    return;
  }
  if (hasPreference || hasPayments || hasPaymentForeignKey) {
    throw new Error(`${databaseName}: migration 004 is partially applied; refusing to alter the schema automatically.`);
  }

  const migrationPath = path.join(__dirname, 'migrations', '004-add-booking-match-preference-and-payments.sql');
  const migration = await fs.readFile(migrationPath, 'utf8');
  const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    await connection.query(statement);
  }

  const [verifiedColumns] = await connection.execute(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bookings'
       AND column_name = 'match_preference'`
  );
  const [verifiedTables] = await connection.execute(
    `SELECT table_name, engine FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'payments'`
  );
  const [verifiedForeignKeys] = await connection.execute(
    `SELECT constraint_name FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_payments_booking'`
  );
  if (!verifiedColumns.length || !verifiedTables.length || verifiedTables[0].engine !== 'InnoDB'
      || !verifiedForeignKeys.length) {
    throw new Error(`${databaseName}: migration 004 verification failed.`);
  }
  console.log(`${databaseName}: migration 004 applied and verified.`);
}

async function applyPaymentTicketMigration(connection, databaseName) {
  const [paymentRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'payments'`
  );
  const [targetRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (?, ?)` ,
    PAYMENT_TICKET_TABLES
  );
  const [foreignKeyRows] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN (?, ?, ?)` ,
    ['fk_payments_booking', 'fk_payment_attempts_payment', 'fk_booking_tickets_booking']
  );
  if (paymentRows.length !== 1 || paymentRows[0].engine !== 'InnoDB'
      || !foreignKeyRows.some((row) => row.constraint_name === 'fk_payments_booking')) {
    throw new Error(`${databaseName}: migration 005 requires migration 004 payments with its foreign key.`);
  }

  const existingTables = new Set(targetRows.map((row) => row.table_name));
  const existingForeignKeys = new Set(foreignKeyRows.map((row) => row.constraint_name));
  const expectedForeignKeys = ['fk_payment_attempts_payment', 'fk_booking_tickets_booking'];
  if (PAYMENT_TICKET_TABLES.every((table) => existingTables.has(table))
      && targetRows.every((row) => row.engine === 'InnoDB')
      && expectedForeignKeys.every((key) => existingForeignKeys.has(key))) {
    console.log(`${databaseName}: migration 005 already applied.`);
    return;
  }
  if (targetRows.length > 0 || expectedForeignKeys.some((key) => existingForeignKeys.has(key))) {
    throw new Error(`${databaseName}: migration 005 is partially applied; refusing to alter the schema automatically.`);
  }

  const migrationPath = path.join(__dirname, 'migrations', '005-create-payment-attempts-and-booking-tickets.sql');
  const migration = await fs.readFile(migrationPath, 'utf8');
  const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    await connection.query(statement);
  }

  const [verifiedTables] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (?, ?)` ,
    PAYMENT_TICKET_TABLES
  );
  const [verifiedForeignKeys] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name IN (?, ?)` ,
    expectedForeignKeys
  );
  if (verifiedTables.length !== PAYMENT_TICKET_TABLES.length
      || verifiedTables.some((row) => row.engine !== 'InnoDB')
      || verifiedForeignKeys.length !== expectedForeignKeys.length) {
    throw new Error(`${databaseName}: migration 005 verification failed.`);
  }
  console.log(`${databaseName}: migration 005 applied and verified.`);
}

async function migrateBookings(databaseName) {
  const pool = getAllowedPool(databaseName);
  const connection = await pool.getConnection();
  try {
    const [databaseRows] = await connection.execute('SELECT DATABASE() AS database_name');
    if (databaseRows[0].database_name !== databaseName) {
      throw new Error(`Refusing to migrate unexpected database ${databaseRows[0].database_name}.`);
    }

    const state = await getMigrationState(connection);
    const missingBaseTables = BASE_TABLES.filter((table) => !state.tables.has(table));
    const nonInnoDbTables = BASE_TABLES.filter(
      (table) => state.tables.has(table) && state.tables.get(table) !== 'InnoDB'
    );
    if (missingBaseTables.length || nonInnoDbTables.length) {
      throw new Error(
        `${databaseName}: migration prerequisites failed; missing base tables: `
        + `${missingBaseTables.join(', ') || 'none'}; non-InnoDB tables: `
        + `${nonInnoDbTables.join(', ') || 'none'}.`
      );
    }

    const existingBookingTables = BOOKING_TABLES.filter((table) => state.tables.has(table));
    const allBookingTablesExist = existingBookingTables.length === BOOKING_TABLES.length;
    const allForeignKeysExist = BOOKING_FOREIGN_KEYS.every((key) => state.foreignKeys.has(key));
    if (allBookingTablesExist && allForeignKeysExist) {
      console.log(`${databaseName}: migration 003 already applied.`);
    } else if (existingBookingTables.length > 0 || state.foreignKeys.size > 0) {
      throw new Error(
        `${databaseName}: migration 003 is partially applied; refusing to alter the schema automatically.`
      );
    } else {
      const migrationPath = path.join(__dirname, 'migrations', '003-create-booking-tables.sql');
      const migration = await fs.readFile(migrationPath, 'utf8');
      const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) {
        await connection.query(statement);
      }

      const migratedState = await getMigrationState(connection);
      const missingTables = BOOKING_TABLES.filter((table) => !migratedState.tables.has(table));
      const missingForeignKeys = BOOKING_FOREIGN_KEYS.filter((key) => !migratedState.foreignKeys.has(key));
      if (missingTables.length || missingForeignKeys.length) {
        throw new Error(
          `${databaseName}: migration verification failed; missing tables: `
          + `${missingTables.join(', ') || 'none'}; missing foreign keys: `
          + `${missingForeignKeys.join(', ') || 'none'}.`
        );
      }
      console.log(`${databaseName}: migration 003 applied and verified.`);
    }
    await applyBookingPreferencesMigration(connection, databaseName);
    await applyPaymentTicketMigration(connection, databaseName);
  } finally {
    connection.release();
    await pool.end();
  }
}

async function main() {
  const databaseName = readDatabaseTarget();
  await migrateBookings(databaseName);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Booking migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateBookings };
