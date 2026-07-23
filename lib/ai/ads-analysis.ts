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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatRate(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function actionId(field: AdsAnalysisAction["field"], itemId: string): string {
  return `${field}-${itemId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
}

/**
 * Produces an evidence-based report even when the external AI gateway is unavailable.
 * It deliberately uses only fields returned by Avito and labels unprovable ideas as tests.
 */
export function createDataDrivenAdsReport(input: AdsAnalysisInput): AdsAnalysisReport {
  const compact = compactAdsAnalysisInput(input);
  const items = input.items;
  const medianViews = compact.accountMetrics.medianViews ?? 0;
  const contactRate = compact.accountMetrics.viewToContactRate;
  const favoriteRate = compact.accountMetrics.viewToFavoriteRate;
  const byViews = [...items].sort((a, b) => b.views - a.views);
  const byContacts = [...items].sort((a, b) => b.contacts - a.contacts || b.views - a.views);
  const topViewed = byViews[0];
  const topContact = byContacts[0];
  const favoriteNoContact = [...items]
    .filter((item) => item.favorites > 0 && item.contacts === 0)
    .sort((a, b) => b.favorites - a.favorites || b.views - a.views)[0];
  const promotionCandidate = [...items]
    .filter((item) => item.views >= medianViews && item.contacts > 0)
    .sort((a, b) => (b.contacts / Math.max(b.views, 1)) - (a.contacts / Math.max(a.views, 1)))[0];
  const lowReach = [...items]
    .filter((item) => item.views < medianViews)
    .sort((a, b) => a.views - b.views)[0];
  const weakInterest = [...items]
    .filter((item) => item.views >= medianViews && item.favorites === 0)
    .sort((a, b) => b.views - a.views)[0];
  const describedWeakConversion = [...items]
    .filter((item) => Boolean(item.description?.trim()) && item.views >= medianViews && item.contacts === 0)
    .sort((a, b) => b.views - a.views)[0];
  const topTenCount = Math.min(10, items.length);
  const topTenViews = byViews.slice(0, topTenCount).reduce((sum, item) => sum + item.views, 0);
  const topTenShare = rate(topTenViews, input.total.views);
  const actions: AdsAnalysisAction[] = [];

  if (topViewed) {
    actions.push({
      id: actionId("video", topViewed.itemId),
      itemId: topViewed.itemId,
      title: `${topViewed.title}: Flow-видео для усиления лидера`,
      priority: "high",
      field: "video",
      diagnosis: `Лидер по охвату: ${formatNumber(topViewed.views)} просмотров, ${formatNumber(topViewed.favorites)} добавлений в избранное и ${formatNumber(topViewed.contacts)} контактов за ${input.periodDays} дней. У позиции уже есть подтверждённый интерес, поэтому видео тестируется на тёплом спросе.`,
      proposedValue: `Flow, вертикальное видео 9:16, 8 секунд. Использовать исходные фото товара как строгий референс: не менять принт, цвет, крой, надписи и пропорции. 0–2 сек: плавный наезд камеры на товар целиком. 2–5 сек: макро-проезд по принту и фактуре ткани с мягким боковым светом. 5–7 сек: лёгкий поворот ракурса, товар остаётся неизменным. 7–8 сек: чистый финальный кадр с текстом «Посмотрите детали в объявлении». Без людей, лишнего реквизита и выдуманных элементов.`,
      expectedImpact: "Сравнить 7 дней до и после: долю избранного и контактов от просмотров. Оставить видео, если хотя бы одна конверсия вырастет на 15% без падения второй.",
      applyMode: "manual",
    });
  }

  if (promotionCandidate) {
    const candidateRate = rate(promotionCandidate.contacts, promotionCandidate.views);
    actions.push({
      id: actionId("promotion", promotionCandidate.itemId),
      itemId: promotionCandidate.itemId,
      title: `${promotionCandidate.title}: тест продвижения`,
      priority: "high",
      field: "promotion",
      diagnosis: `Карточка уже конвертирует трафик: ${formatNumber(promotionCandidate.contacts)} контактов из ${formatNumber(promotionCandidate.views)} просмотров (${formatRate(candidateRate)}), при медиане аккаунта ${formatNumber(medianViews)} просмотров. Это более безопасный кандидат на покупку охвата, чем карточки без контактов.`,
      proposedValue: "Запустить минимальный доступный пакет продвижения на 3 дня без одновременной смены цены, заголовка и обложки. Зафиксировать просмотры и контакты до запуска. Остановить тест, если после первых 100 дополнительных просмотров нет контактов или стоимость контакта превышает допустимую маржу.",
      expectedImpact: "Цель — масштабировать уже работающую конверсию; критерий успеха: прирост контактов пропорционально просмотрам без ухудшения view→contact более чем на 20%.",
      applyMode: "manual",
    });
  }

  if (favoriteNoContact) {
    const discountPercent = 7;
    const testedPrice = favoriteNoContact.price ? Math.round(favoriteNoContact.price * (1 - discountPercent / 100) / 10) * 10 : null;
    actions.push({
      id: actionId("price", favoriteNoContact.itemId),
      itemId: favoriteNoContact.itemId,
      title: `${favoriteNoContact.title}: проверить барьер покупки`,
      priority: "high",
      field: "price",
      diagnosis: `${formatNumber(favoriteNoContact.favorites)} добавлений в избранное и 0 контактов при ${formatNumber(favoriteNoContact.views)} просмотрах: интерес есть, но решение откладывают. Цена — гипотеза, а не доказанный диагноз.`,
      proposedValue: favoriteNoContact.price
        ? `A/B-тест на 7 дней: снизить цену с ${formatNumber(favoriteNoContact.price)} ₽ до ${formatNumber(testedPrice!)} ₽ (−${discountPercent}%), не меняя остальные элементы карточки. До теста проверить минимальную маржу.`
        : "Цена не получена API. Сначала зафиксировать текущую цену и допустимую маржу, затем провести 7-дневный тест −5–7% без других изменений.",
      expectedImpact: "Главная метрика — появление контактов; дополнительная — рост view→contact. Если контактов нет, вернуть цену и тестировать оффер/доверие.",
      applyMode: "manual",
    });
  }

  if (topContact) {
    actions.push({
      id: actionId("duplicate", topContact.itemId),
      itemId: topContact.itemId,
      title: `${topContact.title}: масштабировать подтверждённый спрос`,
      priority: "medium",
      field: "duplicate",
      diagnosis: `Один из лидеров по намерению: ${formatNumber(topContact.contacts)} контактов, ${formatNumber(topContact.favorites)} избранных и ${formatNumber(topContact.views)} просмотров. Это основание тестировать соседний спрос, а не делать идентичную копию.`,
      proposedValue: "Создать отдельное объявление только для реально существующего отличия: другой размер/цвет либо отдельный поисковый оффер. Новая карточка должна иметь другую обложку и заголовок под конкретный вариант, но те же достоверные характеристики. Не публиковать идентичный дубль.",
      expectedImpact: "За 7 дней сравнить просмотры и контакты нового варианта с исходным; сохранить вариант, если он даёт дополнительный спрос, а не просто перетягивает просмотры.",
      applyMode: "autoload",
    });
  }

  if (lowReach) {
    actions.push({
      id: actionId("title", lowReach.itemId),
      itemId: lowReach.itemId,
      title: `${lowReach.title}: тест охвата`,
      priority: "medium",
      field: "title",
      diagnosis: `${formatNumber(lowReach.views)} просмотров против медианы аккаунта ${formatNumber(medianViews)}. Контактов: ${formatNumber(lowReach.contacts)}, избранных: ${formatNumber(lowReach.favorites)}. Проблема находится до конверсии — карточке не хватает входящего трафика или клика.`,
      proposedValue: `Пересобрать заголовок по формуле «тип товара + бренд/стиль из текущего названия + ключевая отличительная характеристика, которая реально есть». Исходное название: «${lowReach.title}». Одновременно заголовок и обложку не менять: сначала 7 дней теста заголовка.`,
      expectedImpact: `Цель — поднять просмотры минимум до медианы аккаунта (${formatNumber(medianViews)}) за сопоставимые 7 дней.`,
      applyMode: "manual",
    });
  }

  if (weakInterest) {
    actions.push({
      id: actionId("photos", weakInterest.itemId),
      itemId: weakInterest.itemId,
      title: `${weakInterest.title}: усилить визуальный оффер`,
      priority: "medium",
      field: "photos",
      diagnosis: `${formatNumber(weakInterest.views)} просмотров (не ниже медианы ${formatNumber(medianViews)}), но 0 добавлений в избранное. Трафик приходит, однако карточка не создаёт желание сохранить товар.`,
      proposedValue: "План фотосерии: 1) чистая контрастная обложка с товаром целиком; 2) крупно принт/главная деталь; 3) фактура ткани и швы; 4) вид сзади; 5) реальные замеры с линейкой; 6) посадка или масштаб без искажения товара; 7) комплектность и состояние. Если эти кадры уже есть, менять порядок и тестировать новую обложку, а не добавлять дубликаты.",
      expectedImpact: "Сравнить 7 дней: целевая метрика — появление избранного и рост favorite rate минимум до средней по аккаунту.",
      applyMode: "content_machine",
    });
  }

  if (describedWeakConversion) {
    actions.push({
      id: actionId("description", describedWeakConversion.itemId),
      itemId: describedWeakConversion.itemId,
      title: `${describedWeakConversion.title}: переработать полученное описание`,
      priority: "medium",
      field: "description",
      diagnosis: `API подтвердил наличие описания. При ${formatNumber(describedWeakConversion.views)} просмотрах карточка получила 0 контактов; можно тестировать структуру оффера, не утверждая, что описание отсутствует.`,
      proposedValue: `Перестроить фактический текст без выдуманных свойств: первая строка — «${describedWeakConversion.title} — в наличии». Далее короткими блоками: состояние и особенности из текущего описания; точные замеры/размеры; условия примерки и доставки; призыв «Напишите — пришлю дополнительные замеры и помогу подобрать размер». Все характеристики сверить с исходным товаром.`,
      expectedImpact: "Цель теста на 7 дней — получить первый контакт либо приблизить view→contact к средней ставке аккаунта.",
      applyMode: "manual",
    });
  }

  actions.push({
    id: "assortment-account",
    itemId: "account",
    title: "Матрица похожих позиций по лидерам",
    priority: "medium",
    field: "assortment",
    diagnosis: topContact
      ? `Отталкиваться от лидера «${topContact.title}» (${formatNumber(topContact.contacts)} контактов), а не расширять ассортимент вслепую.`
      : "В текущем периоде нет контактов, поэтому расширение ассортимента пока остаётся гипотезой и требует проверки спроса.",
    proposedValue: "Собрать 3 соседних варианта вокруг лидирующей позиции: другой реально доступный цвет, соседний размер и близкий дизайн/стиль. Для каждого — отдельный поисковый заголовок и обложка. Публиковать по одному варианту каждые 2–3 дня, чтобы измерить вклад каждого.",
    expectedImpact: "Через 7 дней ранжировать новые позиции по просмотрам, избранному и контактам; закупать/масштабировать только варианты выше медианы аккаунта.",
    applyMode: "manual",
  });

  const portfolioInsights = [
    {
      title: "Конверсия аккаунта",
      finding: `${formatNumber(input.total.views)} просмотров дали ${formatNumber(input.total.favorites)} избранных (${formatRate(favoriteRate)}) и ${formatNumber(input.total.contacts)} контактов (${formatRate(contactRate)}) за ${input.periodDays} дней.`,
      recommendation: "Сначала улучшать карточки с просмотрами и без контактов; продвижение покупать только для объявлений с уже подтверждённой конверсией.",
    },
    {
      title: "Концентрация спроса",
      finding: `Топ-${topTenCount} объявлений собирают ${formatRate(topTenShare)} всех просмотров. Медиана — ${formatNumber(medianViews)} просмотров на объявление.`,
      recommendation: "Масштабировать признаки лидеров и отдельно перезапускать карточки существенно ниже медианы.",
    },
    {
      title: "Отложенный спрос",
      finding: `${formatNumber(compact.accountMetrics.favoritesWithoutContacts)} объявлений имеют избранное, но не имеют контактов.`,
      recommendation: "На этих карточках по одному тестировать цену, доверие и оффер; не смешивать несколько изменений в одном периоде.",
    },
    {
      title: "Нулевая конверсия после просмотра",
      finding: `${formatNumber(compact.accountMetrics.viewedWithoutContacts)} объявлений получили просмотры, но не получили контактов.`,
      recommendation: "Разделить их на карточки с избранным (барьер решения) и без избранного (визуал/соответствие ожиданиям).",
    },
    {
      title: "Качество контентных данных",
      finding: `API вернул описание для ${formatNumber(compact.accountMetrics.descriptionReceivedFromApi)} из ${formatNumber(items.length)} объявлений; для остальных наличие описания не определено.`,
      recommendation: "Не считать неизвестные описания пустыми. Оценивать и переписывать только текст, который фактически получен.",
    },
    {
      title: "Временная динамика",
      finding: `Отчёт использует один период ${input.dateFrom}—${input.dateTo}; фактического сравнения с предыдущими 7 днями в данных нет.`,
      recommendation: "Сохранить текущие ставки как базу и сравнить с последующими 7 днями после внедрения изменений.",
    },
  ];

  return {
    executiveSummary: `Проанализировано ${formatNumber(items.length)} из ${formatNumber(input.total.ads)} объявлений за ${input.periodDays} дней. Аккаунт получил ${formatNumber(input.total.views)} просмотров, ${formatNumber(input.total.favorites)} добавлений в избранное и ${formatNumber(input.total.contacts)} контактов. Главный резерв — точечно улучшать карточки с уже существующим интересом и масштабировать лидеров, не оплачивая трафик для объявлений без доказанной конверсии.`,
    opportunity: favoriteNoContact
      ? `Самый явный резерв — «${favoriteNoContact.title}»: ${formatNumber(favoriteNoContact.favorites)} избранных при 0 контактов. Нужен изолированный тест цены/оффера на 7 дней.`
      : topContact
        ? `Масштабировать «${topContact.title}», которое принесло ${formatNumber(topContact.contacts)} контактов, через Flow-видео, продвижение и отличающиеся ассортиментные варианты.`
        : "Сначала добиться первых контактов через последовательные тесты заголовков, обложек и оффера; затем подключать продвижение.",
    accountMetrics: [
      { label: "Просмотры", value: formatNumber(input.total.views), context: `${input.periodDays} дней · ${formatNumber(input.total.ads)} объявлений` },
      { label: "Контакты", value: formatNumber(input.total.contacts), context: `Конверсия из просмотра: ${formatRate(contactRate)}` },
      { label: "В избранном", value: formatNumber(input.total.favorites), context: `Доля от просмотров: ${formatRate(favoriteRate)}` },
      { label: "Медиана просмотров", value: formatNumber(medianViews), context: "Половина объявлений выше, половина ниже этого уровня" },
      { label: "Без контактов", value: formatNumber(compact.accountMetrics.viewedWithoutContacts), context: "Объявления с просмотрами, но без обращений" },
      { label: `Доля топ-${topTenCount}`, value: formatRate(topTenShare), context: "Доля всех просмотров, которую собирают лидеры" },
    ],
    portfolioInsights,
    actions: actions.slice(0, 12),
  };
}
