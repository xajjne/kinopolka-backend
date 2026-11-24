import { TitleType } from '../titles/entities/title.entity';
import { mapTmdbTitle } from './tmdb-mapper';

const movie = {
  id: 550,
  title: 'Бойцовский клуб',
  original_title: 'Fight Club',
  runtime: 139,
  release_date: '1999-10-15',
  genres: [],
  credits: {
    cast: [{ id: 287, name: 'Brad Pitt', profile_path: '/portrait.jpg' }],
    crew: [],
  },
  keywords: { keywords: [] },
  budget: 63000000,
};

describe('TMDB mapping', () => {
  it('retains source fields and portraits that have no separate columns yet', () => {
    const result = mapTmdbTitle(movie, TitleType.MOVIE, 550);
    expect(result.tmdbPayload).toEqual(movie);
    expect(result.runtimeMinutes).toBe(139);
    expect(result.releaseDate).toBe('1999-10-15');
  });

  it('maps series names, dates and all-season credits without assuming movie runtime', () => {
    const series = {
      id: 1399,
      name: 'Игра престолов',
      original_name: 'Game of Thrones',
      first_air_date: '2011-04-17',
      episode_run_time: [60],
      genres: [],
      aggregate_credits: { cast: [], crew: [] },
      keywords: { results: [] },
    };
    expect(mapTmdbTitle(series, TitleType.SERIES, 1399)).toMatchObject({
      title: 'Игра престолов',
      originalTitle: 'Game of Thrones',
      releaseDate: '2011-04-17',
      runtimeMinutes: null,
      tmdbPayload: series,
    });
  });

  it('converts missing dates and unknown runtime to null', () => {
    expect(
      mapTmdbTitle(
        { ...movie, runtime: 0, release_date: '' },
        TitleType.MOVIE,
        550,
      ),
    ).toMatchObject({ runtimeMinutes: null, releaseDate: null });
  });

  it.each([
    { id: 551 },
    { title: ' ' },
    { release_date: '2025-02-30' },
    { runtime: -1 },
    { credits: { success: false } },
    { keywords: {} },
  ])('rejects invalid source data before saving: %j', (change) => {
    expect(() =>
      mapTmdbTitle({ ...movie, ...change }, TitleType.MOVIE, 550),
    ).toThrow();
  });
});
