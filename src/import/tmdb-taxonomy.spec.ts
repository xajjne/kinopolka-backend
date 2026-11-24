import { TitleType } from '../titles/entities/title.entity';
import { mapTmdbTaxonomy } from './tmdb-taxonomy';

describe('TMDB genres and keywords', () => {
  it('deduplicates IDs, trims names and sorts by source ID', () => {
    const term = { id: 18, name: ' Драма ' };
    expect(
      mapTmdbTaxonomy(
        {
          genres: [term, { id: 12, name: 'Приключения' }, term],
          keywords: { keywords: [] },
        },
        TitleType.MOVIE,
      ),
    ).toEqual({
      genres: [
        { tmdbId: 12, name: 'Приключения' },
        { tmdbId: 18, name: 'Драма' },
      ],
      keywords: [],
    });
  });

  it('reads series keywords from results', () => {
    expect(
      mapTmdbTaxonomy(
        { genres: [], keywords: { results: [{ id: 1, name: 'space' }] } },
        TitleType.SERIES,
      ).keywords,
    ).toEqual([{ tmdbId: 1, name: 'space' }]);
  });

  it.each([
    [{ id: -1, name: 'a' }],
    [{ id: '18', name: 'a' }],
    [{ id: 18, name: ' ' }],
    [
      { id: 18, name: 'a' },
      { id: 18, name: 'b' },
    ],
    [null],
  ])('rejects malformed or conflicting terms: %j', (...genres: unknown[]) => {
    expect(() =>
      mapTmdbTaxonomy({ genres, keywords: { keywords: [] } }, TitleType.MOVIE),
    ).toThrow();
  });

  it('does not interpret missing keywords as an empty list', () => {
    expect(() =>
      mapTmdbTaxonomy({ genres: [], keywords: {} }, TitleType.MOVIE),
    ).toThrow();
  });
});
