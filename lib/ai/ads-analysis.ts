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
  field: z.enum(["title", "description", "photos", "price", "promotion", "other"]),
  diagnosis: z.string().min(1).max(1200),
  proposedValue: z.string().max(6000).nullable(),
  expectedImpact: z.string().min(1).max(700),
  applyMode: z.enum(["autoload", "content_machine", "manual"]),
});

export const adsAnalysisReportSchema = z.object({
  executiveSummary: z.string().min(1).max(2000),
  healthScore: z.number().int().min(0).max(100),
  opportunity: z.string().min(1).max(1200),
  actions: z.array(adsAnalysisActionSchema).max(30),
});

export type AdsAnalysisInput = z.infer<typeof adsAnalysisInputSchema>;
export type AdsAnalysisReport = z.infer<typeof adsAnalysisReportSchema>;
export type AdsAnalysisAction = z.infer<typeof adsAnalysisActionSchema>;

const MAX_PROMPT_ITEMS = 80;
const MAX_PROMPT_DESCRIPTION_LENGTH = 1200;

export function compactAdsAnalysisInput(input: AdsAnalysisInput) {
  const byViews = [...input.items].sort((left, right) => right.views - left.views);
  const byFavoritesWithoutContacts = [...input.items].sort((left, right) => {
    const leftOpportunity = left.favorites * 10 - left.contacts;
    const rightOpportunity = right.favorites * 10 - right.contacts;
    return rightOpportunity - leftOpportunity;
  });
  const byContacts = [...input.items].sort((left, right) => right.contacts - left.contacts);
  const candidates = [
    ...byViews.slice(0, 45),
    ...byFavoritesWithoutContacts.slice(0, 25),
    ...byContacts.slice(0, 10),
  ];
  const selected = Array.from(new Map(candidates.map((item) => [item.itemId, item])).values())
    .slice(0, MAX_PROMPT_ITEMS)
    .map((item) => ({
      ...item,
      description: item.description?.slice(0, MAX_PROMPT_DESCRIPTION_LENGTH) ?? item.description,
      contactRate: item.views > 0 ? Number(((item.contacts / item.views) * 100).toFixed(2)) : 0,
      favoriteRate: item.views > 0 ? Number(((item.favorites / item.views) * 100).toFixed(2)) : 0,
    }));

  return {
    ...input,
    sourceItemCount: input.items.length,
    analyzedItemCount: selected.length,
    items: selected,
  };
}

export function buildAdsAnalysisPrompt(input: AdsAnalysisInput): string {
  const compactInput = compactAdsAnalysisInput(input);

  return [
    "Ты — ведущий аналитик объявлений Avito для магазина одежды.",
    "Проанализируй только наши объявления и предложи конкретные улучшения на русском языке.",
    "Не выдумывай отсутствующие цены, описания, фотографии или свойства товара.",
    "Если данных для точной правки мало, предложи проверяемый следующий шаг и используй applyMode=manual.",
    "Логика воронки: мало просмотров — проблема охвата/обложки/заголовка/цены; просмотры и избранное без контактов — проблема оффера, доверия или цены; просмотры без избранного — проблема визуала или соответствия ожиданиям.",
    "Для заголовка или описания давай готовый proposedValue, только если исходных данных достаточно.",
    "Для новых изображений используй field=photos и applyMode=content_machine.",
    "Выбери не более 5 самых важных действий: сначала высокий приоритет и наибольший ожидаемый эффект.",
    "Пиши кратко: executiveSummary и opportunity до 2 предложений, diagnosis и expectedImpact до 1 предложения.",
    "Верни только JSON без markdown по схеме:",
    JSON.stringify({
      executiveSummary: "краткий итог",
      healthScore: 0,
      opportunity: "главная возможность роста",
      actions: [{
        id: "уникальный-id",
        itemId: "id объявления",
        title: "название объявления",
        priority: "high|medium|low",
        field: "title|description|photos|price|promotion|other",
        diagnosis: "что не так и на каких данных основан вывод",
        proposedValue: "готовая замена или null",
        expectedImpact: "ожидаемый эффект",
        applyMode: "autoload|content_machine|manual",
      }],
    }),
    "Данные:",
    JSON.stringify(compactInput),
  ].join("\n");
}
