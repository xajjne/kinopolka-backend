import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pagination, positiveInteger } from './catalog-options';
import {
  creditRoles,
  imageItems,
  imageUrl,
  record,
  records,
  text,
} from './catalog-format';
import { Person } from './entities/person.entity';
import { card, CARD_COLUMNS } from './titles.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly database: DataSource) {}

  @Get()
  async search(@Query('q') value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200)
      return [];
    const rows = await this.database.query<
      { id: number; name: string; profile_path: string | null }[]
    >(
      `SELECT id,name,profile_path FROM people WHERE strpos(lower(name), lower($1)) > 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tmdb_payload->'also_known_as') alias WHERE strpos(lower(alias),lower($1))>0)
       ORDER BY (lower(name)=lower($1)) DESC,(profile_path IS NOT NULL) DESC,name,id LIMIT 6`,
      [value.trim()],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatar: imageUrl(row.profile_path),
    }));
  }

  @Get('tmdb/:tmdbId')
  async resolveTmdb(@Param('tmdbId') rawId: string) {
    const person = await this.database.getRepository(Person).findOne({
      where: { tmdbId: positiveInteger(rawId, 'tmdbId') },
      select: { id: true },
    });
    if (!person) throw new NotFoundException('Персона не найдена');
    return { id: person.id };
  }

  @Get(':id')
  async detail(
    @Param('id') rawId: string,
    @Query() params: Record<string, unknown>,
  ) {
    const id = positiveInteger(rawId, 'id');
    const pages = pagination(params);
    const order =
      params.sort === 'rating'
        ? '"voteAverage" DESC NULLS LAST'
        : params.sort === 'oldest'
          ? 't.release_date ASC NULLS LAST'
          : 't.release_date DESC NULLS LAST';
    const person = await this.database
      .getRepository(Person)
      .createQueryBuilder('p')
      .addSelect('p.tmdbPayload')
      .where('p.id=:id', { id })
      .getOne();
    if (!person) throw new NotFoundException('Персона не найдена');
    const payload = person.tmdbPayload ?? {};
    const totals = await this.database.query<{ total: number }[]>(
      'SELECT count(DISTINCT title_id)::integer AS total FROM title_credits WHERE person_id=$1',
      [id],
    );
    const rows = await this.database.query<
      (Parameters<typeof card>[0] & { credits: unknown })[]
    >(
      `
      SELECT ${CARD_COLUMNS}, jsonb_agg(jsonb_build_object('kind', c.kind, 'entries', c.entries)) AS credits
      FROM title_credits c JOIN titles t ON t.id=c.title_id WHERE c.person_id=$1
      GROUP BY t.id ORDER BY ${order}, t.id
      LIMIT $2 OFFSET $3
    `,
      [id, pages.limit, (pages.page - 1) * pages.limit],
    );
    return {
      id: person.id,
      tmdbId: person.tmdbId,
      name: person.name,
      profilePath: person.profilePath,
      profileUrl: imageUrl(person.profilePath),
      biography:
        text(payload.biography) ??
        text(record(payload.biography_fallback).biography),
      biographyLanguage: text(payload.biography)
        ? 'ru'
        : text(record(payload.biography_fallback).biography)
          ? 'en'
          : null,
      birthday: text(payload.birthday),
      deathday: text(payload.deathday),
      placeOfBirth: text(payload.place_of_birth),
      knownForDepartment: text(payload.known_for_department),
      alsoKnownAs: Array.isArray(payload.also_known_as)
        ? (payload.also_known_as as unknown[]).filter(
            (name): name is string => typeof name === 'string',
          )
        : [],
      detailsLoaded: person.tmdbFetchedAt !== null,
      fetchedAt: person.tmdbFetchedAt,
      photos: imageItems(record(payload.images).profiles).slice(0, 20),
      filmography: {
        scope: 'catalog',
        ...pages,
        total: totals[0].total,
        items: rows.map((row) => ({
          ...card(row),
          credits: records(row.credits).map((credit) => ({
            kind: text(credit.kind),
            ...creditRoles(credit.entries),
          })),
        })),
      },
    };
  }
}
