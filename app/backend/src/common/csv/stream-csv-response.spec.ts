import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { streamCsvResponse } from './stream-csv-response';

function makeMockResponse() {
  const stream = new PassThrough();
  const res = Object.assign(stream, {
    setHeader: jest.fn(),
    headersSent: false,
  });
  // Real Express flips headersSent to true the moment the first byte of the
  // body is written, since headers must go out before it. Mimic that here.
  res.on('data', () => {
    res.headersSent = true;
  });
  return res as unknown as Response & PassThrough & { headersSent: boolean };
}

async function* asyncGenOf(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

describe('streamCsvResponse', () => {
  it('sets Content-Type, Content-Disposition, and X-Total-Count headers', async () => {
    const res = makeMockResponse();
    res.resume();

    await streamCsvResponse(res, 'export.csv', asyncGenOf('a\r\n'), 3);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="export.csv"',
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '3');
  });

  it('omits X-Total-Count when no total is given', async () => {
    const res = makeMockResponse();
    res.resume();

    await streamCsvResponse(res, 'export.csv', asyncGenOf('a\r\n'));

    expect(res.setHeader).not.toHaveBeenCalledWith(
      'X-Total-Count',
      expect.anything(),
    );
  });

  it('writes each generator chunk through to the response in order', async () => {
    const res = makeMockResponse();
    const received: string[] = [];
    res.on('data', chunk => received.push(chunk.toString()));

    await streamCsvResponse(
      res,
      'export.csv',
      asyncGenOf('header\r\n', 'row1\r\n', 'row2\r\n'),
    );

    expect(received).toEqual(['header\r\n', 'row1\r\n', 'row2\r\n']);
  });

  it('rethrows when the generator fails before any bytes were written, so a proper JSON error can still be sent', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await, require-yield -- deliberately empty: simulates a DB failure before the first row is ever fetched
    async function* failingGen(): AsyncGenerator<string> {
      throw new Error('db unavailable');
    }
    const res = makeMockResponse();

    await expect(
      streamCsvResponse(res, 'export.csv', failingGen()),
    ).rejects.toThrow('db unavailable');
    expect(res.headersSent).toBe(false);
  });

  it('destroys the response instead of rethrowing once bytes were already written', async () => {
    async function* failingGen(): AsyncGenerator<string> {
      await Promise.resolve();
      yield 'header\r\n';
      throw new Error('db unavailable mid-export');
    }
    const res = makeMockResponse();

    await expect(
      streamCsvResponse(res, 'export.csv', failingGen()),
    ).resolves.toBeUndefined();
    expect(res.headersSent).toBe(true);
    expect(res.destroyed).toBe(true);
  });
});
