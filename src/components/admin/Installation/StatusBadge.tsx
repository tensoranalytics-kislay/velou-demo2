/**
 * StatusBadge Component
 * 
 * Displays status with colored badge and icon.
 */

interface StatusBadgeProps {
  status: 'connected' | 'disconnected' | 'degraded' | 'verified' | 'not-verified' | 'testing';
  label: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const statusConfig = {
    connected: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: '✓',
      border: 'border-green-200',
    },
    disconnected: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: '✗',
      border: 'border-red-200',
    },
    degraded: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      icon: '⚠',
      border: 'border-yellow-200',
    },
    verified: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: '✓',
      border: 'border-green-200',
    },
    'not-verified': {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      icon: '⚪',
      border: 'border-slate-200',
    },
    testing: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: '⟳',
      border: 'border-blue-200',
    },
  };

  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      <span>{config.icon}</span>
      <span>{label}</span>
    </span>
  );
}


