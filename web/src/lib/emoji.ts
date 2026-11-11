/** Compact built-in emoji set: [emoji, shortcode, extra search terms]. */
export type EmojiEntry = [string, string, string?];

export const EMOJI_CATEGORIES: Array<{ name: string; emojis: EmojiEntry[] }> = [
  {
    name: 'Smileys',
    emojis: [
      ['😀', 'grinning', 'lachen'], ['😃', 'smiley'], ['😄', 'smile', 'lächeln'], ['😁', 'grin'], ['😆', 'laughing'], ['😅', 'sweat_smile'],
      ['🤣', 'rofl'], ['😂', 'joy', 'tränen lachen'], ['🙂', 'slight_smile'], ['🙃', 'upside_down'], ['😉', 'wink', 'zwinkern'], ['😊', 'blush'],
      ['😇', 'innocent', 'engel'], ['🥰', 'smiling_face_with_hearts', 'verliebt'], ['😍', 'heart_eyes'], ['🤩', 'star_struck'], ['😘', 'kissing_heart', 'kuss'],
      ['😋', 'yum', 'lecker'], ['😛', 'stuck_out_tongue'], ['😜', 'stuck_out_tongue_winking_eye'], ['🤪', 'zany_face', 'verrückt'], ['🤨', 'raised_eyebrow'],
      ['🧐', 'monocle'], ['🤓', 'nerd'], ['😎', 'sunglasses', 'cool'], ['🥳', 'partying_face', 'party'], ['😏', 'smirk'], ['😒', 'unamused'],
      ['😞', 'disappointed', 'enttäuscht'], ['😔', 'pensive'], ['😟', 'worried'], ['😕', 'confused'], ['🙁', 'slight_frown'], ['😣', 'persevere'],
      ['😫', 'tired_face', 'müde'], ['😩', 'weary'], ['🥺', 'pleading_face', 'bitte'], ['😢', 'cry', 'weinen'], ['😭', 'sob'], ['😤', 'triumph'],
      ['😠', 'angry', 'wütend'], ['😡', 'rage'], ['🤬', 'cursing'], ['🤯', 'exploding_head', 'mind blown'], ['😳', 'flushed'], ['🥵', 'hot_face', 'heiß'],
      ['🥶', 'cold_face', 'kalt'], ['😱', 'scream', 'schock'], ['😨', 'fearful'], ['🤗', 'hugging', 'umarmung'], ['🤔', 'thinking', 'denken'], ['🤭', 'hand_over_mouth'],
      ['🤫', 'shushing'], ['🙄', 'rolling_eyes', 'augenrollen'], ['😬', 'grimacing'], ['🤥', 'lying_face'], ['😴', 'sleeping', 'schlafen'], ['🤤', 'drooling'],
      ['😷', 'mask'], ['🤒', 'thermometer_face', 'krank'], ['🤢', 'nauseated'], ['🤮', 'vomiting'], ['💀', 'skull', 'tot'], ['👻', 'ghost', 'geist'],
      ['👽', 'alien'], ['🤖', 'robot', 'roboter'], ['💩', 'poop'], ['🤡', 'clown'], ['😺', 'smiley_cat', 'katze'], ['🙈', 'see_no_evil', 'affe'],
    ],
  },
  {
    name: 'Gesten',
    emojis: [
      ['👍', 'thumbsup', '+1 daumen hoch'], ['👎', 'thumbsdown', '-1 daumen runter'], ['👌', 'ok_hand'], ['✌️', 'v', 'peace'], ['🤞', 'fingers_crossed', 'daumen drücken'],
      ['🤟', 'love_you_gesture'], ['🤘', 'metal'], ['🤙', 'call_me'], ['👈', 'point_left'], ['👉', 'point_right'], ['👆', 'point_up'], ['👇', 'point_down'],
      ['☝️', 'point_up_2'], ['✋', 'raised_hand'], ['👋', 'wave', 'winken hallo'], ['🤚', 'raised_back_of_hand'], ['🖖', 'vulcan'], ['👏', 'clap', 'klatschen'],
      ['🙌', 'raised_hands', 'hurra'], ['👐', 'open_hands'], ['🤲', 'palms_up'], ['🤝', 'handshake', 'deal'], ['🙏', 'pray', 'danke bitte'], ['💪', 'muscle', 'stark'],
      ['🫡', 'saluting_face'], ['🫶', 'heart_hands'], ['👀', 'eyes', 'augen'], ['🧠', 'brain', 'gehirn'], ['🫠', 'melting_face'], ['✍️', 'writing_hand'],
    ],
  },
  {
    name: 'Herzen',
    emojis: [
      ['❤️', 'heart', 'herz liebe'], ['🧡', 'orange_heart'], ['💛', 'yellow_heart'], ['💚', 'green_heart'], ['💙', 'blue_heart'], ['💜', 'purple_heart'],
      ['🖤', 'black_heart'], ['🤍', 'white_heart'], ['🤎', 'brown_heart'], ['💔', 'broken_heart'], ['❣️', 'heart_exclamation'], ['💕', 'two_hearts'],
      ['💖', 'sparkling_heart'], ['💘', 'cupid'], ['💯', '100', 'hundert'], ['💢', 'anger'], ['💥', 'boom'], ['💫', 'dizzy'], ['💦', 'sweat_drops'], ['💤', 'zzz'],
    ],
  },
  {
    name: 'Natur & Essen',
    emojis: [
      ['🐶', 'dog', 'hund'], ['🐱', 'cat', 'katze'], ['🦊', 'fox', 'fuchs'], ['🐻', 'bear', 'bär'], ['🐼', 'panda'], ['🐸', 'frog', 'frosch'], ['🐧', 'penguin', 'pinguin'],
      ['🦄', 'unicorn', 'einhorn'], ['🐝', 'bee', 'biene'], ['🦋', 'butterfly'], ['🌱', 'seedling'], ['🌲', 'evergreen_tree', 'baum'], ['🌸', 'cherry_blossom', 'blume'],
      ['🌈', 'rainbow', 'regenbogen'], ['☀️', 'sunny', 'sonne'], ['🌙', 'crescent_moon', 'mond'], ['⭐', 'star', 'stern'], ['⚡', 'zap', 'blitz'], ['🔥', 'fire', 'feuer'],
      ['❄️', 'snowflake', 'schnee'], ['🍎', 'apple', 'apfel'], ['🍕', 'pizza'], ['🍔', 'hamburger', 'burger'], ['🍟', 'fries', 'pommes'], ['🌮', 'taco'],
      ['🍣', 'sushi'], ['🍩', 'doughnut', 'donut'], ['🍪', 'cookie', 'keks'], ['🎂', 'birthday', 'geburtstag kuchen'], ['🍫', 'chocolate_bar'], ['☕', 'coffee', 'kaffee'],
      ['🍺', 'beer', 'bier'], ['🍷', 'wine_glass', 'wein'], ['🥤', 'cup_with_straw'],
    ],
  },
  {
    name: 'Aktivitäten & Objekte',
    emojis: [
      ['🎉', 'tada', 'party feier'], ['🎊', 'confetti_ball'], ['🎁', 'gift', 'geschenk'], ['🏆', 'trophy', 'pokal'], ['🥇', 'first_place'], ['⚽', 'soccer', 'fußball'],
      ['🏀', 'basketball'], ['🎮', 'video_game', 'zocken spiel'], ['🕹️', 'joystick'], ['🎲', 'game_die', 'würfel'], ['🎯', 'dart', 'ziel'], ['🎵', 'musical_note', 'musik'],
      ['🎧', 'headphones', 'kopfhörer'], ['🎤', 'microphone'], ['🎬', 'clapper', 'film'], ['📷', 'camera', 'kamera'], ['💻', 'computer', 'laptop'], ['⌨️', 'keyboard', 'tastatur'],
      ['🖱️', 'mouse_three_button', 'maus'], ['📱', 'iphone', 'handy'], ['💡', 'bulb', 'idee'], ['📌', 'pushpin', 'pin'], ['📎', 'paperclip'], ['🔒', 'lock', 'schloss'],
      ['🔑', 'key', 'schlüssel'], ['🔧', 'wrench', 'werkzeug'], ['🛠️', 'tools'], ['⚙️', 'gear', 'zahnrad'], ['🧪', 'test_tube'], ['📚', 'books', 'bücher'],
      ['✏️', 'pencil2', 'stift'], ['📝', 'memo', 'notiz'], ['📅', 'date', 'kalender'], ['⏰', 'alarm_clock', 'wecker'], ['🚀', 'rocket', 'rakete'], ['✈️', 'airplane', 'flugzeug'],
      ['🚗', 'car', 'auto'], ['🏠', 'house', 'haus'], ['💰', 'moneybag', 'geld'], ['🎨', 'art', 'kunst'],
    ],
  },
  {
    name: 'Symbole',
    emojis: [
      ['✅', 'white_check_mark', 'haken erledigt'], ['☑️', 'ballot_box_with_check'], ['✔️', 'heavy_check_mark'], ['❌', 'x', 'kreuz falsch'], ['❎', 'negative_squared_cross_mark'],
      ['⚠️', 'warning', 'warnung'], ['⛔', 'no_entry'], ['🚫', 'no_entry_sign', 'verboten'], ['❓', 'question', 'frage'], ['❗', 'exclamation'], ['‼️', 'bangbang'],
      ['➕', 'heavy_plus_sign', 'plus'], ['➖', 'heavy_minus_sign', 'minus'], ['➡️', 'arrow_right', 'pfeil'], ['⬅️', 'arrow_left'], ['⬆️', 'arrow_up'], ['⬇️', 'arrow_down'],
      ['🔄', 'arrows_counterclockwise', 'neu laden'], ['🆕', 'new', 'neu'], ['🆗', 'ok'], ['🔴', 'red_circle'], ['🟢', 'green_circle'], ['🔵', 'blue_circle'], ['🟡', 'yellow_circle'],
      ['⭕', 'o'], ['♻️', 'recycle'], ['🏳️‍🌈', 'rainbow_flag'], ['🇩🇪', 'flag_de', 'deutschland'], ['🇦🇹', 'flag_at', 'österreich'], ['🇨🇭', 'flag_ch', 'schweiz'],
    ],
  },
];

export const ALL_EMOJIS: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

const RECENT_KEY = 'dcpoint-recent-emojis';

export function recentEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string) {
  const list = [e, ...recentEmojis().filter((x) => x !== e)].slice(0, 24);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function searchEmojis(query: string, limit = 50): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:/, '');
  if (!q) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const e of ALL_EMOJIS) {
    if (e[1].startsWith(q)) starts.push(e);
    else if (e[1].includes(q) || e[2]?.includes(q)) contains.push(e);
  }
  return [...starts, ...contains].slice(0, limit);
}
