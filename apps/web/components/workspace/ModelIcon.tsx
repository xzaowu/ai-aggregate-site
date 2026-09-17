import { getModelDisplayName, type AiModelSummary } from "@ai-aggregate/shared";
import { Sparkles } from "lucide-react";
import React, { useState } from "react";

function resolveInitials(model: AiModelSummary) {
  const displayName = getModelDisplayName(model).trim();

  if (!displayName) {
    return "";
  }

  const words = displayName.split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return initials.length >= 2 ? initials : "";
}

export function ModelIcon({
  model,
  selected = false,
  className = "size-10 rounded-2xl",
  imageClassName = "size-6"
}: {
  model: AiModelSummary;
  selected?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  const displayName = getModelDisplayName(model);
  const explicitText = model.iconText?.trim();
  const fallbackText = explicitText || resolveInitials(model);
  const [imgFailed, setImgFailed] = useState(false);
  const iconUrl = model.iconUrl?.trim();
  const showImg = Boolean(iconUrl && !imgFailed);
  const avatarBg =
    model.iconColor?.trim() || (selected ? "#4f46e5" : "#94a3b8");
  const isTextAvatar = Boolean(!showImg && fallbackText);
  const isDefaultAvatar = Boolean(!showImg && !fallbackText);

  return (
    <span
      className={`flex shrink-0 items-center justify-center text-xs font-bold text-white ${className}`}
      style={{ backgroundColor: avatarBg }}
      data-model-icon="true"
      data-model-icon-text={isTextAvatar ? "true" : undefined}
      data-model-icon-default={isDefaultAvatar ? "true" : undefined}
    >
      {showImg ? (
        <img
          alt={displayName}
          className={`${imageClassName} object-contain`}
          src={iconUrl}
          onError={() => setImgFailed(true)}
        />
      ) : fallbackText ? (
        fallbackText
      ) : (
        <Sparkles className="size-4" aria-hidden="true" />
      )}
    </span>
  );
}
