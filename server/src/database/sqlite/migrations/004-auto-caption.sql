--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- The caption is a whole string, so it is a plain nullable TEXT column (unlike
-- auto_tags, which is JSON). NULL is the unprocessed state and '' is the
-- processed-with-nothing marker.
ALTER TABLE `media` ADD COLUMN `auto_caption` TEXT DEFAULT NULL;

-- media_fts is a standalone fts5 table, so the column set cannot be altered in
-- place: drop the triggers and the table, recreate both, then repopulate.
DROP TRIGGER IF EXISTS `media_fts_insert`;
DROP TRIGGER IF EXISTS `media_fts_delete`;
DROP TRIGGER IF EXISTS `media_fts_update`;
DROP TRIGGER IF EXISTS `media_fts_tag_insert`;
DROP TRIGGER IF EXISTS `media_fts_tag_delete`;
DROP TRIGGER IF EXISTS `media_fts_actor_insert`;
DROP TRIGGER IF EXISTS `media_fts_actor_delete`;
DROP TABLE IF EXISTS `media_fts`;

CREATE VIRTUAL TABLE `media_fts` USING fts5(`hash`, `path`, `type`, `tags`, `auto_tags`, `auto_caption`, `actors`, `metadata_artist`, `metadata_album`, `metadata_title`);

INSERT INTO `media_fts`
    (`hash`, `path`, `type`, `tags`, `auto_tags`, `auto_caption`, `actors`, `metadata_artist`, `metadata_album`, `metadata_title`)
SELECT
    `media`.`hash`,
    `media`.`path`,
    `media`.`type`,
    (SELECT GROUP_CONCAT(`tag_id`) FROM `media_tags` WHERE `media_hash` = `media`.`hash`),
    (SELECT GROUP_CONCAT(json_each.value) FROM JSON_EACH(IFNULL(`media`.`auto_tags`, '[]'))),
    `media`.`auto_caption`,
    (SELECT GROUP_CONCAT(`actor_id`) FROM `media_actors` WHERE `media_hash` = `media`.`hash`),
    `media`.`metadata_artist`,
    `media`.`metadata_album`,
    `media`.`metadata_title`
FROM `media`;

CREATE TRIGGER `media_fts_insert` AFTER INSERT ON `media` BEGIN
    INSERT INTO `media_fts`
        (`hash`, `path`, `type`, `auto_tags`, `auto_caption`, `metadata_artist`, `metadata_album`, `metadata_title`)
    SELECT
        new.`hash`,
        new.`path`,
        new.`type`,
        GROUP_CONCAT(json_each.value),
        new.`auto_caption`,
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
        `auto_caption` = new.`auto_caption`,
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
