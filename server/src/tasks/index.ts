import { Database, RouterTask } from '../types';
import FS from 'fs';
import Path from 'path';

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

const taskLoaders = [...getTaskLoaders(__dirname), ...getTaskLoaders(`${__dirname}/tensorflow`)];

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
