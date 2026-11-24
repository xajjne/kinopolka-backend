import 'reflect-metadata';
import 'dotenv/config';

import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

const config = new ConfigService();

export default new DataSource({
  type: 'postgres',
  host: config.getOrThrow<string>('POSTGRES_HOST'),
  port: Number(config.getOrThrow<string>('POSTGRES_PORT')),
  username: config.getOrThrow<string>('POSTGRES_USER'),
  password: config.getOrThrow<string>('POSTGRES_PASSWORD'),
  database: config.getOrThrow<string>('POSTGRES_DB'),

  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],

  synchronize: false,
});