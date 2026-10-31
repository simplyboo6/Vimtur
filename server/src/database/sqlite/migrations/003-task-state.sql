--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `task_state` (
    `task_id` TEXT NOT NULL,
    `key` TEXT NOT NULL,
    `value` TEXT NOT NULL,

    PRIMARY KEY (`task_id`, `key`)
);
