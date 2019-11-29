import {
  BaseMedia,
  Configuration,
  Media,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '@vimtur/common';

export abstract class Database {
  public abstract getMedia(hash: string): Promise<Media | undefined>;
  public abstract saveMedia(hash: string, media: UpdateMedia): Promise<Media>;
  public abstract removeMedia(hash: string): Promise<void>;
  public abstract resetClones(age: number): Promise<void>;

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
