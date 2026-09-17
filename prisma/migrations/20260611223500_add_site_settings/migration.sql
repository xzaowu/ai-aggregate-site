CREATE TABLE `SiteSetting` (
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'string',
    `description` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
