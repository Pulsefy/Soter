import { streamCursorPaginated } from './cursor-paginate';

interface Row {
  id: string;
  value: number;
}

type FetchPageMock = jest.Mock<Promise<Row[]>, [string | undefined]>;

function makeRows(ids: string[]): Row[] {
  return ids.map((id, i) => ({ id, value: i }));
}

describe('streamCursorPaginated', () => {
  it('yields every row across multiple pages, in order', async () => {
    const pages: Row[][] = [
      makeRows(['1', '2']),
      makeRows(['3', '4']),
      makeRows(['5']),
    ];
    const fetchPage: FetchPageMock = jest.fn(
      async (cursor: string | undefined) => {
        await Promise.resolve();
        if (cursor === undefined) return pages[0];
        if (cursor === '2') return pages[1];
        if (cursor === '4') return pages[2];
        return [];
      },
    );

    const collected: Row[] = [];
    for await (const row of streamCursorPaginated(fetchPage, 2)) {
      collected.push(row);
    }

    expect(collected.map(r => r.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('stops as soon as a short page is returned, without an extra empty-page fetch', async () => {
    const fetchPage: FetchPageMock = jest
      .fn()
      .mockResolvedValueOnce(makeRows(['1', '2']))
      .mockResolvedValueOnce(makeRows(['3']));

    const collected: Row[] = [];
    for await (const row of streamCursorPaginated(fetchPage, 2)) {
      collected.push(row);
    }

    expect(collected).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('never fetches more pages than the caller actually consumes (proves non-buffering)', async () => {
    // Three pages are available (6 rows), but the caller only reads the
    // first 3. A buffering implementation (e.g. one that gathers everything
    // into an array before returning) would have called fetchPage 3 times
    // regardless of how much the caller consumes. A truly lazy generator
    // must not fetch the third page at all.
    const fetchPage: FetchPageMock = jest
      .fn()
      .mockResolvedValueOnce(makeRows(['1', '2']))
      .mockResolvedValueOnce(makeRows(['3', '4']))
      .mockResolvedValueOnce(makeRows(['5', '6']));

    const collected: Row[] = [];
    for await (const row of streamCursorPaginated(fetchPage, 2)) {
      collected.push(row);
      if (collected.length === 3) break;
    }

    expect(collected.map(r => r.id)).toEqual(['1', '2', '3']);
    // Only the first two pages should have been requested: the third row
    // came from the second page, which was already in flight when we hit 3.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('passes the last row id of each page as the next cursor', async () => {
    const fetchPage: FetchPageMock = jest
      .fn()
      .mockResolvedValueOnce(makeRows(['a', 'b']))
      .mockResolvedValueOnce([]);

    const collected: Row[] = [];
    for await (const row of streamCursorPaginated(fetchPage, 2)) {
      collected.push(row);
    }

    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'b');
  });

  it('yields nothing when the first page is empty', async () => {
    const fetchPage: FetchPageMock = jest.fn().mockResolvedValueOnce([]);

    const collected: Row[] = [];
    for await (const row of streamCursorPaginated(fetchPage, 500)) {
      collected.push(row);
    }

    expect(collected).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
