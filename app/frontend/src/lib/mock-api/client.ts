import { handlers } from "./handlers";

export async function fetchClient(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const useMocks =
    process.env.NEXT_PUBLIC_USE_MOCKS === "true" ||
    !process.env.NEXT_PUBLIC_API_URL;

  const urlString = input.toString();
  
  // If mocks are enabled, check if we have a handler for this URL
  if (useMocks) {
    // Extract the path relative to API_URL if it starts with it
    let path = urlString;
    if (urlString.startsWith(apiUrl)) {
      path = urlString.substring(apiUrl.length);
    } else if (urlString.startsWith("/")) {
      path = urlString;
    }

    // Remove query parameters for matching
    const pathWithoutQuery = path.split("?")[0];

    const handler = handlers[pathWithoutQuery];
    if (handler) {
      // Emit a visible warning instead of a silent console.log so contributors
      // are aware they are NOT seeing live API data.
      console.warn(
        `[Demo Mode] Intercepting request to: ${urlString} — mock response active. ` +
          "Set NEXT_PUBLIC_USE_MOCKS=false and NEXT_PUBLIC_API_URL to a real backend to use live data."
      );
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      const mockResponse = await handler(urlString, init);
      // Tag the response so callers can detect mock state without inspecting
      // the body or relying on a URL pattern match.
      const tagged = new Response(mockResponse.body, mockResponse);
      tagged.headers.set("X-Demo-Mode", "mock");
      return tagged;
    }

    // Support dynamic campaign endpoints like /campaigns/:id
    if (pathWithoutQuery.startsWith('/campaigns/') && handlers['/campaigns/:id']) {
      console.warn(
        `[Demo Mode] Intercepting dynamic campaign request to: ${urlString} — mock response active.`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      return handlers['/campaigns/:id'](urlString, init);
    }

    // Support dynamic verification-inbox endpoints like /v1/verification-inbox/:id, .../approve, .../reject, etc.
    if (pathWithoutQuery.startsWith('/v1/verification-inbox/') && handlers['/v1/verification-inbox/:id']) {
      console.warn(
        `[Demo Mode] Intercepting dynamic verification-inbox request to: ${urlString} — mock response active.`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      return handlers['/v1/verification-inbox/:id'](urlString, init);
    }
  }

  // Fallback to real fetch
  return fetch(input, init);
}
