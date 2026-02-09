import { trpc } from '../lib/trpc';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

/**
 * BalanceChart Component
 * 
 * Displays domain balance as a bar chart showing completion counts per domain
 * over the past 7 days. Neglected domains (zero completions) are highlighted
 * in red to draw attention to areas needing focus.
 * 
 * Design principles:
 * - Visual clarity: Bar chart makes relative balance immediately obvious
 * - Honest feedback: Neglected domains are highlighted, not hidden
 * - Actionable: Shows exactly which domains need attention
 * - Accessible: Color + pattern for colorblind users, semantic labels
 * 
 * Requirements: 6.4, 6.5
 */

interface BalanceChartProps {
  className?: string;
  days?: number; // Number of days to look back (defaults to 7)
}

export function BalanceChart({ className = '', days = 7 }: BalanceChartProps) {
  // Fetch domain balance data
  const { data: balance, isLoading, error } = trpc.stats.balance.useQuery(
    { days },
    {
      // Refetch when window regains focus
      refetchOnWindowFocus: true,
      // Keep data fresh (refetch every 5 minutes)
      staleTime: 5 * 60 * 1000,
    }
  );

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Domain Balance</h2>
        <div className="h-80 bg-card rounded-lg border animate-pulse flex items-center justify-center">
          <p className="text-muted-foreground">Loading balance data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Domain Balance</h2>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">Failed to load domain balance</p>
          <p className="text-sm text-red-600 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  // No data state
  if (!balance || balance.length === 0) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Domain Balance</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">
            No domains found. Create domains to start tracking balance.
          </p>
        </div>
      </div>
    );
  }

  // Count neglected domains
  const neglectedCount = balance.filter((d) => d.neglected).length;
  const totalCompletions = balance.reduce((sum, d) => sum + d.completions7d, 0);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Domain Balance</h2>
        <p className="text-sm text-muted-foreground">
          Past {days} days
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Completions"
          value={totalCompletions}
          color="blue"
        />
        <StatCard
          label="Active Domains"
          value={balance.length - neglectedCount}
          color="green"
        />
        <StatCard
          label="Neglected Domains"
          value={neglectedCount}
          color={neglectedCount > 0 ? 'red' : 'green'}
          highlight={neglectedCount > 0}
        />
      </div>

      {/* Bar Chart */}
      <div className="p-6 bg-card rounded-lg border">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={balance}
            margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              label={{
                value: 'Completions',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 12 },
              }}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              content={<CustomLegend />}
            />
            <Bar
              dataKey="completions7d"
              name="Completions"
              radius={[8, 8, 0, 0]}
            >
              {balance.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.neglected ? '#ef4444' : '#3b82f6'}
                  opacity={entry.neglected ? 0.8 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Neglected Domains Alert */}
      {neglectedCount > 0 && (
        <NeglectedDomainsAlert
          neglectedDomains={balance.filter((d) => d.neglected)}
          days={days}
        />
      )}

      {/* Balance Message */}
      <BalanceMessage balance={balance} days={days} />
    </div>
  );
}

/**
 * StatCard Component
 * 
 * Displays a single statistic with color-coded styling
 */

interface StatCardProps {
  label: string;
  value: number;
  color: 'blue' | 'green' | 'red';
  highlight?: boolean;
}

function StatCard({ label, value, color, highlight = false }: StatCardProps) {
  const colorStyles = {
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-700',
    },
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-700',
    },
    red: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
    },
  };

  const styles = colorStyles[color];

  return (
    <div
      className={`p-4 rounded-lg border-2 ${styles.bg} ${styles.border} ${
        highlight ? 'ring-2 ring-red-400 ring-offset-2' : ''
      }`}
    >
      <div className={`text-3xl font-bold ${styles.text} tabular-nums`}>
        {value}
      </div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

/**
 * CustomTooltip Component
 * 
 * Custom tooltip for the bar chart showing domain details
 */

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      completions7d: number;
      neglected: boolean;
    };
  }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;

  return (
    <div className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-lg">
      <p className="font-semibold text-gray-900 mb-2">{data.name}</p>
      <p className="text-sm text-gray-600">
        <span className="font-medium">{data.completions7d}</span> completions
      </p>
      {data.neglected && (
        <p className="text-sm text-red-600 font-medium mt-1">
          ⚠️ Neglected
        </p>
      )}
    </div>
  );
}

/**
 * CustomLegend Component
 * 
 * Custom legend explaining the color coding
 */

function CustomLegend() {
  return (
    <div className="flex items-center justify-center gap-6 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 bg-blue-500 rounded"></div>
        <span>Active domains</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 bg-red-500 rounded opacity-80"></div>
        <span>Neglected domains</span>
      </div>
    </div>
  );
}

/**
 * NeglectedDomainsAlert Component
 * 
 * Displays an alert listing neglected domains
 */

interface NeglectedDomainsAlertProps {
  neglectedDomains: Array<{
    domainId: number;
    name: string;
    completions7d: number;
    neglected: boolean;
  }>;
  days: number;
}

function NeglectedDomainsAlert({ neglectedDomains, days }: NeglectedDomainsAlertProps) {
  return (
    <div className="p-4 bg-red-50 border-2 border-red-200 rounded-lg">
      <div className="flex items-start gap-3">
        <div className="text-red-600 mt-0.5">
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-red-900 mb-2">
            {neglectedDomains.length} {neglectedDomains.length === 1 ? 'domain' : 'domains'} neglected
          </p>
          <p className="text-sm text-red-800 mb-2">
            These domains have zero completions in the past {days} days:
          </p>
          <ul className="text-sm text-red-700 space-y-1">
            {neglectedDomains.map((domain) => (
              <li key={domain.domainId} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full"></span>
                {domain.name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-red-800 mt-3 font-medium">
            Consider adding a task from one of these domains to today's plan.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * BalanceMessage Component
 * 
 * Displays a message about overall balance status
 */

interface BalanceMessageProps {
  balance: Array<{
    domainId: number;
    name: string;
    completions7d: number;
    neglected: boolean;
  }>;
  days: number;
}

function BalanceMessage({ balance }: BalanceMessageProps) {
  const neglectedCount = balance.filter((d) => d.neglected).length;
  const totalCompletions = balance.reduce((sum, d) => sum + d.completions7d, 0);

  // Calculate balance score (0-1, where 1 is perfectly balanced)
  // Using coefficient of variation: lower is more balanced
  const mean = totalCompletions / balance.length;
  const variance =
    balance.reduce((sum, d) => sum + Math.pow(d.completions7d - mean, 2), 0) /
    balance.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;
  
  // Convert to 0-1 score (lower CV = higher score)
  // CV of 0 = perfect balance (score 1)
  // CV of 1 or higher = poor balance (score 0)
  const balanceScore = Math.max(0, 1 - coefficientOfVariation);

  // Perfect balance (no neglected domains, low variation)
  if (neglectedCount === 0 && balanceScore > 0.7) {
    return (
      <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
        <p className="text-sm font-medium text-green-900">
          ✨ Excellent balance! You're making progress across all life domains. This is integration in action.
        </p>
      </div>
    );
  }

  // Good balance (no neglected domains, but some variation)
  if (neglectedCount === 0) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm font-medium text-blue-900">
          👍 All domains active. Some variation is natural — not every domain needs equal attention every week.
        </p>
      </div>
    );
  }

  // Some neglect (1-2 domains)
  if (neglectedCount <= 2) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm font-medium text-yellow-900">
          ⚠️ {neglectedCount} {neglectedCount === 1 ? 'domain' : 'domains'} neglected. 
          Small movements matter — even one task in a neglected domain shifts the balance.
        </p>
      </div>
    );
  }

  // Significant neglect (3+ domains)
  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-sm font-medium text-red-900">
        🚨 {neglectedCount} domains neglected. This is a signal — not a judgment. 
        Start with one small task in any neglected domain. Progress compounds.
      </p>
    </div>
  );
}
