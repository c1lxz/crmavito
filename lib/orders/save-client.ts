export function completeOrderSave<T>(
  savedOrder: T,
  onSaved: ((order: T) => void) | undefined,
  refresh: () => void,
  onRefreshError: (error: unknown) => void = (error) =>
    console.warn("Order saved, but the page refresh failed", error),
) {
  if (onSaved) {
    onSaved(savedOrder);
    return;
  }

  try {
    refresh();
  } catch (error) {
    onRefreshError(error);
  }
}
