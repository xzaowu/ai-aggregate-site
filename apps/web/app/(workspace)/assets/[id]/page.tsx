import React from "react";
import { AssetDetailPageContent } from "./asset-detail-page-content";

export default async function AssetDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AssetDetailPageContent assetId={id} />;
}
