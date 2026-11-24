import { collectionInput } from './collection-input';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Header,
} from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { imageUrl } from '../titles/catalog-format';
import { DataSource } from 'typeorm';
import { cookieName, sessionHash, sessionUser, tokenHash } from './session';
import { positiveInteger } from '../titles/catalog-options';

const lifetime = 30 * 24 * 60 * 60 * 1000;
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});
const hashPassword = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
const columns = 'status, favorite, rating';
function checkWrite(req: Request) {
  if (req.get('x-filmets-client') !== 'web') throw new ForbiddenException();
}
@Controller()
export class AccountsController {
  constructor(private readonly db: DataSource) {}
  private attempts = new Map<string, { count: number; until: number }>();
  private throttle(ip: string) {
    const now = Date.now();
    for (const [key, bucket] of this.attempts)
      if (bucket.until <= now) this.attempts.delete(key);
    const bucket = this.attempts.get(ip) ?? { count: 0, until: now + 60000 };
    if (bucket.count >= 20)
      throw new HttpException(
        'Слишком много попыток. Повтори через минуту.',
        429,
      );
    bucket.count++;
    this.attempts.set(ip, bucket);
  }
  private async authenticate(
    register: boolean,
    req: Request,
    res: Response,
    body: Record<string, unknown>,
  ) {
    checkWrite(req);
    this.throttle(req.ip ?? 'local');
    const name = body?.nickname,
      password = body?.password;
    if (
      typeof name !== 'string' ||
      !/^[a-z_]{1,40}$/.test(name) ||
      typeof password !== 'string' ||
      password.length > 256 ||
      !password.length ||
      (register && password.length < 8)
    )
      throw new BadRequestException(
        'Ник — до 40 строчных латинских букв или _. Пароль при регистрации — от 8 до 256 символов.',
      );
    const token = randomBytes(32).toString('hex');
    let encoded = '';
    if (register) {
      const salt = randomBytes(16).toString('hex');
      encoded =
        salt + ':' + (await hashPassword(password, salt)).toString('hex');
    }
    let id: number;
    if (!register) {
      const [row] = await this.db.query<
        { id: number; password_hash: string }[]
      >(
        'SELECT id,password_hash FROM accounts WHERE nickname=$1 AND NOT suspended',
        [name],
      );
      const [salt, hash] = (
        row?.password_hash ?? '0'.repeat(32) + ':' + '0'.repeat(128)
      ).split(':');
      const ok = timingSafeEqual(
        await hashPassword(password, salt),
        Buffer.from(hash, 'hex'),
      );
      if (!ok || !row)
        throw new UnauthorizedException('Неверный логин или пароль');
      id = row.id;
    }
    await this.db.transaction(async (m) => {
      if (register) {
        const [r] = await m.query<{ id: number }[]>(
          'INSERT INTO accounts(nickname,password_hash) VALUES ($1,$2) ON CONFLICT(nickname) DO NOTHING RETURNING id',
          [name, encoded],
        );
        if (!r) throw new ConflictException('Этот ник уже занят');
        id = r.id;
      }
      await m.query(
        'DELETE FROM account_sessions WHERE expires_at<=now() OR token_hash=$1',
        [sessionHash(req.headers.cookie)],
      );
      await m.query(
        'INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,$3)',
        [tokenHash(token), id, new Date(Date.now() + lifetime)],
      );
    });
    res.cookie(cookieName, token, { ...cookieOptions(), maxAge: lifetime });
    return { account: name };
  }
  @Post('auth/register') register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.authenticate(true, req, res, body);
  }
  @Post('auth/login') login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.authenticate(false, req, res, body);
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkWrite(req);
    await this.db.query('DELETE FROM account_sessions WHERE token_hash=$1', [
      sessionHash(req.headers.cookie),
    ]);
    res.clearCookie(cookieName, cookieOptions());
    return { ok: true };
  }
  @Get('auth/me') @Header('Cache-Control', 'no-store') async me(
    @Headers('cookie') cookie?: string,
  ) {
    const user = await sessionUser(this.db, cookie);
    if (!user) return { account: null, shelf: {} };
    const rows = await this.db.query<
      {
        title_id: number;
        status: string | null;
        favorite: boolean;
        rating: number | null;
      }[]
    >(
      'SELECT title_id,' + columns + ' FROM shelf_entries WHERE account_id=$1',
      [user.id],
    );
    return {
      account: user.nickname,
      admin: user.admin,
      profile: (
        await this.db.query('SELECT profile FROM accounts WHERE id=$1', [
          user.id,
        ])
      )[0].profile,
      shelf: Object.fromEntries(
        rows.map(({ title_id, ...entry }) => [title_id, entry]),
      ),
    };
  }
  private async episode(raw: string, season: string, episode: string) {
    const id = positiveInteger(raw, 'id'),
      num = positiveInteger(episode, 'episode');
    if (!/^\d{1,6}$/.test(season)) throw new BadRequestException();
    const rows = await this.db.query(
      `SELECT 1 FROM titles t, jsonb_array_elements(t.tmdb_payload->'seasons') s WHERE t.id=$1 AND (s->>'season_number')::int=$2 AND (s->>'episode_count')::int >= $3`,
      [id, Number(season), num],
    );
    if (!rows.length) throw new NotFoundException('Серия не найдена');
    return [id, Number(season), num];
  }
  @Get('titles/:id/seasons/:season/episodes/:episode/rating')
  async episodeScore(
    @Param() p: { id: string; season: string; episode: string },
    @Headers('cookie') cookie?: string,
  ) {
    const key = await this.episode(p.id, p.season, p.episode),
      user = await sessionUser(this.db, cookie);
    const [row] = await this.db.query(
      'SELECT coalesce(sum(n),0)::int AS votes,round(sum(rating*n)/nullif(sum(n),0),1)::float8 AS average,max(mine) AS mine,jsonb_object_agg(rating,n) AS histogram FROM (SELECT rating,count(*) AS n,max(rating) FILTER(WHERE account_id=$4) AS mine FROM episode_ratings WHERE title_id=$1 AND season=$2 AND episode=$3 GROUP BY rating) bins',
      [...key, user?.id ?? null],
    );
    return row;
  }
  @Patch('titles/:id/seasons/:season/episodes/:episode/rating')
  async rateEpisode(
    @Param() p: { id: string; season: string; episode: string },
    @Req() req: Request,
    @Body() body: { rating?: unknown },
  ) {
    checkWrite(req);
    const user = await sessionUser(this.db, req.headers.cookie);
    if (!user || req.get('x-filmets-account') !== user.nickname)
      throw new UnauthorizedException();
    const value = body?.rating;
    if (
      value !== null &&
      !(
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 10
      )
    )
      throw new BadRequestException();
    const key = [...(await this.episode(p.id, p.season, p.episode)), user.id];
    if (value === null)
      await this.db.query(
        'DELETE FROM episode_ratings WHERE title_id=$1 AND season=$2 AND episode=$3 AND account_id=$4',
        key,
      );
    else
      await this.db.query(
        'INSERT INTO episode_ratings(title_id,season,episode,account_id,rating) VALUES($1,$2,$3,$4,$5) ON CONFLICT(title_id,season,episode,account_id) DO UPDATE SET rating=excluded.rating',
        [...key, value],
      );
    return { ok: true };
  }
  @Get('titles/:id/episodes/scores')
  @Header('Cache-Control', 'no-store')
  async episodeScores(
    @Param('id') raw: string,
    @Headers('cookie') cookie?: string,
  ) {
    const user = await sessionUser(this.db, cookie);
    return this.db.query(
      `WITH scores AS (
      SELECT season, episode, avg(rating)::float8 AS average, max(rating) FILTER (WHERE account_id=$2) AS mine
      FROM episode_ratings WHERE title_id=$1 GROUP BY season,episode
    ), watched AS (SELECT season,episode FROM episode_views WHERE title_id=$1 AND account_id=$2)
    SELECT season,episode,average,mine,watched.episode IS NOT NULL AS watched
    FROM scores FULL JOIN watched USING(season,episode)`,
      [positiveInteger(raw, 'id'), user?.id ?? null],
    );
  }

  @Patch('titles/:id/seasons/:season/episodes/:episode/watched')
  async markEpisode(
    @Param() p: { id: string; season: string; episode: string },
    @Req() req: Request,
    @Body() body: { watched?: unknown },
  ) {
    const user = await this.owner(req);
    if (typeof body?.watched !== 'boolean') throw new BadRequestException();
    const params = [
      ...(await this.episode(p.id, p.season, p.episode)),
      user.id,
    ];
    await this.db.query(
      body.watched
        ? 'INSERT INTO episode_views(title_id,season,episode,account_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING'
        : 'DELETE FROM episode_views WHERE title_id=$1 AND season=$2 AND episode=$3 AND account_id=$4',
      params,
    );
    return { ok: true };
  }

  @Get('collections')
  @Header('Cache-Control', 'no-store')
  async collections(@Headers('cookie') cookie?: string) {
    const user = await sessionUser(this.db, cookie);
    const rows = await this.db.query(
      `SELECT c.id,c.name,c.description,a.nickname AS owner,
      coalesce(items.ids,ARRAY[]::text[]) AS titles,items.poster,
      (SELECT count(*)::int FROM collection_bookmarks b WHERE b.collection_id=c.id) AS "initialSaves",
      EXISTS(SELECT 1 FROM collection_bookmarks b WHERE b.collection_id=c.id AND b.account_id=$1) AS saved
      FROM collections c LEFT JOIN accounts a ON a.id=c.owner
      LEFT JOIN LATERAL(SELECT array_agg(t.id::text ORDER BY l.position) AS ids,(array_agg(t.poster_path ORDER BY l.position))[1] AS poster FROM collection_titles l JOIN titles t ON t.id=l.title_id WHERE l.collection_id=c.id) items ON true
      WHERE NOT c.hidden ORDER BY c.created_at DESC,c.id`,
      [user?.id ?? null],
    );
    return rows.map(({ poster, ...row }) => ({
      ...row,
      cover: imageUrl(poster) ?? '',
      author: row.owner ?? 'Кинополка',
    }));
  }
  private async owner(req: Request) {
    checkWrite(req);
    const user = await sessionUser(this.db, req.headers.cookie);
    if (!user || user.nickname !== req.get('x-filmets-account'))
      throw new UnauthorizedException();
    return user;
  }
  @Post('collections')
  async createCollection(
    @Req() req: Request,
    @Body() body: { name?: unknown; description?: unknown; titles?: unknown },
  ) {
    const user = await this.owner(req);
    const { name, description, ids } = collectionInput(body);
    return this.db.transaction(async (m) => {
      const found = await m.query(
        'SELECT id FROM titles WHERE id=ANY($1::int[]) FOR KEY SHARE',
        [ids],
      );
      if (found.length !== ids.length)
        throw new BadRequestException(
          'Одного из произведений уже нет в каталоге',
        );
      const id = 'collection-' + randomBytes(16).toString('hex');
      await m.query(
        'INSERT INTO collections(id,owner,name,description) VALUES ($1,$2,$3,$4)',
        [id, user.id, name, description.trim()],
      );
      await m.query(
        'INSERT INTO collection_titles(collection_id,title_id,position) SELECT $1,id,pos FROM unnest($2::int[]) WITH ORDINALITY AS titles(id,pos)',
        [id, ids],
      );
      return { id };
    });
  }
  @Patch('collections/:id/bookmark')
  async bookmark(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: { saved?: unknown },
  ) {
    const user = await this.owner(req);
    if (typeof body?.saved !== 'boolean') throw new BadRequestException();
    if (body.saved) {
      const rows = await this.db.query(
        'INSERT INTO collection_bookmarks(account_id,collection_id) SELECT $1,id FROM collections WHERE id=$2 AND NOT hidden ON CONFLICT(account_id,collection_id) DO UPDATE SET collection_id=excluded.collection_id RETURNING collection_id',
        [user.id, id],
      );
      if (!rows.length) throw new NotFoundException();
    } else
      await this.db.query(
        'DELETE FROM collection_bookmarks WHERE account_id=$1 AND collection_id=$2',
        [user.id, id],
      );
    return { saved: body.saved };
  }
  @Patch('me/profile')
  async saveProfile(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.owner(req);
    for (const [k, n] of Object.entries({
      name: 60,
      handle: 40,
      bio: 400,
      email: 254,
    }))
      if (typeof body?.[k] !== 'string' || (body[k] as string).length > n)
        throw new BadRequestException('Проверь длину полей профиля');
    if (!(body.name as string).trim() || !(body.handle as string).trim())
      throw new BadRequestException();
    const avatar = body.avatar;
    if (
      avatar != null &&
      (typeof avatar !== 'string' ||
        avatar.length > 90000 ||
        !/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(avatar))
    )
      throw new BadRequestException('Выбери изображение меньшего размера');
    const profile = {
      name: body.name,
      handle: body.handle,
      bio: body.bio,
      email: body.email,
      avatar,
    };
    await this.db.query('UPDATE accounts SET profile=$1::jsonb WHERE id=$2', [
      JSON.stringify(profile),
      user.id,
    ]);
    return profile;
  }
  @Get('profiles/:nickname')
  @Header('Cache-Control', 'private, no-store')
  async profile(
    @Param('nickname') name: string,
    @Headers('cookie') cookie?: string,
  ) {
    const [profile] = await this.db.query(
      "SELECT id,nickname,profile->>'name' AS name,profile->>'bio' AS bio,profile->>'avatar' AS avatar FROM accounts WHERE nickname=$1",
      [name],
    );
    if (!profile) throw new NotFoundException('Профиль не найден');
    const viewer = await sessionUser(this.db, cookie);
    const friends = await this.db.query(
      `SELECT a.nickname FROM friend_requests f JOIN friend_requests r ON r.sender=f.recipient AND r.recipient=f.sender JOIN accounts a ON a.id=f.recipient WHERE f.sender=$1 ORDER BY a.nickname`,
      [profile.id],
    );
    const incoming =
      viewer?.id === profile.id
        ? await this.db.query(
            `SELECT a.nickname FROM friend_requests f JOIN accounts a ON a.id=f.sender WHERE f.recipient=$1 AND NOT EXISTS(SELECT 1 FROM friend_requests r WHERE r.sender=$1 AND r.recipient=f.sender) ORDER BY a.nickname`,
            [profile.id],
          )
        : [];
    const [relation] = await this.db.query(
      'SELECT EXISTS(SELECT 1 FROM friend_requests WHERE sender=$1 AND recipient=$2) AS sent, EXISTS(SELECT 1 FROM friend_requests WHERE sender=$2 AND recipient=$1) AS received',
      [viewer?.id ?? null, profile.id],
    );
    const comments = await this.db.query(
      'SELECT c.id,c.body,t.id AS "titleId",t.title FROM title_comments c JOIN titles t ON t.id=c.title_id LEFT JOIN shelf_entries s ON s.account_id=c.account_id AND s.title_id=c.title_id WHERE c.account_id=$1 AND (c.headline IS NULL OR s.rating IS NOT NULL) ORDER BY c.id DESC LIMIT 20',
      [profile.id],
    );
    return {
      nickname: name,
      name: profile.name,
      bio: profile.bio,
      avatar: profile.avatar,
      friends,
      incoming,
      ...relation,
      comments,
    };
  }
  @Post('profiles/:nickname/friend')
  async friendship(
    @Param('nickname') name: string,
    @Req() req: Request,
    @Body() body: { add?: boolean },
  ) {
    checkWrite(req);
    const viewer = await sessionUser(this.db, req.headers.cookie);
    if (!viewer || viewer.nickname !== req.get('x-filmets-account'))
      throw new UnauthorizedException();
    if (name === viewer.nickname || typeof body?.add !== 'boolean')
      throw new BadRequestException();
    const [other] = await this.db.query(
      'SELECT id FROM accounts WHERE nickname=$1',
      [name],
    );
    if (!other) throw new NotFoundException('Профиль не найден');
    if (body.add)
      await this.db.query(
        'INSERT INTO friend_requests(sender,recipient) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [viewer.id, other.id],
      );
    else
      await this.db.query(
        'DELETE FROM friend_requests WHERE (sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1)',
        [viewer.id, other.id],
      );
    return { ok: true };
  }
  @Get('titles/:id/community')
  @Header('Cache-Control', 'no-store')
  async community(@Param('id') raw: string, @Req() req: Request) {
    const id = positiveInteger(raw, 'id');
    const page =
      req.query.page === undefined
        ? 1
        : positiveInteger(req.query.page, 'page', 10000);
    const [summary] = await this.db.query(
      'SELECT coalesce(sum(n),0)::int AS votes,round(sum(rating*n)/nullif(sum(n),0),1)::float8 AS average,jsonb_object_agg(rating,n) AS histogram FROM (SELECT rating,count(*) AS n FROM shelf_entries WHERE title_id=$1 AND rating IS NOT NULL GROUP BY rating) bins',
      [id],
    );
    const user = await sessionUser(this.db, req.headers.cookie);
    const visible = `FROM title_comments c LEFT JOIN shelf_entries s USING(title_id,account_id)
      WHERE c.title_id=$1 AND (c.headline IS NULL OR s.rating IS NOT NULL)`;
    const [count] = await this.db.query(
      'SELECT count(*)::int AS total ' + visible,
      [id],
    );
    const comments = await this.db.query(
      `WITH visible AS (
      SELECT c.*,s.rating ${visible} ORDER BY c.id DESC LIMIT 10 OFFSET $2)
      SELECT c.id,c.body,c.headline AS title,c.spoiler,c.rating,c.created_at AS "createdAt",a.nickname,
      r.likes,r.dislikes,r.reaction FROM visible c JOIN accounts a ON a.id=c.account_id
      CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE kind='like')::int AS likes,
      count(*) FILTER (WHERE kind='dislike')::int AS dislikes,max(kind) FILTER (WHERE account_id=$3) AS reaction
      FROM review_reactions WHERE comment_id=c.id) r ORDER BY c.id DESC`,
      [id, (page - 1) * 10, user?.id ?? null],
    );
    const [own] = user
      ? await this.db.query(
          'SELECT id,headline AS title,body,spoiler FROM title_comments WHERE title_id=$1 AND account_id=$2 AND headline IS NOT NULL',
          [id, user.id],
        )
      : [];
    return { ...summary, ...count, comments, own: own ?? null };
  }
  @Post('titles/:id/comments') async comment(
    @Param('id') raw: string,
    @Req() req: Request,
    @Body() body: { title?: unknown; text?: unknown; spoiler?: unknown },
  ) {
    const user = await this.owner(req);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (
      !title ||
      title.length > 120 ||
      !text ||
      text.length > 2000 ||
      (body.spoiler !== undefined && typeof body.spoiler !== 'boolean')
    )
      throw new BadRequestException(
        'Заполните заголовок (до 120 знаков) и текст рецензии (до 2000 знаков).',
      );
    const rows = await this.db.query(
      `INSERT INTO title_comments(account_id,title_id,headline,body,spoiler)
      SELECT account_id,title_id,$3,$4,$5 FROM shelf_entries WHERE title_id=$1 AND account_id=$2 AND rating IS NOT NULL
      ON CONFLICT(title_id,account_id) WHERE headline IS NOT NULL DO UPDATE SET
      headline=excluded.headline,body=excluded.body,spoiler=excluded.spoiler RETURNING id`,
      [positiveInteger(raw, 'id'), user.id, title, text, body.spoiler ?? false],
    );
    if (!rows.length)
      throw new BadRequestException('Выберите оценку перед публикацией.');
    return rows[0];
  }
  @Patch('reviews/:id/reaction')
  async react(
    @Req() req: Request,
    @Param('id') raw: string,
    @Body() body: { kind?: unknown },
  ) {
    const user = await this.owner(req);
    const id = positiveInteger(raw, 'id');
    if (body?.kind === null)
      await this.db.query(
        'DELETE FROM review_reactions WHERE comment_id=$1 AND account_id=$2',
        [id, user.id],
      );
    else {
      if (body?.kind !== 'like' && body?.kind !== 'dislike')
        throw new BadRequestException();
      const rows = await this.db.query(
        `INSERT INTO review_reactions(comment_id,account_id,kind)
        SELECT id,$2,$3 FROM title_comments WHERE id=$1 ON CONFLICT(comment_id,account_id)
        DO UPDATE SET kind=excluded.kind RETURNING comment_id`,
        [id, user.id, body.kind],
      );
      if (!rows.length) throw new NotFoundException();
    }
    return { ok: true };
  }
  @Patch('me/shelf/:id') async update(
    @Req() req: Request,
    @Param('id') raw: string,
    @Body() body: Record<string, unknown>,
  ) {
    checkWrite(req);
    const user = await sessionUser(this.db, req.headers.cookie);
    if (!user || req.get('x-filmets-account') !== user.nickname)
      throw new UnauthorizedException('Войди в аккаунт заново');
    const id = positiveInteger(raw, 'id');
    const keys = Object.keys(body ?? {});
    if (
      !keys.length ||
      keys.some((k) => !['status', 'favorite', 'rating'].includes(k)) ||
      ('favorite' in body && typeof body.favorite !== 'boolean') ||
      ('status' in body &&
        body.status !== null &&
        (typeof body.status !== 'string' ||
          !['watching', 'planned', 'watched', 'paused', 'dropped'].includes(
            body.status,
          ))) ||
      ('rating' in body &&
        body.rating !== null &&
        !(
          typeof body.rating === 'number' &&
          Number.isInteger(body.rating) &&
          body.rating >= 1 &&
          body.rating <= 10
        ))
    )
      throw new BadRequestException('Некорректная отметка');
    return this.db.transaction(async (m) => {
      const exists = await m.query(
        'SELECT id FROM titles WHERE id=$1 FOR KEY SHARE',
        [id],
      );
      if (!exists.length)
        throw new NotFoundException('Произведение не найдено');
      const [entry] = await m.query<
        { status: string | null; favorite: boolean; rating: number | null }[]
      >(
        `INSERT INTO shelf_entries(account_id,title_id,status,favorite,rating) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(account_id,title_id) DO UPDATE SET ${keys.map((k) => k + '=EXCLUDED.' + k).join(', ')},updated_at=now() RETURNING ${columns}`,
        [
          user.id,
          id,
          body.status ?? null,
          body.favorite ?? false,
          body.rating ?? null,
        ],
      );
      if (!entry.status && !entry.favorite && entry.rating === null) {
        await m.query(
          'DELETE FROM shelf_entries WHERE account_id=$1 AND title_id=$2',
          [user.id, id],
        );
        return { entry: null };
      }
      return { entry };
    });
  }
}
