import dataSource from '../database/data-source';
import { Title } from '../titles/entities/title.entity';
import { syncTitleCredits } from './tmdb-credits';

async function main() {
  await dataSource.initialize();
  try {
    if (await dataSource.showMigrations())
      throw new Error('Сначала примените миграции');
    const titles = await dataSource
      .getRepository(Title)
      .find({ select: { id: true }, order: { id: 'ASC' } });
    let count = 0;
    for (const item of titles) {
      await dataSource.transaction(async (manager) => {
        const title = await manager
          .getRepository(Title)
          .createQueryBuilder('t')
          .addSelect('t.tmdbPayload')
          .where('t.id = :id', { id: item.id })
          .setLock('pessimistic_write')
          .getOne();
        if (title?.tmdbPayload)
          await syncTitleCredits(
            manager,
            title.id,
            title.tmdbPayload,
            title.type,
          );
      });
      count++;
      if (count % 50 === 0)
        console.log(`Обработано произведений: ${count}/${titles.length}`);
    }
    console.log(`Составы синхронизированы: ${count}`);
  } finally {
    await dataSource.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Ошибка синхронизации',
  );
  process.exitCode = 1;
});
