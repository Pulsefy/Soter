/**
 * Detects the X-Demo-Mode header that fetchClient tags mock responses
 * with, so any route can show an indicator without inspecting the body.
 * Never reports true when mocks are disabled, so it cannot ship visible
 * in a production build with NEXT_PUBLIC_USE_MOCKS unset.
 */
export function isMockResponse(response: Response): boolean {
  if (process.env.NEXT_PUBLIC_USE_MOCKS !== 'true') return false;
  return response.headers.get('X-Demo-Mode') === 'mock';
}

/** Tracks whether any response used by the current route was mocked. */
export function createDemoModeTracker() {
  let sawMock = false;
  return {
    observe(response: Response): void {
      if (isMockResponse(response)) sawMock = true;
    },
    get isDemoMode(): boolean {
      return sawMock;
    },
  };
}
