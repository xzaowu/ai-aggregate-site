"use client";

import React from "react";
import { InfoPage } from "../../components/InfoPage";

export default function PrivacyPage() {
  return (
    <InfoPage
      titleKey="privacy.title"
      introKey="privacy.intro"
      sections={[
        {
          titleKey: "privacy.collectTitle",
          bulletKeys: [
            "privacy.collect.email",
            "privacy.collect.chat",
            "privacy.collect.quota",
            "privacy.collect.orders",
            "privacy.collect.logs"
          ]
        },
        {
          titleKey: "privacy.useTitle",
          paragraphKeys: ["privacy.useBody"]
        },
        {
          titleKey: "privacy.shareTitle",
          paragraphKeys: ["privacy.shareBody", "privacy.aiBody"]
        },
        {
          titleKey: "privacy.sensitiveTitle",
          paragraphKeys: ["privacy.sensitiveBody"]
        }
      ]}
    />
  );
}
