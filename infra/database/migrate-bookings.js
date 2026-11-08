'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { getAllowedPool, readDatabaseTarget } = require('./facilities-db');

const BASE_TABLES = ['users', 'courts', 'time_slots', 'facilities'];
const BOOKING_TABLES = ['bookings', 'booking_slots'];
const FOREIGN_KEYS = [
  'fk_bookings_user',
  'fk_booking_slots_booking',
  'fk_booking_slots_time_slot',
  'fk_booking_slots_court',
  'fk_time_slots_current_booking'
];

async function getMigrationState(connection) {
  const [tableRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (?, ?, ?, ?, ?, ?)`,
    [...BASE_TABLES, ...BOOKING_TABLES]
  );
  const tables = new Map(tableRows.map((row) => [row.table_name, row.engine]));

  const [foreignKeyRows] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN (?, ?, ?, ?, ?)`,
    FOREIGN_KEYS
  );

  return {
    tables,
    foreignKeys: new Set(foreignKeyRows.map((row) => row.constraint_name))
  };
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
    const allForeignKeysExist = FOREIGN_KEYS.every((key) => state.foreignKeys.has(key));
    if (allBookingTablesExist && allForeignKeysExist) {
      console.log(`${databaseName}: migration 003 already applied.`);
      return;
    }
    if (existingBookingTables.length > 0 || state.foreignKeys.size > 0) {
      throw new Error(
        `${databaseName}: migration 003 is partially applied; refusing to alter the schema automatically.`
      );
    }

    const migrationPath = path.join(__dirname, 'migrations', '003-create-booking-tables.sql');
    const migration = await fs.readFile(migrationPath, 'utf8');
    const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) {
      await connection.query(statement);
    }

    const migratedState = await getMigrationState(connection);
    const missingTables = BOOKING_TABLES.filter((table) => !migratedState.tables.has(table));
    const missingForeignKeys = FOREIGN_KEYS.filter((key) => !migratedState.foreignKeys.has(key));
    if (missingTables.length || missingForeignKeys.length) {
      throw new Error(
        `${databaseName}: migration verification failed; missing tables: `
        + `${missingTables.join(', ') || 'none'}; missing foreign keys: `
        + `${missingForeignKeys.join(', ') || 'none'}.`
      );
    }
    console.log(`${databaseName}: migration 003 applied and verified.`);
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
