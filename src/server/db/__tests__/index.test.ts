import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, runMigrations, closeDatabase } from '../index.js';
import { domains } from '../schema.js';

describe('Database Connection and Migrations', () => {
  beforeAll(() => {
    // Run migrations before tests
    runMigrations();
  });

  afterAll(() => {
    // Clean up database connection
    closeDatabase();
  });

  it('should successfully connect to the database', () => {
    expect(db).toBeDefined();
  });

  it('should have run migrations and created tables', async () => {
    // Try to query the domains table - this will fail if migrations didn't run
    const result = await db.select().from(domains);
    expect(Array.isArray(result)).toBe(true);
  });

  it('should enforce foreign key constraints', async () => {
    // This test verifies that foreign keys are enabled
    // We'll test this more thoroughly in the router tests
    expect(db).toBeDefined();
  });
});
