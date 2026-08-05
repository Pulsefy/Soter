export interface CursorEntity {
  id: string;
}

/**
 * Lazily streams rows from a paginated data source using cursor-based pagination.
 *
 * Each page is only fetched once the previous page has been fully consumed by
 * the caller (an async generator's body doesn't run past a `yield` until the
 * consumer asks for the next value), so memory usage stays bounded by
 * `pageSize` regardless of how many rows match in total. That's what lets a
 * CSV export stream an arbitrarily large result set without buffering it.
 */
export async function* streamCursorPaginated<T extends CursorEntity>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
  pageSize: number,
): AsyncGenerator<T> {
  let cursor: string | undefined;

  while (true) {
    const page = await fetchPage(cursor);
    if (page.length === 0) break;

    for (const row of page) {
      yield row;
    }

    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
}
