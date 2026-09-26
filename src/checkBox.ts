const MARK =
  '<svg class="check__mark" fill="none" viewBox="0 0 15 14" width="15" height="14" aria-hidden="true"><path d="M2 8.36364L6.23077 12L13 2"></path></svg>';

/** Circular splash checkbox control (Uiverse Shoh2008/big-deer-80, themed). */
export function checkInput(attrs: string): string {
  const trimmed = attrs.trim();
  return `<span class="check__box"><input type="checkbox"${trimmed ? ` ${trimmed}` : ""} /><span class="check__splash" aria-hidden="true"></span>${MARK}</span>`;
}

export function wrapCheckInput(input: HTMLInputElement): void {
  if (input.closest(".check__box")) return;
  const box = document.createElement("span");
  box.className = "check__box";
  input.replaceWith(box);
  box.append(input);
  const splash = document.createElement("span");
  splash.className = "check__splash";
  splash.setAttribute("aria-hidden", "true");
  box.append(splash);
  box.insertAdjacentHTML("beforeend", MARK);
}
