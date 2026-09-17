import { describe, expect, it } from "vitest";
import {
  calculateChatAttemptCost,
  calculateImageEstimatedCost,
  decideGlobalAdminProviderTestBudget,
  decideGlobalChatAttemptCost,
  decideGlobalImageRequestCost,
  getUtcDailyBudgetPeriodKey,
  resolveGlobalChatBudgetConfig,
  resolveGlobalAdminProviderTestBudgetConfig,
  resolveGlobalImageBudgetConfig,
  type GlobalChatBudgetConfigResult,
  type GlobalImageBudgetConfigResult,
  type GlobalAdminProviderTestBudgetConfigResult
} from "../src/global-budget";
import type {
  ConsumeGlobalBudgetInput,
  ConsumeGlobalBudgetResult,
  GlobalBudgetStore
} from "../src/store";

const enforcedEnv = {
  GLOBAL_IMAGE_BUDGET_MODE: "enforced",
  GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: "100",
  GLOBAL_IMAGE_MAX_REQUEST_COST_CREDITS: "20"
} satisfies Partial<NodeJS.ProcessEnv>;

describe("resolveGlobalImageBudgetConfig", () => {
  it("accepts disabled mode without numeric settings", () => {
    expect(
      resolveGlobalImageBudgetConfig({
        GLOBAL_IMAGE_BUDGET_MODE: "disabled",
        GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: "not-used",
        GLOBAL_IMAGE_MAX_REQUEST_COST_CREDITS: "not-used"
      })
    ).toEqual({ status: "valid", config: { mode: "disabled" } });
  });

  it("accepts an enforced configuration with positive safe integers", () => {
    expect(resolveGlobalImageBudgetConfig(enforcedEnv)).toEqual({
      status: "valid",
      config: {
        mode: "enforced",
        dailyBudgetCredits: 100,
        maxRequestCostCredits: 20
      }
    });
  });

  it("reports a missing mode", () => {
    expect(resolveGlobalImageBudgetConfig({})).toEqual({
      status: "invalid",
      reason: "MODE_MISSING"
    });
  });

  it("reports an invalid mode", () => {
    expect(
      resolveGlobalImageBudgetConfig({ GLOBAL_IMAGE_BUDGET_MODE: "ENFORCED" })
    ).toEqual({ status: "invalid", reason: "MODE_INVALID" });
  });

  it("reports a missing daily budget", () => {
    expect(
      resolveGlobalImageBudgetConfig({ GLOBAL_IMAGE_BUDGET_MODE: "enforced" })
    ).toEqual({ status: "invalid", reason: "DAILY_BUDGET_MISSING" });
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "10abc",
    " 10",
    "10 ",
    "1e2",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1)
  ])("rejects invalid daily budget text without partial parsing: %s", (value) => {
    expect(
      resolveGlobalImageBudgetConfig({
        ...enforcedEnv,
        GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: value
      })
    ).toEqual({ status: "invalid", reason: "DAILY_BUDGET_INVALID" });
  });

  it("reports a missing maximum request cost", () => {
    expect(
      resolveGlobalImageBudgetConfig({
        GLOBAL_IMAGE_BUDGET_MODE: "enforced",
        GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: "100"
      })
    ).toEqual({ status: "invalid", reason: "MAX_REQUEST_COST_MISSING" });
  });

  it.each(["0", "-1", "1.5", "10abc", " 10", "10 ", "1e2"])(
    "rejects invalid maximum request cost text: %s",
    (value) => {
      expect(
        resolveGlobalImageBudgetConfig({
          ...enforcedEnv,
          GLOBAL_IMAGE_MAX_REQUEST_COST_CREDITS: value
        })
      ).toEqual({ status: "invalid", reason: "MAX_REQUEST_COST_INVALID" });
    }
  );

  it("rejects a maximum request cost above the daily budget", () => {
    expect(
      resolveGlobalImageBudgetConfig({
        ...enforcedEnv,
        GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: "19"
      })
    ).toEqual({
      status: "invalid",
      reason: "MAX_REQUEST_COST_EXCEEDS_DAILY_BUDGET"
    });
  });

  it("does not include rejected environment text in the result", () => {
    const rejectedValue = "sensitive-invalid-budget-value";
    const result = resolveGlobalImageBudgetConfig({
      ...enforcedEnv,
      GLOBAL_IMAGE_DAILY_BUDGET_CREDITS: rejectedValue
    });

    expect(JSON.stringify(result)).not.toContain(rejectedValue);
  });
});

describe("getUtcDailyBudgetPeriodKey", () => {
  it.each([
    ["ordinary date", "2026-07-16T12:34:56.789Z", "2026-07-16"],
    ["month end", "2026-04-30T23:00:00.000Z", "2026-04-30"],
    ["year end", "2026-12-31T23:59:59.000Z", "2026-12-31"],
    ["leap day", "2024-02-29T08:00:00.000Z", "2024-02-29"]
  ])("formats %s using UTC", (_label, timestamp, expected) => {
    expect(getUtcDailyBudgetPeriodKey(new Date(timestamp))).toBe(expected);
  });

  it("switches periods at the exact UTC midnight boundary", () => {
    expect(
      getUtcDailyBudgetPeriodKey(new Date("2026-07-16T23:59:59.999Z"))
    ).toBe("2026-07-16");
    expect(
      getUtcDailyBudgetPeriodKey(new Date("2026-07-17T00:00:00.000Z"))
    ).toBe("2026-07-17");
  });

  it("uses the UTC instant instead of the timestamp's local offset", () => {
    expect(
      getUtcDailyBudgetPeriodKey(new Date("2026-01-01T00:30:00+14:00"))
    ).toBe("2025-12-31");
    expect(
      getUtcDailyBudgetPeriodKey(new Date("2025-12-30T16:30:00-10:00"))
    ).toBe("2025-12-31");
  });
});

describe("calculateImageEstimatedCost", () => {
  it.each([
    [1, 1, 1],
    [3, 4, 12]
  ])(
    "calculates %i credits times %i images as %i credits",
    (modelCreditCost, count, costCredits) => {
      expect(calculateImageEstimatedCost({ modelCreditCost, count })).toEqual({
        status: "valid",
        costCredits
});

const chatEnforcedEnv = {
  GLOBAL_CHAT_BUDGET_MODE: "enforced",
  GLOBAL_CHAT_DAILY_BUDGET_CREDITS: "200",
  GLOBAL_CHAT_MAX_ATTEMPT_COST_CREDITS: "50"
} satisfies Partial<NodeJS.ProcessEnv>;

describe("resolveGlobalChatBudgetConfig", () => {
  it("accepts disabled mode without numeric settings", () => {
    expect(
      resolveGlobalChatBudgetConfig({
        GLOBAL_CHAT_BUDGET_MODE: "disabled"
      })
    ).toEqual({ status: "valid", config: { mode: "disabled" } });
  });

  it("accepts an enforced configuration with positive safe integers", () => {
    expect(resolveGlobalChatBudgetConfig(chatEnforcedEnv)).toEqual({
      status: "valid",
      config: {
        mode: "enforced",
        dailyBudgetCredits: 200,
        maxAttemptCostCredits: 50
      }
    });
  });

  it("reports a missing mode", () => {
    expect(resolveGlobalChatBudgetConfig({})).toEqual({
      status: "invalid",
      reason: "MODE_MISSING"
    });
  });

  it("reports an invalid mode", () => {
    expect(
      resolveGlobalChatBudgetConfig({
        GLOBAL_CHAT_BUDGET_MODE: "ENFORCED"
      })
    ).toEqual({ status: "invalid", reason: "MODE_INVALID" });
  });

  it("reports a missing daily budget", () => {
    expect(
      resolveGlobalChatBudgetConfig({
        GLOBAL_CHAT_BUDGET_MODE: "enforced"
      })
    ).toEqual({ status: "invalid", reason: "DAILY_BUDGET_MISSING" });
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "10abc",
    " 10",
    "10 ",
    "1e2",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1)
  ])("rejects invalid daily budget text: %s", (value) => {
    expect(
      resolveGlobalChatBudgetConfig({
        ...chatEnforcedEnv,
        GLOBAL_CHAT_DAILY_BUDGET_CREDITS: value
      })
    ).toEqual({ status: "invalid", reason: "DAILY_BUDGET_INVALID" });
  });

  it("reports a missing max attempt cost", () => {
    expect(
      resolveGlobalChatBudgetConfig({
        GLOBAL_CHAT_BUDGET_MODE: "enforced",
        GLOBAL_CHAT_DAILY_BUDGET_CREDITS: "200"
      })
    ).toEqual({ status: "invalid", reason: "MAX_ATTEMPT_COST_MISSING" });
  });

  it.each(["0", "-1", "1.5", "10abc", " 10", "10 "])(
    "rejects invalid max attempt cost text: %s",
    (value) => {
      expect(
        resolveGlobalChatBudgetConfig({
          ...chatEnforcedEnv,
          GLOBAL_CHAT_MAX_ATTEMPT_COST_CREDITS: value
        })
      ).toEqual({ status: "invalid", reason: "MAX_ATTEMPT_COST_INVALID" });
    }
  );

  it("rejects max attempt cost above daily budget", () => {
    expect(
      resolveGlobalChatBudgetConfig({
        ...chatEnforcedEnv,
        GLOBAL_CHAT_DAILY_BUDGET_CREDITS: "30"
      })
    ).toEqual({
      status: "invalid",
      reason: "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET"
    });
  });

  it("does not include rejected environment text in the result", () => {
    const rejectedValue = "sensitive-chat-budget-value";
    const result = resolveGlobalChatBudgetConfig({
      ...chatEnforcedEnv,
      GLOBAL_CHAT_DAILY_BUDGET_CREDITS: rejectedValue
    });

    expect(JSON.stringify(result)).not.toContain(rejectedValue);
  });
});

describe("calculateChatAttemptCost", () => {
  it("returns valid with the same cost credits for a positive safe integer", () => {
    expect(calculateChatAttemptCost({ modelCreditCost: 5 })).toEqual({
      status: "valid",
      costCredits: 5
    });
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid model credit cost: %s",
    (cost) => {
      expect(calculateChatAttemptCost({ modelCreditCost: cost })).toEqual({
        status: "invalid",
        reason: "MODEL_COST_INVALID"
      });
    }
  );

  it("accepts Number.MAX_SAFE_INTEGER", () => {
    expect(
      calculateChatAttemptCost({ modelCreditCost: Number.MAX_SAFE_INTEGER })
    ).toEqual({
      status: "valid",
      costCredits: Number.MAX_SAFE_INTEGER
    });
  });

  it("rejects a value above Number.MAX_SAFE_INTEGER", () => {
    expect(
      calculateChatAttemptCost({
        modelCreditCost: Number.MAX_SAFE_INTEGER + 1
      })
    ).toEqual({ status: "invalid", reason: "MODEL_COST_INVALID" });
  });
});

describe("decideGlobalChatAttemptCost", () => {
  const validDisabled: GlobalChatBudgetConfigResult = {
    status: "valid",
    config: { mode: "disabled" }
  };
  const validEnforced: GlobalChatBudgetConfigResult = {
    status: "valid",
    config: { mode: "enforced", dailyBudgetCredits: 200, maxAttemptCostCredits: 50 }
  };
  const invalidConfig: GlobalChatBudgetConfigResult = {
    status: "invalid",
    reason: "MODE_MISSING"
  };

  it("returns unavailable for invalid config", () => {
    expect(decideGlobalChatAttemptCost(invalidConfig, 7)).toBe("unavailable");
  });

  it("returns bypass for disabled config regardless of cost", () => {
    expect(decideGlobalChatAttemptCost(validDisabled, 0)).toBe("bypass");
    expect(decideGlobalChatAttemptCost(validDisabled, -1)).toBe("bypass");
    expect(decideGlobalChatAttemptCost(validDisabled, 7)).toBe("bypass");
  });

  it("returns unavailable for invalid cost under enforced", () => {
    expect(decideGlobalChatAttemptCost(validEnforced, 0)).toBe("unavailable");
    expect(decideGlobalChatAttemptCost(validEnforced, -1)).toBe("unavailable");
    expect(decideGlobalChatAttemptCost(validEnforced, 0.5)).toBe("unavailable");
    expect(
      decideGlobalChatAttemptCost(validEnforced, Number.NaN)
    ).toBe("unavailable");
  });

  it("returns attempt_cost_exceeded when cost > max", () => {
    expect(decideGlobalChatAttemptCost(validEnforced, 51)).toBe(
      "attempt_cost_exceeded"
    );
  });

  it("returns allowed when cost equals max", () => {
    expect(decideGlobalChatAttemptCost(validEnforced, 50)).toBe("allowed");
  });

  it("returns allowed when cost < max", () => {
    expect(decideGlobalChatAttemptCost(validEnforced, 7)).toBe("allowed");
  });
});
    }
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid model cost: %s",
    (modelCreditCost) => {
      expect(calculateImageEstimatedCost({ modelCreditCost, count: 1 })).toEqual(
        { status: "invalid", reason: "MODEL_COST_INVALID" }
      );
    }
  );

  it.each([-1, 0, 3, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsupported image count: %s",
    (count) => {
      expect(calculateImageEstimatedCost({ modelCreditCost: 1, count })).toEqual(
        { status: "invalid", reason: "IMAGE_COUNT_INVALID" }
      );
    }
  );

  it("rejects multiplication overflow", () => {
    expect(
      calculateImageEstimatedCost({
        modelCreditCost: Math.floor(Number.MAX_SAFE_INTEGER / 4) + 1,
        count: 4
      })
    ).toEqual({ status: "invalid", reason: "COST_OVERFLOW" });
  });

  it("does not include rejected numeric inputs in the result", () => {
    const result = calculateImageEstimatedCost({
      modelCreditCost: 9007199254740992,
      count: 3
    });

    expect(result).toEqual({ status: "invalid", reason: "MODEL_COST_INVALID" });
    expect(Object.keys(result)).toEqual(["status", "reason"]);
  });
});

describe("decideGlobalImageRequestCost", () => {
  const enforced = resolveGlobalImageBudgetConfig(enforcedEnv);

  it("bypasses the maximum check when protection is disabled", () => {
    const disabled = resolveGlobalImageBudgetConfig({
      GLOBAL_IMAGE_BUDGET_MODE: "disabled"
    });
    expect(decideGlobalImageRequestCost(disabled, Number.MAX_SAFE_INTEGER)).toBe(
      "bypass"
    );
  });

  it("allows a cost below the maximum", () => {
    expect(decideGlobalImageRequestCost(enforced, 19)).toBe("allowed");
  });

  it("allows a cost equal to the maximum", () => {
    expect(decideGlobalImageRequestCost(enforced, 20)).toBe("allowed");
  });

  it("rejects a cost above the maximum", () => {
    expect(decideGlobalImageRequestCost(enforced, 21)).toBe(
      "request_cost_exceeded"
    );
  });

  it("fails closed when configuration is invalid", () => {
    const invalid: GlobalImageBudgetConfigResult = {
      status: "invalid",
      reason: "MODE_MISSING"
    };
    expect(decideGlobalImageRequestCost(invalid, 1)).toBe("unavailable");
  });
});

const adminProviderTestEnforcedEnv = {
  GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE: "enforced",
  GLOBAL_ADMIN_PROVIDER_TEST_DAILY_BUDGET_CREDITS: "200",
  GLOBAL_ADMIN_PROVIDER_TEST_MAX_ATTEMPT_COST_CREDITS: "50",
  GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS: "7"
} satisfies Partial<NodeJS.ProcessEnv>;

describe("resolveGlobalAdminProviderTestBudgetConfig", () => {
  it("rejects a missing mode", () => {
    expect(resolveGlobalAdminProviderTestBudgetConfig({})).toEqual({
      status: "invalid",
      reason: "MODE_MISSING"
    });
  });

  it("rejects an invalid mode", () => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE: "ENFORCED"
      })
    ).toEqual({ status: "invalid", reason: "MODE_INVALID" });
  });

  it("accepts disabled mode without numeric settings", () => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE: "disabled"
      })
    ).toEqual({ status: "valid", config: { mode: "disabled" } });
  });

  it("rejects an enforced configuration with missing daily budget", () => {
    const { GLOBAL_ADMIN_PROVIDER_TEST_DAILY_BUDGET_CREDITS: _daily, ...env } =
      adminProviderTestEnforcedEnv;
    expect(resolveGlobalAdminProviderTestBudgetConfig(env)).toEqual({
      status: "invalid",
      reason: "DAILY_BUDGET_MISSING"
    });
  });

  it("rejects an enforced configuration with missing maximum attempt cost", () => {
    const {
      GLOBAL_ADMIN_PROVIDER_TEST_MAX_ATTEMPT_COST_CREDITS: _max,
      ...env
    } = adminProviderTestEnforcedEnv;
    expect(resolveGlobalAdminProviderTestBudgetConfig(env)).toEqual({
      status: "invalid",
      reason: "MAX_ATTEMPT_COST_MISSING"
    });
  });

  it("rejects an enforced configuration with missing attempt cost", () => {
    const {
      GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS: _attempt,
      ...env
    } = adminProviderTestEnforcedEnv;
    expect(resolveGlobalAdminProviderTestBudgetConfig(env)).toEqual({
      status: "invalid",
      reason: "ATTEMPT_COST_MISSING"
    });
  });

  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1)
  ])("rejects invalid daily budget text: %s", (value) => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        ...adminProviderTestEnforcedEnv,
        GLOBAL_ADMIN_PROVIDER_TEST_DAILY_BUDGET_CREDITS: value
      })
    ).toEqual({ status: "invalid", reason: "DAILY_BUDGET_INVALID" });
  });

  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1)
  ])("rejects invalid maximum attempt cost text: %s", (value) => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        ...adminProviderTestEnforcedEnv,
        GLOBAL_ADMIN_PROVIDER_TEST_MAX_ATTEMPT_COST_CREDITS: value
      })
    ).toEqual({ status: "invalid", reason: "MAX_ATTEMPT_COST_INVALID" });
  });

  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1)
  ])("rejects invalid attempt cost text: %s", (value) => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        ...adminProviderTestEnforcedEnv,
        GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS: value
      })
    ).toEqual({ status: "invalid", reason: "ATTEMPT_COST_INVALID" });
  });

  it("rejects a maximum attempt cost above the daily budget", () => {
    expect(
      resolveGlobalAdminProviderTestBudgetConfig({
        ...adminProviderTestEnforcedEnv,
        GLOBAL_ADMIN_PROVIDER_TEST_DAILY_BUDGET_CREDITS: "49"
      })
    ).toEqual({
      status: "invalid",
      reason: "MAX_ATTEMPT_COST_EXCEEDS_DAILY_BUDGET"
    });
  });
});

describe("decideGlobalAdminProviderTestBudget", () => {
  it("returns unavailable for invalid configuration", () => {
    const invalid: GlobalAdminProviderTestBudgetConfigResult = {
      status: "invalid",
      reason: "MODE_MISSING"
    };
    expect(decideGlobalAdminProviderTestBudget(invalid)).toEqual({
      status: "unavailable"
    });
  });

  it("bypasses disabled configuration", () => {
    expect(
      decideGlobalAdminProviderTestBudget(
        resolveGlobalAdminProviderTestBudgetConfig({
          GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE: "disabled"
        })
      )
    ).toEqual({ status: "bypass" });
  });

  it("returns attempt_cost_exceeded when attempt cost is above max", () => {
    expect(
      decideGlobalAdminProviderTestBudget(
        resolveGlobalAdminProviderTestBudgetConfig({
          ...adminProviderTestEnforcedEnv,
          GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS: "51"
        })
      )
    ).toEqual({ status: "attempt_cost_exceeded" });
  });

  it("returns allowed with the configured costs when attempt equals max", () => {
    expect(
      decideGlobalAdminProviderTestBudget(
        resolveGlobalAdminProviderTestBudgetConfig({
          ...adminProviderTestEnforcedEnv,
          GLOBAL_ADMIN_PROVIDER_TEST_ATTEMPT_COST_CREDITS: "50"
        })
      )
    ).toEqual({
      status: "allowed",
      dailyBudgetCredits: 200,
      attemptCostCredits: 50
    });
  });

  it("returns allowed when attempt cost is below max", () => {
    expect(
      decideGlobalAdminProviderTestBudget(
        resolveGlobalAdminProviderTestBudgetConfig(adminProviderTestEnforcedEnv)
      )
    ).toEqual({
      status: "allowed",
      dailyBudgetCredits: 200,
      attemptCostCredits: 7
    });
  });
});

describe("GlobalBudgetStore contract", () => {
  type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
      ? true
      : false;
  type StoreKeysAreExact = Equal<
    keyof GlobalBudgetStore,
    "consumeGlobalBudget"
  >;
  type InputKeysAreExact = Equal<
    keyof ConsumeGlobalBudgetInput,
    "scope" | "periodType" | "periodKey" | "budgetCredits" | "costCredits"
  >;

  it("is implementable as a consume-only asynchronous store", async () => {
    const storeKeysAreExact: StoreKeysAreExact = true;
    const inputKeysAreExact: InputKeysAreExact = true;
    let received: ConsumeGlobalBudgetInput | undefined;
    const store: GlobalBudgetStore = {
      async consumeGlobalBudget(input) {
        received = input;
        return { status: "consumed" };
      }
    };
    const input: ConsumeGlobalBudgetInput = {
      scope: "image_generation",
      periodType: "DAILY",
      periodKey: "2026-07-16",
      budgetCredits: 100,
      costCredits: 12
    };

    await expect(store.consumeGlobalBudget(input)).resolves.toEqual({
      status: "consumed"
    });
    expect(received).toEqual(input);
    expect(Object.keys(store)).toEqual(["consumeGlobalBudget"]);
    expect(Object.keys(input)).toEqual([
      "scope",
      "periodType",
      "periodKey",
      "budgetCredits",
      "costCredits"
    ]);
    expect(storeKeysAreExact).toBe(true);
    expect(inputKeysAreExact).toBe(true);
  });

  it("distinguishes all three consume outcomes", () => {
    const results: ConsumeGlobalBudgetResult[] = [
      { status: "consumed" },
      { status: "exhausted" },
      { status: "unavailable" }
    ];

    expect(results.map((result) => result.status)).toEqual([
      "consumed",
      "exhausted",
      "unavailable"
    ]);
  });
});
