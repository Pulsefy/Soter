import { handlers } from "./handlers";

export async function fetchClient(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
      console.log(`[Mock API] Intercepting request to: ${urlString}`);
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      return handler(urlString, init);
    }
  }

  // Fallback to real fetch
  return fetch(input, init);
}
