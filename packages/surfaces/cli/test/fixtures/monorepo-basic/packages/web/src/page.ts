import { formatTitle } from "../../lib/src/index";

export function renderPage(title: string): string {
  return `<h1>${formatTitle(title)}</h1>`;
}
