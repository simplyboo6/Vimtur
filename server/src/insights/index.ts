import { SearchIndexer } from './tokens';
import type { CalculatedAverage, SortedAverage } from '@vimtur/common';

import { setup as setupDb } from '../database';
import type { Database } from '../types';

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

const MIN_COUNT_FOR_AVERAGE = 20;

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
  public scores: Record<string, CalculatedAverage> = {};
  private db: Database;
  private indexer = new SearchIndexer();

  public constructor(db: Database) {
    this.db = db;
  }

  public async analyse(): Promise<void> {
    const scores: Record<string, TrackedAverage> = {};

    const allMedia = await this.db.subsetFields({}, 'all');
    for (const media of allMedia) {
      const tags = Object.keys(this.indexer.registerMedia(media));
      if (!media.rating) {
        continue;
      }
      for (const tag of tags) {
        this.updateRating(scores, tag, media.rating);
      }
    }

    this.scores = this.calculateAverages(scores);
    for (const key of Object.keys(this.scores)) {
      if (Math.abs(this.scores[key].average) < 0.1) {
        delete this.scores[key];
      }
    }
  }

  public getRecommendations(hashes?: string[]): ScoredMedia[] {
    const scored: ScoredMedia[] = [];

    hashes = hashes || Array.from(this.indexer.indexed.keys());
    for (const hash of hashes) {
      const scores = this.indexer.getScores(hash);
      const scoredMedia: ScoredMedia = {
        hash,
        score: 0,
      };
      for (const tag of Object.keys(scores)) {
        const rating = this.scores[tag];
        if (rating) {
          scoredMedia.score += rating.average;
        }
      }
      scored.push(scoredMedia);
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
  await insights.analyse();
  console.timeEnd('Time to analyse ratings');

  printAverages('Averages', insights.scores);

  console.time('Time to build recommendations');
  const rawRecommendations = insights.getRecommendations();
  console.timeEnd('Time to build recommendations');
  await printRecommendations(db, rawRecommendations, 50);

  await db.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
