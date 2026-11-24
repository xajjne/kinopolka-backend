import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Title } from './entities/title.entity';
import { Genre } from './entities/genre.entity';
import { Keyword } from './entities/keyword.entity';
import { TitleGenre } from './entities/title-genre.entity';
import { TitleKeyword } from './entities/title-keyword.entity';
import { TitleEmbedding } from './entities/title-embedding.entity';
import { Person } from './entities/person.entity';
import { TitleCredit } from './entities/title-credit.entity';
import { TitleMedia } from './entities/title-media.entity';
import { TitlesService } from './titles.service';
import { GenresController, TitlesController } from './titles.controller';
import { PeopleController } from './people.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Title,
      Genre,
      Keyword,
      TitleGenre,
      TitleKeyword,
      TitleEmbedding,
      Person,
      TitleCredit,
      TitleMedia,
    ]),
  ],
  controllers: [TitlesController, GenresController, PeopleController],
  providers: [TitlesService],
  exports: [TitlesService],
})
export class TitlesModule {}
