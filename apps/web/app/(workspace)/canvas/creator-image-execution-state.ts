export type CreatorImageExecutionStatus =
  | "idle"
  | "preparing"
  | "submitting"
  | "checking"
  | "unresolved"
  | "failed";

export type CreatorImageNodeExecutionStatus =
  | "generating"
  | "checking"
  | "unresolved"
  | "failed";

export type CreatorImageNodeExecutionView = Readonly<{
  status: CreatorImageNodeExecutionStatus;
}>;

export function toCreatorImageNodeExecutionView(
  status: CreatorImageExecutionStatus | undefined
): CreatorImageNodeExecutionView | null {
  switch (status) {
    case "preparing":
    case "submitting":
      return { status: "generating" };
    case "checking":
    case "unresolved":
    case "failed":
      return { status };
    case "idle":
    case undefined:
      return null;
  }
}
