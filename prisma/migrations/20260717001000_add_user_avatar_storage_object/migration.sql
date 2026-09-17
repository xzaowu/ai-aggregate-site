-- AlterTable
ALTER TABLE `User` ADD COLUMN `avatarStorageObjectId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `User_avatarStorageObjectId_idx` ON `User`(`avatarStorageObjectId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_avatarStorageObjectId_fkey` FOREIGN KEY (`avatarStorageObjectId`) REFERENCES `StorageObject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
