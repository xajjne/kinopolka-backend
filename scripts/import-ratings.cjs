// Run from backend: npm run ratings:import -- file.json (or --kinopoisk).
const { readFile } = require('node:fs/promises');
const { Client } = require('pg');
require('dotenv/config');
async function save(db, row) {
  const { source, type, tmdbId, score, url } = row;
  if (
    !['movie', 'series'].includes(type) ||
    !Number.isSafeInteger(tmdbId) ||
    tmdbId < 1 ||
    !Number.isFinite(score) ||
    score <= 0 ||
    score > 10
  )
    throw Error('Некорректные тип, TMDB ID или оценка: ' + tmdbId);
  const link = new URL(url);
  const valid =
    source === 'kinopoisk'
      ? ['www.kinopoisk.ru', 'kinopoisk.ru'].includes(link.hostname) &&
        /^\/(film|series)\/\d+\/?$/.test(link.pathname)
      : source === 'seriesgraph' &&
        type === 'series' &&
        link.hostname === 'seriesgraph.com' &&
        new RegExp('^/show/' + tmdbId + '(?:-[^/]+)?/?$').test(link.pathname);
  if (
    !valid ||
    link.protocol !== 'https:' ||
    link.username ||
    link.password ||
    link.port
  )
    throw Error('Проверьте ссылку на источник для TMDB ' + tmdbId);
  const result = await db.query(
    `INSERT INTO external_ratings(title_id,source,score,url)
 SELECT id,$3,$4,$5 FROM titles WHERE tmdb_id=$1 AND type=$2
 ON CONFLICT(title_id,source) DO UPDATE SET score=excluded.score,url=excluded.url,updated_at=now()`,
    [tmdbId, type, source, score, link.origin + link.pathname],
  );
  return result.rowCount;
}
async function syncKp(db) {
  const key = process.env.POISKKINO_API_KEY;
  if (!key) throw Error('Добавьте POISKKINO_API_KEY в backend/.env');
  const { rows } = await db.query(
    "SELECT t.tmdb_id,t.type FROM titles t LEFT JOIN external_ratings r ON r.title_id=t.id AND r.source='kinopoisk' WHERE t.tmdb_id IS NOT NULL ORDER BY r.updated_at NULLS FIRST,t.id",
  );
  let saved = 0;
  for (const t of rows) {
    const url = new URL('https://api.poiskkino.dev/v1.5/movie');
    url.searchParams.set('externalId.tmdb', String(t.tmdb_id));
    url.searchParams.set('isSeries', String(t.type === 'series'));
    url.searchParams.set('limit', '2');
    const response = await fetch(url, {
      headers: { 'X-API-KEY': key },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        'ПоискКино: HTTP ' +
          response.status +
          '; сохранено в этом запуске: ' +
          saved,
      );
    const { docs } = await response.json();
    if (!Array.isArray(docs))
      throw Error('Неизвестный формат ответа ПоискКино');
    if (docs.length !== 1) continue;
    const [d] = docs;
    if (
      Number(d.externalId?.tmdb) !== t.tmdb_id ||
      d.isSeries !== (t.type === 'series') ||
      !(d.rating?.kp > 0) ||
      !Number.isSafeInteger(d.id)
    )
      continue;
    saved += await save(db, {
      source: 'kinopoisk',
      type: t.type,
      tmdbId: t.tmdb_id,
      score: d.rating.kp,
      url:
        'https://www.kinopoisk.ru/' +
        (d.isSeries ? 'series' : 'film') +
        '/' +
        d.id +
        '/',
    });
  }
  return saved;
}
async function main() {
  const arg = process.argv[2];
  if (!arg) throw Error('Укажите JSON-файл или --kinopoisk');
  const db = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await db.connect();
  try {
    if (arg === '--kinopoisk-xml') {
      await require('./kinopoisk-xml.cjs')(db, save);
      return;
    }
    if (arg === '--kinopoisk') {
      console.log('Оценок обновлено:', await syncKp(db));
      return;
    }
    const rows = JSON.parse(
      (await readFile(arg, 'utf8')).replace(/^\uFEFF/, ''),
    );
    if (!Array.isArray(rows)) throw Error('Ожидается JSON-массив оценок');
    await db.query('BEGIN');
    try {
      let saved = 0;
      for (const row of rows) saved += await save(db, row);
      await db.query('COMMIT');
      console.log(
        'Сохранено:',
        saved,
        'Отсутствует в каталоге:',
        rows.length - saved,
      );
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  } finally {
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
