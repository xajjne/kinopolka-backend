import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource, type QueryRunner, type EntityManager } from 'typeorm';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import db from '../src/database/data-source';
import { TitlesService } from '../src/titles/titles.service';
import { TitlesController } from '../src/titles/titles.controller';
import { AdminController } from '../src/accounts/admin.controller';
import { AccountsController } from '../src/accounts/accounts.controller';

describe('Film community in PostgreSQL', () => {
  let runner: QueryRunner;
  let app: INestApplication;
  beforeAll(async () => {
    await db.initialize();
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const mod = await Test.createTestingModule({
      controllers: [AccountsController, TitlesController, AdminController],
      providers: [
        TitlesService,
        {
          provide: DataSource,
          useValue: {
            query: runner.query.bind(runner),
            transaction: (fn: (manager: EntityManager) => unknown) =>
              fn(runner.manager),
          },
        },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    await runner?.release();
    if (db.isInitialized) await db.destroy();
  });
  it('limits moderation to admins and publishes collections as the platform', async () => {
    const guest = request(app.getHttpServer()),
      admin = request.agent(app.getHttpServer()),
      member = request.agent(app.getHttpServer());
    const register = async (agent: typeof admin) => {
      const nickname =
        'mod_' + randomBytes(10).toString('hex').replace(/[0-9]/g, 'a');
      const headers = {
        'X-Filmets-Client': 'web',
        'X-Filmets-Account': nickname,
      };
      await agent
        .post('/auth/register')
        .set(headers)
        .send({ nickname, password: randomBytes(12).toString('hex') })
        .expect(201);
      return { nickname, headers };
    };
    const a = await register(admin),
      u = await register(member);
    await runner.query('UPDATE accounts SET is_admin=true WHERE nickname=$1', [
      a.nickname,
    ]);
    await guest.get('/admin').expect(401);
    await member.get('/admin').expect(403);
    const [{ id }] = await runner.query(
      'SELECT id FROM titles ORDER BY id LIMIT 1',
    );
    const draft = { name: 'Редакция', description: '', titles: [String(id)] };
    await member
      .post('/admin/collections')
      .set(u.headers)
      .send(draft)
      .expect(403);
    const created = (
      await admin
        .post('/admin/collections')
        .set(a.headers)
        .send(draft)
        .expect(201)
    ).body.id;
    const publicRows = async () =>
      (await guest.get('/collections').expect(200)).body as {
        id: string;
        author: string;
      }[];
    expect(await publicRows()).toContainEqual(
      expect.objectContaining({ id: created, author: 'Кинополка' }),
    );
    const path = '/admin/collections/' + created;
    await admin
      .patch(path)
      .set(a.headers)
      .send({ ...draft, name: 'Изменено' })
      .expect(200);
    await admin
      .patch(path + '/visibility')
      .set(a.headers)
      .send({ hidden: true })
      .expect(200);
    expect((await publicRows()).some((c) => c.id === created)).toBe(false);
    await admin
      .patch(path + '/visibility')
      .set(a.headers)
      .send({ hidden: false })
      .expect(200);
    expect((await publicRows()).some((c) => c.id === created)).toBe(true);
    await admin.delete(path).set(a.headers).expect(200);
    expect((await publicRows()).some((c) => c.id === created)).toBe(false);
    await admin
      .patch('/admin/users/' + a.nickname)
      .set(a.headers)
      .send({ suspended: true })
      .expect(403);
    await admin
      .patch('/admin/users/' + u.nickname)
      .set(a.headers)
      .send({ suspended: true })
      .expect(200);
    expect((await member.get('/auth/me')).body.account).toBeNull();
    await admin
      .patch('/admin/users/' + u.nickname)
      .set(a.headers)
      .send({ suspended: false })
      .expect(200);
  });
  it('restores the account, counts one vote per viewer and publishes comments', async () => {
    const [{ id }] = await runner.query(
      'SELECT id FROM titles ORDER BY id LIMIT 1',
    );
    const agent = request.agent(app.getHttpServer());
    const guest = request(app.getHttpServer());
    const credentials = {
      nickname:
        'test_' + randomBytes(10).toString('hex').replace(/[0-9]/g, 'a'),
      password: randomBytes(16).toString('hex'),
    };
    const headers = {
      'X-Filmets-Client': 'web',
      'X-Filmets-Account': credentials.nickname,
    };
    const url = '/titles/' + id + '/community';
    const before = (await guest.get(url).expect(200)).body;
    await guest
      .post('/titles/' + id + '/comments')
      .set(headers)
      .send({ text: 'test' })
      .expect(401);
    await agent
      .post('/auth/register')
      .set(headers)
      .send(credentials)
      .expect(201);
    const details = {
      name: 'Имя зрителя',
      handle: 'viewer',
      bio: 'Люблю фантастику',
      email: 'viewer@example.org',
    };
    await agent.patch('/me/profile').set(headers).send(details).expect(200);
    expect((await agent.get('/auth/me')).body.profile).toMatchObject(details);
    const published = (await guest.get('/profiles/' + credentials.nickname))
      .body;
    expect(published.name).toBe(details.name);
    expect(published.email).toBeUndefined();
    const ids = (
      await runner.query('SELECT id FROM titles ORDER BY id DESC LIMIT 2')
    ).map((r) => String(r.id));
    const draft = {
      name: 'Истории',
      description: 'Для просмотра',
      titles: ids,
    };
    await guest.post('/collections').set(headers).send(draft).expect(401);
    const created = (
      await agent.post('/collections').set(headers).send(draft).expect(201)
    ).body.id;
    await agent
      .patch('/collections/' + created + '/bookmark')
      .set(headers)
      .send({ saved: true })
      .expect(200);
    await agent
      .patch('/collections/' + created + '/bookmark')
      .set(headers)
      .send({ saved: true })
      .expect(200);
    expect(
      (await guest.get('/collections')).body.find((c) => c.id === created),
    ).toMatchObject({
      name: draft.name,
      owner: credentials.nickname,
      titles: ids,
      initialSaves: 1,
      saved: false,
    });
    expect(
      (await agent.get('/collections')).body.find((c) => c.id === created)
        .saved,
    ).toBe(true);
    await agent
      .patch('/collections/' + created + '/bookmark')
      .set(headers)
      .send({ saved: false })
      .expect(200);
    const [seed] = await runner.query(
      'SELECT title_id FROM title_embeddings ORDER BY title_id LIMIT 1',
    );
    const seedUrl = '/me/shelf/' + seed.title_id;
    await agent
      .patch(seedUrl)
      .set(headers)
      .send({ favorite: true })
      .expect(200);
    const suggestions = (await agent.get('/titles/recommended').expect(200))
      .body.items;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.map((t) => t.id)).not.toContain(seed.title_id);
    await agent
      .patch('/me/shelf/' + suggestions[0].id)
      .set(headers)
      .send({ status: 'watched' })
      .expect(200);
    expect(
      (await agent.get('/titles/recommended')).body.items.map((t) => t.id),
    ).not.toContain(suggestions[0].id);
    expect((await guest.get('/titles/recommended')).body.items).toEqual([]);
    const setRating = (rating: number | null) =>
      agent
        .patch('/me/shelf/' + id)
        .set(headers)
        .send({ rating });
    await setRating(11).expect(400);
    const reviewUrl = '/titles/' + id + '/comments';
    const review = {
      title: 'Заголовок',
      text: 'Тестовый комментарий',
      spoiler: true,
    };
    await agent.post(reviewUrl).set(headers).send(review).expect(400);
    await setRating(7).expect(200);
    await setRating(9).expect(200);
    await agent
      .post('/titles/' + id + '/comments')
      .set(headers)
      .send({ text: '   ' })
      .expect(400);
    await agent
      .post('/titles/' + id + '/comments')
      .set(headers)
      .send(review)
      .expect(201);
    await agent.post('/auth/logout').set(headers).expect(201);
    await agent.post('/auth/login').set(headers).send(credentials).expect(201);
    expect((await agent.get('/auth/me')).body.shelf[id].rating).toBe(9);
    const after = (await guest.get(url).expect(200)).body;
    expect(after.votes).toBe(before.votes + 1);
    expect(after.total).toBe(before.total + 1);
    expect(after.comments[0]).toMatchObject({
      nickname: credentials.nickname,
      body: 'Тестовый комментарий',
    });
    expect(after.comments[0]).toMatchObject({
      rating: 9,
      title: review.title,
      spoiler: true,
    });
    await agent
      .post(reviewUrl)
      .set(headers)
      .send({ ...review, title: 'Изменено' })
      .expect(201);
    expect((await agent.get(url)).body.own.title).toBe('Изменено');
    expect((await guest.get(url)).body.total).toBe(after.total);
    await agent
      .patch('/reviews/' + after.comments[0].id + '/reaction')
      .set(headers)
      .send({ kind: 'like' })
      .expect(200);
    expect((await guest.get(url)).body.comments[0].likes).toBe(1);
    const second = request.agent(app.getHttpServer());
    const secondName = 'b' + credentials.nickname;
    const secondHeaders = { ...headers, 'X-Filmets-Account': secondName };
    await second
      .post('/auth/register')
      .set(secondHeaders)
      .send({ ...credentials, nickname: secondName })
      .expect(201);
    await agent
      .post('/profiles/' + secondName + '/friend')
      .set(headers)
      .send({ add: true })
      .expect(201);
    expect((await second.get('/profiles/' + secondName)).body.incoming).toEqual(
      [{ nickname: credentials.nickname }],
    );
    await second
      .post('/profiles/' + credentials.nickname + '/friend')
      .set(secondHeaders)
      .send({ add: true })
      .expect(201);
    expect(
      (await guest.get('/profiles/' + credentials.nickname)).body.friends,
    ).toEqual([{ nickname: secondName }]);
    await agent
      .post('/profiles/' + secondName + '/friend')
      .set(headers)
      .send({ add: false })
      .expect(201);
    expect((await guest.get('/profiles/' + secondName)).body.friends).toEqual(
      [],
    );
    const [series] = await runner.query(
      `SELECT t.id, s->>'season_number' AS season FROM titles t,jsonb_array_elements(t.tmdb_payload->'seasons') s WHERE (s->>'episode_count')::int>0 LIMIT 1`,
    );
    const episodeUrl =
      '/titles/' +
      series.id +
      '/seasons/' +
      series.season +
      '/episodes/1/rating';
    const original = (await guest.get(episodeUrl).expect(200)).body;
    await agent.patch(episodeUrl).set(headers).send({ rating: 6 }).expect(200);
    expect((await agent.get(episodeUrl)).body).toMatchObject({
      mine: 6,
      votes: original.votes + 1,
    });
    await agent
      .patch(episodeUrl.replace('/rating', '/watched'))
      .set(headers)
      .send({ watched: true })
      .expect(200);
    const grid = (
      await agent.get('/titles/' + series.id + '/episodes/scores').expect(200)
    ).body;
    expect(grid).toContainEqual(
      expect.objectContaining({
        season: Number(series.season),
        episode: 1,
        mine: 6,
        watched: true,
      }),
    );
    expect((await guest.get(episodeUrl)).body.mine).toBeNull();
    await agent
      .patch(episodeUrl)
      .set(headers)
      .send({ rating: null })
      .expect(200);
    expect((await guest.get(episodeUrl)).body.votes).toBe(original.votes);
    await setRating(null).expect(200);
    expect((await guest.get(url)).body.total).toBe(before.total);
    expect((await agent.get(url)).body.own.title).toBe('Изменено');
    expect((await guest.get(url)).body.votes).toBe(before.votes);
  });
});
