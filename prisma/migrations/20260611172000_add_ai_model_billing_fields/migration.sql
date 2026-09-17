ALTER TABLE `AiModel`
  ADD COLUMN `creditCost` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `allowGuest` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `AiModel_enabled_sortOrder_idx` ON `AiModel`(`enabled`, `sortOrder`);
CREATE INDEX `AiModel_sortOrder_idx` ON `AiModel`(`sortOrder`);

ALTER TABLE `AiModel`
  ADD CONSTRAINT `AiModel_creditCost_check` CHECK (`creditCost` >= 1);
