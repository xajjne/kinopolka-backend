# Filmets · API каталога

NestJS и TypeORM обслуживают каталог, профили, полки, публичные подборки, оценки, комментарии и КиноГид. PostgreSQL хранит эмбеддинги фильмов в pgvector и ищет ближайших соседей по индексу HNSW.

## Первый запуск

Команды для PowerShell выполняются в корне backend. Понадобятся Node.js (проверено с 26), npm и Docker Compose. Для новой установки скопируйте .env.example в .env и задайте POSTGRES_PASSWORD. Для существующей базы используйте её действующие параметры подключения.

```powershell
npm.cmd ci
docker compose up -d --wait
npm.cmd run typeorm -- migration:run -d src/database/data-source.ts
npm.cmd run start:dev
```

API по умолчанию доступен на http://127.0.0.1:3000. Vite из репозитория frontend пересылает сюда запросы с префиксом /api. Compose использует именованный том filmets_postgres_data.

## Пример наполнения новой базы

Для обращения к TMDB задайте TMDB_READ_ACCESS_TOKEN в .env. Пример загружает по одной странице каталога каждого типа. Обогащение получает дополнительные сведения о медиа и персонах.

```powershell
node --env-file=.env -r ts-node/register src/import/import-catalog.ts movie 1
node --env-file=.env -r ts-node/register src/import/import-catalog.ts series 1
node --env-file=.env -r ts-node/register src/import/enrich-catalog.ts media 40
node --env-file=.env -r ts-node/register src/import/enrich-catalog.ts people 20
```

Для семантического поиска выполните векторизацию в репозитории ml-service и запустите его API. ML_SERVICE_URL по умолчанию указывает на http://127.0.0.1:8000. КиноГиду дополнительно нужен OPENROUTER_API_KEY.

## Проверка

```powershell
npm.cmd run build
npm.cmd test -- --runInBand
npm.cmd run test:db
```

Интеграционные тесты запускаются после миграций и наполнения каталога фильмами и сериалами и расчёта эмбеддингов в ml-service. Тестовые записи создаются внутри транзакций с откатом.
