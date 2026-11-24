// Run after npm run build, with the ML service listening on port 8000.
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const examples = [
      { q: 'фэнтези с драконами, интригами и борьбой за власть' },
      { q: 'мужчина страдает бессонницей и создаёт тайный бойцовский клуб' },
      { q: 'фэнтези с драконами', type: 'movie' },
    ];
    for (const query of examples) {
      const response = await fetch(
        `${base}/search/semantic?${new URLSearchParams(query)}`,
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.ok(Array.isArray(data.items));
      assert.ok(data.items.every((item) => Number.isFinite(item.distance)));
      if (query.type)
        assert.ok(data.items.every((item) => item.type === query.type));
      console.log(
        JSON.stringify(
          {
            query: data.query,
            items: data.items.map(({ id, title, distance }) => ({
              id,
              title,
              distance,
            })),
          },
          null,
          2,
        ),
      );
    }
    for (const suffix of [
      '',
      '?q=%20',
      '?q=test&limit=51',
      '?q=test&type=invalid',
    ]) {
      assert.equal(
        (await fetch(`${base}/search/semantic${suffix}`)).status,
        400,
      );
    }
    console.log('Semantic API checks passed.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
