"use client";

import React from "react";
import { InfoPage } from "../../components/InfoPage";

export default function AboutPage() {
  return (
    <InfoPage
      titleKey="about.title"
      introKey="about.intro"
      sections={[
        {
          titleKey: "about.platformTitle",
          paragraphKeys: ["about.platformBody"]
        },
        {
          titleKey: "about.capabilitiesTitle",
          bulletKeys: [
            "about.capability.chat",
            "about.capability.quota",
            "about.capability.orders",
            "about.capability.admin"
          ]
        },
        {
          titleKey: "about.betaTitle",
          paragraphKeys: ["about.betaBody"]
        }
      ]}
    />
  );
}
