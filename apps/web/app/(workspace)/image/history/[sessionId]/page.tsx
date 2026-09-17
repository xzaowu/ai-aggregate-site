import React from "react";
import { ImagePageContent } from "../../image-page-content";

export default async function ImageHistorySessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return <ImagePageContent initialSessionId={sessionId} historyDetail />;
}
