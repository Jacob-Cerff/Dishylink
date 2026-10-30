export type AccountSort = "name-asc" | "name-desc";
const STORAGE_KEY = "dishylink-account-sort";
export function readAccountSort(): AccountSort {
  try {
    return localStorage.getItem(STORAGE_KEY) === "name-desc" ? "name-desc" : "name-asc";
  } catch {
    return "name-asc";
  }
}
export function writeAccountSort(order: AccountSort): void {
  try {
    localStorage.setItem(STORAGE_KEY, order);
  } catch {
    /* Keep the current window usable if preferences cannot be saved. */
  }
}
/** Sort a copy: presentation must not change session discovery/preferred-credential order. */
export function sortByDisplayName<T>(
  items: readonly T[],
  name: (item: T) => string,
  id: (item: T) => string,
  order: AccountSort,
  locale: string,
): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...items].sort((left, right) => {
    const leftId = id(left),
      rightId = id(right);
    const comparison =
      collator.compare(name(left), name(right)) ||
      collator.compare(leftId, rightId) ||
      (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
    return order === "name-desc" ? -comparison : comparison;
  });
}
