Scanning
1) Scan the file system for a list of files
2) Compare this against the list from the database to establish new and missing.

Indexing - For each file:
1) Create a media object
2) Extract metadata (include empty qualityCache array)
3) Create thumbnail
4) Save to database

Caching - Videos:
1) Fix old versions - For each video with metadata and no qualityCache[] set then fix the directory structure.
2) For each video run against the cache validator
    Cache Validator - For each level in quality level list:
    * Check if the video is already encoded at the requested quality, if it's not then....
    1) * If the requested qualtiy level is equal to the videos size and max-copy is enabled then copy video if possible.
       * If the requested size is greater than the source quality, then skip.
       * Else...:
         * If min-source-quality-transcode is set and the source videos quality is less than the quality then: (Eg requested=240p, source=360p, min=480p then don't transcode. [But do transcode is to 360p])
           * If the video hasn't been transcoded to the source quality, then do that, and copy if max-copy is enabled and it's possible.
           * Else skip
         * If the requested quality is greater than the the source quality, then ensure transcoding has been done at source quality.
         * Else transcode the video to the requested quality.
    2) Save the master playlist with all the new qualities.
    3) Update the database with the new cache.

TODO:
* Switch quality to use array of arbitrary numbers
* Call generate thumbnails
* Add support for old style system recovery
