const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const get = async (path) => {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const catalog = await get('/titles?type=movie&limit=5&page=1&sort=rating');
    assert.equal(catalog.items.length, 5);
    assert.ok(catalog.items.every((item) => item.type === 'movie'));
    assert.ok(catalog.items.every((item) => !('tmdbPayload' in item)));
    const genres = await get('/genres?type=movie');
    assert.ok(
      genres.length > 0 && genres.every((genre) => genre.type === 'movie'),
    );
    const filtered = await get(
      `/titles?type=movie&genreId=${genres[0].id}&limit=5`,
    );
    assert.ok(filtered.items.length > 0);
    const found = await get(`/titles?q=${encodeURIComponent('Интерстеллар')}`);
    const interstellar = found.items.find((item) => item.tmdbId === 157336);
    assert.ok(interstellar);
    const detail = await get(`/titles/${interstellar.id}`);
    assert.ok(detail.cast.items.length > 0);
    assert.ok(
      detail.creators.some((person) => person.jobs.includes('Director')),
    );
    assert.ok(detail.genres.length > 0 && detail.keywords.length > 0);
    assert.ok(!('tmdbPayload' in detail));
    const credits = await get(
      `/titles/${detail.id}/credits?kind=crew&limit=5&page=1`,
    );
    assert.ok(credits.items.length <= 5);
    const person = await get(
      `/people/${detail.cast.items[0].personId}?limit=5`,
    );
    assert.ok(person.filmography.total > 0);
    assert.ok(person.filmography.items.length <= 5);
    const series = await get('/titles/2');
    assert.ok(series.seasons.length > 0);
    const similar = await get(`/titles/${detail.id}/similar?limit=5`);
    assert.equal(similar.items.length, 5);
    assert.ok(
      similar.items.every(
        (item) => item.id !== detail.id && Number.isFinite(item.distance),
      ),
    );

    if (process.argv.includes('--require-media')) {
      assert.equal(detail.media.loaded, true);
      assert.ok(detail.media.backdrops.length > 0);
      assert.ok(
        detail.media.trailer?.embedUrl.startsWith(
          'https://www.youtube-nocookie.com/embed/',
        ),
      );
      const gallery = await get(
        `/titles/${detail.id}/media?kind=backdrops&limit=10&page=2`,
      );
      assert.equal(gallery.items.length, 10);
      assert.equal(gallery.total, detail.media.backdropCount);
    }
    for (const [path, expected] of [
      ['/titles?limit=101', 400],
      ['/titles?type=tv', 400],
      ['/titles?sort=invalid', 400],
      ['/titles/0', 400],
      ['/titles/2147483647', 404],
      ['/people/2147483647', 404],
      ['/titles/1/credits?kind=invalid', 400],
      ['/genres?type=tv', 400],
    ])
      assert.equal((await fetch(base + path)).status, expected, path);
    console.log(
      JSON.stringify(
        {
          totalMovies: catalog.total,
          interstellar: {
            id: detail.id,
            title: detail.title,
            actors: detail.cast.total,
            creators: detail.creators,
            mediaLoaded: detail.media.loaded,
            backdrops: detail.media.backdropCount,
            trailer: detail.media.trailer?.name ?? null,
          },
          person: {
            id: person.id,
            name: person.name,
            biographyLoaded: person.detailsLoaded,
            titlesInCatalog: person.filmography.total,
          },
        },
        null,
        2,
      ),
    );
    console.log('Catalog API checks passed.');
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
