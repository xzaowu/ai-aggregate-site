"use client";

import React from "react";
import { MarkdownContent } from "./MarkdownContent";

export function AssistantMarkdown({
  content,
  messageId,
  locale = "zh-CN"
}: {
  content: string;
  messageId: string;
  locale?: string;
}) {
  return (
    <MarkdownContent
      content={content}
      locale={locale}
      variant="chat"
      headingIdPrefix={`chat-heading-${messageId}`}
    />
  );
}
