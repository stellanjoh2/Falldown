export type EmojiItem = {
  char: string;
  name: string;
  tags: string;
};

export const FEATURED_EMOJI: EmojiItem[] = [
  { char: "😂", name: "Joy", tags: "laugh lol crying funny" },
  { char: "🔥", name: "Fire", tags: "lit hot flame" },
  { char: "✨", name: "Sparkles", tags: "shine magic stars" },
  { char: "🎉", name: "Party", tags: "celebrate confetti popper" },
  { char: "💀", name: "Skull", tags: "dead bones funny" },
  { char: "❤️", name: "Heart", tags: "love red" },
  { char: "🚀", name: "Rocket", tags: "space launch" },
  { char: "😎", name: "Cool", tags: "sunglasses smug fun" },
];

export const EMOJI_CATALOG: EmojiItem[] = [
  ...FEATURED_EMOJI,
  { char: "😀", name: "Grin", tags: "smile happy" },
  { char: "😃", name: "Smile", tags: "happy open" },
  { char: "😄", name: "Beaming", tags: "happy grin" },
  { char: "😁", name: "Beaming teeth", tags: "grin" },
  { char: "😆", name: "Squint laugh", tags: "lol" },
  { char: "🤣", name: "ROFL", tags: "laugh rolling" },
  { char: "😊", name: "Blush", tags: "smile shy" },
  { char: "😇", name: "Halo", tags: "angel innocent" },
  { char: "😉", name: "Wink", tags: "flirt" },
  { char: "😍", name: "Heart eyes", tags: "love crush" },
  { char: "🥰", name: "Smiling hearts", tags: "love" },
  { char: "😘", name: "Kiss", tags: "love" },
  { char: "😋", name: "Yum", tags: "tongue tasty" },
  { char: "😜", name: "Wink tongue", tags: "playful" },
  { char: "🤪", name: "Zany", tags: "goofy wild" },
  { char: "🤨", name: "Raised brow", tags: "skeptic hmm" },
  { char: "😐", name: "Neutral", tags: "meh" },
  { char: "😑", name: "Expressionless", tags: "blank" },
  { char: "😶", name: "No mouth", tags: "silent" },
  { char: "😏", name: "Smirk", tags: "smug" },
  { char: "😒", name: "Unamused", tags: "ugh" },
  { char: "🙄", name: "Eye roll", tags: "whatever" },
  { char: "😔", name: "Pensive", tags: "sad" },
  { char: "😢", name: "Cry", tags: "sad tear" },
  { char: "😭", name: "Sob", tags: "cry loud" },
  { char: "😤", name: "Huff", tags: "steam angry" },
  { char: "😡", name: "Pout", tags: "mad red" },
  { char: "🤬", name: "Swearing", tags: "symbols angry" },
  { char: "🤯", name: "Mind blown", tags: "explode shock" },
  { char: "😳", name: "Flushed", tags: "oops" },
  { char: "🥵", name: "Hot face", tags: "heat" },
  { char: "🥶", name: "Cold face", tags: "freeze" },
  { char: "😱", name: "Scream", tags: "fear shock" },
  { char: "🤗", name: "Hug", tags: "hands" },
  { char: "🤔", name: "Think", tags: "hmm" },
  { char: "🫡", name: "Salute", tags: "yes sir" },
  { char: "🤫", name: "Shush", tags: "quiet secret" },
  { char: "🫠", name: "Melt", tags: "dissolve" },
  { char: "😴", name: "Sleep", tags: "zzz tired" },
  { char: "🤤", name: "Drool", tags: "hungry" },
  { char: "🤮", name: "Puke", tags: "sick" },
  { char: "🤧", name: "Sneeze", tags: "sick" },
  { char: "🤡", name: "Clown", tags: "joke" },
  { char: "👻", name: "Ghost", tags: "boo spooky" },
  { char: "👽", name: "Alien", tags: "ufo" },
  { char: "🤖", name: "Robot", tags: "bot" },
  { char: "💩", name: "Poop", tags: "pile" },
  { char: "🎃", name: "Pumpkin", tags: "halloween" },
  { char: "😺", name: "Cat smile", tags: "kitty" },
  { char: "😹", name: "Cat joy", tags: "laugh kitty" },
  { char: "😻", name: "Cat hearts", tags: "love kitty" },
  { char: "🙈", name: "See no evil", tags: "monkey" },
  { char: "🙉", name: "Hear no evil", tags: "monkey" },
  { char: "🙊", name: "Speak no evil", tags: "monkey" },
  { char: "💋", name: "Kiss mark", tags: "lips" },
  { char: "💯", name: "Hundred", tags: "score keep" },
  { char: "💥", name: "Boom", tags: "explode" },
  { char: "💫", name: "Dizzy", tags: "star" },
  { char: "⭐", name: "Star", tags: "favorite" },
  { char: "🌟", name: "Glow star", tags: "shine" },
  { char: "⚡", name: "Zap", tags: "electric lightning" },
  { char: "☀️", name: "Sun", tags: "weather" },
  { char: "🌙", name: "Moon", tags: "night" },
  { char: "🌈", name: "Rainbow", tags: "pride color" },
  { char: "☁️", name: "Cloud", tags: "weather" },
  { char: "❄️", name: "Snowflake", tags: "cold winter" },
  { char: "💧", name: "Droplet", tags: "water" },
  { char: "🌊", name: "Wave", tags: "ocean" },
  { char: "🎵", name: "Note", tags: "music" },
  { char: "🎶", name: "Notes", tags: "music" },
  { char: "🎧", name: "Headphones", tags: "music dj" },
  { char: "🎤", name: "Mic", tags: "sing karaoke" },
  { char: "🎸", name: "Guitar", tags: "music rock" },
  { char: "🎹", name: "Keys", tags: "piano music" },
  { char: "🥁", name: "Drum", tags: "music" },
  { char: "💿", name: "Disc", tags: "cd vinyl" },
  { char: "🎮", name: "Gamepad", tags: "game play" },
  { char: "🕹️", name: "Joystick", tags: "arcade" },
  { char: "🎲", name: "Dice", tags: "game random" },
  { char: "🎯", name: "Bullseye", tags: "target" },
  { char: "🏆", name: "Trophy", tags: "win" },
  { char: "🥇", name: "Gold", tags: "medal win" },
  { char: "🎁", name: "Gift", tags: "present" },
  { char: "🎈", name: "Balloon", tags: "party" },
  { char: "🎊", name: "Confetti", tags: "party" },
  { char: "🪩", name: "Disco", tags: "ball party" },
  { char: "🪄", name: "Wand", tags: "magic" },
  { char: "🍕", name: "Pizza", tags: "food" },
  { char: "🍔", name: "Burger", tags: "food" },
  { char: "🍟", name: "Fries", tags: "food" },
  { char: "🌮", name: "Taco", tags: "food" },
  { char: "🍣", name: "Sushi", tags: "food" },
  { char: "🍜", name: "Ramen", tags: "food" },
  { char: "🍩", name: "Donut", tags: "food sweet" },
  { char: "🍪", name: "Cookie", tags: "food sweet" },
  { char: "🍰", name: "Cake", tags: "dessert" },
  { char: "🍫", name: "Chocolate", tags: "sweet" },
  { char: "🍿", name: "Popcorn", tags: "movie" },
  { char: "🍺", name: "Beer", tags: "drink" },
  { char: "🍻", name: "Cheers", tags: "beer drink" },
  { char: "🍷", name: "Wine", tags: "drink" },
  { char: "🍸", name: "Cocktail", tags: "drink" },
  { char: "🧋", name: "Boba", tags: "tea drink" },
  { char: "☕", name: "Coffee", tags: "drink cafe" },
  { char: "🐶", name: "Dog", tags: "animal pet" },
  { char: "🐱", name: "Cat", tags: "animal pet" },
  { char: "🐭", name: "Mouse", tags: "animal" },
  { char: "🐹", name: "Hamster", tags: "animal" },
  { char: "🐰", name: "Bunny", tags: "animal rabbit" },
  { char: "🦊", name: "Fox", tags: "animal" },
  { char: "🐻", name: "Bear", tags: "animal" },
  { char: "🐼", name: "Panda", tags: "animal" },
  { char: "🐨", name: "Koala", tags: "animal" },
  { char: "🐯", name: "Tiger", tags: "animal" },
  { char: "🦁", name: "Lion", tags: "animal" },
  { char: "🐮", name: "Cow", tags: "animal" },
  { char: "🐷", name: "Pig", tags: "animal" },
  { char: "🐸", name: "Frog", tags: "animal" },
  { char: "🐵", name: "Monkey", tags: "animal" },
  { char: "🐔", name: "Chicken", tags: "animal" },
  { char: "🦄", name: "Unicorn", tags: "magic horse" },
  { char: "🐝", name: "Bee", tags: "insect" },
  { char: "🦋", name: "Butterfly", tags: "insect" },
  { char: "🌸", name: "Cherry blossom", tags: "flower" },
  { char: "🌺", name: "Hibiscus", tags: "flower" },
  { char: "🌻", name: "Sunflower", tags: "flower" },
  { char: "🍀", name: "Clover", tags: "luck four" },
  { char: "🌹", name: "Rose", tags: "flower love" },
  { char: "🪐", name: "Planet", tags: "saturn space" },
  { char: "🌍", name: "Earth", tags: "globe world" },
  { char: "👾", name: "Invader", tags: "game alien" },
  { char: "💀", name: "Skull", tags: "dead bones" },
  { char: "👀", name: "Eyes", tags: "look stare" },
  { char: "👁️", name: "Eye", tags: "look" },
  { char: "🧠", name: "Brain", tags: "smart" },
  { char: "🫶", name: "Heart hands", tags: "love" },
  { char: "👍", name: "Thumbs up", tags: "ok yes" },
  { char: "👎", name: "Thumbs down", tags: "no" },
  { char: "👏", name: "Clap", tags: "applause" },
  { char: "🙌", name: "Raise hands", tags: "yes praise" },
  { char: "🤝", name: "Handshake", tags: "deal" },
  { char: "✌️", name: "Peace", tags: "two" },
  { char: "🤘", name: "Horns", tags: "rock metal" },
  { char: "🤙", name: "Call me", tags: "shaka" },
  { char: "👋", name: "Wave", tags: "hello hi" },
  { char: "💪", name: "Flex", tags: "strong gym" },
  { char: "🙏", name: "Folded hands", tags: "please thanks pray" },
  { char: "💅", name: "Nails", tags: "care" },
  { char: "👑", name: "Crown", tags: "king queen" },
  { char: "💎", name: "Gem", tags: "diamond" },
  { char: "💰", name: "Money bag", tags: "cash" },
  { char: "💸", name: "Money fly", tags: "cash" },
  { char: "📈", name: "Chart up", tags: "stocks" },
  { char: "💡", name: "Bulb", tags: "idea" },
  { char: "💻", name: "Laptop", tags: "computer" },
  { char: "📱", name: "Phone", tags: "mobile" },
  { char: "⏰", name: "Alarm", tags: "time" },
  { char: "💣", name: "Bomb", tags: "explode" },
  { char: "🧨", name: "Firecracker", tags: "boom" },
  { char: "🕶️", name: "Shades", tags: "cool glasses" },
  { char: "🪄", name: "Wand", tags: "magic" },
  { char: "🧿", name: "Nazar", tags: "evil eye" },
  { char: "🌀", name: "Cyclone", tags: "swirl hypnotic" },
  { char: "🪩", name: "Mirror ball", tags: "disco" },
  { char: "🖤", name: "Black heart", tags: "love" },
  { char: "💖", name: "Sparkle heart", tags: "love" },
  { char: "💗", name: "Growing heart", tags: "love" },
  { char: "💙", name: "Blue heart", tags: "love" },
  { char: "💚", name: "Green heart", tags: "love" },
  { char: "💛", name: "Yellow heart", tags: "love" },
  { char: "💜", name: "Purple heart", tags: "love" },
  { char: "🤍", name: "White heart", tags: "love" },
  { char: "💔", name: "Broken heart", tags: "sad" },
  { char: "💘", name: "Heart arrow", tags: "love cupid" },
  { char: "✅", name: "Check", tags: "done yes" },
  { char: "❌", name: "Cross", tags: "no x" },
  { char: "⚠️", name: "Warning", tags: "alert" },
  { char: "🚫", name: "Prohibited", tags: "no" },
  { char: "➡️", name: "Arrow", tags: "right" },
  { char: "⬇️", name: "Down", tags: "arrow fall" },
];

export function searchEmoji(query: string): EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return EMOJI_CATALOG.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.tags.includes(q) ||
      item.char === query.trim(),
  ).slice(0, 32);
}

export const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

type EmojiBox = { width: number; height: number };
const emojiBoxes = new Map<string, EmojiBox>();
const emojiCanvas = document.createElement("canvas");
const emojiCtx = emojiCanvas.getContext("2d", { willReadFrequently: true });

export function measureEmojiBox(char: string, size: number): EmojiBox {
  const key = `${char}:${Math.round(size)}`;
  const hit = emojiBoxes.get(key);
  if (hit) return hit;

  const fallback = {
    width: Math.max(8, Math.round(size * 0.7)),
    height: Math.max(8, Math.round(size * 0.7)),
  };
  if (!emojiCtx) {
    emojiBoxes.set(key, fallback);
    return fallback;
  }

  const dim = Math.max(32, Math.ceil(size * 2));
  emojiCanvas.width = dim;
  emojiCanvas.height = dim;
  emojiCtx.clearRect(0, 0, dim, dim);
  emojiCtx.font = `${size}px ${EMOJI_FONT}`;
  emojiCtx.textAlign = "center";
  emojiCtx.textBaseline = "middle";
  emojiCtx.fillText(char, dim / 2, dim / 2);

  const { data, width: w, height: h } = emojiCtx.getImageData(0, 0, dim, dim);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 20) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    emojiBoxes.set(key, fallback);
    return fallback;
  }

  const pad = 2;
  const box = {
    width: Math.max(8, maxX - minX + 1 + pad * 2),
    height: Math.max(8, maxY - minY + 1 + pad * 2),
  };
  emojiBoxes.set(key, box);
  return box;
}
