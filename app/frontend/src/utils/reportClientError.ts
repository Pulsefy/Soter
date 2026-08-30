interface ErrorReportPayload {
  message: string;
  stack?: string;
  route: string;
  correlationId?: string;
}

export async function reportClientError(error: Error, correlationId?: string) {
  if (process.env.NEXT_PUBLIC_DISABLE_ERROR_REPORTING === 'true') {
    return;
  }

  try {
    const payload: ErrorReportPayload = {
      message: sanitizeErrorMessage(error.message),
      stack: sanitizeStack(error.stack),
      route: window.location.pathname,
      correlationId: correlationId || crypto.randomUUID(),
    };

    const endpoint = '/api/telemetry/errors';
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    } else {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    }
  } catch (reportingErr) {
    console.error('Failed to report client error:', reportingErr);
  }
}

function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/[a-zA-Z0-9_.%+,-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

function sanitizeStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, 10).join('\n');
}