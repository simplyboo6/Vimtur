CREATE TABLE `tags` (
    `id` CHAR(24) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE `actors` (
    `id` CHAR(24) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE `config` (
    `key` VARCHAR(255) NOT NULL,
    `value` TEXT NOT NULL
);

CREATE TABLE `media` (
    `hash` CHAR(32) PRIMARY KEY,
    `path` TEXT NOT NULL,
    `dir` TEXT NOT NULL,
    `rotation` INTEGER NULL DEFAULT NULL,
    `type` VARCHAR(64) NOT NULL,
    `hashDate` UNSIGNED INTEGER NOT NULL,
    -- Metadata
    `metadata_createdAt` UNSIGNED INTEGER NULL DEFAULT NULL,
    `metadata_length` UNSIGNED INTEGER NULL DEFAULT NULL,
    `metadata_artist` VARCHAR(1024) NULL DEFAULT NULL,
    `metadata_album` VARCHAR(1024) NULL DEFAULT NULL,
    `metadata_title` VARCHAR(1024) NULL DEFAULT NULL,
    `metadata_codec` VARCHAR(64) NULL DEFAULT NULL,
    `metadata_maxCopy` BOOLEAN NULL DEFAULT NULL,
    `metadata_segments` TEXT NULL DEFAULT NULL, -- JSON array
    `corrupted` BOOLEAN NOT NULL DEFAULT FALSE,
    `thumbnail` BOOLEAN NOT NULL DEFAULT FALSE,
    `thumbnailOptimised` BOOLEAN NOT NULL DEFAULT FALSE,
    `preview` BOOLEAN NOT NULL DEFAULT FALSE,
    `previewOptimised` BOOLEAN NOT NULL DEFAULT FALSE,
    `rating` UNSIGNED TINYINT NULL DEFAULT NULL,
    `phash` VARCHAR(255) NULL DEFAULT NULL,
    `cloneDate` UNSIGNED INTEGER NULL DEFAULT NULL
    -- todo playlist bits for a playlist.
);

CREATE TABLE `playlists` (
    `id` CHAR(24) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE,
    `thumbnail` CHAR(32) NULL DEFAULT NULL,
    `size` UNSIGNED INTEGER DEFAULT 0,
    FOREIGN KEY (`thumbnail`) REFERENCES `media`(`hash`) ON DELETE SET NULL
);

CREATE TABLE `media_tags` (
    `hash` CHAR(32) NOT NULL,
    `tagId` CHAR(24) NOT NULL,
    PRIMARY KEY (`hash`, `tagId`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE,
    FOREIGN KEY (`tagId`) REFERENCES `tags`(`id`) ON DELETE CASCADE
);

CREATE TABLE `media_auto_tags` (
    `hash` CHAR(32) NOT NULL,
    `tag` VARCHAR(255) NOT NULL,
    PRIMARY KEY (`hash`, `tag`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE
);

CREATE TABLE `media_actors` (
    `hash` CHAR(32) NOT NULL,
    `actorId` CHAR(24) NOT NULL,
    PRIMARY KEY (`hash`, `actorId`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE,
    FOREIGN KEY (`actorId`) REFERENCES `actors`(`id`) ON DELETE CASCADE
);

CREATE TABLE `media_quality_cache` (
    `hash` CHAR(32) NOT NULL,
    `quality` UNSIGNED SMALLINT NOT NULL,
    PRIMARY KEY (`hash`, `quality`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE
);

CREATE TABLE `media_clones` (
    `hash` CHAR(32) NOT NULL,
    `clone` CHAR(32) NOT NULL,
    PRIMARY KEY (`hash`, `clone`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE,
    FOREIGN KEY (`clone`) REFERENCES `media`(`hash`) ON DELETE CASCADE
);

CREATE TABLE `media_playlists` (
    `hash` CHAR(32) NOT NULL,
    `playlistId` CHAR(24) NOT NULL,
    `order` UNSIGNED INTEGER NOT NULL,
    PRIMARY KEY (`hash`, `playlistId`),
    FOREIGN KEY (`hash`) REFERENCES `media`(`hash`) ON DELETE CASCADE,
    FOREIGN KEY (`playlistId`) REFERENCES `playlists`(`id`) ON DELETE CASCADE
);
