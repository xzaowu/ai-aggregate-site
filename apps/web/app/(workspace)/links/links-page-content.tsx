"use client";

import { LinksPanel } from "../../../components/workspace/LinksPanel";
import { MobilePageHeader } from "../../../components/workspace/MobilePageHeader";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  publicWorkspaceLinks,
  usePublicLinks
} from "../../../lib/use-public-links";

export default function LinksPageContent() {
  const { t } = useI18n();
  const links = publicWorkspaceLinks(usePublicLinks());

  return (
    <>
      <MobilePageHeader title={t("links.title")} backHref="/account" />
      <LinksPanel links={links} />
    </>
  );
}
