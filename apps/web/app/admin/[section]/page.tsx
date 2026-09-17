import { notFound } from "next/navigation";
import { getAdminSectionFromRouteSegment } from "../admin-navigation";

export default async function AdminSectionPage({
  params
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!getAdminSectionFromRouteSegment(section)) {
    notFound();
  }

  return null;
}
