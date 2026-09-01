import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Pipes an async generator of CSV text chunks directly into an HTTP
 * response, writing each chunk as it's produced instead of buffering the
 * whole CSV in memory first. Callers must use a raw `@Res() res: Response`
 * (no `passthrough: true`) so Nest doesn't attempt to serialize a return
 * value on top of what we've already streamed.
 */
export async function streamCsvResponse(
  res: Response,
  filename: string,
  csvChunks: AsyncGenerator<string>,
  totalCount?: number,
): Promise<void> {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (totalCount !== undefined) {
    res.setHeader('X-Total-Count', String(totalCount));
  }

  try {
    await pipeline(Readable.from(csvChunks), res);
  } catch (err) {
    if (res.headersSent) {
      // The response already started streaming, so we can't send a JSON
      // error body without corrupting the CSV the client has partially
      // received. Destroy the connection instead of letting the exception
      // bubble up to the global filter, which would try (and fail) to call
      // res.status().json() on a response that's already in flight.
      res.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    throw err;
  }
}
