export type GlobalImageBudgetConfig =
  | Readonly<{
      mode: "disabled";
    }>
  | Readonly<{
      mode: "enforced";
      dailyBudgetCredits: number;
      maxRequestCostCredits: number;
    }>;

export type GlobalImageBudgetConfigInvalidReason =
  | "MODE_MISSING"
  | "MODE_INVALID"
  | "DAILY_BUDGET_MISSING"
  | "DAILY_BUDGET_INVALID"
  | "MAX_REQUEST_COST_MISSING"
  | "MAX_REQUEST_COST_INVALID"
  | "MAX_REQUEST_COST_EXCEEDS_DAILY_BUDGET";

export type GlobalImageBudgetConfigResult =
  | Readonly<{
      status: "valid";
      config: GlobalImageBudgetConfig;
    }>
  | Readonly<{
      status: "invalid";
      reason: GlobalImageBudgetConfigInvalidReason;
    }>;

function parsePositiveSafeInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function resolveGlobalImageBudgetConfig(
  env: Partial<NodeJS.ProcessEnv>
): GlobalImageBudgetConfigResult {
  const mode = env.GLOBAL_IMAGE_BUDGET_MODE;
  if (mode === undefined) {
    return { status: "invalid", reason: "MODE_MISSING" };
  }
  if (mode !== "disabled" && mode !== "enforced") {
    return { status: "invalid", reason: "MODE_INVALID" };
  }
  if (mode === "disabled") {
    return { status: "valid", config: { mode } };
  }

  const dailyBudgetText = env.GLOBAL_IMAGE_DAILY_BUDGET_CREDITS;
  if (dailyBudgetText === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_MISSING" };
  }
  const dailyBudgetCredits = parsePositiveSafeInteger(dailyBudgetText);
  if (dailyBudgetCredits === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_INVALID" };
  }

  const maxRequestCostText = env.GLOBAL_IMAGE_MAX_REQUEST_COST_CREDITS;
  if (maxRequestCostText === undefined) {
    return { status: "invalid", reason: "MAX_REQUEST_COST_MISSING" };
  }
  const maxRequestCostCredits = parsePositiveSafeInteger(maxRequestCostText);
  if (maxRequestCostCredits === undefined) {
    return { status: "invalid", reason: "MAX_REQUEST_COST_INVALID" };
  }
  if (maxRequestCostCredits > dailyBudgetCredits) {
    return {
      status: "invalid",
      reason: "MAX_REQUEST_COST_EXCEEDS_DAILY_BUDGET"
    };
  }

  return {
    status: "valid",
    config: {
      mode,
      dailyBudgetCredits,
      maxRequestCostCredits
    }
  };
}

export type GlobalChatBudgetConfig =
  | Readonly<{
      mode: "disabled";
    }>
  | Readonly<{
      mode: "enforced";
      dailyBudgetCredits: number;
      maxAttemptCostCredits: number;
    }>;

export type GlobalChatBudgetConfigInvalidReason =
  | "MODE_MISSING"
  | "MODE_INVALID"
  | "DAILY_BUDGET_MISSING"
  | "DAILY_BUDGET_INVALID"
  | "MAX_ATTEMPT_COST_MISSING"
  | "MAX_ATTEMPT_COST_INVALID"
  | "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET";

export type GlobalChatBudgetConfigResult =
  | Readonly<{
      status: "valid";
      config: GlobalChatBudgetConfig;
    }>
  | Readonly<{
      status: "invalid";
      reason: GlobalChatBudgetConfigInvalidReason;
    }>;

export function resolveGlobalChatBudgetConfig(
  env: Partial<NodeJS.ProcessEnv>
): GlobalChatBudgetConfigResult {
  const mode = env.GLOBAL_CHAT_BUDGET_MODE;
  if (mode === undefined) {
    return { status: "invalid", reason: "MODE_MISSING" };
  }
  if (mode !== "disabled" && mode !== "enforced") {
    return { status: "invalid", reason: "MODE_INVALID" };
  }
  if (mode === "disabled") {
    return { status: "valid", config: { mode } };
  }

  const dailyBudgetText = env.GLOBAL_CHAT_DAILY_BUDGET_CREDITS;
  if (dailyBudgetText === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_MISSING" };
  }
  const dailyBudgetCredits = parsePositiveSafeInteger(dailyBudgetText);
  if (dailyBudgetCredits === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_INVALID" };
  }

  const maxAttemptCostText = env.GLOBAL_CHAT_MAX_ATTEMPT_COST_CREDITS;
  if (maxAttemptCostText === undefined) {
    return { status: "invalid", reason: "MAX_ATTEMPT_COST_MISSING" };
  }
  const maxAttemptCostCredits = parsePositiveSafeInteger(maxAttemptCostText);
  if (maxAttemptCostCredits === undefined) {
    return { status: "invalid", reason: "MAX_ATTEMPT_COST_INVALID" };
  }
  if (maxAttemptCostCredits > dailyBudgetCredits) {
    return {
      status: "invalid",
      reason: "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET"
    };
  }

  return {
    status: "valid",
    config: {
      mode,
      dailyBudgetCredits,
      maxAttemptCostCredits
    }
  };
}

export type ChatAttemptCostResult =
  | Readonly<{
      status: "valid";
      costCredits: number;
    }>
  | Readonly<{
      status: "invalid";
      reason: "MODEL_COST_INVALID";
    }>;

export function calculateChatAttemptCost(
  input: Readonly<{
    modelCreditCost: number;
  }>
): ChatAttemptCostResult {
  if (
    !Number.isSafeInteger(input.modelCreditCost) ||
    input.modelCreditCost <= 0
  ) {
    return { status: "invalid", reason: "MODEL_COST_INVALID" };
  }

  return { status: "valid", costCredits: input.modelCreditCost };
}

export type GlobalChatAttemptCostDecision =
  | "bypass"
  | "allowed"
  | "attempt_cost_exceeded"
  | "unavailable";

export function decideGlobalChatAttemptCost(
  configResult: GlobalChatBudgetConfigResult,
  costCredits: number
): GlobalChatAttemptCostDecision {
  if (configResult.status === "invalid") {
    return "unavailable";
  }
  if (configResult.config.mode === "disabled") {
    return "bypass";
  }
  if (!Number.isSafeInteger(costCredits) || costCredits <= 0) {
    return "unavailable";
  }

  return costCredits <= configResult.config.maxAttemptCostCredits
    ? "allowed"
    : "attempt_cost_exceeded";
}

export type GlobalAdminProviderTestBudgetConfig =
  | Readonly<{
      mode: "disabled";
    }>
  | Readonly<{
      mode: "enforced";
      dailyBudgetCredits: number;
      maxAttemptCostCredits: number;
      attemptCostCredits: number;
    }>;

export type GlobalAdminProviderTestBudgetConfigInvalidReason =
  | "MODE_MISSING"
  | "MODE_INVALID"
  | "DAILY_BUDGET_MISSING"
  | "DAILY_BUDGET_INVALID"
  | "MAX_ATTEMPT_COST_MISSING"
  | "MAX_ATTEMPT_COST_INVALID"
  | "ATTEMPT_COST_MISSING"
  | "ATTEMPT_COST_INVALID"
  | "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET";

export type GlobalAdminProviderTestBudgetConfigResult =
  | Readonly<{
      status: "valid";
      config: GlobalAdminProviderTestBudgetConfig;
    }>
  | Readonly<{
      status: "invalid";
      reason: GlobalAdminProviderTestBudgetConfigInvalidReason;
    }>;

export function resolveGlobalAdminProviderTestBudgetConfig(
  env: Partial<NodeJS.ProcessEnv>
): GlobalAdminProviderTestBudgetConfigResult {
  const mode = env.GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE;
  if (mode === undefined) {
    return { status: "invalid", reason: "MODE_MISSING" };
  }
  if (mode !== "disabled" && mode !== "enforced") {
    return { status: "invalid", reason: "MODE_INVALID" };
  }
  if (mode === "disabled") {
    return { status: "valid", config: { mode } };
  }

  const dailyBudgetText = env.GLOBAL_ADMIN_PROVIDER_TEST_DAILY_BUDGET_CREDITS;
  if (dailyBudgetText === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_MISSING" };
  }
  const dailyBudgetCredits = parsePositiveSafeInteger(dailyBudgetText);
  if (dailyBudgetCredits === undefined) {
    return { status: "invalid", reason: "DAILY_BUDGET_INVALID" };
  }

  const maxAttemptCostText =
    env.GLOBAL_ADMIN_PROVIDER_TEST_MAX_ATTEMPT_COST_CREDITS;
  if (maxAttemptCostText === undefined) {
    return { status: "invalid", reason: "MAX_ATTEMPT_COST_MISSING" };
  }
  const maxAttemptCostCredits = parsePositiveSafeInteger(maxAttemptCostText);
  if (maxAttemptCostCredits === undefined) {
    return { status: "invalid", reason: "MAX_ATTEMPT_COST_INVALID" };
  }
  if (maxAttemptCostCredits > dailyBudgetCredits) {
    return {
      status: "invalid",
      reason: "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET"
    };
  }

  const attemptCostText = env.GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS;
  if (attemptCostText === undefined) {
    return { status: "invalid", reason: "ATTEMPT_COST_MISSING" };
  }
  const attemptCostCredits = parsePositiveSafeInteger(attemptCostText);
  if (attemptCostCredits === undefined) {
    return { status: "invalid", reason: "ATTEMPT_COST_INVALID" };
  }

  return {
    status: "valid",
    config: {
      mode,
      dailyBudgetCredits,
      maxAttemptCostCredits,
      attemptCostCredits
    }
  };
}

export type GlobalAdminProviderTestBudgetDecision =
  | Readonly<{ status: "bypass" }>
  | Readonly<{
      status: "allowed";
      dailyBudgetCredits: number;
      attemptCostCredits: number;
    }>
  | Readonly<{ status: "attempt_cost_exceeded" }>
  | Readonly<{ status: "unavailable" }>;

export function decideGlobalAdminProviderTestBudget(
  configResult: GlobalAdminProviderTestBudgetConfigResult
): GlobalAdminProviderTestBudgetDecision {
  if (configResult.status === "invalid") {
    return { status: "unavailable" };
  }
  if (configResult.config.mode === "disabled") {
    return { status: "bypass" };
  }

  return configResult.config.attemptCostCredits <=
    configResult.config.maxAttemptCostCredits
    ? {
        status: "allowed",
        dailyBudgetCredits: configResult.config.dailyBudgetCredits,
        attemptCostCredits: configResult.config.attemptCostCredits
      }
    : { status: "attempt_cost_exceeded" };
}

export function getUtcDailyBudgetPeriodKey(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("INVALID_GLOBAL_BUDGET_NOW");
  }

  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type ImageEstimatedCostResult =
  | Readonly<{
      status: "valid";
      costCredits: number;
    }>
  | Readonly<{
      status: "invalid";
      reason: "MODEL_COST_INVALID" | "IMAGE_COUNT_INVALID" | "COST_OVERFLOW";
    }>;

export function calculateImageEstimatedCost(
  input: Readonly<{
    modelCreditCost: number;
    count: number;
  }>
): ImageEstimatedCostResult {
  if (
    !Number.isSafeInteger(input.modelCreditCost) ||
    input.modelCreditCost <= 0
  ) {
    return { status: "invalid", reason: "MODEL_COST_INVALID" };
  }
  if (input.count !== 1 && input.count !== 2 && input.count !== 4) {
    return { status: "invalid", reason: "IMAGE_COUNT_INVALID" };
  }

  const costCredits = input.modelCreditCost * input.count;
  if (!Number.isSafeInteger(costCredits) || costCredits <= 0) {
    return { status: "invalid", reason: "COST_OVERFLOW" };
  }

  return { status: "valid", costCredits };
}

export type GlobalImageRequestCostDecision =
  | "bypass"
  | "allowed"
  | "request_cost_exceeded"
  | "unavailable";

export function decideGlobalImageRequestCost(
  configResult: GlobalImageBudgetConfigResult,
  costCredits: number
): GlobalImageRequestCostDecision {
  if (configResult.status === "invalid") {
    return "unavailable";
  }
  if (configResult.config.mode === "disabled") {
    return "bypass";
  }
  if (!Number.isSafeInteger(costCredits) || costCredits <= 0) {
    return "unavailable";
  }

  return costCredits <= configResult.config.maxRequestCostCredits
    ? "allowed"
    : "request_cost_exceeded";
}
