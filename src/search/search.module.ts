import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { GuideModel } from './guide-model';
import { GuideService } from './guide.service';
import { TitlesModule } from '../titles/titles.module';

@Module({
  imports: [TitlesModule],
  controllers: [SearchController],
  providers: [SearchService, GuideService, GuideModel],
})
export class SearchModule {}
