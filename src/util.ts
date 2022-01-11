import fs from 'fs-extra';
import path from 'path';
import type { PackageJson } from 'types-package-json';

let packageJsonCache: PackageJson | undefined;
export const packageJson = (): PackageJson => {
  if (packageJsonCache) return packageJsonCache;
  packageJsonCache = fs.readJSONSync(path.resolve(process.cwd(), `package.json`));
  return packageJsonCache as PackageJson;
};

export const getVersion = (): string => {
  const { COMMIT_SHA } = process.env;
  let { version } = packageJson();
  if (COMMIT_SHA) version = `${version}#${COMMIT_SHA.substring(0, 8)}`;
  return version;
};

export const getRandomElement = <T>(array: T[]): T => {
  return array[Math.floor(Math.random() * array.length)];
};
