import type { DataSource } from 'typeorm';
import type { TitlesService } from '../titles/titles.service';
import type { SearchService } from './search.service';
import type { GuideModel } from './guide-model';
import { GuideService, referenceTail } from './guide.service';

describe('referenceTail', () => {
  it.each([
    ['Хочу фильм который похож по атмосфере на Интерстеллар', 'Интерстеллар'],
    [
      'Посоветуй похожее на «Интерстеллар», но короче',
      '«Интерстеллар», но короче',
    ],
    ['что-то как Interstellar', 'Interstellar'],
    ['кино в стиле «Дюна»', '«Дюна»'],
    ['фантастика о первом контакте', undefined],
  ])('разбирает %s', (query, expected) => {
    expect(referenceTail(query!)).toBe(expected);
  });
});

describe('проверка запроса и ответа КиноГида', () => {
  const intent = jest.fn(),
    review = jest.fn(),
    semantic = jest.fn();
  const guide = new GuideService(
    {} as DataSource,
    {} as TitlesService,
    { semantic } as unknown as SearchService,
    { intent, review } as unknown as GuideModel,
  );
  beforeEach(() => jest.resetAllMocks());
  it('останавливается до поиска при посторонней теме', async () => {
    intent.mockResolvedValue({ intent: 'other' });
    const r = await guide.recommend({
      query: 'В каком году придумали Python?',
      limit: 3,
    });
    expect(r.items).toEqual([]);
    expect(semantic).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it('исключает отметки до поиска, проверяет кандидатов и допускает пустой ответ', async () => {
    intent.mockResolvedValue({
      intent: 'recommend',
      query: 'история о программисте',
      reference: '',
    });
    semantic.mockResolvedValue({ items: [{ id: 1, title: 'Фильм' }] });
    review.mockResolvedValue([]);
    const r = await guide.recommend({
      query: 'Фильм про программиста',
      limit: 3,
      exclude: [17],
    });
    expect(semantic).toHaveBeenCalledWith(
      expect.objectContaining({ exclude: [17] }),
    );
    expect(review).toHaveBeenCalledTimes(1);
    expect(r.items).toEqual([]);
  });
  it('не подменяет отказ модели непроверенной выдачей', async () => {
    intent.mockRejectedValue(new Error('busy'));
    await expect(
      guide.recommend({ query: 'Фантастика', limit: 3 }),
    ).rejects.toThrow('busy');
    expect(semantic).not.toHaveBeenCalled();
  });
});
