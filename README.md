# Media viewer and organiser

![Preview Image](screenshots/view.png)

## Features

- Web-based interface
- Video, gif and image support
- Tagging media
- Various forms of searching (weighted keyword, tag selection, etc)
- Metadata support for Artist/Album/Title/[People/Actors]
- Auto-scraped metadata from files where possible
- Internal image gallery for faster browser
- Thumbnail generation for all media
- Auto-transcode videos for web-browser compatibility
- Import and export database to JSON format
- Rating system
- Configurable video caching levels.

## Quick-Start

1. Install Docker CE (https://docs.docker.com/install)
2. `git clone https://github.com/simplyboo6/Vimtur`
3. `cd Vimtur`
4. Run `DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache docker-compose up` (change `DATA_DIR` and `CACHE_DIR`).

## Upgrade from V3 to V4.

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

## Notes

- Requirements
  - ffmpeg for transcoding and thumbnails.
  - graphicsmagick for extracting EXIF data.
- Caching data takes a lot of space. All videos are re-transcoded to be h264 and HLS compatible.
- Because of pre-caching it's possible to quickly skip through videos and loading times are minimal.
- Videos by default are transcoded to 240p and 1080p. If the source is h264 and no scalings been applied it copies the video data. This is quicker, and higher quality, but takes up more space. These are configurable options. It could be configured to only transcode to a low-quality for browsing.
- Tested on Ubuntu 16.04 & 18.04 64-bit and Windows 10 64-bit.
- The included compose file comes with a mongodb instance.
- The keyword search supports quotes ("magic phrase" for sentences and negation (-) on words and sentences).

## Docker

The server can be run as a Docker instance. It accepts the following environment variables:

- (required) DATA_DIR - The path to the media library.
- (required) CACHE_DIR - The directory to cache thumbnails, videos, and store the config and database. Cannot be inside the DATA_DIR.
- (optional) CONFIG_PATH - The location of config.json, by default this will be in `${CACHE_PATH}/config.json`.
- (optional) USERNAME - A username to login with. PASSWORD also required.
- (optional) PASSWORD - A password to login with. USERNAME required too.
- (optional) PORT - A port for the Docker instance to expose. Default 3523.
- (optional) DATABASE - Must be set to `mongodb` (default).
  - If using `mongodb` then you must also set `DATABASE_URI` to a MongoDB connection string (eg `mongodb://localhost`) and `DATABASE_DB` to the database name.

Note: Any of these variables can be used when starting the NodeJS app natively.

## Example

### Basic

`DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache docker-compose up --build`

### External MongoDB (make sure to modify docker-compose.yml).

`DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache DATABASE=mongodb DATABASE_URI=mongodb://username:password@localhost/photos docker-compose up --build`

## Running Natively

### Setup

On Ubuntu/Debian run:
`sudo apt-get install graphicsmagick ffmpeg`

For Windows install graphicsmagick, ffmpeg and ffprobe. Make sure they're in your `PATH` variable.

`yarn install && yarn start`

### Running

A config file can be specified using the `-c` flag when launching with nodejs or with the `CONFIG_PATH` variable when launching with yarn.

## Configuration JSON File

```
{
  "port": 3523, // The external port to listen on.
  "transcoder": { // Settings for transcoding video.
    "maxCopyEnabled": true, // Whether to directly copy the source video if possible. This is quicker but takes more space.
    "minQuality": 480, // The minimum quality to bother transcoding. Eg if qualities contains 240p but the source is 480p or below then just transcode to 480p.
    "qualities": [ // Qualities to transcode to in pixel heights. (Eg 240 = 240p).
      240,
      1080
    ]
  },
  "user": { // User settings are all configurable from 'Config' in the UI and explained there. These are defaults.
    "autoplayEnabled": false, // Autoplay videos (muted) if possible.
    "tagColumnCount": 1, // The number of columns to display in the quick-tag panel.
    "stateEnabled": false, // Whether to update the URL suffix with information to directly go back to the current search and media.
    "lowQualityOnLoadEnabled": false, // Whether to drop to a lower-quality on seek and initial load for desktop browsers.
    "lowQualityOnLoadEnabledForMobile": true // Whether to drop to a lower-quality on seek and initial load for mobile browsers.
  },
  "username": "username", // Optional login username.
  "password": "password", // Optional login password.
  "libraryPath": "/home/user/Pictures", // The path to the source library.
  "cachePath": "/home/user/cache", // Where to store the cache.
  "database": { // Database configuration as above.
    "provider": "mongodb",
    "uri": "mongodb://username:password@localhost",
    "db": "datbaseName"
  }
}

```

## Screenshots

### Admin

![Preview Image](screenshots/admin.png)

### Metadata

![Preview Image](screenshots/metadata.png)

### Search

![Preview Image](screenshots/search.png)

### Configuration

![Preview Image](screenshots/configuration_video.png)
