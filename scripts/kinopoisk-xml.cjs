// TMDB movie and TV identifiers use different Wikidata properties.
const { setTimeout: delay } = require('node:timers/promises');
async function readUrl(url) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Filmets/1.0 (course project; catalog ratings)',
        },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt >= 1) throw e;
      await delay(1500);
      continue;
    }
    if (response.status === 404) return null;
    if (response.ok) return response.text();
    if (attempt >= 1 || ![429, 502, 503, 504].includes(response.status))
      throw Error(url.hostname + ' HTTP ' + response.status);
    await delay(
      Math.max(2000, Number(response.headers.get('retry-after') || 0) * 1000),
    );
  }
}
async function match(ids, type) {
  const url = new URL('https://query.wikidata.org/sparql');
  const prop = type === 'movie' ? 'P4947' : 'P4983';
  url.searchParams.set('format', 'json');
  url.searchParams.set(
    'query',
    `SELECT DISTINCT ?tmdb ?kp WHERE { VALUES ?tmdb { ${ids.map((id) => JSON.stringify(String(id))).join(' ')} } ?item wdt:${prop} ?tmdb; wdt:P2603 ?kp. }`,
  );
  const result = JSON.parse(await readUrl(url));
  const candidates = new Map();
  for (const { tmdb, kp } of result.results.bindings) {
    if (!/^\d+$/.test(kp.value)) continue;
    const key = Number(tmdb.value);
    if (!candidates.has(key)) candidates.set(key, new Set());
    candidates.get(key).add(kp.value);
  }
  return candidates;
}
module.exports = async function importXml(db, save) {
  const { rows } = await db.query(
    "SELECT t.type,t.tmdb_id AS id,r.url FROM titles t LEFT JOIN external_ratings r ON r.title_id=t.id AND r.source='kinopoisk' ORDER BY t.id",
  );
  const totals = {
    catalog: rows.length,
    saved: 0,
    unmatched: 0,
    unrated: 0,
    errors: 0,
  };
  const jobs = [];
  for (const type of ['movie', 'series']) {
    const missing = [];
    for (const t of rows.filter((t) => t.type === type)) {
      const kp = t.url?.match(/\/(\d+)\/?$/)?.[1];
      if (kp) jobs.push({ ...t, kp });
      else if (t.id) missing.push(t);
      else totals.unmatched++;
    }
    for (let i = 0; i < missing.length; i += 80) {
      const batch = missing.slice(i, i + 80);
      try {
        const candidates = await match(
          batch.map((t) => t.id),
          type,
        );
        for (const t of batch) {
          const ids = candidates.get(t.id);
          if (ids?.size === 1) jobs.push({ ...t, kp: [...ids][0] });
          else totals.unmatched++;
        }
      } catch (e) {
        console.error(type, 'batch', i, e.cause?.message ?? e.message);
        totals.errors += batch.length;
      }
    }
  }
  console.log('Сопоставлено:', jobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const t = jobs[cursor++];
      try {
        const xml = await readUrl(
          new URL('https://rating.kinopoisk.ru/' + t.kp + '.xml'),
        );
        if (xml === null) {
          totals.unrated++;
          continue;
        }
        if (!/<rating[\s>]/.test(xml))
          throw Error('Неизвестный ответ вместо XML');
        const m = xml.match(
          /<kp_rating\b([^>]*)>\s*(\d+(?:\.\d+)?)\s*<\/kp_rating>/,
        );
        if (!m || Number(m[2]) <= 0 || /num_vote=["']0["']/.test(m[1])) {
          totals.unrated++;
          continue;
        }
        await save(db, {
          type: t.type,
          tmdbId: t.id,
          source: 'kinopoisk',
          score: Number(m[2]),
          url:
            'https://www.kinopoisk.ru/' +
            (t.type === 'series' ? 'series' : 'film') +
            '/' +
            t.kp +
            '/',
        });
        totals.saved++;
      } catch (e) {
        totals.errors++;
        console.error(t.type, t.id, e.cause?.message ?? e.message);
      }
      if (cursor % 50 === 0)
        console.log('Обработано:', cursor, 'из', jobs.length);
      await delay(250);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  console.log(JSON.stringify(totals));
  if (totals.errors) process.exitCode = 1;
};
