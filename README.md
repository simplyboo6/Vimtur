# Media viewer and organiser

![Preview Image](screenshots/gallery.png)

## Features

- Web-based mobile-friendly interface
- Video, gif and image support
- Tagging media
- Auto-Tagging of images using TensorFlow
- Various forms of searching (weighted keyword, tag selection, etc)
- Metadata support for Artist/Album/Title/[People/Actors]
- Auto-scraped metadata from files where possible
- Internal image gallery for faster browsing (with video previews)
- Thumbnail generation for all media
- Auto-transcode videos for web-browser compatibility (both streaming and optional caching)
- Import and export database to JSON format
- Rating system
- Custom video player supporting quality selection and video previews
- Media recommendations based upon your tags, actors and ratings.
- Automatic image clone detection and viewer using perceuptual hashing.
- Playlists
- Download with gallery-dl or youtube-dlp

## Quick-Start

1. Install Docker CE (https://docs.docker.com/install) & docker-compose
2. Run `DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache docker-compose up --build` (change `DATA_DIR` and `CACHE_DIR`).

This will start an instance of the program listening on (http://localhost:3523)[http://localhost:3523] and store the Mongo data in the cache directory. The data directory will not be modified.

## Notes

- Requirements (outside of Docker)
  - ffmpeg for transcoding and thumbnails.
  - graphicsmagick for extracting EXIF data.
- Caching data is optional (disabled by default) and takes a lot of space. All videos are transcoded to be h264 and HLS compatible on the fly. Enabling caching will allow faster load times.
- When pre-caching it's possible to quickly skip through videos and loading times are minimal. Otherwise expect about 5s on initial load (or slightly more on the first time) and 5s every time you seek to an unbufferred segment.
- Videos by default are transcoded to 240p and 1080p. If the source is h264 and no scalings been applied it copies the video data. This is quicker, and higher quality, but takes up more space. These are configurable options. It could be configured to only transcode to a low-quality for browsing.
- Tested on Ubuntu 18.04 64-bit.
- The included compose file comes with a mongodb instance.
- The keyword search supports quotes ("magic phrase" for sentences and negation (-) on words and sentences).
- When doing the keyword search there's a limit of 1200 results.
- All code is TypeScript and the UI framework is Angular.
- TensorFlow will run on the CPU. If you have AVX support on your CPU it uses native code and depending on the model and your CPU classifies in the range of 45ms. If your CPU does not support AVX it uses the JS only library and each classification will take in the range of 5s. However, it does use worker threads to make use of multi-core CPUs.
- TensorFlow currently requires internet connectivity the first time a model is used. It fetches the list of ImageNet classes and the selected pre-trained model when it starts. Media is all classified locally. Further classifications with that model will use the cached download.
- The downloaders can be found under the Download Files task under the Config tab.

### Github Sponsors

If you'd like to donate towards development you can [here](https://github.com/sponsors/simplyboo6). Never feel obligated to do so, I'll always provide support and respond to requests through issues.

## Docker

The server can be run as a Docker instance. It accepts the following environment variables:

- (required) DATA_DIR - The path to the media library.
- (required) CACHE_DIR - The directory to cache thumbnails, videos, and store the config and database. Cannot be inside the DATA_DIR.
- (optional) CONFIG_PATH - The location of config.json, by default this will be in `${CACHE_PATH}/config.json`. For the format of this file the type Configuration.Main.
- (optional) USERNAME - A username to login with. PASSWORD also required.
- (optional) PASSWORD - A password to login with. USERNAME required too.
- (optional) PORT - A port for the Docker instance to expose. Default 3523.
- (optional) DATABASE - Must be set to `mongodb` (default).
  - If using `mongodb` then you must also set `DATABASE_URI` to a MongoDB connection string (eg `mongodb://localhost`) and `DATABASE_DB` to the database name.

Note: Any of these variables can be used when starting the NodeJS app natively.

### External MongoDB (make sure to modify docker-compose.yml).

`DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache DATABASE=mongodb DATABASE_URI=mongodb://username:password@localhost/photos docker-compose up --build`

## Screenshots

### Gallery

![Preview Image](screenshots/gallery.png)

### Video Player

![Preview Image](screenshots/video-player.png)

### Viewer

![Preview Image](screenshots/viewer.png)

### Search

![Preview Image](screenshots/search.png)

### Search

![Preview Image](screenshots/metadata.png)

### Configuration

![Preview Image](screenshots/config.png)

## Upgrades

### General Guidance

When upgrading major releases upgrades are only supports sequentially. For example going from version 4 to 5 is okay and going from 3 to 4 is okay (with notes below). However you can't directly go from 3 to 5, you must first go to 4 and make sure that all updates have completed first.

### Upgrade from V4 to V5

Version 5 removes command line arguments in favour solely of environment variables. The only previously used flag was `-c` or `--config`, this is now replaced by `CONFIG_FILE`.

### Upgrade from V3 to V4

Version 4 brings a number of improvements to the server-side to reduce RAM usage to be more scaleable. This has meant a major rearchitecting of the server-side. During this support for SQL has been dropped and Vimtur 4 has switched to Mongo. The good news is upgrading is reasonably easy using the export and import tools.
Note that during the upgrade the hashing mechanism will change from doing md5 sum's of the entire file to following SubDB's model of the first and last 64kbs. Another notable change is that
during upgrade the library needs to be partially re-cached to support multiple quality levels. This is more file shuffling than encoding.

1. **Exporting**
   Before upgrading you need to run the export script. To do this from the Docker variant make sure the server is running and then execute the following commands:
   ```
   docker-compose exec node /bin/sh -c 'DUMP_FILE=/tmp/upgrade.json node /opt/app/utils/export_json.js'
   docker-compose exec node /bin/sh -c 'cat /tmp/upgrade.json' > vimtur-backup.json
   ```
   If running outside of Docker run:
   ```
   node utils/export_json.js <path/to/config.json>
   ```
   You need to replace the config path above or otherwise remove it and use the environment variables. The command will generate a file called _output.json_.
2. **Upgrading**
   At this point upgrade your source code to the latest version by doing a git pull.
3. **Importing**
   For the Docker version, bringup a fresh environment using the quick-start instructions then run:
   ```
   ./import.sh vimtur-backup.json
   ```
   For the native version run:
   ```
   node src/utils/import-json.js [-c /path/to/config.json] -f output.json
   ```
   The above command should be configured with the same environment variables or config file as running the program.

## Licenses

### Font Awesome

Note that this project uses icons from the free Font Awesome library. The license can be found [here](https://fontawesome.com/license).
