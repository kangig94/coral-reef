export function formatCurrency(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatDuration(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainderSeconds}s`;
}

export function formatInteger(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  return new Intl.NumberFormat().format(value);
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return '0%';
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function prettyJson(value: string | null): string {
  if (!value) {
    return 'No result stored.';
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function truncateId(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
