import { notFound } from "next/navigation";
import { getAdminSettingsAreaFromRouteSegment } from "../../admin-navigation";

export default async function AdminSettingsSubsectionPage({
  params
}: {
  params: Promise<{ subsection: string }>;
}) {
  const { subsection } = await params;
  if (!getAdminSettingsAreaFromRouteSegment(subsection)) {
    notFound();
  }

  return null;
}
