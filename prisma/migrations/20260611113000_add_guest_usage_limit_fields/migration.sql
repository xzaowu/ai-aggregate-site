-- AlterTable
ALTER TABLE `UsageLog`
  ADD COLUMN `guestIp` VARCHAR(128) NULL,
  ADD COLUMN `guestUsageDate` VARCHAR(10) NULL;

-- CreateIndex
CREATE INDEX `UsageLog_guestIp_guestUsageDate_idx` ON `UsageLog`(`guestIp`, `guestUsageDate`);
