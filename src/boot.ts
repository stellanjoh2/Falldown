import "./mobile-gate.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

const mobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

if (mobile) {
  app.innerHTML = `
    <main class="mobile-gate">
      <img class="mobile-gate__art" src="/share.jpg" alt="" />
      <div class="mobile-gate__copy">
        <p class="mobile-gate__mark">Ultrapilled</p>
        <h1>This is not currently available from mobile devices.</h1>
      </div>
    </main>
  `;
} else {
  await import("./main.ts");
}
