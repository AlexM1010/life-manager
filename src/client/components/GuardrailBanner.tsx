import { trpc } from '../lib/trpc';

/**
 * GuardrailBanner Component
 * 
 * Displays safety messages when guardrail checks trigger concerning patterns:
 * 
 * 1. Doctor suggestion: 3+ consecutive days with mood ≤ 3 OR energy ≤ 3
 *    → Recommends contacting doctor or care team
 * 
 * 2. Support suggestion: 5+ consecutive days with <50% plan completion AND avg mood/energy ≤ 4
 *    → Recommends reaching out to support network
 * 
 * Design principles:
 * - Brutally kind honesty: States facts directly without softening
 * - Non-medical: Never provides medical advice, only suggests reaching out
 * - Compassionate: Respects dignity, offers concrete path forward
 * - Urgent but not shaming: Acknowledges difficulty without catastrophizing
 * 
 * Requirements: 8.3, 8.4
 */

interface GuardrailBannerProps {
  className?: string;
}

export function GuardrailBanner({ className = '' }: GuardrailBannerProps) {
  // Fetch guardrail check results
  const { data: guardrailCheck, isLoading } = trpc.stats.guardrails.useQuery(
    undefined,
    {
      // Refetch every 5 minutes to stay current
      refetchInterval: 5 * 60 * 1000,
      // Don't show stale data
      staleTime: 5 * 60 * 1000,
    }
  );

  // Don't render anything while loading
  if (isLoading) {
    return null;
  }

  // Don't render if no guardrails are triggered
  if (!guardrailCheck || (!guardrailCheck.shouldSuggestDoctor && !guardrailCheck.shouldSuggestSupport)) {
    return null;
  }

  // Determine banner style based on severity
  const isHighSeverity = guardrailCheck.shouldSuggestDoctor;
  const bannerStyles = isHighSeverity
    ? 'bg-orange-50 border-orange-300 text-orange-900'
    : 'bg-yellow-50 border-yellow-300 text-yellow-900';

  const iconStyles = isHighSeverity
    ? 'text-orange-600'
    : 'text-yellow-600';

  return (
    <div className={`space-y-3 ${className}`}>
      {guardrailCheck.messages.map((message, index) => (
        <div
          key={index}
          className={`p-4 border-l-4 rounded-lg ${bannerStyles}`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className={`flex-shrink-0 ${iconStyles}`}>
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Message Content */}
            <div className="flex-1">
              <h3 className="font-semibold mb-1">
                {guardrailCheck.shouldSuggestDoctor
                  ? 'Consider Reaching Out to Your Care Team'
                  : 'Consider Reaching Out for Support'}
              </h3>
              <p className="text-sm leading-relaxed">{message}</p>

              {/* Action Suggestions */}
              <div className="mt-3 text-sm">
                <p className="font-medium mb-1">What you can do:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {guardrailCheck.shouldSuggestDoctor && (
                    <>
                      <li>Call your doctor or care team</li>
                      <li>Use your crisis support number if you have one</li>
                      <li>Visit your clinic's walk-in hours</li>
                    </>
                  )}
                  {guardrailCheck.shouldSuggestSupport && !guardrailCheck.shouldSuggestDoctor && (
                    <>
                      <li>Text or call a friend or family member</li>
                      <li>Reach out to your therapist if you have one</li>
                      <li>Join a support group or community activity</li>
                    </>
                  )}
                </ul>
              </div>

              {/* Reassurance */}
              <p className="text-xs mt-3 opacity-80">
                This is based on patterns in your recent logs. Reaching out is a sign of strength, not weakness.
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
