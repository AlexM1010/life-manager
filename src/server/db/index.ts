import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

// Database file path
const DB_PATH = './life-manager.db';

// Create better-sqlite3 connection
const sqlite = new Database(DB_PATH);

// Enable foreign key constraints (SQLite doesn't enable them by default)
sqlite.pragma('foreign_keys = ON');

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

/**
 * Run pending Drizzle migrations
 * This should be called on application startup
 */
export function runMigrations() {
  try {
    migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
}

/**
 * Close the database connection
 * Call this on application shutdown for clean exit
 */
export function closeDatabase() {
  sqlite.close();
  console.log('Database connection closed');
}

// Export the raw sqlite instance for advanced use cases
export { sqlite };
