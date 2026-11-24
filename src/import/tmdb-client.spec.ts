import { TitleType } from '../titles/entities/title.entity';
import { parseImportArguments, TmdbClient } from './tmdb-client';

describe('TMDB client', () => {
  it('discovers and deduplicates title IDs with fixed selection parameters', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        Response.json({ results: [{ id: 550 }, { id: 550 }, { id: 278 }] }),
      );
    const ids = await new TmdbClient('test-token', request).discover(
      TitleType.MOVIE,
      2,
    );
    expect(ids).toEqual([550, 278]);
    const url = request.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/3/discover/movie');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('vote_count.gte')).toBe('50');
  });

  it('retries incomplete JSON responses', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(Response.json({ id: 550 }));
    const pause = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);
    await expect(
      new TmdbClient('test-token', request, pause).getDetails(
        TitleType.MOVIE,
        550,
      ),
    ).resolves.toEqual({ id: 550 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid discovery IDs before creating import jobs', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(Response.json({ results: [{ id: -1 }] }));
    await expect(
      new TmdbClient('test-token', request).discover(TitleType.MOVIE, 1),
    ).rejects.toThrow('Некорректный ID');
  });
  it.each([
    [],
    ['tv', '1'],
    ['movie', '-1'],
    ['movie', '1x'],
    ['movie', '2147483648'],
  ])('rejects invalid command arguments: %j', (...args: string[]) => {
    expect(() => parseImportArguments(args)).toThrow();
  });

  it('uses the TV endpoint and aggregate credits for series', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('{}'));
    await new TmdbClient('test-token', request).getDetails(
      TitleType.SERIES,
      1399,
    );
    const url = request.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/3/tv/1399');
    expect(url.searchParams.get('append_to_response')).toBe(
      'aggregate_credits,keywords',
    );
  });

  it('respects Retry-After before retrying HTTP 429', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
      )
      .mockResolvedValueOnce(new Response('{"id":550}'));
    const pause = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);
    await expect(
      new TmdbClient('test-token', request, pause).getDetails(
        TitleType.MOVIE,
        550,
      ),
    ).resolves.toEqual({ id: 550 });
    expect(pause).toHaveBeenCalledWith(3000);
  });

  it('does not retry invalid credentials', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 401 }));
    await expect(
      new TmdbClient('test-token', request).getDetails(TitleType.MOVIE, 550),
    ).rejects.toThrow('HTTP 401');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops instead of ignoring a long Retry-After', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response('', {
          status: 429,
          headers: { 'Retry-After': '120' },
        }),
      );
    await expect(
      new TmdbClient('test-token', request).getDetails(TitleType.MOVIE, 550),
    ).rejects.toThrow('более 30 секунд');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds network retries to three attempts', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockRejectedValue(new Error('network'));
    const pause = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);
    await expect(
      new TmdbClient('test-token', request, pause).getDetails(
        TitleType.MOVIE,
        550,
      ),
    ).rejects.toThrow('трёх попыток');
    expect(request).toHaveBeenCalledTimes(3);
  });
});
