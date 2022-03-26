import { DataSourceOptions } from 'typeorm';
import { Channel } from './entity/Channel';
import { Guild } from './entity/Guild';
import { CreateTables1640838214672 } from './migration/1640838214672-CreateTables';

const ENTITIES = [Channel, Guild];
const MIGRATIONS = [CreateTables1640838214672];
// const SUBSCRIBERS = [];

const devConfig: DataSourceOptions = {
  type: 'better-sqlite3',
  database: process.env.CONFIG_DIR
    ? `${process.env.CONFIG_DIR}/db/db.sqlite3`
    : 'config/db/db.sqlite3',
  synchronize: true,
  migrationsRun: false,
  // logging: 'all',
  entities: ENTITIES,
  migrations: MIGRATIONS,
  // subscribers: SUBSCRIBERS,
};

const prodConfig: DataSourceOptions = {
  type: 'better-sqlite3',
  database: process.env.CONFIG_DIR
    ? `${process.env.CONFIG_DIR}/db/db.sqlite3`
    : 'config/db/db.sqlite3',
  synchronize: false,
  logging: false,
  entities: ENTITIES,
  migrations: MIGRATIONS,
  migrationsRun: true,
  // subscribers: SUBSCRIBERS,
};

const finalConfig = process.env.NODE_ENV !== 'production' ? devConfig : prodConfig;

export default finalConfig;
