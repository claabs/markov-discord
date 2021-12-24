const devConfig = {
  type: 'better-sqlite3',
  database: process.env.CONFIG_DIR
    ? `${process.env.CONFIG_DIR}/db/db.sqlite3`
    : 'config/db/db.sqlite3',
  synchronize: true,
  migrationsRun: false,
  // logging: 'all',
  enableWAL: true,
  entities: ['src/entity/**/*.ts'],
  migrations: ['src/migration/**/*.ts'],
  subscribers: ['src/subscriber/**/*.ts'],
  cli: {
    entitiesDir: 'src/entity',
    migrationsDir: 'src/migration',
  },
};

const prodConfig = {
  type: 'better-sqlite3',
  database: process.env.CONFIG_DIR
    ? `${process.env.CONFIG_DIR}/db/db.sqlite3`
    : 'config/db/db.sqlite3',
  synchronize: false,
  logging: false,
  enableWAL: true,
  entities: ['dist/entity/**/*.js'],
  migrations: ['dist/migration/**/*.js'],
  migrationsRun: false,
  subscribers: ['dist/subscriber/**/*.js'],
  cli: {
    entitiesDir: 'dist/entity',
    migrationsDir: 'dist/migration',
  },
};

const finalConfig = process.env.NODE_ENV !== 'production' ? devConfig : prodConfig;

module.exports = finalConfig;
