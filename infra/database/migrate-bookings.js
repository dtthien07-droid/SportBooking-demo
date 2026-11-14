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
  'fk_booking_tickets_booking',
  'fk_notifications_user'
];
const PAYMENT_TICKET_TABLES = ['payment_attempts', 'booking_tickets'];
const MIGRATION_TABLES = [
  ...BASE_TABLES,
  ...BOOKING_TABLES,
  'payments',
  ...PAYMENT_TICKET_TABLES,
  'notifications'
];

async function getMigrationState(connection) {
  const [tableRows] = await connection.execute(
    `SELECT table_name, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    MIGRATION_TABLES
  );
  const tables = new Map(tableRows.map((row) => [row.table_name, row.engine]));

  const [foreignKeyRows] = await connection.execute(
    `SELECT constraint_name
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

async function applyBookingCancellationMigration(connection, databaseName) {
  const migrationPath = path.join(
    __dirname,
    'migrations',
    '006-add-booking-cancellation-details.sql'
  );
  const migration = await fs.readFile(migrationPath, 'utf8');
  const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);

  for (const statement of statements) {
    const columnMatch = /^ALTER TABLE bookings\s+ADD COLUMN\s+([a-z_]+)\s+(.+)$/is.exec(statement);
    if (!columnMatch) {
      throw new Error(`${databaseName}: migration 006 contains an unsupported statement.`);
    }
    const [, columnName] = columnMatch;
    const [existingColumns] = await connection.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = ?`,
      ['bookings', columnName]
    );
    if (existingColumns.length === 0) {
      await connection.query(statement);
    }
  }

  const expectedColumns = ['cancelled_by', 'cancellation_reason', 'cancelled_at'];
  const [verifiedColumns] = await connection.execute(
    `SELECT column_name, column_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name IN (?, ?, ?)`,
    ['bookings', ...expectedColumns]
  );
  const columns = new Map(verifiedColumns.map((row) => [row.column_name, row]));
  const expectedTypes = new Map([
    ['cancelled_by', "enum('USER','ADMIN')"],
    ['cancellation_reason', 'varchar(500)'],
    ['cancelled_at', 'datetime(3)']
  ]);
  if (expectedColumns.some((column) => columns.get(column)?.column_type !== expectedTypes.get(column)
      || columns.get(column)?.is_nullable !== 'YES')) {
    throw new Error(`${databaseName}: migration 006 verification failed.`);
  }
  console.log(`${databaseName}: migration 006 applied and verified.`);
}

async function applyNotificationsMigration(connection, databaseName) {
  const [existingTables] = await connection.execute(
    `SELECT engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    ['notifications']
  );
  if (existingTables.length > 0) {
    const [columns] = await connection.execute(
      `SELECT column_name, column_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      ['notifications']
    );
    const [indexes] = await connection.execute(
      `SELECT index_name, column_name, seq_in_index
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      ['notifications']
    );
    const [foreignKeys] = await connection.execute(
      `SELECT constraint_name
       FROM information_schema.referential_constraints
       WHERE constraint_schema = DATABASE() AND constraint_name = ?`,
      ['fk_notifications_user']
    );
    const expectedColumns = new Map([
      ['id', ['bigint(20) unsigned', 'NO']],
      ['user_id', ['bigint(20) unsigned', 'NO']],
      ['category', ["enum('BOOKING_HOLD','MATCH','PAYMENT','SYSTEM')", 'NO']],
      ['title', ['varchar(180)', 'NO']],
      ['body', ['text', 'NO']],
      ['resource_type', ['varchar(40)', 'YES']],
      ['resource_id', ['bigint(20) unsigned', 'YES']],
      ['read_at', ['datetime(3)', 'YES']],
      ['created_at', ['datetime(3)', 'NO']]
    ]);
    const actualColumns = new Map(columns.map((row) => [
      row.column_name,
      [row.column_type, row.is_nullable]
    ]));
    const expectedIndex = ['user_id', 'read_at', 'created_at'];
    const actualIndex = indexes
      .filter((row) => row.index_name === 'idx_notifications_user_read_created')
      .map((row) => row.column_name);
    const complete = existingTables[0].engine === 'InnoDB'
      && expectedColumns.size === actualColumns.size
      && [...expectedColumns].every(([name, value]) => (
        actualColumns.has(name)
        && actualColumns.get(name)[0] === value[0]
        && actualColumns.get(name)[1] === value[1]
      ))
      && JSON.stringify(actualIndex) === JSON.stringify(expectedIndex)
      && foreignKeys.length === 1;
    if (!complete) {
      throw new Error(`${databaseName}: migration 007 is partially applied or has an unexpected schema.`);
    }
    console.log(`${databaseName}: migration 007 already applied.`);
    return;
  }

  const [userTables] = await connection.execute(
    `SELECT engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    ['users']
  );
  if (userTables.length !== 1 || userTables[0].engine !== 'InnoDB') {
    throw new Error(`${databaseName}: migration 007 requires the InnoDB users table.`);
  }
  const migrationPath = path.join(__dirname, 'migrations', '007-create-notifications.sql');
  const migration = await fs.readFile(migrationPath, 'utf8');
  for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await connection.query(statement);
  }
  await applyNotificationsMigration(connection, databaseName);
}

async function applyAdminAuditMigration(connection, databaseName) {
  const [tables] = await connection.execute(
    `SELECT engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    ['admin_audit_logs']
  );
  if (tables.length > 0) {
    const [columns] = await connection.execute(
      `SELECT column_name, column_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      ['admin_audit_logs']
    );
    const [indexes] = await connection.execute(
      `SELECT index_name, column_name, seq_in_index
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      ['admin_audit_logs']
    );
    const [foreignKeys] = await connection.execute(
      `SELECT constraint_name
       FROM information_schema.referential_constraints
       WHERE constraint_schema = DATABASE() AND constraint_name = ?`,
      ['fk_admin_audit_logs_user']
    );
    const expectedColumns = new Map([
      ['id', ['bigint(20) unsigned', 'NO']],
      ['admin_user_id', ['bigint(20) unsigned', 'NO']],
      ['action', ['varchar(80)', 'NO']],
      ['resource_type', ['varchar(40)', 'NO']],
      ['resource_id', ['bigint(20) unsigned', 'NO']],
      ['details', ['longtext', 'YES']],
      ['created_at', ['datetime(3)', 'NO']]
    ]);
    const actualColumns = new Map(columns.map((row) => [
      row.column_name,
      [row.column_type, row.is_nullable]
    ]));
    const resourceIndex = indexes
      .filter((row) => row.index_name === 'idx_admin_audit_resource')
      .map((row) => row.column_name);
    const adminIndex = indexes
      .filter((row) => row.index_name === 'idx_admin_audit_admin_created')
      .map((row) => row.column_name);
    const complete = tables[0].engine === 'InnoDB'
      && expectedColumns.size === actualColumns.size
      && [...expectedColumns].every(([name, value]) => (
        actualColumns.has(name)
        && actualColumns.get(name)[0] === value[0]
        && actualColumns.get(name)[1] === value[1]
      ))
      && JSON.stringify(resourceIndex) === JSON.stringify(['resource_type', 'resource_id'])
      && JSON.stringify(adminIndex) === JSON.stringify(['admin_user_id', 'created_at'])
      && foreignKeys.length === 1;
    if (!complete) {
      throw new Error(`${databaseName}: migration 008 is partially applied or has an unexpected schema.`);
    }
    console.log(`${databaseName}: migration 008 already applied.`);
    return;
  }

  const [users] = await connection.execute(
    `SELECT engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    ['users']
  );
  if (users.length !== 1 || users[0].engine !== 'InnoDB') {
    throw new Error(`${databaseName}: migration 008 requires the InnoDB users table.`);
  }
  const migrationPath = path.join(__dirname, 'migrations', '008-create-admin-audit-logs.sql');
  const migration = await fs.readFile(migrationPath, 'utf8');
  for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await connection.query(statement);
  }
  await applyAdminAuditMigration(connection, databaseName);
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
    await applyBookingCancellationMigration(connection, databaseName);
    await applyNotificationsMigration(connection, databaseName);
    await applyAdminAuditMigration(connection, databaseName);
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
