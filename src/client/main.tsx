import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, createTRPCClient } from './lib/trpc';
import App from './App';
import './index.css';

/**
 * Life Manager React Entry Point
 * 
 * This file sets up:
 * - React Query client for data fetching and caching
 * - tRPC client for type-safe API calls
 * - React Query provider wrapping the app
 * - tRPC provider wrapping the app
 * 
 * Requirements: 10.3, 10.4
 */

/**
 * Create React Query client
 * 
 * Configuration:
 * - Default stale time: 5 seconds (data is considered fresh for 5s)
 * - Retry failed queries once
 * - Refetch on window focus disabled (prevents unnecessary refetches)
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Create tRPC client instance
 */
const trpcClient = createTRPCClient();

/**
 * Render app with providers
 * 
 * Provider hierarchy:
 * 1. tRPC Provider (outermost) - provides tRPC client
 * 2. React Query Provider - provides query client
 * 3. App component - main application
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
