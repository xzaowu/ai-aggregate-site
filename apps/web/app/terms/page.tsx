"use client";

import React from "react";
import { InfoPage } from "../../components/InfoPage";

export default function TermsPage() {
  return (
    <InfoPage
      titleKey="terms.title"
      introKey="terms.intro"
      sections={[
        {
          titleKey: "terms.useTitle",
          bulletKeys: [
            "terms.use.legal",
            "terms.use.noAbuse",
            "terms.use.noIllegal",
            "terms.use.limit"
          ]
        },
        {
          titleKey: "terms.aiTitle",
          paragraphKeys: ["terms.aiBody"]
        },
        {
          titleKey: "terms.ordersTitle",
          paragraphKeys: ["terms.ordersBody"]
        }
      ]}
    />
  );
}
