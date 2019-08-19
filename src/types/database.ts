import { BaseMedia, Media, UpdateMedia } from './media';
import { Configuration } from './config';

export interface QualityConstraints {
  all?: number[];
  any?: number[];
  none?: number[];
}

export interface RatingConstraints {
  min?: number;
  max?: number;
}

export interface SubsetConstraints {
  any?: '*' | string[];
  all?: string[];
  none?: '*' | string[];
  quality?: QualityConstraints;
  type?: string | string[];
  rating?: RatingConstraints;
  width?: number; // Min width
  height?: number; // Min height
  dir?: string;
  keywordSearch?: string;
  corrupted?: boolean;
  indexed?: boolean;
  thumbnail?: boolean;
  cached?: boolean;
  sortBy?: 'hashDate';
}

export interface SubsetFields {
  hash?: number;
  path?: number;
}

export abstract class Database {
  public abstract getMedia(hash: string): Promise<Media | undefined>;
  public abstract saveMedia(hash: string, media: UpdateMedia): Promise<Media>;
  public abstract removeMedia(hash: string): Promise<void>;

  public abstract subset(constraints: SubsetConstraints): Promise<string[]>;
  public abstract subsetFields(
    constraints: SubsetConstraints,
    fields: SubsetFields,
  ): Promise<BaseMedia[]>;

  public abstract addActor(name: string): Promise<void>;
  public abstract removeActor(name: string): Promise<void>;
  public abstract getActors(): Promise<string[]>;

  public abstract addTag(name: string): Promise<void>;
  public abstract removeTag(name: string): Promise<void>;
  public abstract getTags(): Promise<string[]>;

  public abstract getUserConfig(): Promise<Configuration.Partial>;
  public abstract saveUserConfig(config: Configuration.Partial): Promise<void>;

  public abstract close(): Promise<void>;
}
