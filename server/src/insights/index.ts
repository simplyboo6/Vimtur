import { Database } from '../types';
import { setup as setupDb } from '../database';

interface TrackedAverage {
  total: number;
  count: number;
  name: string;
}

interface CalculatedAverage {
  name: string;
  average: number;
  count: number;
}

interface AverageData<T> {
  tags: T[];
  actors: T[];
  artists: T[];
}

interface ScoredMedia {
  hash: string;
  score: number;
}

const MIN_COUNT_FOR_AVERAGE = 2;
const BATCH_SIZE = 16;

class Insights {
  private db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public async analyse(): Promise<AverageData<CalculatedAverage>> {
    const data: AverageData<TrackedAverage> = {
      tags: [],
      actors: [],
      artists: [],
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
    data.artists = data.artists.filter(artist => {
      const artistLower = artist.name.toLowerCase();
      for (const actor of data.actors) {
        if (artistLower.includes(actor.name.toLowerCase())) {
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
    // Convert to maps because they're quicker to access.
    const tagRatings: Record<string, number> = {};
    const actorRatings: Record<string, number> = {};
    const artistRatings: Record<string, number> = {};
    for (const tag of insights.tags) {
      tagRatings[tag.name] = tag.average;
    }
    for (const actor of insights.actors) {
      actorRatings[actor.name] = actor.average;
    }
    for (const artist of insights.artists) {
      artistRatings[artist.name] = artist.average;
    }

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
              const rating = tagRatings[tag];
              if (rating) {
                scoredMedia.score += rating;
              }
            }
          }

          if (media.actors) {
            for (const actor of media.actors) {
              const rating = actorRatings[actor];
              if (rating) {
                scoredMedia.score += rating;
              }
            }
          }

          if (media.metadata && media.metadata.artist) {
            const rating = artistRatings[media.metadata.artist];
            if (rating) {
              scoredMedia.score += rating;
            }
          }

          scored.push(scoredMedia);
        }),
      );
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private calculateAverages(list: TrackedAverage[]): CalculatedAverage[] {
    return list
      .filter(avg => avg.count >= MIN_COUNT_FOR_AVERAGE)
      .map(el => {
        return { name: el.name, average: el.total / el.count, count: el.count };
      })
      .sort((a, b) => b.average - a.average);
  }

  private updateRating(list: TrackedAverage[], name: string, rating: number): void {
    const avg = list.find(el => el.name === name);
    const mappedRating = (rating - 3) / 2;
    if (avg) {
      avg.total += mappedRating;
      avg.count++;
    } else {
      list.push({
        name,
        total: mappedRating,
        count: 1,
      });
    }
  }
}

function printAverages(name: string, list: CalculatedAverage[]): void {
  console.log(name);
  for (const item of list) {
    console.log(`${item.name}: ${item.average.toFixed(2)}`);
  }
  console.log();
}

async function printRecommendations(
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
  const hashes = await db.subset({ rating: { max: 0 }, any: '*' });
  const rawRecommendations = await insights.getRecommendations(hashes, results);
  console.timeEnd('Time to build recommendations');
  await printRecommendations(db, rawRecommendations, 50);

  await db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
