import { useState } from 'react';
import { trpc } from '../lib/trpc';

/**
 * DomainList Component
 * 
 * Displays and manages life domains with:
 * - List view showing all domains with task counts and BBI flags
 * - Create new domain form
 * - Edit existing domain (inline or modal)
 * - Delete domain (with task-existence guard)
 * 
 * Features:
 * - Real-time updates via tRPC
 * - Validation feedback
 * - Confirmation for destructive actions
 * - Visual indicators for boring-but-important domains
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 10.3
 */

interface DomainListProps {
  className?: string;
}

export function DomainList({ className = '' }: DomainListProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingDomainId, setEditingDomainId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Fetch domains
  const { data: domains, isLoading, error } = trpc.domain.list.useQuery();

  // Create domain mutation
  const createDomain = trpc.domain.create.useMutation({
    onSuccess: () => {
      utils.domain.list.invalidate();
      setShowCreateForm(false);
    },
  });

  // Update domain mutation
  const updateDomain = trpc.domain.update.useMutation({
    onSuccess: () => {
      utils.domain.list.invalidate();
      setEditingDomainId(null);
    },
  });

  // Delete domain mutation
  const deleteDomain = trpc.domain.delete.useMutation({
    onSuccess: () => {
      utils.domain.list.invalidate();
    },
  });

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Domains</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">Loading domains...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Domains</h2>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">Failed to load domains</p>
          <p className="text-sm text-red-600 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Domains</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Organize your life into high-level areas
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors"
        >
          + New Domain
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <DomainForm
          onSubmit={(data) => createDomain.mutate(data)}
          onCancel={() => setShowCreateForm(false)}
          isSubmitting={createDomain.isPending}
          error={createDomain.error?.message}
        />
      )}

      {/* Domain List */}
      <div className="space-y-3">
        {domains && domains.length === 0 ? (
          <div className="p-8 bg-card rounded-lg border text-center">
            <p className="text-muted-foreground">
              No domains yet. Create your first domain to get started!
            </p>
          </div>
        ) : (
          domains?.map((domain) => (
            <div key={domain.id}>
              {editingDomainId === domain.id ? (
                <DomainForm
                  initialData={domain}
                  onSubmit={(data) =>
                    updateDomain.mutate({ id: domain.id, ...data })
                  }
                  onCancel={() => setEditingDomainId(null)}
                  isSubmitting={updateDomain.isPending}
                  error={updateDomain.error?.message}
                />
              ) : (
                <DomainCard
                  domain={domain}
                  onEdit={() => setEditingDomainId(domain.id)}
                  onDelete={() => {
                    if (
                      confirm(
                        `Delete "${domain.name}"? This cannot be undone.`
                      )
                    ) {
                      deleteDomain.mutate({ id: domain.id });
                    }
                  }}
                  isDeleting={deleteDomain.isPending}
                  deleteError={
                    deleteDomain.error?.data?.code === 'PRECONDITION_FAILED'
                      ? deleteDomain.error.message
                      : undefined
                  }
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * DomainCard Component
 * 
 * Displays a single domain with its metadata and action buttons
 */

interface DomainCardProps {
  domain: {
    id: number;
    name: string;
    description: string;
    whyItMatters: string;
    boringButImportant: boolean;
    taskCount: number;
  };
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError?: string;
}

function DomainCard({
  domain,
  onEdit,
  onDelete,
  isDeleting,
  deleteError,
}: DomainCardProps) {
  return (
    <div className="p-6 bg-card rounded-lg border hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Domain Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold">{domain.name}</h3>
            {domain.boringButImportant && (
              <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                Boring But Important
              </span>
            )}
            <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
              {domain.taskCount} {domain.taskCount === 1 ? 'task' : 'tasks'}
            </span>
          </div>

          {domain.description && (
            <p className="text-sm text-muted-foreground mb-2">
              {domain.description}
            </p>
          )}

          {domain.whyItMatters && (
            <div className="mt-3 p-3 bg-muted/50 rounded">
              <p className="text-sm">
                <span className="font-medium">Why it matters:</span>{' '}
                {domain.whyItMatters}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground
                     border border-muted hover:border-foreground rounded transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="px-3 py-1 text-sm font-medium text-red-600 hover:text-red-700
                     border border-red-200 hover:border-red-300 rounded transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Delete Error */}
      {deleteError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">{deleteError}</p>
        </div>
      )}
    </div>
  );
}

/**
 * DomainForm Component
 * 
 * Form for creating or editing a domain
 */

interface DomainFormProps {
  initialData?: {
    name: string;
    description: string;
    whyItMatters: string;
    boringButImportant: boolean;
  };
  onSubmit: (data: {
    name: string;
    description: string;
    whyItMatters: string;
    boringButImportant: boolean;
  }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string;
}

function DomainForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: DomainFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(
    initialData?.description || ''
  );
  const [whyItMatters, setWhyItMatters] = useState(
    initialData?.whyItMatters || ''
  );
  const [boringButImportant, setBoringButImportant] = useState(
    initialData?.boringButImportant || false
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      whyItMatters: whyItMatters.trim(),
      boringButImportant,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-6 bg-card rounded-lg border border-primary"
    >
      <h3 className="text-lg font-semibold mb-4">
        {initialData ? 'Edit Domain' : 'New Domain'}
      </h3>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label
            htmlFor="domain-name"
            className="block text-sm font-medium mb-1"
          >
            Name *
          </label>
          <input
            id="domain-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g., Health, Uni / Research, Admin"
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="domain-description"
            className="block text-sm font-medium mb-1"
          >
            Description
          </label>
          <textarea
            id="domain-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Brief description of this life area"
          />
        </div>

        {/* Why It Matters */}
        <div>
          <label
            htmlFor="domain-why"
            className="block text-sm font-medium mb-1"
          >
            Why It Matters
          </label>
          <textarea
            id="domain-why"
            value={whyItMatters}
            onChange={(e) => setWhyItMatters(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Why is this domain important to you?"
          />
        </div>

        {/* Boring But Important Flag */}
        <div className="flex items-start gap-3">
          <input
            id="domain-bbi"
            type="checkbox"
            checked={boringButImportant}
            onChange={(e) => setBoringButImportant(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-input"
          />
          <div>
            <label htmlFor="domain-bbi" className="text-sm font-medium">
              Boring But Important
            </label>
            <p className="text-xs text-muted-foreground mt-1">
              Tasks in this domain tend to be avoided but need to be done
            </p>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : initialData ? 'Save Changes' : 'Create Domain'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 border border-input rounded-lg font-medium
                   hover:bg-muted transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
