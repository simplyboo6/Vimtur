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
    // An array of qualities to transcode to in heights for caching.
    cacheQualities: number[];
    // An array of qualities to transcode to in heights for streaming (includes cached qualities).
    streamQualities: number[];
    // A multiplier for the bitrate. Increasing this results in larger, higher quality streaming segments.
    bitrateMultiplier: number;
    // True to cache keyframes the first time they're requested.
    enableCachingKeyframes: boolean;
    // True to cache keyframes as part of the importing process.
    enablePrecachingKeyframes: boolean;
    // True to enable video caching for all videos as part of the import process.
    enableVideoCaching: boolean;
    // Enable preview generation during import
    enableVideoPreviews: boolean;
    // Video preview height
    videoPreviewHeight: number;
    // Video preview FPS (time between preview images)
    videoPreviewFps: number;
    // Video preview max image total height (before starting a new column).
    videoPreviewMaxHeight: number;
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
    // Number of images to show per-page in the gallery. 0 means all.
    galleryImageCount?: number;
    // Whether to use a native multi-select element on mobile.
    useNativeSelectOnMobile?: boolean;
    // Limit image sizes to the screen width on mobile devices.
    scaleToScreenWidthOnMobile?: boolean;

    // Quick tag panel visibility options.
    quickTagShowRating?: boolean;
    quickTagShowArtist?: boolean;
    quickTagShowAlbum?: boolean;
    quickTagShowTitle?: boolean;
    quickTagShowPeople?: boolean;
    quickTagShowPath?: boolean;
    quickTagShowPlaylists?: boolean;
    quickTagShowAutoTags?: boolean;

    showTaskNotifications?: boolean;
    autoClearCompletedTasks?: boolean;
  }

  // Per-tag configuration for the zero-shot Auto-Tagging pipeline, edited from
  // the Auto-Tagging page and persisted through the normal config overlay.
  export interface AutoTagTag {
    // Short text hints scored alongside the tag name itself (the bare tag and
    // "a photo of {tag}" are always scored too). Replaced wholesale on save.
    descriptions?: string[];
    /**
     * A user-typed score threshold (cosine similarity in [0, 1]) which is
     * applied instead of any calibrated value. Explicit null clears an
     * existing override through the overlay merge; absent means the tag has
     * no override. Zero is a meaningful value, never a placeholder.
     * @minimum 0
     * @maximum 1
     */
    manualThreshold?: number | null;
  }

  // Page-level settings for the Auto-Tagging pipeline.
  export interface AutoTags {
    /**
     * The AUTO-TAG task id of the selected model, e.g.
     * AUTO-TAG-AVES-SIGLIP2-B32 (zero-shot) or AUTO-TAG-MOBILE-NET-V2
     * (classifier). The roster is the server's own listed AUTO-TAG-* tasks
     * (GET /api/tasks), so no enum is possible here; unknown values fail
     * closed at their use sites (import skips with a warning, the Auto-Tagging
     * page shows the apply-unavailable alert).
     */
    model: string;
    /**
     * Number of concurrent encoding workers.
     * @minimum 1
     * @maximum 8
     */
    workers: number;
    /**
     * Minimum calibration support (manually tagged examples) for a
     * calibrated threshold to be applied automatically. Tags below the floor
     * land in the Review (low support) state and are never auto-applied.
     * @minimum 1
     */
    minSupport: number;
    /**
     * How many stills each calibration run samples.
     * @minimum 1
     */
    calibrationSampleSize: number;
    // Per-tag configuration keyed by tag name.
    tags?: { [tag: string]: AutoTagTag };
  }

  // Overlay-shaped mirror of AutoTags with every field optional, so a client
  // can write one settings field (e.g. only tags) without echoing the rest.
  export interface PartialAutoTags {
    // See AutoTags.model: the AUTO-TAG task id; membership is validated at
    // the use sites, not by this schema.
    model?: string;
    /**
     * @minimum 1
     * @maximum 8
     */
    workers?: number;
    /**
     * @minimum 1
     */
    minSupport?: number;
    /**
     * @minimum 1
     */
    calibrationSampleSize?: number;
    tags?: { [tag: string]: AutoTagTag };
  }

  export interface Mongo {
    provider: 'mongodb';
    uri: string;
    db: string;
  }

  export interface SqliteDbConfig {
    provider: 'sqlite';
    path?: string;
  }

  export interface Main {
    port: number; // The listen port.
    libraryPath: string; // Path to the source library.
    cachePath: string; // Path to store thumbnails and cached media.
    database?: Mongo | SqliteDbConfig; // Not passed back to the APIs.
    transcoder: Transcoder;
    // Enable pHash generation for stills as part of import.
    enablePhash: boolean;
    // Enable auto-tagging of stills as part of import, using the model selected
    // in the Auto-Tagging settings (autotags.model, an AUTO-TAG task id). The
    // zero-shot task needs an applicable threshold (calibration or a manual
    // override); without one, the import skips auto-tagging.
    enableAutoTags: boolean;
    // Auto-Tagging pipeline settings, for both the classifier and the
    // zero-shot embedding tasks.
    autotags?: AutoTags;
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
    autotags?: PartialAutoTags;
    user?: User;
    username?: string; // Optional clear-text login username.
    password?: string; // Optional clear-text login password.
  }
}
