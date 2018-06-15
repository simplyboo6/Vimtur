CREATE TABLE IF NOT EXISTS `images` (
  `hash` varchar(32) NOT NULL,
  `path` varchar(2048) DEFAULT NULL,
  `rotation` smallint(6) DEFAULT '0',
  `type` varchar(10) DEFAULT 'UNKNOWN',
  `hash_date` int(11) DEFAULT '0',
  PRIMARY KEY (`hash`)
);

CREATE TABLE IF NOT EXISTS `deleted` (
  `hash` varchar(32) NOT NULL,
  `time` int(11) NOT NULL
);

CREATE TABLE IF NOT EXISTS `corrupted` (
  `hash` varchar(32) NOT NULL,
  PRIMARY KEY (`hash`),
  FOREIGN KEY (`hash`) REFERENCES `images` (`hash`)
);

CREATE TABLE IF NOT EXISTS `tags` (
  `tag` varchar(20) NOT NULL,
  PRIMARY KEY (`tag`)
);

CREATE TABLE IF NOT EXISTS `imgtags` (
  `hash` varchar(32) NOT NULL,
  `tag` varchar(20) NOT NULL,
  PRIMARY KEY (`hash`,`tag`),
  FOREIGN KEY (`hash`) REFERENCES `images` (`hash`),
  FOREIGN KEY (`tag`) REFERENCES `tags` (`tag`)
);

CREATE TABLE IF NOT EXISTS `priority_transcode` (
  `hash` varchar(32) NOT NULL,
  PRIMARY KEY (`hash`),
  FOREIGN KEY (`hash`) REFERENCES `images` (`hash`)
);

CREATE TABLE IF NOT EXISTS `cached` (
  `hash` varchar(32) NOT NULL,
  `width` int(11) NOT NULL,
  `height` int(11) NOT NULL,
  `length` int(11) NOT NULL,
  `artist` text,
  `album` text,
  `title` text,
  PRIMARY KEY (`hash`),
  FOREIGN KEY (`hash`) REFERENCES `images` (`hash`)
);

CREATE TABLE IF NOT EXISTS `version` (
  `version` int(11) NOT NULL,
  PRIMARY KEY (`version`)
);

INSERT OR REPLACE INTO version(version) VALUES (0);
