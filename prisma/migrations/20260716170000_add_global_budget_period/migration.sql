-- CreateTable
CREATE TABLE `GlobalBudgetPeriod` (
    `scope` VARCHAR(64) NOT NULL,
    `periodType` VARCHAR(16) NOT NULL,
    `periodKey` VARCHAR(10) NOT NULL,
    `budgetCredits` BIGINT NOT NULL,
    `consumedCredits` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`scope`, `periodType`, `periodKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
