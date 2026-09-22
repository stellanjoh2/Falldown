type FontDataLike = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
};

let catalog: FontDataLike[] = [];
const loaded = new Set<string>();

export function listedFamilies(): string[] {
  return [...new Set(catalog.map((font) => font.family))].sort((a, b) => a.localeCompare(b));
}

export async function queryLocalCatalog(): Promise<string[]> {
  const query = (window as Window & { queryLocalFonts?: () => Promise<FontDataLike[]> }).queryLocalFonts;
  if (!query) throw new Error("unsupported");
  catalog = await query();
  return listedFamilies();
}

function weightFromStyle(style: string): string {
  const s = style.toLowerCase();
  if (/(extra|ultra)?\s*black|heavy/.test(s)) return "900";
  if (/(extra|ultra)\s*bold/.test(s)) return "800";
  if (/\bbold\b/.test(s)) return "700";
  if (/semi\s*bold|demi\s*bold/.test(s)) return "600";
  if (/\bmedium\b/.test(s)) return "500";
  if (/\blight\b/.test(s)) return "300";
  if (/extra\s*light|ultra\s*light|thin|hairline/.test(s)) return "100";
  return "400";
}

async function addFace(family: string, source: BufferSource | string, weight: string, italic: boolean) {
  const face = new FontFace(family, source, {
    weight,
    style: italic ? "italic" : "normal",
    display: "swap",
  });
  await face.load();
  document.fonts.add(face);
}

export async function activateFamily(family: string): Promise<void> {
  const key = family.trim().toLowerCase();
  if (!key || loaded.has(key)) return;

  const matches = catalog.filter((font) => font.family === family);
  if (matches.length) {
    await Promise.all(
      matches.map(async (font) => {
        try {
          const buffer = await (await font.blob()).arrayBuffer();
          await addFace(family, buffer, weightFromStyle(font.style), /italic|oblique/i.test(font.style));
        } catch {
          /* skip unreadable faces */
        }
      }),
    );
    loaded.add(key);
    return;
  }

  for (const localName of [family, family.replaceAll(" ", "")]) {
    try {
      await addFace(family, `local("${localName}")`, "700", false);
      try {
        await addFace(family, `local("${localName}")`, "400", false);
      } catch {
        /* bold-only is enough for chips */
      }
      loaded.add(key);
      return;
    } catch {
      /* try next local name */
    }
  }
}
