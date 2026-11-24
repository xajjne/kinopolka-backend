import {
  Controller,
  Get,
  Query,
  Body,
  Headers,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { parseSearchOptions } from './search-options';
import { SearchService } from './search.service';
import {personalExclusions} from '../accounts/session';
import { DataSource } from 'typeorm';
import { shelfExclusions } from '../titles/shelf-exclusions';
import { GuideService } from './guide.service';

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly guide: GuideService,
    private readonly db: DataSource,
  ) {}

  @Get('guide')
  async guideSearch(@Query() query: Record<string, unknown>,@Headers('cookie') cookie?:string) {
    return this.guide.recommend({...parseSearchOptions(query),exclude:await personalExclusions(this.db,cookie)});
  }

  @Post('guide')
  async guideWithShelf(@Body() body: Record<string, unknown>,@Headers('cookie') cookie?:string) {
    if (!body || typeof body !== 'object') throw new BadRequestException();
    const opts = parseSearchOptions(body);
    if (
      body.previous !== undefined &&
      (typeof body.previous !== 'string' || body.previous.length > 1000)
    )
      throw new BadRequestException();
    return this.guide.recommend(
      { ...opts, exclude:[...new Set([...await shelfExclusions(this.db,body.exclude),...await personalExclusions(this.db,cookie)])] },
      body.previous as string | undefined,
    );
  }

  @Get('semantic')
  semantic(@Query() query: Record<string, unknown>) {
    return this.search.semantic(parseSearchOptions(query));
  }
}
