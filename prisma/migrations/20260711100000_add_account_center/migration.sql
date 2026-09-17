ALTER TABLE `User`
  ADD COLUMN `avatarUrl` VARCHAR(500) NULL;

CREATE TABLE `UserStorageSubscription` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `priceCredits` INTEGER NOT NULL,
  `durationDays` INTEGER NOT NULL,
  `startsAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `autoRenewEnabled` BOOLEAN NOT NULL DEFAULT false,
  `lastRequestKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UserStorageSubscription_userId_key` (`userId`),
  UNIQUE INDEX `UserStorageSubscription_lastRequestKey_key` (`lastRequestKey`),
  INDEX `UserStorageSubscription_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `UserStorageSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DailyCheckIn` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `checkInDate` VARCHAR(10) NOT NULL,
  `streakDay` INTEGER NOT NULL,
  `rewardCredits` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `DailyCheckIn_userId_checkInDate_key` (`userId`, `checkInDate`),
  INDEX `DailyCheckIn_userId_checkInDate_idx` (`userId`, `checkInDate`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DailyCheckIn_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReferralCode` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ReferralCode_userId_key` (`userId`),
  UNIQUE INDEX `ReferralCode_code_key` (`code`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ReferralCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReferralRelation` (
  `id` VARCHAR(191) NOT NULL,
  `inviterId` VARCHAR(191) NOT NULL,
  `inviteeId` VARCHAR(191) NOT NULL,
  `codeId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ReferralRelation_inviteeId_key` (`inviteeId`),
  UNIQUE INDEX `ReferralRelation_inviterId_inviteeId_key` (`inviterId`, `inviteeId`),
  INDEX `ReferralRelation_inviterId_createdAt_idx` (`inviterId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ReferralRelation_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ReferralRelation_inviteeId_fkey` FOREIGN KEY (`inviteeId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountLedger` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(50) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `creditsDelta` INTEGER NOT NULL,
  `amount` INTEGER NULL,
  `status` VARCHAR(20) NOT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `relatedRecordId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `AccountLedger_idempotencyKey_key` (`idempotencyKey`),
  INDEX `AccountLedger_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `AccountLedger_kind_createdAt_idx` (`kind`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AccountLedger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
