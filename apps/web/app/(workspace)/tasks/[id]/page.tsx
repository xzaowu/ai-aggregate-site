import React from "react";
import { TaskDetailPageContent } from "./task-detail-page-content";

export default async function TaskDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <TaskDetailPageContent taskId={id} />;
}
