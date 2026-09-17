import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app/(workspace)/chat/history/page.tsx"),
  "utf8"
);

describe("mobile chat history contracts", () => {
  it("uses the existing ChatSession list and local date groups", () => {
    expect(source).toContain('apiUrl("/chat/sessions")');
    expect(source).toContain("ChatSessionSummary");
    expect(source).toContain("updatedAt");
    expect(source).toContain('"today"');
    expect(source).toContain('"yesterday"');
    expect(source).toContain('"earlier"');
    expect(source).toContain("getFullYear");
    expect(source).toContain("getHistoryGroup");
  });

  it("supports search, safe loading/error/empty states, recovery, and existing deletion", () => {
    expect(source).toContain('data-chat-history-state="loading"');
    expect(source).toContain('data-chat-history-state="error"');
    expect(source).toContain('data-chat-history-state="empty"');
    expect(source).toContain('onClick={() => void loadHistory()}');
    expect(source).toContain("query.trim().toLowerCase()");
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("window.confirm");
  });

  it("restores a real session without making a provider request and defers unavailable previews", () => {
    expect(source).toContain("sessionId");
    expect(source).toContain("encodeURIComponent(sessionId)");
    expect(source).toContain("CHAT_HISTORY_PREVIEW_DEFERRED");
    expect(source).not.toContain("/chat/sessions/${sessionId}/messages");
    expect(source).not.toContain("/chat/completions");
  });

  it("keeps the mobile header and bottom-nav page contract", () => {
    expect(source).toContain("MobilePageHeader");
    expect(source).toContain('backHref="/"');
    expect(source).toContain('data-chat-history-page="true"');
    expect(source).toContain('aria-label={t("chat.newChat")}');
  });
});
