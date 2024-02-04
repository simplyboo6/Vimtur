DROP TABLE IF EXISTS `media_deleted_next`;

CREATE TABLE `media_deleted_next` (
    `hash` TEXT NOT NULL,
    `path` TEXT NOT NULL,

    PRIMARY KEY(`hash`, `path`)
);

INSERT INTO `media_deleted_next` (`hash`, `path`) SELECT `hash`, `path` from `media_deleted`;

DROP TABLE `media_deleted`;

ALTER TABLE `media_deleted_next` RENAME TO `media_deleted`;
