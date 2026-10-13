type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

/** Structured JSON line on stdout; Cloud Logging reads `severity` and `message`. */
export function log(severity: Severity, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ severity, message, service: 'web', ...fields }));
}
