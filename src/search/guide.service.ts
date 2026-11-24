import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TitlesService } from '../titles/titles.service';
import { GuideModel } from './guide-model';
import { SearchService } from './search.service';
import type { SearchOptions } from './search-options';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function referenceTail(query: string) {
  const match =
    /(?:похож[а-яё]*\s+(?:[^.!?«»"]{1,55}?\s+)?на|наподобие|(?:что[- ]то|кино|фильм|сериал)\s+как|в\s+(?:духе|стиле)|тако[йея]\s+же(?:\s+[^,«»"]{1,30})?,?\s+как)\s+(?:(?:фильм|сериал|мультфильм)(?:а|у|е)?\s+)?(.+)/iu.exec(
      query,
    );
  return match?.[1]?.trim();
}
function anchors(tail: string) {
  const quoted = /^[«“"]([^»”"]+)[»”"]/.exec(tail);
  const words = normalize(quoted?.[1] ?? tail).split(' ');
  return quoted
    ? [words.join(' ')]
    : words.map((_, i) => words.slice(0, i + 1).join(' ')).reverse();
}

interface Features {
  id: number;
  minutes: number | null;
  genres: string[];
  keywords: number[];
}
function overlap<T>(left: T[], right: T[]) {
  const shared = left.filter((v) => right.includes(v)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

@Injectable()
export class GuideService {
  constructor(
    private readonly db: DataSource,
    private readonly titles: TitlesService,
    private readonly search: SearchService,
    private readonly model: GuideModel,
  ) {}

  async recommend(options: SearchOptions, previous?: string) {
    const decision = await this.model.intent(options.query, previous);
    if (decision.intent === 'other')
      return {
        items: [],
        message:
          'Я помогаю с фильмами и сериалами. Расскажи, какое кино хочешь посмотреть, или задай вопрос о кино.',
      };
    if (decision.intent !== 'recommend')
      return {
        items: [],
        message: decision.reply || 'Какое кино хочется посмотреть?',
      };
    const explicit = referenceTail(options.query);
    const query = explicit
      ? options.query
      : decision.reference
        ? 'Похожее на «' + decision.reference + '», ' + decision.query
        : decision.query;
    const pool = await this.candidates({
      ...options,
      query,
      limit: Math.max(options.limit, 12),
    });
    if (!pool.items.length) return pool;
    const items = await this.model.review(
      decision.query,
      pool.items,
      options.limit,
      decision.reference,
    );
    return {
      items,
      message: items.length
        ? undefined
        : 'Не нашёл достаточно подходящего варианта в доступном каталоге. Какое условие можно смягчить?',
    };
  }

  private async candidates(options: SearchOptions) {
    const { query, limit } = options;
    const tail = referenceTail(query);
    if (!tail) return this.search.semantic(options);
    const names = anchors(tail);
    const matches = await this.db.query<
      { id: number; title: string; year: number | null; alias: string }[]
    >(
      `SELECT DISTINCT t.id,t.title,extract(year FROM t.release_date)::int AS year, alias
       FROM titles t CROSS JOIN LATERAL unnest(ARRAY[t.title,t.original_title]) n(name)
       CROSS JOIN LATERAL (SELECT trim(regexp_replace(replace(lower(n.name),'ё','е'),'[^[:alnum:]]+',' ','g')) AS alias) a
       WHERE alias=ANY($1::text[]) ORDER BY t.id`,
      [names],
    );
    const best = names.find((name) => matches.some((m) => m.alias === name));
    const year = tail.match(/\b(?:19|20)\d{2}\b/)?.[0];
    const candidates = matches.filter((m) => m.alias === best);
    const byYear = year
      ? candidates.filter((m) => String(m.year) === year)
      : [];
    const refs = byYear.length ? byYear : candidates;
    if (refs.length !== 1)
      return {
        items: [],
        message: refs.length
          ? 'Нашёл несколько произведений с таким названием. Уточни год: ' +
            refs
              .map((r) => r.year)
              .filter(Boolean)
              .join(', ') +
            '.'
          : 'Не нашёл исходное произведение в каталоге. Проверь название или опиши сюжет своими словами.',
      };
    const ref = refs[0];
    const request = query.slice(0, query.length - tail.length);
    const type =
      options.type ??
      (/сериал/iu.test(request)
        ? 'series'
        : /фильм/iu.test(request)
          ? 'movie'
          : undefined);
    const pool = await this.titles.similar(
      ref.id,
      Math.max(50, limit),
      type,
      options.exclude,
    );
    if (!pool.items.length)
      return {
        items: [],
        message:
          'Для «' +
          ref.title +
          '» пока нет подходящих соседей в выбранном разделе.',
      };
    const features = await this.db.query<Features[]>(
      `SELECT t.id, t.runtime_minutes AS minutes, ARRAY(SELECT g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id) AS genres,
         ARRAY(SELECT tk.keyword_id FROM title_keywords tk WHERE tk.title_id=t.id) AS keywords
       FROM titles t WHERE t.id=ANY($1::integer[])`,
      [[ref.id, ...pool.items.map((r) => r.id)]],
    );
    const byId = new Map(features.map((row) => [row.id, row]));
    const source = byId.get(ref.id)!;
    const animation = (f: Features) =>
      f.genres.some((g) => /мульт|анимаци/iu.test(g));
    const noAnimation = /(?:без|кроме|не)\s+(?:мульт|анимаци)/iu.test(query);
    const preferAnimation =
      !noAnimation && /мультфильм|мультик|анимацион/iu.test(query);
    const shorter = /короче|покороче|менее длинн/iu.test(query);
    const extra = normalize(tail)
      .split(' ')
      .slice(ref.alias.split(' ').length)
      .join(' ')
      .replace(/^(?:(?:19|20)\d{2}\s*|но\s+|только\s+)+/u, '')
      .trim();
    const extraScores = new Map<number, number>();
    if (extra) {
      const preferences = await this.search.semantic({
        query: extra,
        exclude: options.exclude,
        type,
        limit: 50,
      });
      for (const row of preferences.items)
        extraScores.set(row.id, row.similarity);
    }
    const ranked = pool.items
      .flatMap((item) => {
        const f = byId.get(item.id);
        if (!f) return [];
        if (noAnimation && animation(f)) return [];
        if (
          shorter &&
          (!source.minutes || !f.minutes || f.minutes >= source.minutes)
        )
          return [];
        const common = source.genres.filter((g) => f.genres.includes(g));
        const genre = overlap(source.genres, f.genres);
        const themes = overlap(source.keywords, f.keywords);
        const mismatch =
          animation(f) !== (preferAnimation || animation(source));
        const score =
          item.similarity +
          0.19 * genre +
          0.3 * themes -
          (mismatch ? 0.17 : 0) +
          0.12 * (extraScores.get(item.id) ?? 0);
        return [
          {
            item,
            score,
            reason: common.length
              ? 'Общие жанры: ' + common.join(', ')
              : undefined,
          },
        ];
      })
      .sort((a, b) => b.score - a.score || a.item.id - b.item.id);
    return {
      message:
        'Подбор по «' +
        ref.title +
        '» с учётом сюжета, жанров и ключевых слов.' +
        (ranked.length
          ? ''
          : ' Среди кандидатов нет произведений, удовлетворяющих ограничениям.'),
      items: ranked
        .slice(0, limit)
        .map(({ item, reason }) => ({ ...item, reason })),
    };
  }
}
