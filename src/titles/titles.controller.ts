import {
  BadRequestException,
  Body,
  Headers,
  Header,
  Post,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { catalogOptions, pagination, positiveInteger } from './catalog-options';
import { personalExclusions, sessionUser } from '../accounts/session';
import { DataSource } from 'typeorm';
import { shelfExclusions } from './shelf-exclusions';
import { TitlesService } from './titles.service';

@Controller('titles')
export class TitlesController {
  constructor(
    private readonly titles: TitlesService,
    private readonly db: DataSource,
  ) {}

  @Get()
  catalog(@Query() params: Record<string, unknown>) {
    return this.titles.catalog(catalogOptions(params));
  }

  @Get(':id/credits')
  credits(@Param('id') id: string, @Query() params: Record<string, unknown>) {
    const kind = params.kind ?? 'cast';
    if (kind !== 'cast' && kind !== 'crew')
      throw new BadRequestException('kind должен быть cast или crew');
    return this.titles.credits(
      positiveInteger(id, 'id'),
      kind,
      pagination(params),
    );
  }

  @Get(':id/media')
  media(@Param('id') id: string, @Query() params: Record<string, unknown>) {
    const kind = params.kind ?? 'backdrops';
    if (
      kind !== 'backdrops' &&
      kind !== 'posters' &&
      kind !== 'logos' &&
      kind !== 'videos'
    )
      throw new BadRequestException('Неизвестный вид медиаданных');
    return this.titles.gallery(
      positiveInteger(id, 'id'),
      kind,
      pagination(params),
    );
  }

  @Post('cards')
  async cards(@Body() body: { ids?: unknown }) {
    return this.titles.shelfCards(await shelfExclusions(this.db, body?.ids));
  }

  @Post(':id/similar')
  async personalized(
    @Param('id') id: string,
    @Body() body: { exclude?: unknown },
    @Headers('cookie') cookie?: string,
  ) {
    return this.titles.similar(positiveInteger(id, 'id'), 5, undefined, [
      ...new Set([
        ...(await shelfExclusions(this.db, body?.exclude)),
        ...(await personalExclusions(this.db, cookie)),
      ]),
    ]);
  }

  @Get(':id/similar')
  async similar(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('cookie') cookie?: string,
  ) {
    return this.titles.similar(
      positiveInteger(id, 'id'),
      limit === undefined ? 10 : positiveInteger(limit, 'limit', 50),
      undefined,
      await personalExclusions(this.db, cookie),
    );
  }

  @Get('recommended')
  @Header('Cache-Control','private, no-store')
  async recommended(@Headers('cookie') cookie?: string) {
    const user = await sessionUser(this.db, cookie);
    return { items: user ? await this.titles.forViewer(user.id) : [] };
  }
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.titles.detail(positiveInteger(id, 'id'));
  }
}

@Controller('genres')
export class GenresController {
  constructor(private readonly titles: TitlesService) {}

  @Get()
  genres(@Query('type') type?: string) {
    if (type !== undefined && type !== 'movie' && type !== 'series')
      throw new BadRequestException('type должен быть movie или series');
    return this.titles.genres(type);
  }
}
