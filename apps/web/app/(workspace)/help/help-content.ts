export interface HelpOverviewCard {
  kind: "chat" | "image" | "credits";
  title: string;
  description: string;
}

export interface HelpQuickStartItem {
  title: string;
  description: string;
}

export interface HelpServiceCard {
  kind: "models" | "image" | "account" | "recharge" | "links";
  title: string;
  description: string;
}

export interface HelpFaqItem {
  question: string;
  answer: string;
}

export interface HelpLocaleContent {
  title: string;
  intro: string;
  quickStartTitle: string;
  serviceTitle: string;
  faqTitle: string;
  overviewCards: HelpOverviewCard[];
  quickStart: HelpQuickStartItem[];
  serviceCards: HelpServiceCard[];
  faqs: HelpFaqItem[];
}

export interface HelpPageContentConfig {
  "zh-CN": HelpLocaleContent;
  "en-US": HelpLocaleContent;
}

const MAX_JSON_BYTES = 50_000;
const MAX_TITLE_LENGTH = 100;
const MAX_INTRO_LENGTH = 1000;
const MAX_CARD_TITLE_LENGTH = 100;
const MAX_CARD_DESC_LENGTH = 1000;
const MAX_QUICK_START_ITEMS = 8;
const MAX_SERVICE_CARDS = 10;
const MAX_FAQ_ITEMS = 20;
const MAX_FAQ_QUESTION_LENGTH = 200;
const MAX_FAQ_ANSWER_LENGTH = 3000;

const VALID_OVERVIEW_KINDS = new Set(["chat", "image", "credits"]);
const VALID_SERVICE_KINDS = new Set(["models", "image", "account", "recharge", "links"]);

export function parseHelpContentJson(raw: string | null | undefined): HelpPageContentConfig | null {
  if (!raw) return null;

  if (raw.length > MAX_JSON_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const zhCN = obj["zh-CN"];
  const enUS = obj["en-US"];

  if (!zhCN || !enUS) return null;

  if (typeof zhCN !== "object" || zhCN === null || Array.isArray(zhCN)) return null;
  if (typeof enUS !== "object" || enUS === null || Array.isArray(enUS)) return null;

  return {
    "zh-CN": parseLocaleContent(zhCN as Record<string, unknown>),
    "en-US": parseLocaleContent(enUS as Record<string, unknown>)
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function parseLocaleContent(raw: Record<string, unknown>): HelpLocaleContent {
  const title = typeof raw.title === "string" ? truncate(raw.title, MAX_TITLE_LENGTH) : "";
  const intro = typeof raw.intro === "string" ? truncate(raw.intro, MAX_INTRO_LENGTH) : "";
  const quickStartTitle = typeof raw.quickStartTitle === "string" ? truncate(raw.quickStartTitle, MAX_TITLE_LENGTH) : "";
  const serviceTitle = typeof raw.serviceTitle === "string" ? truncate(raw.serviceTitle, MAX_TITLE_LENGTH) : "";
  const faqTitle = typeof raw.faqTitle === "string" ? truncate(raw.faqTitle, MAX_TITLE_LENGTH) : "";

  const overviewCards = Array.isArray(raw.overviewCards)
    ? raw.overviewCards
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => {
          const kind = typeof item.kind === "string" && VALID_OVERVIEW_KINDS.has(item.kind)
            ? (item.kind as HelpOverviewCard["kind"])
            : "chat";
          const cardTitle = typeof item.title === "string" ? truncate(item.title, MAX_CARD_TITLE_LENGTH) : "";
          const description = typeof item.description === "string" ? truncate(item.description, MAX_CARD_DESC_LENGTH) : "";
          return { kind, title: cardTitle, description };
        })
    : [];

  const quickStart = Array.isArray(raw.quickStart)
    ? raw.quickStart
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => {
          const itemTitle = typeof item.title === "string" ? truncate(item.title, MAX_CARD_TITLE_LENGTH) : "";
          const description = typeof item.description === "string" ? truncate(item.description, MAX_CARD_DESC_LENGTH) : "";
          return { title: itemTitle, description };
        })
        .slice(0, MAX_QUICK_START_ITEMS)
    : [];

  const serviceCards = Array.isArray(raw.serviceCards)
    ? raw.serviceCards
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => {
          const kind = typeof item.kind === "string" && VALID_SERVICE_KINDS.has(item.kind)
            ? (item.kind as HelpServiceCard["kind"])
            : "models";
          const cardTitle = typeof item.title === "string" ? truncate(item.title, MAX_CARD_TITLE_LENGTH) : "";
          const description = typeof item.description === "string" ? truncate(item.description, MAX_CARD_DESC_LENGTH) : "";
          return { kind, title: cardTitle, description };
        })
        .slice(0, MAX_SERVICE_CARDS)
    : [];

  const faqs = Array.isArray(raw.faqs)
    ? raw.faqs
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => {
          const question = typeof item.question === "string" ? truncate(item.question, MAX_FAQ_QUESTION_LENGTH) : "";
          const answer = typeof item.answer === "string" ? truncate(item.answer, MAX_FAQ_ANSWER_LENGTH) : "";
          return { question, answer };
        })
        .slice(0, MAX_FAQ_ITEMS)
    : [];

  return {
    title,
    intro,
    quickStartTitle,
    serviceTitle,
    faqTitle,
    overviewCards,
    quickStart,
    serviceCards,
    faqs
  };
}

export function getHelpLocaleContent(
  config: HelpPageContentConfig | null,
  locale: string
): HelpLocaleContent | null {
  if (!config) return null;
  if (locale !== "zh-CN" && locale !== "en-US") return null;
  return config[locale] ?? null;
}