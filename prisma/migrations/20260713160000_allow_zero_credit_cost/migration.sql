ALTER TABLE `AiModel`
  DROP CHECK `AiModel_creditCost_check`;

ALTER TABLE `AiModel`
  ADD CONSTRAINT `AiModel_creditCost_check`
  CHECK (`creditCost` >= 0);
