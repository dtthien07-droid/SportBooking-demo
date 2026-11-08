'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { getAllowedPool, readDatabaseTarget } = require('./facilities-db');

const TABLES = ['facilities', 'courts', 'time_slots'];

async function migrateFacilities(databaseName) {
  const pool = getAllowedPool(databaseName);
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN (?, ?, ?)`,
      TABLES
    );
    const existingCount = Number(rows[0].table_count);
    if (existingCount === TABLES.length) {
      console.log(`${databaseName}: migration 002 already applied.`);
      return;
    }
    if (existingCount !== 0) {
      throw new Error(`${databaseName}: only some module 2 tables exist; refusing partial migration.`);
    }

    const migrationPath = path.join(__dirname, 'migrations', '002-create-facility-tables.sql');
    const migration = await fs.readFile(migrationPath, 'utf8');
    const statements = migration.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) {
      await connection.query(statement);
    }
    console.log(`${databaseName}: migration 002 applied.`);
  } finally {
    connection.release();
    await pool.end();
  }
}

async function main() {
  const databaseName = readDatabaseTarget();
  await migrateFacilities(databaseName);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Facilities migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateFacilities };
