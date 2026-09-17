"use client";

import {
  BookOpen,
  ChevronDown,
  CreditCard,
  ImageIcon,
  MessageSquare,
  User
} from "lucide-react";
import React, { useState } from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { usePublicSettings } from "../../../lib/use-public-settings";
import { MobilePageHeader } from "../../../components/workspace/MobilePageHeader";
import {
  parseHelpContentJson,
  getHelpLocaleContent,
  type HelpLocaleContent
} from "./help-content";

function StatCard({
  icon,
  label,
  description
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
      </div>
    </div>
  );
}

function QuickStartCard({
  step,
  title,
  description
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
        {step}
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</div>
      </div>
    </div>
  );
}

function FaqItem({
  question,
  answer
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500 transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-4 py-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-400">
          {answer}
        </div>
      ) : null}
    </div>
  );
}

function overviewIcon(kind: string) {
  if (kind === "image") return <ImageIcon className="h-4 w-4" aria-hidden="true" />;
  if (kind === "credits") return <CreditCard className="h-4 w-4" aria-hidden="true" />;
  return <MessageSquare className="h-4 w-4" aria-hidden="true" />;
}

function serviceIcon(kind: string) {
  if (kind === "image") return <ImageIcon className="h-4 w-4" aria-hidden="true" />;
  if (kind === "account") return <User className="h-4 w-4" aria-hidden="true" />;
  if (kind === "recharge") return <CreditCard className="h-4 w-4" aria-hidden="true" />;
  if (kind === "links") return <MessageSquare className="h-4 w-4" aria-hidden="true" />;
  return <BookOpen className="h-4 w-4" aria-hidden="true" />;
}

export function HelpPageContent() {
  const { t, locale } = useI18n();
  const settings = usePublicSettings();
  const helpConfig = settings ? parseHelpContentJson(settings.helpContentJson) : null;
  const helpContent = getHelpLocaleContent(helpConfig, locale);

  function h(fallbackKey: string, value: string | undefined): string {
    return value || t(fallbackKey);
  }

  return (
    <>
      <MobilePageHeader title={h("help.title", helpContent?.title)} backHref="/account" />
      <div
        className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 px-5 py-3 sm:px-6 sm:py-6 lg:px-8 dark:bg-slate-950"
        data-workspace-page-scroll="help"
      >
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="hidden text-2xl font-bold text-slate-950 sm:text-3xl md:block dark:text-slate-100">
                {h("help.title", helpContent?.title)}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {h("help.intro", helpContent?.intro)}
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3 lg:w-72">
              {helpContent?.overviewCards && helpContent.overviewCards.length > 0
                ? helpContent.overviewCards.map((card, i) => (
                    <StatCard
                      key={`overview-${i}`}
                      icon={overviewIcon(card.kind)}
                      label={card.title}
                      description={card.description}
                    />
                  ))
                : [
                    <StatCard
                      key="overview-chat"
                      icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
                      label={t("workspace.chat")}
                      description={t("help.quickStartBody1")}
                    />,
                    <StatCard
                      key="overview-image"
                      icon={<ImageIcon className="h-4 w-4" aria-hidden="true" />}
                      label={t("workspace.imageNav")}
                      description={t("multimodal.image.description")}
                    />,
                    <StatCard
                      key="overview-credits"
                      icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                      label={t("workspace.remainingCredits")}
                      description={t("help.creditsBody1")}
                    />
                  ]}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-bold text-slate-950 dark:text-slate-100">
            {h("help.quickStartTitle", helpContent?.quickStartTitle)}
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {helpContent?.quickStart && helpContent.quickStart.length > 0
              ? helpContent.quickStart.map((item, i) => (
                  <QuickStartCard
                    key={`quick-${i}`}
                    step={i + 1}
                    title={item.title}
                    description={item.description}
                  />
                ))
              : [
                  <QuickStartCard
                    key="quick-0"
                    step={1}
                    title={t("help.chooseModelTitle")}
                    description={t("help.chooseModelBody1")}
                  />,
                  <QuickStartCard
                    key="quick-1"
                    step={2}
                    title={t("chat.inputPlaceholder")}
                    description={t("help.quickStartBody1")}
                  />,
                  <QuickStartCard
                    key="quick-2"
                    step={3}
                    title={t("chat.switchModel")}
                    description={t("help.chooseModelBody2")}
                  />
                ]}
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold text-slate-950 dark:text-slate-100">
            {h("workspace.groupService", helpContent?.serviceTitle)}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {helpContent?.serviceCards && helpContent.serviceCards.length > 0
              ? helpContent.serviceCards.map((card, i) => (
                  <FeatureCard
                    key={`service-${i}`}
                    icon={serviceIcon(card.kind)}
                    title={card.title}
                    description={card.description}
                  />
                ))
              : [
                  <FeatureCard
                    key="service-models"
                    icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                    title={t("workspace.models")}
                    description={t("help.chooseModelBody2")}
                  />,
                  <FeatureCard
                    key="service-image"
                    icon={<ImageIcon className="h-4 w-4" aria-hidden="true" />}
                    title={t("workspace.imageNav")}
                    description={t("multimodal.image.description")}
                  />,
                  <FeatureCard
                    key="service-account"
                    icon={<User className="h-4 w-4" aria-hidden="true" />}
                    title={t("nav.account")}
                    description={t("account.description")}
                  />,
                  <FeatureCard
                    key="service-recharge"
                    icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                    title={t("workspace.recharge")}
                    description={t("help.buyPlansBody1")}
                  />,
                  <FeatureCard
                    key="service-links"
                    icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
                    title={t("workspace.linksNav")}
                    description={t("workspace.externalLinks")}
                  />
                ]}
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold text-slate-950 dark:text-slate-100">
            {h("help.faqTitle", helpContent?.faqTitle)}
          </h2>
          <div className="mt-3 grid gap-3">
            {helpContent?.faqs && helpContent.faqs.length > 0
              ? helpContent.faqs.map((item, i) => (
                  <FaqItem
                    key={`faq-${i}`}
                    question={item.question}
                    answer={item.answer}
                  />
                ))
              : [
                  <FaqItem key="faq-0" question={t("help.faqQ1")} answer={t("help.faqA1")} />,
                  <FaqItem key="faq-1" question={t("help.faqQ2")} answer={t("help.faqA2")} />,
                  <FaqItem key="faq-2" question={t("help.faqQ3")} answer={t("help.faqA3")} />,
                  <FaqItem key="faq-3" question={t("help.faqQ4")} answer={t("help.faqA4")} />,
                  <FaqItem key="faq-4" question={t("help.faqQ5")} answer={t("help.faqA5")} />,
                  <FaqItem key="faq-5" question={t("help.faqQ6")} answer={t("help.faqA6")} />
                ]}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
