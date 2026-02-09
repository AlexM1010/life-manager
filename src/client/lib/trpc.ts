import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@server/index.js';

/**
 * tRPC React Client
 * 
 * This creates a type-safe tRPC client for React components.
 * The client is configured with the AppRouter type from the server,
 * providing end-to-end type safety.
 * 
 * Usage in components:
 * ```tsx
 * const domains = trpc.domain.list.useQuery();
 * const createDomain = trpc.domain.create.useMutation();
 * ```
 * 
 * Requirements: 10.3, 10.4
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Get base URL for tRPC requests
 * 
 * In development:
 * - Vite dev server runs on port 5173
 * - Vite proxies /api to Express server on port 4000
 * - We use relative URL '/api/trpc' which Vite will proxy
 * 
 * In production:
 * - Express serves both API and static files
 * - We use relative URL '/api/trpc'
 */
function getBaseUrl() {
  if (typeof window !== 'undefined') {
    // Browser: use relative URL (works in both dev and prod)
    return '';
  }
  // SSR: use localhost (not applicable for this app, but good practice)
  return `http://localhost:${process.env.PORT ?? 4000}`;
}

/**
 * Create tRPC client instance
 * 
 * This function creates a configured tRPC client with:
 * - HTTP batch link for efficient request batching
 * - Proper URL configuration for dev and prod
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
      }),
    ],
  });
}
