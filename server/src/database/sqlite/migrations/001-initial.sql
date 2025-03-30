--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

CREATE TABLE `config` (
    `key` TEXT PRIMARY KEY,
    `value` TEXT NOT NULL
);

CREATE TABLE `media` (
    `hash` TEXT NOT NULL PRIMARY KEY,
    `path` TEXT DEFAULT NULL,
    `dir` TEXT DEFAULT NULL,
    `type` TEXT DEFAULT NULL,
    `hash_date` INTEGER DEFAULT NULL,

    `rotation` INTEGER DEFAULT NULL,
    `corrupted` INTEGER DEFAULT NULL,
    `thumbnail` INTEGER DEFAULT NULL,
    `thumbnail_optimised` INTEGER DEFAULT NULL,
    `preview` INTEGER DEFAULT NULL,
    `preview_optimised` INTEGER DEFAULT NULL,
    `rating` INTEGER DEFAULT NULL,
    `phash` TEXT DEFAULT NULL,
    -- Not a foreign key because of issues during import.
    `duplicate_of` TEXT DEFAULT NULL,
    `clone_date` INTEGER DEFAULT NULL,
    -- These are TEXT fields because they're only ever fully set and not modified.
    `auto_tags` TEXT DEFAULT NULL, -- JSON Array
    `clones` TEXT DEFAULT NULL, -- JSON Array
    `unrelated` TEXT DEFAULT NULL, -- JSON Array of unrelated clone files

    `metadata_width` INTEGER DEFAULT NULL,
    `metadata_height` INTEGER DEFAULT NULL,
    `metadata_length` INTEGER DEFAULT NULL,
    `metadata_artist` TEXT DEFAULT NULL,
    `metadata_album` TEXT DEFAULT NULL,
    `metadata_title` TEXT DEFAULT NULL,
    `metadata_created_at` INTEGER DEFAULT NULL,
    `metadata_codec` TEXT DEFAULT NULL,
    `metadata_quality_cache` TEXT DEFAULT NULL, -- JSON number[];
    `metadata_max_copy` INTEGER DEFAULT NULL,
    `metadata_segments` TEXT DEFAULT NULL -- JSON SegmentMetadata;
);

CREATE INDEX `media_dir_idx` ON `media` (`dir`);
CREATE INDEX `media_rating_idx` ON `media` (`rating`);

CREATE TABLE `media_deleted` (
    `hash` TEXT NOT NULL PRIMARY KEY,
    `path` TEXT NOT NULL
);

-- Tags
CREATE TABLE `tags` (
    `id` TEXT PRIMARY KEY
);

CREATE TABLE `media_tags` (
    `media_hash` TEXT NOT NULL,
    `tag_id` TEXT NOT NULL,
    PRIMARY KEY (`media_hash`, `tag_id`),
    FOREIGN KEY (`media_hash`) REFERENCES `media` (`hash`) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Actors
CREATE TABLE `actors` (
    `id` TEXT PRIMARY KEY
);

CREATE TABLE `media_actors` (
    `media_hash` TEXT NOT NULL,
    `actor_id` TEXT NOT NULL,
    PRIMARY KEY (`media_hash`, `actor_id`),
    FOREIGN KEY (`media_hash`) REFERENCES `media` (`hash`) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (`actor_id`) REFERENCES `actors` (`id`) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Full-text-search
CREATE VIRTUAL TABLE `media_fts` USING fts5(`hash`, `path`, `type`, `tags`, `auto_tags`, `actors`, `metadata_artist`, `metadata_album`, `metadata_title`);
CREATE TRIGGER `media_fts_insert` AFTER INSERT ON `media` BEGIN
    INSERT INTO `media_fts`
        (`hash`, `path`, `type`, `auto_tags`, `metadata_artist`, `metadata_album`, `metadata_title`)
    SELECT
        new.`hash`,
        new.`path`,
        new.`type`,
        GROUP_CONCAT(json_each.value),
        new.`metadata_artist`,
        new.`metadata_album`,
        new.`metadata_title`
    FROM JSON_EACH(IFNULL(new.`auto_tags`, '[]'));
END;
CREATE TRIGGER `media_fts_delete` AFTER DELETE ON `media` BEGIN
    DELETE FROM `media_fts` WHERE `hash` = old.`hash`;
END;
CREATE TRIGGER `media_fts_update` AFTER UPDATE ON `media` BEGIN
    UPDATE `media_fts` SET
        `path` = new.`path`,
        `type` = new.`type`,
        `auto_tags` = (SELECT GROUP_CONCAT(json_each.value) FROM JSON_EACH(IFNULL(new.`auto_tags`, '[]'))),
        `metadata_artist` = new.`metadata_artist`,
        `metadata_album` = new.`metadata_album`,
        `metadata_title` = new.`metadata_title`
    WHERE `media_fts`.`hash` = new.`hash`;
END;
CREATE TRIGGER `media_fts_tag_insert` AFTER INSERT ON `media_tags` BEGIN
    UPDATE `media_fts` SET `tags` = (SELECT GROUP_CONCAT(`tag_id`) FROM `media_tags` WHERE `media_hash` = new.`media_hash`) WHERE `hash` = new.`media_hash`;
END;
CREATE TRIGGER `media_fts_tag_delete` AFTER DELETE ON `media_tags` BEGIN
    UPDATE `media_fts` SET `tags` = (SELECT GROUP_CONCAT(`tag_id`) FROM `media_tags` WHERE `media_hash` = old.`media_hash`) WHERE `hash` = old.`media_hash`;
END;
CREATE TRIGGER `media_fts_actor_insert` AFTER INSERT ON `media_actors` BEGIN
    UPDATE `media_fts` SET `actors` = (SELECT GROUP_CONCAT(`actor_id`) FROM `media_actors` WHERE `media_hash` = new.`media_hash`) WHERE `hash` = new.`media_hash`;
END;
CREATE TRIGGER `media_fts_actor_delete` AFTER DELETE ON `media_actors` BEGIN
    UPDATE `media_fts` SET `actors` = (SELECT GROUP_CONCAT(`actor_id`) FROM `media_actors` WHERE `media_hash` = old.`media_hash`) WHERE `hash` = old.`media_hash`;
END;

-- Playlists
CREATE TABLE `playlists` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `name` TEXT NOT NULL,
    `thumbnail` TEXT DEFAULT NULL, -- hash
    `size` INTEGER DEFAULT 0
);

CREATE TABLE `media_playlists` (
    `media_hash` TEXT NOT NULL,
    `playlist_id` TEXT NOT NULL,
    `order` INTEGER NOT NULL,

    PRIMARY KEY (`media_hash`, `playlist_id`),
    FOREIGN KEY (`media_hash`) REFERENCES `media` (`hash`) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (`playlist_id`) REFERENCES `playlists` (`id`) ON UPDATE CASCADE ON DELETE CASCADE
);
