import type { PlayerProfile } from "./protocol";

export type PresenceHandle = {
  setPlayers: (players: PlayerProfile[], selfId: string | null) => void;
  setCursor: (id: string, x: number, y: number) => void;
  destroy: () => void;
};

export function mountPresence(stage: HTMLElement): PresenceHandle {
  const layer = document.createElement("div");
  layer.className = "mp-cursors";
  layer.setAttribute("aria-hidden", "true");
  stage.append(layer);

  const cursors = new Map<string, HTMLElement>();
  let players = new Map<string, PlayerProfile>();
  let selfId: string | null = null;

  function ensure(id: string) {
    let el = cursors.get(id);
    if (el) return el;
    el = document.createElement("div");
    el.className = "mp-cursor";
    el.innerHTML = `<span class="mp-cursor__avatar"></span><span class="mp-cursor__name"></span>`;
    layer.append(el);
    cursors.set(id, el);
    paint(id);
    return el;
  }

  function paint(id: string) {
    const el = cursors.get(id);
    const profile = players.get(id);
    if (!el || !profile) return;
    el.style.setProperty("--mp-color", profile.color);
    const avatar = el.querySelector(".mp-cursor__avatar");
    const name = el.querySelector(".mp-cursor__name");
    if (avatar) avatar.textContent = profile.avatar;
    if (name) name.textContent = profile.name;
  }

  return {
    setPlayers(next, you) {
      selfId = you;
      players = new Map(next.map((p) => [p.id, p]));
      for (const id of [...cursors.keys()]) {
        if (!players.has(id) || id === selfId) {
          cursors.get(id)?.remove();
          cursors.delete(id);
        }
      }
      for (const profile of next) {
        if (profile.id === selfId) continue;
        ensure(profile.id);
        paint(profile.id);
      }
    },
    setCursor(id, x, y) {
      if (id === selfId) return;
      const el = ensure(id);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.add("is-on");
    },
    destroy() {
      layer.remove();
      cursors.clear();
    },
  };
}
