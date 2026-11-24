import { BadRequestException } from '@nestjs/common';
export function collectionInput(body: {
  name?: unknown;
  description?: unknown;
  titles?: unknown;
}) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '',
    description = body?.description ?? '';
  const ids = body?.titles;
  if (
    !name ||
    name.length > 100 ||
    typeof description !== 'string' ||
    description.length > 4000 ||
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some(
      (v) =>
        typeof v !== 'string' ||
        !/^[1-9]\d{0,9}$/.test(v) ||
        Number(v) > 2147483647,
    ) ||
    new Set(ids).size !== ids.length
  )
    throw new BadRequestException(
      'Укажи название до 100 символов и от 1 до 100 разных произведений.',
    );
  return { name, description: description.trim(), ids: ids as string[] };
}
