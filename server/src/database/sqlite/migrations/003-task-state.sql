--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- The VARCHAR lengths document intent only: SQLite gives every TEXT-affinity
-- column the same storage and ignores the length entirely.
CREATE TABLE IF NOT EXISTS `task_state` (
    `task_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,

    PRIMARY KEY (`task_id`, `key`)
);
