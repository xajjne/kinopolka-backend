import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { parseSearchOptions } from './search-options';
import { SearchService } from './search.service';

describe('Semantic search boundaries', () => {
  const embedding = {
    model_id: 'BAAI/bge-m3',
    revision: 'a'.repeat(40),
    dimensions: 1024,
    embedding: [1, ...Array<number>(1023).fill(0)],
  };
  const database = {
    query: jest.fn(),
    transaction: jest.fn(),
  };
  let service: SearchService;

  beforeEach(() => {
    database.query.mockReset().mockResolvedValue([]);
    database.transaction.mockImplementation(
      (callback: (manager: { query: typeof database.query }) => unknown) =>
        callback(database),
    );
    service = new SearchService(
      database as unknown as DataSource,
      new ConfigService(),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {},
    { q: ' ' },
    { q: ['a', 'b'] },
    { q: 'a'.repeat(1001) },
    { q: 'a', limit: '51' },
    { q: 'a', limit: '1;DROP' },
    { q: 'a', type: 'tv' },
    { q: 'a', genreId: '-1' },
  ])('rejects invalid search options: %j', (query) => {
    expect(() => parseSearchOptions(query)).toThrow(BadRequestException);
  });

  it('applies defaults and trims the query', () => {
    expect(parseSearchOptions({ q: ' space ' })).toMatchObject({
      query: 'space',
      limit: 10,
    });
  });

  it('keeps filters and vector values in SQL parameters', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(embedding));
    await service.semantic({
      query: "'; DROP TABLE titles; --",
      limit: 3,
      type: 'movie',
      genreId: 7,
    });
    const [sql, parameters] = database.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('tg.genre_id = $5');
    expect(parameters.slice(1)).toEqual([
      'BAAI/bge-m3',
      embedding.revision,
      'movie',
      7,
      3,
    ]);
  });

  it.each([
    { ...embedding, embedding: [1] },
    { ...embedding, embedding: Array<number>(1024).fill(0) },
    { ...embedding, model_id: 'different-model' },
  ])(
    'rejects invalid ML results before querying the database',
    async (result) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(result));
      await expect(
        service.semantic({ query: 'space', limit: 10 }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(database.query).not.toHaveBeenCalled();
    },
  );

  it('returns 503 when the model service is offline', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Connection refused'));
    await expect(
      service.semantic({ query: 'space', limit: 10 }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
