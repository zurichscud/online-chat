export function normalizeText(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

export function normalizeVisitorId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : '';
}

export function visitorNameFor(visitorId: string): string {
  const suffix = visitorId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return `访客 ${suffix || '0000'}`;
}

export function normalizeClientId(value: unknown): string {
  return normalizeText(value, 64);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractBearerToken(header: string | undefined): string {
  if (!header) return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
