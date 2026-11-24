import { BadRequestException } from '@nestjs/common';
import { catalogOptions, pagination, positiveInteger } from './catalog-options';
import { creditRoles, imageUrl, mediaView } from './catalog-format';
import { mapTmdbCredits } from '../import/tmdb-credits';
import { TitleType } from './entities/title.entity';

describe('Catalog API and source data', () => {
  it.each([
    { limit: '101' },
    { page: '0' },
    { type: 'tv' },
    { sort: 'title; DROP' },
    { year: '1' },
    { q: ['a'] },
    { genreId: '-1' },
  ])('rejects invalid options: %j', (query) => {
    expect(() => catalogOptions(query)).toThrow(BadRequestException);
  });
  it('parses independent filters and defaults', () => {
    expect(
      catalogOptions({ type: 'movie', year: '2014', q: ' space ' }),
    ).toMatchObject({
      type: 'movie',
      year: 2014,
      query: 'space',
      page: 1,
      limit: 20,
      sort: 'popular',
    });
    expect(() => positiveInteger('2147483648', 'id')).toThrow();
    expect(() => pagination({ limit: ['1', '2'] })).toThrow();
  });
  it('does not construct image links from untrusted origins or traversal paths', () => {
    expect(imageUrl('/poster.jpg')).toBe(
      'https://image.tmdb.org/t/p/w500/poster.jpg',
    );
    expect(imageUrl('https://other.example/x')).toBeNull();
    expect(imageUrl('/../x')).toBeNull();
  });
  it('retains multiple film roles and aggregate TV roles/jobs for a person', () => {
    const result = mapTmdbCredits(
      {
        aggregate_credits: {
          cast: [
            {
              id: 1,
              name: 'Actor',
              roles: [{ character: 'A' }, { character: 'B' }],
            },
          ],
          crew: [
            {
              id: 1,
              name: 'Actor',
              jobs: [{ job: 'Writer' }, { job: 'Director' }],
            },
          ],
        },
      },
      TitleType.SERIES,
    );
    expect(result.people).toHaveLength(1);
    expect(result.groups).toHaveLength(2);
    expect(creditRoles(result.groups[0].entries).characters).toEqual([
      'A',
      'B',
    ]);
    expect(creditRoles(result.groups[1].entries).jobs).toEqual([
      'Writer',
      'Director',
    ]);
  });
  it('groups duplicate cast entries without discarding source entries', () => {
    const result = mapTmdbCredits(
      {
        credits: {
          cast: [
            { id: 1, name: 'Actor', character: 'A' },
            { id: 1, name: 'Actor', character: 'B' },
          ],
          crew: [],
        },
      },
      TitleType.MOVIE,
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].entries).toHaveLength(2);
    expect(() =>
      mapTmdbCredits(
        { credits: { cast: [{ id: -1, name: 'Actor' }], crew: [] } },
        TitleType.MOVIE,
      ),
    ).toThrow();
  });
  it('chooses an official Russian trailer before English and rejects invalid video keys', () => {
    const videos = [
      {
        id: '1',
        site: 'YouTube',
        key: 'abcdefghijk',
        type: 'Trailer',
        official: true,
        iso_639_1: 'en',
      },
      {
        id: '2',
        site: 'YouTube',
        key: '0123456789a',
        type: 'Trailer',
        official: true,
        iso_639_1: 'ru',
      },
      { id: '3', site: 'YouTube', key: '" onclick="', type: 'Trailer' },
    ];
    const media = mediaView({ videos }, new Date());
    expect(media.trailer?.id).toBe('2');
    expect(media.videos).toHaveLength(2);
    expect(mediaView(null, null)).toMatchObject({
      loaded: false,
      trailer: null,
      backdrops: [],
    });
  });
});
