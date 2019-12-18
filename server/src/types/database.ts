import {
  BaseMedia,
  Configuration,
  Media,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '@vimtur/common';

export abstract class Database {
  // Media
  public abstract getMedia(hash: string): Promise<Media | undefined>;
  public abstract saveMedia(hash: string, media: UpdateMedia): Promise<Media>;
  public abstract removeMedia(hash: string): Promise<void>;
  // Media - tags
  public abstract addMediaTag(hash: string, tag: string): Promise<void>;
  public abstract removeMediaTag(hash: string, tag: string): Promise<void>;
  // Media - actors
  public abstract addMediaActor(hash: string, actor: string): Promise<void>;
  public abstract removeMediaActor(hash: string, actor: string): Promise<void>;

  // Searching
  public abstract subset(constraints: SubsetConstraints): Promise<string[]>;
  public abstract subsetFields(
    constraints: SubsetConstraints,
    fields: SubsetFields,
  ): Promise<BaseMedia[]>;

  // Actors
  public abstract addActor(name: string): Promise<void>;
  public abstract removeActor(name: string): Promise<void>;
  public abstract getActors(): Promise<string[]>;

  // Tags
  public abstract addTag(name: string): Promise<void>;
  public abstract removeTag(name: string): Promise<void>;
  public abstract getTags(): Promise<string[]>;

  // Config
  public abstract getUserConfig(): Promise<Configuration.Partial>;
  public abstract saveUserConfig(config: Configuration.Partial): Promise<void>;

  // Utility
  public abstract close(): Promise<void>;
  public abstract resetClones(age: number): Promise<void>;
}
