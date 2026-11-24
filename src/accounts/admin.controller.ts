import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { sessionUser } from './session';
import { collectionInput } from './collection-input';

@Controller('admin')
export class AdminController {
  constructor(private readonly db: DataSource) {}
  private async admin(req: Request) {
    const user = await sessionUser(this.db, req.headers.cookie);
    if (!user) throw new UnauthorizedException('Войдите в аккаунт');
    if (
      !user.admin ||
      (req.method !== 'GET' &&
        (req.get('x-filmets-client') !== 'web' ||
          req.get('x-filmets-account') !== user.nickname))
    )
      throw new ForbiddenException('Требуются права администратора');
    return user;
  }
  @Get() @Header('Cache-Control', 'no-store') async dashboard(
    @Req() req: Request,
  ) {
    await this.admin(req);
    const users = await this.db.query(
      'SELECT nickname,is_admin AS admin,suspended FROM accounts ORDER BY nickname',
    );
    const collections = await this.db
      .query(`SELECT c.id,c.name,c.description,c.hidden,a.nickname AS owner,
 coalesce((SELECT jsonb_agg(jsonb_build_object('value',t.id::text,'label',t.title) ORDER BY l.position)
 FROM collection_titles l JOIN titles t ON t.id=l.title_id WHERE l.collection_id=c.id),'[]') AS items
 FROM collections c LEFT JOIN accounts a ON a.id=c.owner ORDER BY c.created_at DESC,c.id`);
    return { users, collections };
  }
  @Patch('users/:name') async moderate(
    @Req() req: Request,
    @Param('name') name: string,
    @Body() body: { suspended?: unknown },
  ) {
    await this.admin(req);
    if (typeof body?.suspended !== 'boolean') throw new BadRequestException();
    await this.db.transaction(async (m) => {
      const [row] = await m.query(
        'SELECT id,is_admin FROM accounts WHERE nickname=$1 FOR UPDATE',
        [name],
      );
      if (!row) throw new NotFoundException();
      if (row.is_admin)
        throw new ForbiddenException('Администратора нельзя заблокировать');
      await m.query('UPDATE accounts SET suspended=$1 WHERE id=$2', [
        body.suspended,
        row.id,
      ]);
      if (body.suspended)
        await m.query('DELETE FROM account_sessions WHERE account_id=$1', [
          row.id,
        ]);
    });
    return { ok: true };
  }
  @Post('collections') async create(
    @Req() req: Request,
    @Body() body: Parameters<typeof collectionInput>[0],
  ) {
    await this.admin(req);
    return this.saveCollection(null, body);
  }
  @Patch('collections/:id') async edit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Parameters<typeof collectionInput>[0],
  ) {
    await this.admin(req);
    return this.saveCollection(id, body);
  }
  private async saveCollection(
    existing: string | null,
    body: Parameters<typeof collectionInput>[0],
  ) {
    const { name, description, ids } = collectionInput(body);
    const id = existing ?? 'collection-' + randomUUID();
    return this.db.transaction(async (m) => {
      if (
        (
          await m.query(
            'SELECT id FROM titles WHERE id=ANY($1::int[]) FOR KEY SHARE',
            [ids],
          )
        ).length !== ids.length
      )
        throw new BadRequestException('Проверьте состав подборки');
      if (existing) {
        const rows = await m.query(
          'UPDATE collections SET name=$1,description=$2 WHERE id=$3 RETURNING id',
          [name, description, id],
        );
        if (!rows[1]) throw new NotFoundException();
        await m.query('DELETE FROM collection_titles WHERE collection_id=$1', [
          id,
        ]);
      } else
        await m.query(
          'INSERT INTO collections(id,name,description,owner) VALUES($1,$2,$3,NULL)',
          [id, name, description],
        );
      await m.query(
        'INSERT INTO collection_titles(collection_id,title_id,position) SELECT $1,t,pos FROM unnest($2::int[]) WITH ORDINALITY AS u(t,pos)',
        [id, ids],
      );
      return { id };
    });
  }
  @Patch('collections/:id/visibility') async visibility(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { hidden?: unknown },
  ) {
    await this.admin(req);
    if (typeof body?.hidden !== 'boolean') throw new BadRequestException();
    const [, count] = await this.db.query(
      'UPDATE collections SET hidden=$1 WHERE id=$2',
      [body.hidden, id],
    );
    if (!count) throw new NotFoundException();
    return { ok: true };
  }
  @Delete('collections/:id') async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.admin(req);
    const [, count] = await this.db.query(
      'DELETE FROM collections WHERE id=$1',
      [id],
    );
    if (!count) throw new NotFoundException();
    return { ok: true };
  }
}
