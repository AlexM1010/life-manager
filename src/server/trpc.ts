import { initTRPC } from '@trpc/server';
import { db } from './db/index.js';

/**
 * tRPC Context
 * 
 * This context is created for each request and provides access to:
 * - Database instance (Drizzle ORM)
 * 
 * The context is available in all tRPC procedures via `ctx`.
 */
export interface Context {
  db: typeof db;
}

/**
 * Create tRPC context
 * 
 * This function is called for each incoming request to create the context
 * that will be available in all procedures.
 */
export const createContext = (): Context => {
  return {
    db,
  };
};

/**
 * Initialize tRPC instance
 * 
 * This creates the tRPC instance with the context type.
 * We use this to create routers and procedures.
 */
const t = initTRPC.context<Context>().create();

/**
 * Export reusable router and procedure builders
 * 
 * - router: Used to create tRPC routers
 * - publicProcedure: Used to create public procedures (no auth required)
 */
export const router = t.router;
export const publicProcedure = t.procedure;

