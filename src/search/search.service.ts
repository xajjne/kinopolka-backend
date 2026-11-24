import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { SearchOptions } from './search-options';
import { imageUrl } from '../titles/catalog-format';

interface QueryEmbedding {
  model_id: string;
  revision: string;
  dimensions: number;
  embedding: number[];
}

interface SearchRow {
  id: number;
  type: 'movie' | 'series';
  title: string;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  distance: number;
}

function validEmbedding(value: unknown): value is QueryEmbedding {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (
    data.model_id !== 'BAAI/bge-m3' ||
    typeof data.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(data.revision) ||
    data.dimensions !== 1024 ||
    !Array.isArray(data.embedding) ||
    data.embedding.length !== 1024
  )
    return false;
  if (
    !data.embedding.every(
      (item: unknown) => typeof item === 'number' && Number.isFinite(item),
    )
  )
    return false;
  const norm = Math.sqrt(
    (data.embedding as number[]).reduce((sum, item) => sum + item * item, 0),
  );
  return Math.abs(norm - 1) < 0.001;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}

  async semantic(options: SearchOptions) {
    const embedding = await this.embedQuery(options.query);
    const parameters: unknown[] = [
      JSON.stringify(embedding.embedding),
      embedding.model_id,
      embedding.revision,
    ];
    const filters = [
      'e.model_name = $2',
      'e.model_revision = $3',
      'e.text_version = 1',
    ];
    if (options.type) {
      parameters.push(options.type);
      filters.push(`t.type = $${parameters.length}`);
    }
    if (options.genreId !== undefined) {
      parameters.push(options.genreId);
      filters.push(
        `EXISTS (SELECT 1 FROM title_genres AS tg WHERE tg.title_id = t.id AND tg.genre_id = $${parameters.length})`,
      );
    }
    if (options.exclude?.length) {
      parameters.push(options.exclude);
      filters.push(`e.title_id <> ALL($${parameters.length}::int[])`);
    }
    parameters.push(options.limit);
    const rows = await this.database.transaction(async (manager) => {
      // Настройки действуют только в этой транзакции и не затрагивают пул соединений.
      await manager.query(`
        SELECT set_config('hnsw.ef_search', '100', true),
               set_config('hnsw.iterative_scan', 'strict_order', true)
      `);
      return manager.query<SearchRow[]>(
        `
      SELECT t.id, t.type, t.title, t.original_title AS "originalTitle",
             t.overview, t.poster_path AS "posterPath", t.backdrop_path AS "backdropPath",
             t.release_date::text AS "releaseDate", e.embedding <=> $1::vector AS distance
      FROM title_embeddings AS e
      JOIN titles AS t ON t.id = e.title_id
      WHERE ${filters.join(' AND ')}
      ORDER BY e.embedding <=> $1::vector
      LIMIT $${parameters.length}
    `,
        parameters,
      );
    });
    return {
      query: options.query,
      count: rows.length,
      model: {
        name: embedding.model_id,
        revision: embedding.revision,
        dimensions: embedding.dimensions,
        textVersion: 1,
      },
      items: rows.map((row) => ({
        ...row,
        posterUrl: imageUrl(row.posterPath),
        similarity: 1 - row.distance,
      })),
    };
  }

  private async embedQuery(query: string): Promise<QueryEmbedding> {
    try {
      const base =
        this.config.get<string>('ML_SERVICE_URL') ?? 'http://127.0.0.1:8000';
      const response = await fetch(new URL('/embed', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Embedding service failed');
      }
      const data: unknown = await response.json();
      if (!validEmbedding(data)) throw new Error('Invalid embedding response');
      return data;
    } catch {
      throw new ServiceUnavailableException(
        'Сервис семантического поиска временно недоступен. Повторите запрос позже.',
      );
    }
  }
}
