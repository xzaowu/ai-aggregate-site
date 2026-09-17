import type { AuthUser } from "@ai-aggregate/shared";
import type { Locale } from "../../lib/i18n/types";

const ZH_PREFIXES = [
  "星河", "云端", "极光", "月影", "晨曦",
  "深蓝", "微光", "风铃", "青空", "银河",
  "流光", "雾海"
];

const ZH_ROLES = [
  "旅人", "探索者", "创作者", "画师", "观测员",
  "研究员", "策划师", "漫游者", "记录者", "构筑师",
  "思考者", "设计师"
];

const EN_PREFIXES = [
  "Stellar", "Cloud", "Aurora", "Moonlight", "Dawn",
  "Deep Blue", "Glimmer", "Wind Chime", "Azure", "Galaxy",
  "Luminous", "Mist"
];

const EN_ROLES = [
  "Traveler", "Explorer", "Creator", "Artist", "Observer",
  "Researcher", "Planner", "Wanderer", "Recorder", "Architect",
  "Thinker", "Designer"
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function deterministicNumber(seed: string, max: number): number {
  return hashSeed(seed) % max;
}

function getNicknameSuffix(seed: string): string {
  const num = 10 + (deterministicNumber(`${seed}-suffix`, 89));
  return String(num).padStart(2, "0");
}

export function generateNickname(seed: string, locale: Locale): string {
  if (locale === "zh-CN") {
    const prefixIdx = deterministicNumber(`${seed}-prefix`, ZH_PREFIXES.length);
    const roleIdx = deterministicNumber(`${seed}-role`, ZH_ROLES.length);
    const suffix = getNicknameSuffix(seed);
    const prefix = ZH_PREFIXES[prefixIdx] ?? "星河";
    const role = ZH_ROLES[roleIdx] ?? "旅人";
    return `${prefix}${role} ${suffix}`;
  }

  const prefixIdx = deterministicNumber(`${seed}-prefix`, EN_PREFIXES.length);
  const roleIdx = deterministicNumber(`${seed}-role`, EN_ROLES.length);
  const suffix = getNicknameSuffix(seed);
  const prefix = EN_PREFIXES[prefixIdx] ?? "Stellar";
  const role = EN_ROLES[roleIdx] ?? "Traveler";
  return `${prefix} ${role} ${suffix}`;
}

export function getUserDisplayName(user: AuthUser, locale: Locale): string {
  if (user.name && user.name.trim().length > 0) {
    return user.name.trim();
  }
  const seed = getUserSeed(user);
  return generateNickname(seed, locale);
}

export function getUserSeed(user: AuthUser): string {
  return user.id || user.email || "user";
}
