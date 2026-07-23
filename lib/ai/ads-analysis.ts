import { z } from "zod";

export const adsAnalysisItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1).max(300),
  url: z.string().url().nullable().optional(),
  status: z.string().nullable().optional(),
  views: z.number().int().nonnegative(),
  contacts: z.number().int().nonnegative(),
  favorites: z.number().int().nonnegative(),
  price: z.number().nonnegative().nullable().optional(),
  description: z.string().max(6000).nullable().optional(),
  imageCount: z.number().int().nonnegative().nullable().optional(),
});

export const adsAnalysisInputSchema = z.object({
  profileId: z.string().min(1),
  accountId: z.string().min(1),
  periodDays: z.number().int().min(1).max(270),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  total: z.object({
    ads: z.number().int().nonnegative(),
    views: z.number().int().nonnegative(),
    contacts: z.number().int().nonnegative(),
    favorites: z.number().int().nonnegative(),
  }),
  items: z.array(adsAnalysisItemSchema).max(500),
});

export const adsAnalysisActionSchema = z.object({
  id: z.string().min(1).max(100),
  itemId: z.string().min(1),
  title: z.string().min(1).max(300),
  priority: z.enum(["high", "medium", "low"]),
  field: z.enum(["title", "description", "photos", "video", "price", "promotion", "duplicate", "assortment", "other"]),
  diagnosis: z.string().min(1).max(1600),
  proposedValue: z.string().max(8000).nullable(),
  expectedImpact: z.string().min(1).max(900),
  applyMode: z.enum(["autoload", "content_machine", "manual"]),
});

const accountMetricSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
  context: z.string().min(1).max(500),
});

const portfolioInsightSchema = z.object({
  title: z.string().min(1).max(200),
  finding: z.string().min(1).max(1000),
  recommendation: z.string().min(1).max(1200),
});

export const adsAnalysisReportSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  opportunity: z.string().min(1).max(1600),
  accountMetrics: z.array(accountMetricSchema).max(10).default([]),
  portfolioInsights: z.array(portfolioInsightSchema).max(10).default([]),
  actions: z.array(adsAnalysisActionSchema).max(20),
});

export type AdsAnalysisInput = z.infer<typeof adsAnalysisInputSchema>;
export type AdsAnalysisReport = z.infer<typeof adsAnalysisReportSchema>;
export type AdsAnalysisAction = z.infer<typeof adsAnalysisActionSchema>;

const MAX_PROMPT_ITEMS = 100;
const MAX_PROMPT_DESCRIPTION_LENGTH = 1200;

function rate(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function compactAdsAnalysisInput(input: AdsAnalysisInput) {
  const byViews = [...input.items].sort((left, right) => right.views - left.views);
  const byLowViews = [...input.items].sort((left, right) => left.views - right.views);
  const byFavoritesWithoutContacts = [...input.items].sort((left, right) => {
    const leftOpportunity = left.favorites * 10 - left.contacts;
    const rightOpportunity = right.favorites * 10 - right.contacts;
    return rightOpportunity - leftOpportunity;
  });
  const byContacts = [...input.items].sort((left, right) => right.contacts - left.contacts);
  const candidates = input.items.length <= MAX_PROMPT_ITEMS
    ? input.items
    : [
        ...byViews.slice(0, 40),
        ...byLowViews.slice(0, 25),
        ...byFavoritesWithoutContacts.slice(0, 20),
        ...byContacts.slice(0, 15),
        ...input.items,
      ];
  const selected = Array.from(new Map(candidates.map((item) => [item.itemId, item])).values())
    .slice(0, MAX_PROMPT_ITEMS)
    .map((item) => ({
      ...item,
      description: item.description?.slice(0, MAX_PROMPT_DESCRIPTION_LENGTH) ?? null,
      descriptionDataStatus: item.description?.trim() ? "received_from_api" : "not_returned_by_api",
      imageCountDataStatus: item.imageCount === null || item.imageCount === undefined ? "not_returned_by_api" : "received_from_api",
      contactRate: rate(item.contacts, item.views),
      favoriteRate: rate(item.favorites, item.views),
    }));

  const prices = input.items.flatMap((item) => item.price === null || item.price === undefined ? [] : [item.price]);
  const knownImageCounts = input.items.flatMap((item) => item.imageCount === null || item.imageCount === undefined ? [] : [item.imageCount]);
  const topTenViews = byViews.slice(0, Math.min(10, byViews.length)).reduce((sum, item) => sum + item.views, 0);

  return {
    ...input,
    sourceItemCount: input.items.length,
    analyzedItemCount: selected.length,
    coveragePercent: rate(selected.length, input.items.length),
    accountMetrics: {
      viewToContactRate: rate(input.total.contacts, input.total.views),
      viewToFavoriteRate: rate(input.total.favorites, input.total.views),
      medianViews: median(input.items.map((item) => item.views)),
      medianContacts: median(input.items.map((item) => item.contacts)),
      medianFavorites: median(input.items.map((item) => item.favorites)),
      medianPrice: median(prices),
      averageKnownImageCount: knownImageCounts.length
        ? Number((knownImageCounts.reduce((sum, value) => sum + value, 0) / knownImageCounts.length).toFixed(1))
        : null,
      zeroViewAds: input.items.filter((item) => item.views === 0).length,
      viewedWithoutContacts: input.items.filter((item) => item.views > 0 && item.contacts === 0).length,
      favoritesWithoutContacts: input.items.filter((item) => item.favorites > 0 && item.contacts === 0).length,
      descriptionReceivedFromApi: input.items.filter((item) => Boolean(item.description?.trim())).length,
      descriptionNotReturnedByApi: input.items.filter((item) => !item.description?.trim()).length,
      imageCountNotReturnedByApi: input.items.filter((item) => item.imageCount === null || item.imageCount === undefined).length,
      topTenViewShare: rate(topTenViews, input.total.views),
    },
    items: selected,
  };
}

export function buildAdsAnalysisPrompt(input: AdsAnalysisInput): string {
  const compactInput = compactAdsAnalysisInput(input);

  return [
    "Ты — директор по росту Avito-магазина одежды: аналитик воронки, ассортимента, цены, контента и платного продвижения.",
    "Подготовь глубокий, доказательный отчёт на русском языке по всему аккаунту и конкретным объявлениям.",
    `Охват: передано ${compactInput.analyzedItemCount} из ${compactInput.sourceItemCount} объявлений (${compactInput.coveragePercent}%). Обязательно укажи охват в выводе и не называй анализ полным, если охват ниже 100%.`,
    "КРИТИЧЕСКОЕ ПРАВИЛО ДАННЫХ: description=null и descriptionDataStatus=not_returned_by_api означают только то, что API не вернул текст. Это НЕ означает, что описания в объявлении нет. Запрещено советовать «добавить описание» или утверждать, что оно отсутствует. Анализируй текст описания только при received_from_api.",
    "То же правило применяй к imageCountDataStatus: неизвестное количество фото нельзя трактовать как отсутствие или нехватку фото.",
    "Сначала разложи аккаунт по воронке: просмотры, избранное, контакты. Используй проценты, медианы, доли и сравнение объявлений между собой. Не выдумывай показы, продажи, прибыль, рыночные цены, динамику к прошлому периоду или данные конкурентов.",
    "Называй «тенденцией» только закономерность внутри переданного периода и выборки. Для временной динамики прямо укажи, что нужен предыдущий сопоставимый период.",
    "Найди сильные и слабые паттерны: какие формулировки, цены и типы позиций дают больше просмотров, избранного и контактов; что можно масштабировать.",
    "Проверь ассортиментные кластеры по названиям. Предложи похожие позиции и кандидатов на отдельные объявления/дубли только там, где спрос подтверждён метриками. Объясни, чем новый дубль должен отличаться: размер, цвет, оффер, обложка, запрос или аудитория. Не предлагай идентичные копии.",
    "По цене предлагай точный тест снижения/повышения в рублях или процентах только относительно фактической цены и внутренних данных аккаунта. Отмечай гипотезу как тест, если нет рынка/маржи.",
    "По продвижению выбирай конкретные объявления, цель, срок теста, критерий остановки и метрику успеха. Не советуй покупать продвижение карточке с плохой конверсией до исправления карточки.",
    "По контенту не ограничивайся фразой «добавить фото». Дай готовый план кадров: обложка, ракурсы, крупные планы, замеры, посадка и детали доверия — только если количество фото известно или рекомендация сформулирована как проверка.",
    "Обязательно рассмотри Flow-видео. Для подходящих сильных позиций дай готовый 6–10-секундный сценарий/промпт: сцены, движение камеры, акцент на принте/фактуре, вертикальный формат, запрет менять товар и CTA. Используй field=video и applyMode=manual.",
    "Для title/description/photos/video в proposedValue давай готовый вариант текста или исчерпывающий бриф, а не общие слова.",
    "Сформируй 6–10 метрик аккаунта, 5–8 портфельных выводов и 8–15 приоритетных действий. Действия должны покрывать разные рычаги: контент, видео, цена, продвижение, дубли/ассортимент; не заполняй отчёт одними заменами описания.",
    "Каждый вывод и diagnosis подкрепляй конкретными itemId, числами, ставками или сравнением с медианой аккаунта. Если доказательств нет — пометь это как гипотезу и предложи измеримый тест.",
    "Верни только JSON без markdown по схеме:",
    JSON.stringify({
      executiveSummary: "3–5 предложений: состояние воронки, охват анализа, главные доказанные закономерности",
      opportunity: "главная возможность роста с числами",
      accountMetrics: [{ label: "метрика", value: "значение", context: "интерпретация и источник" }],
      portfolioInsights: [{ title: "вывод", finding: "доказательство с числами и itemId", recommendation: "решение или измеримый тест" }],
      actions: [{
        id: "уникальный-id",
        itemId: "id объявления или account для портфельного действия",
        title: "объявление или портфельное действие",
        priority: "high|medium|low",
        field: "title|description|photos|video|price|promotion|duplicate|assortment|other",
        diagnosis: "проблема/возможность и числовое доказательство",
        proposedValue: "готовая правка, бриф, сценарий или план теста; null только когда неприменимо",
        expectedImpact: "влияние и метрика проверки",
        applyMode: "autoload|content_machine|manual",
      }],
    }),
    "Данные:",
    JSON.stringify(compactInput),
  ].join("\n");
}
