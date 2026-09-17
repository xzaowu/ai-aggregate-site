"use client";

import { Presentation } from "lucide-react";
import React from "react";
import {
  GenerationFormShell,
  MultimodalWorkspacePage
} from "../../../components/workspace/MultimodalWorkspacePage";

export default function PptPage() {
  return (
    <MultimodalWorkspacePage
      icon={Presentation}
      eyebrowKey="multimodal.ppt.eyebrow"
      titleKey="multimodal.ppt.title"
      descriptionKey="multimodal.ppt.description"
      noticeKey="multimodal.comingSoonNotice"
    >
      <GenerationFormShell
        fields={[
          {
            labelKey: "multimodal.topic",
            placeholderKey: "multimodal.ppt.topicPlaceholder"
          }
        ]}
        selectors={[
          {
            labelKey: "multimodal.pageCount",
            valueKey: "multimodal.pageCountPlaceholder"
          },
          {
            labelKey: "multimodal.style",
            valueKey: "multimodal.stylePlaceholder"
          }
        ]}
        actions={[
          { labelKey: "multimodal.ppt.generateOutline", variant: "secondary" },
          { labelKey: "multimodal.ppt.generatePpt" }
        ]}
        resultTitleKey="multimodal.ppt.emptyTitle"
        resultDescriptionKey="multimodal.ppt.emptyDescription"
      />
    </MultimodalWorkspacePage>
  );
}
