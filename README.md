
# Media viewer and organiser

![Preview Image](screenshots/view.png)

## Features
* Web-based interface
* Video, gif and image support
* Tagging media
* Various forms of searching (weighted keyword, tag selection, etc)
* Metadata support for Artist/Album/Title/[People/Actors]
* Auto-scraped metadata from files where possible
* Internal image gallery for faster browser
* Thumbnail generation for all media
* Auto-transcode videos for web-browser compatibility
* Import and export database to JSON format
* Rating system
* Configurable video caching levels.

## Quick-Start
1) Install Docker CE (https://docs.docker.com/install)
2) ```git clone https://github.com/simplyboo6/Vimtur```
3) ```cd Vimtur```
2) Run ```DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache docker-compose up``` (change `DATA_DIR` and `CACHE_DIR`).

## Notes
* Requirements
  * ffmpeg for transcoding and thumbnails.
  * graphicsmagick for extracting EXIF data.
* Caching data takes a lot of space. All videos are re-transcoded to be h264 and HLS compatible.
* Because of pre-caching it's possible to quickly skip through videos and loading times are minimal.
* Videos by default are transcoded to 240p and 1080p. If the source is h264 and no scalings been applied it copies the video data. This is quicker, and higher quality, but takes up more space. These are configurable options. It could be configured to only transcode to a low-quality for browsing.
* Tested on Ubuntu 16.04 & 18.04 64-bit and Windows 10 64-bit.
* The included compose file comes with a mongodb instance.
* The keyword search supports quotes ("magic phrase" for sentences and negation (-) on words and sentences).

## Conversion from V3 to V4.
From V3 to V4 there's been a move from storing the entire database in memory to moving search capabilities and storage to the database.
The path of least resistance for this turned out to be MongoDB. The frameworks are still in place to add other database types back later, before merging this to master.
For now, to use this version use utils/export_json.js to export your database from the SQL version and then in the new MongoDB version use utils/import_json.js. It is quite likely that when the other database types are re-introduced the structure will be different and this will be necessary for those too.

## Docker
The server can be run as a Docker instance. It accepts the following environment variables:
* (required) DATA_DIR - The path to the media library.
* (required) CACHE_DIR - The directory to cache thumbnails, videos, and store the config and database. Cannot be inside the DATA_DIR.
* (optional) CONFIG_PATH - The location of config.json, by default this will be in `${CACHE_PATH}/config.json`.
* (optional) USERNAME - A username to login with. PASSWORD also required.
* (optional) PASSWORD - A password to login with. USERNAME required too.
* (optional) PORT - A port for the Docker instance to expose. Default 3523.
* (optional) DATABASE - Must be set to `mongodb` (default).
  * If using `mongodb` then you must also set `DATABASE_HOST` and `DATABASE_DATABASE`. If they're set in your config.json file then the DATABASE config can be omitted. Optional: `DATABASE_USERNAME`, `DATABASE_PASSWORD`, and `DATABASE_PORT`.

Note: Any of these variables can be used when starting the NodeJS app natively.


## Example
### Basic
```DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache docker-compose up --build```
### External MongoDB (make sure to modify docker-compose.yml.
```DATA_DIR=/home/user/Pictures CACHE_DIR=/home/user/cache DATABASE=mongodb DATABASE_HOST=localhost DATABASE_DATABASE=photos DATABASE_USERNAME=username DATABASE_PASSWORD=password docker-compose up --build```

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
    "host": "localhost",
    "username": "vimtur_photos",
    "password": "vimtur_photos",
    "database": "vimtur_photos"
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
