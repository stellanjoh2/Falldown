import gsap from "gsap";
import { playRemove, playTransition } from "./uiSounds";

const ABOUT_TEXT =
  "Hi, I'm Stellan Johansson, a creative director and brand designer with 20+ years across games, 3D, motion, UI and visual identity — shipping titles at studios, running agencies, and shaping platforms used by millions of creators. Ultrapilled is one of my sideprojects.";

const ABOUT_LINKS = [
  { text: "LinkedIn", href: "https://www.linkedin.com/in/stellanj/" },
  {
    text: "MobyGames",
    href: "https://www.mobygames.com/person/289121/stellan-johansson/credits/",
  },
  { text: "X", href: "https://x.com/johstell" },
  { text: "Orby", href: "https://orby.studio/" },
] as const;

let modalRoot: HTMLElement | null = null;
let closing = false;
let onKey: ((event: KeyboardEvent) => void) | null = null;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bodyHtml(): string {
  const links = ABOUT_LINKS.map(
    (link) =>
      `<a href="${link.href}" target="_blank" rel="noopener noreferrer">${link.text}</a>`,
  ).join(" · ");
  return `
    <p class="about-modal__bio">${ABOUT_TEXT}</p>
    <p class="about-modal__links">${links}</p>
  `;
}

export function isAboutOpen(): boolean {
  return Boolean(modalRoot);
}

export function closeAbout(): void {
  if (!modalRoot || closing) return;
  closing = true;
  const root = modalRoot;
  const scrim = root.querySelector<HTMLElement>(".settings-modal__scrim");
  const sheet = root.querySelector<HTMLElement>(".settings-modal__sheet");
  if (onKey) window.removeEventListener("keydown", onKey);
  onKey = null;
  playRemove();

  const done = () => {
    root.remove();
    modalRoot = null;
    closing = false;
  };

  if (reducedMotion() || !scrim || !sheet) {
    done();
    return;
  }

  const tl = gsap.timeline({ onComplete: done });
  tl.to(sheet, { x: 48, autoAlpha: 0, duration: 0.28, ease: "power2.in" }, 0);
  tl.to(scrim, { autoAlpha: 0, duration: 0.28, ease: "power1.in" }, 0);
}

export function openAbout(): void {
  if (modalRoot || closing) return;

  const root = document.createElement("div");
  root.className = "settings-modal about-modal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "about-modal-title");
  root.innerHTML = `
    <div class="settings-modal__scrim" data-about-close></div>
    <div class="settings-modal__sheet">
      <header class="settings-modal__head">
        <h2 class="settings-modal__title" id="about-modal-title">About me</h2>
      </header>
      <div class="settings-modal__body about-modal__body">${bodyHtml()}</div>
      <footer class="settings-modal__foot">
        <button type="button" class="pill is-on settings-modal__done" data-about-close data-tip="Close">OK COOL I GOT IT</button>
      </footer>
    </div>
  `;

  const scrim = root.querySelector<HTMLElement>(".settings-modal__scrim")!;
  const sheet = root.querySelector<HTMLElement>(".settings-modal__sheet")!;
  const doneBtn = root.querySelector<HTMLButtonElement>(".settings-modal__done")!;

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-about-close]")) closeAbout();
  });

  onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAbout();
    }
  };
  window.addEventListener("keydown", onKey);

  document.body.append(root);
  modalRoot = root;
  playTransition(true);
  doneBtn.focus({ preventScroll: true });

  gsap.set(scrim, { autoAlpha: 0 });
  gsap.set(sheet, { autoAlpha: 0, x: 56 });

  if (reducedMotion()) {
    gsap.set([scrim, sheet], { clearProps: "all", autoAlpha: 1, x: 0 });
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.to(scrim, { autoAlpha: 1, duration: 0.32 }, 0);
  tl.to(sheet, { autoAlpha: 1, x: 0, duration: 0.42 }, 0.04);
}
