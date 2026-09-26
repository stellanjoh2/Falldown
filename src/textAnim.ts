import gsap from "gsap";
import type { TextSlot } from "./types";

export const DEFAULT_TEXT_ANIM_SPEED = 50;

type Running = { sig: string; kill: () => void };

const running = new WeakMap<HTMLElement, Running>();

export function textAnimSpeedOf(speed: number | undefined): number {
  const value = speed ?? DEFAULT_TEXT_ANIM_SPEED;
  if (!Number.isFinite(value)) return DEFAULT_TEXT_ANIM_SPEED;
  return Math.max(1, Math.min(100, Math.round(value)));
}

/** Words for cycle; empty text becomes a single space so measure stays valid. */
export function textAnimWords(text: string): string[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : [" "];
}

/** Cycle locks chip width to the longest word so swaps never resize physics. */
export function usesCycleMeasure(slot: Pick<TextSlot, "textAnim">): boolean {
  return Boolean(slot.textAnim);
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pace(speed: number | undefined) {
  const s = textAnimSpeedOf(speed);
  const scale = DEFAULT_TEXT_ANIM_SPEED / s;
  return {
    letter: 0.4 * scale,
    stagger: 0.045 * scale,
    pause: 0.85 * scale,
  };
}

/** How far letters travel so they clear the pill edge (clip happens on the chip). */
function travelPx(label: HTMLElement, fontSize: number): number {
  const host = label.parentElement;
  const pillH = host?.clientHeight ?? 0;
  if (pillH > 0) return Math.ceil(pillH / 2 + fontSize * 0.15);
  return Math.ceil(fontSize * 1.2);
}

function splitChars(word: string): HTMLElement[] {
  return [...word].map((ch) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = ch === " " ? "\u00a0" : ch;
    return span;
  });
}

function clearInline(label: HTMLElement) {
  gsap.killTweensOf(label.querySelectorAll(".char, .text-anim-word, .text-anim-clip"));
  label.classList.remove("is-text-anim");
  label.parentElement?.classList.remove("is-text-anim-host");
  label.replaceChildren();
}

export function stopTextAnim(label: HTMLElement) {
  const prev = running.get(label);
  if (prev) {
    prev.kill();
    running.delete(label);
  } else {
    clearInline(label);
  }
}

export function stopTextAnimIn(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(".chip-label").forEach(stopTextAnim);
}

/** Builds split markup and starts a looping word-cycle. Returns false if caller should use plain text. */
export function applyTextAnim(label: HTMLElement, slot: TextSlot): boolean {
  if (!slot.textAnim) {
    stopTextAnim(label);
    return false;
  }

  const speed = textAnimSpeedOf(slot.textAnimSpeed);
  const travel = travelPx(label, slot.fontSize);
  const sig = `cycle|${speed}|${slot.text}|${travel}`;
  const prev = running.get(label);
  if (prev?.sig === sig) return true;

  stopTextAnim(label);

  const host = label.parentElement;
  host?.classList.add("is-text-anim-host");

  if (reducedMotion()) {
    label.classList.add("is-text-anim");
    label.textContent = textAnimWords(slot.text)[0] ?? slot.text;
    running.set(label, {
      sig,
      kill: () => {
        label.classList.remove("is-text-anim");
        host?.classList.remove("is-text-anim-host");
        label.replaceChildren();
      },
    });
    return true;
  }

  label.classList.add("is-text-anim");
  const timing = pace(speed);
  const clip = document.createElement("span");
  clip.className = "text-anim-clip";

  const words = textAnimWords(slot.text);
  for (const word of words) {
    const row = document.createElement("span");
    row.className = "text-anim-word";
    row.append(...splitChars(word));
    clip.append(row);
  }
  label.replaceChildren(clip);

  const rows = [...clip.querySelectorAll<HTMLElement>(".text-anim-word")];
  let maxW = 0;
  for (const row of rows) {
    row.style.position = "relative";
    maxW = Math.max(maxW, row.getBoundingClientRect().width);
    row.style.position = "";
  }
  if (maxW > 0) clip.style.width = `${Math.ceil(maxW)}px`;

  gsap.set(rows, { autoAlpha: 0 });
  const tl = gsap.timeline({ repeat: -1 });
  for (const row of rows) {
    const chars = row.querySelectorAll<HTMLElement>(".char");
    tl.set(row, { autoAlpha: 1 });
    tl.fromTo(
      chars,
      { y: travel, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: timing.letter, stagger: timing.stagger, ease: "power2.out" },
    );
    tl.to(chars, {
      y: -travel,
      autoAlpha: 0,
      duration: timing.letter,
      stagger: timing.stagger,
      ease: "power2.in",
      delay: timing.pause,
    });
    tl.set(row, { autoAlpha: 0 });
  }

  running.set(label, {
    sig,
    kill: () => {
      tl.kill();
      clearInline(label);
    },
  });
  return true;
}
