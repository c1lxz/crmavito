export const MOSCOW_DAY_CHANGED_EVENT = "crm:moscow-day-changed";

export interface MoscowDayChangedDetail {
  previousDay: string;
  currentDay: string;
}
