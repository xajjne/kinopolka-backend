async function main() {
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();

  if (!token) {
    throw new Error('В backend/.env не найден TMDB_READ_ACCESS_TOKEN');
  }

  const url = new URL('https://api.themoviedb.org/3/movie/550');
  url.searchParams.set('language', 'ru-RU');
  url.searchParams.set('append_to_response', 'credits,keywords');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`TMDB вернул HTTP ${response.status}`);
  }

  const movie = await response.json();

  console.log(
    JSON.stringify(
      {
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        overview: movie.overview,
        releaseDate: movie.release_date,
        runtimeMinutes: movie.runtime,
        posterPath: movie.poster_path,
        backdropPath: movie.backdrop_path,
        genres: movie.genres?.map((genre) => genre.name),
        keywords: movie.keywords?.keywords?.map((word) => word.name),
        castCount: movie.credits?.cast?.length,
        castPreview: movie.credits?.cast?.slice(0, 5).map((person) => ({
          id: person.id,
          name: person.name,
          character: person.character,
          profilePath: person.profile_path,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Ошибка проверки TMDB:', error.message);
  const causeCode = error.cause?.code ?? error.code;
  if (causeCode) {
    console.error('Код причины:', causeCode);
  }
  const connectionErrors = error.cause?.errors;
  if (Array.isArray(connectionErrors)) {
    const codes = [...new Set(connectionErrors.map((item) => item.code).filter(Boolean))];
    if (codes.length > 0) {
      console.error('Коды ошибок соединения:', codes.join(', '));
    }
  }
  process.exitCode = 1;
});
