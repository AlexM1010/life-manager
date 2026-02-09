import 'dotenv/config';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createContext, router } from './trpc.js';
import { domainRouter } from './routers/domain.js';
import { taskRouter } from './routers/task.js';
import { plannerRouter } from './routers/planner.js';
import { dailyLogRouter } from './routers/dailyLog.js';
import { statsRouter } from './routers/stats.js';
import { summaryRouter } from './routers/summary.js';
import { syncRouter } from './routers/sync.js';
import { mobileRouter } from './routers/mobile.js';

/**
 * Life Manager Express Server
 * 
 * This server provides:
 * - tRPC API endpoints at /api/trpc
 * - Static file serving for the React frontend (in production)
 * 
 * In development:
 * - Vite dev server runs on port 5173 and proxies /api to this server
 * - This server runs on port 3000
 * 
 * In production:
 * - This server serves both API and static files on port 3000
 * 
 * Requirements: 10.4
 */

/**
 * App Router
 * 
 * Combines all tRPC routers into a single app router.
 * Add new routers here as they are implemented.
 */
export const appRouter = router({
  domain: domainRouter,
  task: taskRouter,
  planner: plannerRouter,
  dailyLog: dailyLogRouter,
  stats: statsRouter,
  summary: summaryRouter,
  sync: syncRouter,
  mobile: mobileRouter,
});

/**
 * Export type definition for the app router
 * 
 * This type is used by the tRPC client to provide end-to-end type safety.
 * The client can import this type and get full TypeScript autocomplete
 * and type checking for all API calls.
 */
export type AppRouter = typeof appRouter;

/**
 * Create and configure Express app
 */
const app = express();

/**
 * tRPC middleware
 * 
 * Handles all tRPC requests at /api/trpc
 * Creates a new context for each request
 */
app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

/**
 * Health check endpoint
 * 
 * Useful for monitoring and debugging
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start server
 */
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Life Manager server running on http://localhost:${PORT}`);
  console.log(`📡 tRPC endpoint: http://localhost:${PORT}/api/trpc`);
  console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
});
