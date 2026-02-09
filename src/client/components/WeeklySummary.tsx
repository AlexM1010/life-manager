import { useState } from 'react';
import { trpc } from '../lib/trpc';

/**
 * WeeklySummary Component
 * 
 * Displays a weekly summary aggregating:
 * - Daily logs (sleep, energy, mood averages)
 * - Task completions by domain
 * - Current streaks
 * - Neglected domains
 * 
 * The summary is plain text (no HTML/markdown) suitable for sharing with
 * a clinician or care team. Users can:
 * - Copy to clipboard
 * - Download as a text file
 * 
 * Design principles:
 * - Clarity: Plain text, well-structured, easy to read
 * - Shareability: One-click copy or download
 * - Privacy-aware: User controls when/how to share
 * - Honest: Shows the full picture without softening
 * 
 * Requirements: 7.1, 7.5, 7.6
 */

interface WeeklySummaryProps {
  className?: string;
  endDate?: string; // ISO date string (defaults to today)
}

export function WeeklySummary({ className = '', endDate }: WeeklySummaryProps) {
  const [copied, setCopied] = useState(false);

  // Fetch summary text
  const { data: summary, isLoading, error } = trpc.summary.generate.useQuery(
    { endDate },
    {
      // Refetch when window regains focus
      refetchOnWindowFocus: true,
      // Keep data fresh (refetch every 5 minutes)
      staleTime: 5 * 60 * 1000,
    }
  );

  // Fetch export data (for download)
  const { data: exportData } = trpc.summary.export.useQuery(
    { endDate },
    {
      enabled: !!summary, // Only fetch if summary is available
      staleTime: 5 * 60 * 1000,
    }
  );

  /**
   * Copy summary to clipboard
   */
  const handleCopy = async () => {
    if (!summary) return;

    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback: select text for manual copy
      const textArea = document.createElement('textarea');
      textArea.value = summary;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  /**
   * Download summary as text file
   */
  const handleDownload = () => {
    if (!exportData) return;

    try {
      // Create blob from text content
      const blob = new Blob([exportData.content], { type: 'text/plain;charset=utf-8' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportData.filename;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Weekly Summary</h2>
        <div className="p-6 bg-card rounded-lg border animate-pulse">
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-5/6"></div>
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Weekly Summary</h2>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">Failed to generate weekly summary</p>
          <p className="text-sm text-red-600 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  // No data state
  if (!summary) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Weekly Summary</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">
            No summary data available. Start logging daily activities to generate a summary.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Weekly Summary</h2>
        <div className="flex items-center gap-2">
          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label="Copy summary to clipboard"
          >
            {copied ? (
              <>
                <CheckIcon />
                <span className="text-sm font-medium">Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon />
                <span className="text-sm font-medium">Copy</span>
              </>
            )}
          </button>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={!exportData}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Download summary as text file"
          >
            <DownloadIcon />
            <span className="text-sm font-medium">Download</span>
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="text-blue-600 mt-0.5">
            <InfoIcon />
          </div>
          <div className="flex-1">
            <p className="text-sm text-blue-900">
              <span className="font-semibold">Privacy-first sharing:</span> This summary is plain text with no identifying information beyond what you choose to share. Copy or download to share with your clinician or care team.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Content */}
      <div className="p-6 bg-card rounded-lg border">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
          {summary}
        </pre>
      </div>

      {/* Usage Tips */}
      <div className="p-4 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold">Tip:</span> Use the Copy button to paste into a message, or Download to save as a file. The summary includes averages, completion rates, streaks, and neglected domains — everything your care team needs to see patterns.
        </p>
      </div>
    </div>
  );
}

/**
 * Icon Components
 */

function CopyIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="currentColor"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  );
}
