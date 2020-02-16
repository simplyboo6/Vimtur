import { CalculatedAverage, SortedAverage } from '@vimtur/common';
import { Database } from '../types';
import { setup as setupDb } from '../database';

interface TrackedAverage {
  total: number;
  count: number;
}

export interface AverageData<T> {
  tags: Record<string, T>;
  actors: Record<string, T>;
  artists: Record<string, T>;
}

export interface ScoredMedia {
  hash: string;
  score: number;
}

const MIN_COUNT_FOR_AVERAGE = 2;
const BATCH_SIZE = 16;

function filterObject<T>(
  obj: Record<string, T>,
  callback: (name: string, obj: T) => boolean,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (callback(key, value)) {
      result[key] = value;
    }
  }
  return result;
}

function mapObject<T, K>(
  obj: Record<string, T>,
  callback: (name: string, obj: T) => K,
): Record<string, K> {
  const result: Record<string, K> = {};
  for (const key of Object.keys(obj)) {
    result[key] = callback(key, obj[key]);
  }
  return result;
}

export class Insights {
  private db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public async analyse(): Promise<AverageData<CalculatedAverage>> {
    const data: AverageData<TrackedAverage> = {
      tags: {},
      actors: {},
      artists: {},
    };
    const hashes = await this.db.subset({ rating: { min: 1 } });

    while (hashes.length > 0) {
      await Promise.all(
        hashes.splice(0, BATCH_SIZE).map(async hash => {
          const media = await this.db.getMedia(hash);
          if (!media || !media.rating) {
            return;
          }

          if (media.tags) {
            for (const tag of media.tags) {
              this.updateRating(data.tags, tag, media.rating);
            }
          }
          if (media.actors) {
            for (const actor of media.actors) {
              this.updateRating(data.actors, actor, media.rating);
            }
          }
          if (media.metadata && media.metadata.artist) {
            this.updateRating(data.artists, media.metadata.artist, media.rating);
          }
        }),
      );
    }

    // Filter out artists that are also actors.
    data.artists = filterObject(data.artists, artist => {
      const artistLower = artist.toLowerCase();
      for (const actor of Object.keys(data.actors)) {
        if (artistLower.includes(actor.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    return {
      tags: this.calculateAverages(data.tags),
      actors: this.calculateAverages(data.actors),
      artists: this.calculateAverages(data.artists),
    };
  }

  public async getRecommendations(
    hashes: string[],
    insights: AverageData<CalculatedAverage>,
  ): Promise<ScoredMedia[]> {
    const scored: ScoredMedia[] = [];

    while (hashes.length > 0) {
      await Promise.all(
        hashes.splice(0, BATCH_SIZE).map(async hash => {
          const media = await this.db.getMedia(hash);
          if (!media) {
            return;
          }
          const scoredMedia: ScoredMedia = {
            hash,
            score: 0,
          };

          if (media.tags) {
            for (const tag of media.tags) {
              const rating = insights.tags[tag];
              if (rating) {
                scoredMedia.score += rating.average;
              }
            }
          }

          if (media.actors) {
            for (const actor of media.actors) {
              const rating = insights.actors[actor];
              if (rating) {
                scoredMedia.score += rating.average;
              }
            }
          }

          if (media.metadata && media.metadata.artist) {
            const rating = insights.artists[media.metadata.artist];
            if (rating) {
              scoredMedia.score += rating.average;
            }
          }

          scored.push(scoredMedia);
        }),
      );
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private calculateAverages(
    list: Record<string, TrackedAverage>,
  ): Record<string, CalculatedAverage> {
    const filtered = filterObject<TrackedAverage>(
      list,
      (_, avg) => avg.count >= MIN_COUNT_FOR_AVERAGE,
    );
    return mapObject<TrackedAverage, CalculatedAverage>(filtered, (name, el) => {
      return { name, average: el.total / el.count, count: el.count };
    });
  }

  private updateRating(list: Record<string, TrackedAverage>, name: string, rating: number): void {
    const avg = list[name];
    const mappedRating = (rating - 3) / 2;
    if (avg) {
      avg.total += mappedRating;
      avg.count++;
    } else {
      list[name] = {
        total: mappedRating,
        count: 1,
      };
    }
  }
}

export function convertToArray(list: Record<string, CalculatedAverage>): SortedAverage[] {
  const arr: SortedAverage[] = [];
  for (const item of Object.keys(list)) {
    arr.push({
      name: item,
      ...list[item],
    });
  }
  return arr.sort((a, b) => b.average - a.average);
}

export function printAverages(name: string, list: Record<string, CalculatedAverage>): void {
  const arr = convertToArray(list);

  console.log(name);
  for (const item of arr) {
    console.log(`${item.name}: ${item.average.toFixed(2)}`);
  }
  console.log();
}

export async function printRecommendations(
  db: Database,
  recommended: ScoredMedia[],
  limit: number,
): Promise<void> {
  console.log('Recommended');
  for (let i = 0; i < recommended.length && i < limit; i++) {
    const media = await db.getMedia(recommended[i].hash);
    if (!media) {
      continue;
    }
    console.log(`${media.path}: ${recommended[i].score.toFixed(2)}`);
  }
  console.log();
}

async function main(): Promise<void> {
  const db = await setupDb();
  const insights = new Insights(db);
  console.time('Time to analyse ratings');
  const results = await insights.analyse();
  console.timeEnd('Time to analyse ratings');

  printAverages('Tags', results.tags);
  printAverages('Actors', results.actors);
  printAverages('Artists', results.artists);

  console.time('Time to build recommendations');
  const hashes = await db.subset({ rating: { max: 0 }, tags: { exists: true } });
  const rawRecommendations = await insights.getRecommendations(hashes, results);
  console.timeEnd('Time to build recommendations');
  await printRecommendations(db, rawRecommendations, 50);

  await db.close();
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
