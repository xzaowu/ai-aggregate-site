import { describe, expect, it } from "vitest";
import { toCreatorImageNodeExecutionView } from "./creator-image-execution-state";

describe("Creator Image node execution state", () => {
  it("keeps idle and absent runtime undecorated", () => {
    expect(toCreatorImageNodeExecutionView("idle")).toBeNull();
    expect(toCreatorImageNodeExecutionView(undefined)).toBeNull();
  });

  it("projects preparation and submission as generating", () => {
    expect(toCreatorImageNodeExecutionView("preparing")).toEqual({
      status: "generating"
    });
    expect(toCreatorImageNodeExecutionView("submitting")).toEqual({
      status: "generating"
    });
  });

  it("preserves checking, unresolved, and failed presentation states", () => {
    expect(toCreatorImageNodeExecutionView("checking")).toEqual({
      status: "checking"
    });
    expect(toCreatorImageNodeExecutionView("unresolved")).toEqual({
      status: "unresolved"
    });
    expect(toCreatorImageNodeExecutionView("failed")).toEqual({
      status: "failed"
    });
  });
});
