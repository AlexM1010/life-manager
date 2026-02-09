import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { domainRouter } from '../domain.js';
import * as schema from '../../db/schema.js';
import * as fc from 'fast-check';

/**
 * Domain Router Tests
 * 
 * Tests for Domain CRUD operations including:
 * - Property 1: Domain CRUD Round-Trip
 * - Property 2: Domain Deletion Guard
 * - Property 3: Domain List Accuracy
 * 
 * Validates Requirements: 1.1, 1.2, 1.3, 1.4
 */

// Test database setup
let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof domainRouter.createCaller>;

beforeEach(() => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });

  // Create caller with test context
  caller = domainRouter.createCaller({ db });
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Unit Tests - Specific Examples and Edge Cases
// ============================================================================

describe('Domain CRUD - Unit Tests', () => {
  describe('create', () => {
    it('should create a domain with all fields', async () => {
      const input = {
        name: 'Health',
        description: 'Physical and mental wellbeing',
        whyItMatters: 'Foundation for everything else',
        boringButImportant: false,
      };

      const result = await caller.create(input);

      expect(result).toMatchObject({
        id: expect.any(Number),
        name: 'Health',
        description: 'Physical and mental wellbeing',
        whyItMatters: 'Foundation for everything else',
        boringButImportant: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should create a domain with minimal fields (defaults)', async () => {
      const input = {
        name: 'Admin',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      };

      const result = await caller.create(input);

      expect(result).toMatchObject({
        name: 'Admin',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });
    });

    it('should reject duplicate domain names', async () => {
      await caller.create({
        name: 'Health',
        description: 'First',
        whyItMatters: '',
        boringButImportant: false,
      });

      await expect(
        caller.create({
          name: 'Health',
          description: 'Second',
          whyItMatters: '',
          boringButImportant: false,
        })
      ).rejects.toThrow('Domain name already exists');
    });

    it('should create domains with boring-but-important flag', async () => {
      const result = await caller.create({
        name: 'Admin',
        description: 'Paperwork and bureaucracy',
        whyItMatters: 'Keeps life running',
        boringButImportant: true,
      });

      expect(result.boringButImportant).toBe(true);
    });
  });

  describe('update', () => {
    it('should update domain name', async () => {
      const created = await caller.create({
        name: 'Health',
        description: 'Original',
        whyItMatters: '',
        boringButImportant: false,
      });

      const updated = await caller.update({
        id: created.id,
        name: 'Health & Wellness',
      });

      expect(updated.name).toBe('Health & Wellness');
      expect(updated.description).toBe('Original'); // unchanged
    });

    it('should update multiple fields', async () => {
      const created = await caller.create({
        name: 'Admin',
        description: 'Old',
        whyItMatters: 'Old reason',
        boringButImportant: false,
      });

      const updated = await caller.update({
        id: created.id,
        description: 'New description',
        whyItMatters: 'New reason',
        boringButImportant: true,
      });

      expect(updated).toMatchObject({
        name: 'Admin', // unchanged
        description: 'New description',
        whyItMatters: 'New reason',
        boringButImportant: true,
      });
    });

    it('should reject update to duplicate name', async () => {
      await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      const admin = await caller.create({
        name: 'Admin',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      await expect(
        caller.update({
          id: admin.id,
          name: 'Health',
        })
      ).rejects.toThrow('Domain name already exists');
    });

    it('should reject update of non-existent domain', async () => {
      await expect(
        caller.update({
          id: 999,
          name: 'Does not exist',
        })
      ).rejects.toThrow('Domain not found');
    });

    it('should update updatedAt timestamp', async () => {
      const created = await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await caller.update({
        id: created.id,
        description: 'Updated',
      });

      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  describe('delete', () => {
    it('should delete domain with no tasks', async () => {
      const created = await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      const result = await caller.delete({ id: created.id });

      expect(result).toEqual({ success: true, id: created.id });

      // Verify domain is gone
      const list = await caller.list();
      expect(list).toHaveLength(0);
    });

    it('should reject deletion of non-existent domain', async () => {
      await expect(caller.delete({ id: 999 })).rejects.toThrow('Domain not found');
    });

    it('should reject deletion of domain with tasks (task-existence guard)', async () => {
      // Create domain
      const domain = await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      // Create task linked to domain
      await db.insert(schema.tasks).values({
        title: 'Exercise',
        domainId: domain.id,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Attempt to delete domain
      await expect(caller.delete({ id: domain.id })).rejects.toThrow(
        'Cannot delete domain: 1 task(s) are linked to this domain'
      );

      // Verify domain still exists
      const list = await caller.list();
      expect(list).toHaveLength(1);
    });

    it('should show correct task count in error message', async () => {
      const domain = await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      // Create multiple tasks
      for (let i = 0; i < 3; i++) {
        await db.insert(schema.tasks).values({
          title: `Task ${i}`,
          domainId: domain.id,
          priority: 'must-do',
          estimatedMinutes: 30,
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      await expect(caller.delete({ id: domain.id })).rejects.toThrow(
        'Cannot delete domain: 3 task(s) are linked to this domain'
      );
    });
  });

  describe('list', () => {
    it('should return empty list when no domains exist', async () => {
      const result = await caller.list();
      expect(result).toEqual([]);
    });

    it('should list single domain with zero tasks', async () => {
      const created = await caller.create({
        name: 'Health',
        description: 'Desc',
        whyItMatters: 'Why',
        boringButImportant: false,
      });

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: created.id,
        name: 'Health',
        description: 'Desc',
        whyItMatters: 'Why',
        boringButImportant: false,
        taskCount: 0,
      });
    });

    it('should list multiple domains with correct task counts', async () => {
      // Create domains
      const health = await caller.create({
        name: 'Health',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
      });

      const admin = await caller.create({
        name: 'Admin',
        description: '',
        whyItMatters: '',
        boringButImportant: true,
      });

      // Create tasks
      await db.insert(schema.tasks).values([
        {
          title: 'Exercise',
          domainId: health.id,
          priority: 'must-do',
          estimatedMinutes: 30,
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          title: 'Meditate',
          domainId: health.id,
          priority: 'should-do',
          estimatedMinutes: 15,
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          title: 'Pay bills',
          domainId: admin.id,
          priority: 'must-do',
          estimatedMinutes: 20,
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await caller.list();

      expect(result).toHaveLength(2);

      const healthDomain = result.find((d) => d.name === 'Health');
      const adminDomain = result.find((d) => d.name === 'Admin');

      expect(healthDomain?.taskCount).toBe(2);
      expect(adminDomain?.taskCount).toBe(1);
      expect(adminDomain?.boringButImportant).toBe(true);
    });
  });
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Domain CRUD - Property Tests', () => {
  // Helper to create a fresh database for each property test iteration
  const createFreshDb = () => {
    const sqliteDb = new BetterSqlite3(':memory:');
    const db = drizzle(sqliteDb, { schema });
    migrate(db, { migrationsFolder: './drizzle' });
    const caller = domainRouter.createCaller({ db });
    return { sqliteDb, db, caller };
  };

  // Arbitraries (generators) for property-based testing
  const domainNameArb = fc.string({ minLength: 1, maxLength: 100 });
  const domainDescriptionArb = fc.string({ maxLength: 500 });
  const booleanArb = fc.boolean();

  const validDomainInputArb = fc.record({
    name: domainNameArb,
    description: domainDescriptionArb,
    whyItMatters: domainDescriptionArb,
    boringButImportant: booleanArb,
  });

  /**
   * Property 1: Domain CRUD Round-Trip
   * 
   * For any valid domain input, creating the domain and reading it back
   * should return an object with identical field values.
   * 
   * Validates: Requirements 1.1, 1.2
   */
  it('Property 1: Domain CRUD Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(validDomainInputArb, async (input) => {
        // Create fresh database for this iteration
        const { sqliteDb: testDb, caller: testCaller } = createFreshDb();

        try {
          // Create domain
          const created = await testCaller.create(input);

          // Verify all fields match
          expect(created.name).toBe(input.name);
          expect(created.description).toBe(input.description);
          expect(created.whyItMatters).toBe(input.whyItMatters);
          expect(created.boringButImportant).toBe(input.boringButImportant);

          // Read back via list
          const list = await testCaller.list();
          const found = list.find((d) => d.id === created.id);

          expect(found).toBeDefined();
          expect(found?.name).toBe(input.name);
          expect(found?.description).toBe(input.description);
          expect(found?.whyItMatters).toBe(input.whyItMatters);
          expect(found?.boringButImportant).toBe(input.boringButImportant);

          // Update a field
          const updated = await testCaller.update({
            id: created.id,
            description: 'Updated description',
          });

          expect(updated.description).toBe('Updated description');
          expect(updated.name).toBe(input.name); // unchanged
        } finally {
          testDb.close();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Domain Deletion Guard
   * 
   * For any domain that has at least one associated task, attempting to
   * delete that domain should fail with an error, and the domain should
   * remain in the database unchanged.
   * 
   * Validates: Requirements 1.3
   */
  it('Property 2: Domain Deletion Guard', async () => {
    await fc.assert(
      fc.asyncProperty(
        validDomainInputArb,
        fc.integer({ min: 1, max: 10 }),
        async (domainInput, taskCount) => {
          // Create fresh database for this iteration
          const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

          try {
            // Create domain
            const domain = await testCaller.create(domainInput);

            // Create tasks linked to domain
            for (let i = 0; i < taskCount; i++) {
              await testDbInstance.insert(schema.tasks).values({
                title: `Task ${i}`,
                domainId: domain.id,
                priority: 'must-do',
                estimatedMinutes: 30,
                status: 'todo',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }

            // Attempt to delete should fail
            await expect(testCaller.delete({ id: domain.id })).rejects.toThrow();

            // Verify domain still exists
            const list = await testCaller.list();
            const found = list.find((d) => d.id === domain.id);
            expect(found).toBeDefined();
            expect(found?.taskCount).toBe(taskCount);
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 3: Domain List Accuracy
   * 
   * For any set of domains and tasks, listing all domains should return
   * each domain with a task count equal to the actual number of tasks
   * linked to that domain, and the boringButImportant flag matching
   * the stored value.
   * 
   * Validates: Requirements 1.4
   */
  it('Property 3: Domain List Accuracy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validDomainInputArb, { minLength: 1, maxLength: 5 }),
        async (domainInputs) => {
          // Create fresh database for this iteration
          const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

          try {
            // Create domains with unique names
            const uniqueDomains = domainInputs.map((d, i) => ({
              ...d,
              name: `${d.name}_${i}`, // ensure uniqueness
            }));

            const createdDomains = [];
            for (const input of uniqueDomains) {
              const domain = await testCaller.create(input);
              createdDomains.push(domain);
            }

            // Create random number of tasks for each domain
            const expectedCounts = new Map<number, number>();
            for (const domain of createdDomains) {
              const taskCount = Math.floor(Math.random() * 5);
              expectedCounts.set(domain.id, taskCount);

              for (let i = 0; i < taskCount; i++) {
                await testDbInstance.insert(schema.tasks).values({
                  title: `Task ${i} for domain ${domain.id}`,
                  domainId: domain.id,
                  priority: 'must-do',
                  estimatedMinutes: 30,
                  status: 'todo',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            }

            // List domains and verify counts
            const list = await testCaller.list();

            expect(list).toHaveLength(createdDomains.length);

            for (const domain of createdDomains) {
              const found = list.find((d) => d.id === domain.id);
              expect(found).toBeDefined();
              expect(found?.taskCount).toBe(expectedCounts.get(domain.id));
              expect(found?.boringButImportant).toBe(domain.boringButImportant);
            }
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
