export const AVATARS = ["🦊", "🐸", "🐙", "🦄", "🐼", "🐧", "🐯", "👻", "🤖", "👾"] as const;

const NAME_KEY = "ultrapilled-mp-name";
const AVATAR_KEY = "ultrapilled-mp-avatar";

export type Identity = { name: string; avatar: string };

export function loadIdentity(): Identity {
  const name = localStorage.getItem(NAME_KEY)?.trim() || "";
  const avatar = localStorage.getItem(AVATAR_KEY) || AVATARS[0];
  return { name, avatar: AVATARS.includes(avatar as (typeof AVATARS)[number]) ? avatar : AVATARS[0] };
}

export function saveIdentity(identity: Identity) {
  localStorage.setItem(NAME_KEY, identity.name.trim().slice(0, 24));
  localStorage.setItem(AVATAR_KEY, identity.avatar);
}

/** Modal name + avatar picker. Resolves null if cancelled. */
export function promptIdentity(existing?: Identity, title = "Join"): Promise<Identity | null> {
  const prior = existing ?? loadIdentity();
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "mp-modal";
    root.innerHTML = `
      <form class="mp-modal__card" autocomplete="off">
        <h2 class="mp-modal__title">${title === "Host" ? "Host a session" : "Join a friend"}</h2>
        <p class="mp-modal__hint">Pick a name and avatar so your friend can see you.</p>
        <label class="mp-modal__field">
          <span>Name</span>
          <input type="text" name="name" maxlength="24" placeholder="Your name" value="${escapeAttr(prior.name)}" required />
        </label>
        <div class="mp-modal__avatars" role="radiogroup" aria-label="Avatar"></div>
        <div class="mp-modal__actions">
          <button type="button" class="pill" data-cancel>Cancel</button>
          <button type="submit" class="pill is-on">${title === "Host" ? "Host" : "Join"}</button>
        </div>
      </form>
    `;
    const form = root.querySelector("form")!;
    const avatars = root.querySelector(".mp-modal__avatars")!;
    let picked = prior.avatar;
    for (const emoji of AVATARS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `mp-modal__avatar${emoji === picked ? " is-on" : ""}`;
      btn.textContent = emoji;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(emoji === picked));
      btn.addEventListener("click", () => {
        picked = emoji;
        for (const el of avatars.querySelectorAll(".mp-modal__avatar")) {
          const on = el === btn;
          el.classList.toggle("is-on", on);
          el.setAttribute("aria-checked", String(on));
        }
      });
      avatars.append(btn);
    }

    const finish = (value: Identity | null) => {
      root.remove();
      resolve(value);
    };

    form.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    root.addEventListener("click", (event) => {
      if (event.target === root) finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[name="name"]');
      const name = input?.value.trim() || "Player";
      const identity = { name, avatar: picked };
      saveIdentity(identity);
      finish(identity);
    });

    document.body.append(root);
    form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  });
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
