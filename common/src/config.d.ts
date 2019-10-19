export namespace Configuration {
  // Settings to use during video transcoding.
  export interface Transcoder {
    // If source quality = target quality (no scaling) and the source codec is h264, set to true to copy the video directly.
    // Currently that is the default behaviour. This is faster but uses more space (and bandwidth).
    maxCopyEnabled: boolean;
    // Minimum source qualtiy to bother transcoding down from. Eg if minQuality is 480p and 240p is requested and the source is 480p
    // then just do 480p instead. However if the source is 720p, then transcode it to the targetted quality (240p).
    // Set to 0 to disable.
    minQuality: number;
    // An array of qualities to transcode to in heights for caching and streaming.
    qualities: number[];
    // True to cache keyframes the first time they're requested.
    enableCachingKeyframes: boolean;
    // True to cache keyframes as part of the importing process.
    enablePrecachingKeyframes: boolean;
    // True to enable video caching for all videos as part of the import process.
    enableVideoCaching: boolean;
  }

  // Settings to persist across UI sessions.
  export interface User {
    // Enable autoplay if possible on desktop browsers. (Will always start muted).
    autoplayEnabled?: boolean;
    // The number of columns to display in the quick-tag panel.
    tagColumnCount?: number;
    // If enabled updates the URL with the applications state. This means it's possible
    // to bookmark search results or the currently accessed media.
    stateEnabled?: boolean;
    // If true lowers the quality on seek and initial load for desktop browsers.
    // This allows faster loading and skipping around. Might want to set to true
    // when using the application remotely.
    lowQualityOnLoadEnabled?: boolean;
    // If true lowers the quality on seek and initial load for mobile browsers.
    // Recommended to be true.
    lowQualityOnLoadEnabledForMobile?: boolean;
    // If set to a value greater than 0 than the initial search done at load time will limit
    // to this number. This is useful in large collections.
    initialLoadLimit?: number;
  }

  export interface Mongo {
    provider: 'mongodb';
    uri: string;
    db: string;
  }

  export interface Main {
    port: number; // The listen port.
    libraryPath: string; // Path to the source library.
    cachePath: string; // Path to store thumbnails and cached media.
    database: Mongo;
    transcoder: Transcoder;
    // Enable pHash generation for video and stills
    enablePhash: boolean;
    user: User;
    username?: string; // Optional clear-text login username.
    password?: string; // Optional clear-text login password.
  }

  export interface PartialTranscoder {
    maxCopyEnabled?: boolean;
    minQuality?: number;
    qualities?: number[];
    enableCachingKeyframes?: boolean;
    enablePrecachingKeyframes?: boolean;
    enableVideoCaching?: boolean;
  }

  export interface Partial {
    port?: number; // The listen port.
    libraryPath?: string; // Path to the source library.
    cachePath?: string; // Path to store thumbnails and cached media.
    transcoder?: PartialTranscoder;
    user?: User;
    username?: string; // Optional clear-text login username.
    password?: string; // Optional clear-text login password.
  }
}
