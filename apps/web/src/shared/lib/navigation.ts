/** A full page load, so nothing from the previous page survives in memory. */
export function loadPage(url: string): void {
  window.location.assign(url);
}
