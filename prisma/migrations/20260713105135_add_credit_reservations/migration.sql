-- CreateTable
CREATE TABLE `CreditReservation` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('IMAGE_GENERATION', 'CHAT_COMPLETION', 'CHAT_STREAM') NOT NULL,
    `amountCredits` INTEGER NOT NULL,
    `status` ENUM('RESERVED', 'SETTLED', 'RELEASED') NOT NULL DEFAULT 'RESERVED',
    `expiresAt` DATETIME(3) NOT NULL,
    `settledAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `aiTaskId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CreditReservation_aiTaskId_key`(`aiTaskId`),
    INDEX `CreditReservation_userId_status_idx`(`userId`, `status`),
    INDEX `CreditReservation_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CreditReservation` ADD CONSTRAINT `CreditReservation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditReservation` ADD CONSTRAINT `CreditReservation_aiTaskId_fkey` FOREIGN KEY (`aiTaskId`) REFERENCES `AiTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
