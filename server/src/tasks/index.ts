import { Database, RouterTask } from '../types';
import FS from 'fs';
import Path from 'path';

function isAvxSupported(): boolean {
  try {
    const cpuInfo = FS.readFileSync('/proc/cpuinfo').toString();
    const rawKeyValues = cpuInfo.split('\n').map(line => line.split(':'));
    const trimmedKeyValues = rawKeyValues.map(arr => arr.map(el => el.trim()));
    const rawFlags = trimmedKeyValues.find(([key]) => key === 'flags');
    if (!rawFlags) {
      console.warn('Unable to find flags in CPU info. AVX tasks disabled.');
      return false;
    }
    const flags = rawFlags[1]?.split(' ').map(el => el.trim());
    if (!flags) {
      console.warn('Unable to extract flags value from key in CPU info. AVX tasks disabled.');
      return false;
    }

    if (!flags.includes('avx')) {
      console.warn('CPU does not support avx instructions. AVX tasks disabled.');
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Unable to load CPU info. AVX tasks disabled.', err.message);
    return false;
  }
}

interface TaskLoader {
  getTask: (database: Database) => RouterTask | RouterTask[] | undefined;
}

type TaskLoaderOptionalTask = Partial<TaskLoader>;

function getTaskLoaders(dir: string): TaskLoader[] {
  return FS.readdirSync(dir, { encoding: 'utf8' })
    .filter(file => file.endsWith('.js') && file !== Path.basename(__filename))
    .map(file => {
      try {
        // eslint-disable-next-line
        const loader: TaskLoaderOptionalTask = require(`${dir}/${file}`);
        if (!loader.getTask) {
          // Not a task loader.
          return undefined;
        }
        return loader as TaskLoader;
      } catch (err) {
        console.warn(`Failed to load task: ${file}`, err);
        return undefined;
      }
    })
    .filter(loader => loader !== undefined) as TaskLoader[];
}

const taskLoaders = [
  ...getTaskLoaders(__dirname),
  ...(isAvxSupported() ? getTaskLoaders(`${__dirname}/avx`) : []),
];

export function getTasks(database: Database): RouterTask[] {
  return (
    taskLoaders
      .map(loader => {
        const tasks = loader.getTask(database);
        return Array.isArray(tasks) ? tasks : [tasks];
      })
      // Map 2d array to 1d.
      .reduce((acc, val) => acc.concat(val), [])
      .filter(task => task !== undefined) as RouterTask[]
  );
}
