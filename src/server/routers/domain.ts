import { router, publicProcedure } from '../trpc.js';
import { domains, tasks } from '../db/schema.js';
import {
  createDomainSchema,
  updateDomainSchema,
  deleteDomainSchema,
} from '../../shared/types.js';
import { eq, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

/**
 * Domain Router
 * 
 * Provides CRUD operations for life domains:
 * - create: Create a new domain
 * - update: Update an existing domain
 * - delete: Delete a domain (with task-existence guard)
 * - list: List all domains with task counts
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export const domainRouter = router({
  /**
   * Create a new domain
   * 
   * Requirement 1.1: Store domain with name, description, why-it-matters, and boring-but-important flag
   */
  create: publicProcedure
    .input(createDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      try {
        const [domain] = await ctx.db
          .insert(domains)
          .values({
            name: input.name,
            description: input.description,
            whyItMatters: input.whyItMatters,
            boringButImportant: input.boringButImportant,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return domain;
      } catch (error: any) {
        // Handle unique constraint violation
        if (error.message?.includes('UNIQUE constraint failed')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Domain name already exists',
          });
        }
        throw error;
      }
    }),

  /**
   * Update an existing domain
   * 
   * Requirement 1.2: Persist changes and reflect them in all associated tasks
   */
  update: publicProcedure
    .input(updateDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if domain exists
      const [existingDomain] = await ctx.db
        .select()
        .from(domains)
        .where(eq(domains.id, id))
        .limit(1);

      if (!existingDomain) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Domain not found',
        });
      }

      const now = new Date().toISOString();

      try {
        const [updatedDomain] = await ctx.db
          .update(domains)
          .set({
            ...updates,
            updatedAt: now,
          })
          .where(eq(domains.id, id))
          .returning();

        return updatedDomain;
      } catch (error: any) {
        // Handle unique constraint violation
        if (error.message?.includes('UNIQUE constraint failed')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Domain name already exists',
          });
        }
        throw error;
      }
    }),

  /**
   * Delete a domain
   * 
   * Requirement 1.3: Prevent deletion if domain has associated tasks
   */
  delete: publicProcedure
    .input(deleteDomainSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if domain exists
      const [existingDomain] = await ctx.db
        .select()
        .from(domains)
        .where(eq(domains.id, input.id))
        .limit(1);

      if (!existingDomain) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Domain not found',
        });
      }

      // Check for associated tasks (task-existence guard)
      const [taskCount] = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(eq(tasks.domainId, input.id));

      if (taskCount.count > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete domain: ${taskCount.count} task(s) are linked to this domain`,
        });
      }

      // Delete the domain
      await ctx.db.delete(domains).where(eq(domains.id, input.id));

      return { success: true, id: input.id };
    }),

  /**
   * List all domains with task counts
   * 
   * Requirement 1.4: Provide list view showing name, task count, and boring-but-important flag
   */
  list: publicProcedure.query(async ({ ctx }) => {
    // Get all domains
    const allDomains = await ctx.db.select().from(domains);

    // Get task counts for each domain
    const domainTaskCounts = await ctx.db
      .select({
        domainId: tasks.domainId,
        count: count(),
      })
      .from(tasks)
      .groupBy(tasks.domainId);

    // Create a map of domain ID to task count
    const taskCountMap = new Map(
      domainTaskCounts.map((item) => [item.domainId, item.count])
    );

    // Combine domains with their task counts
    const domainsWithCounts = allDomains.map((domain) => ({
      ...domain,
      taskCount: taskCountMap.get(domain.id) || 0,
    }));

    return domainsWithCounts;
  }),
});
