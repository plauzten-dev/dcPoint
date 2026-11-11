/** Lazily loaded syntax highlighting (separate chunk, only fetched when a code block appears). */
type Hljs = typeof import('highlight.js/lib/core').default;

let instance: Promise<Hljs> | null = null;

function load(): Promise<Hljs> {
  instance ??= (async () => {
    const [{ default: hljs }, ...langs] = await Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/cpp'),
      import('highlight.js/lib/languages/csharp'),
      import('highlight.js/lib/languages/go'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/markdown'),
      import('highlight.js/lib/languages/diff'),
      import('highlight.js/lib/languages/php'),
      import('highlight.js/lib/languages/kotlin'),
      import('highlight.js/lib/languages/ini'),
    ]);
    const names = ['javascript', 'typescript', 'python', 'rust', 'json', 'bash', 'css', 'xml', 'sql', 'java', 'cpp', 'csharp', 'go', 'yaml', 'markdown', 'diff', 'php', 'kotlin', 'ini'];
    langs.forEach((l, i) => hljs.registerLanguage(names[i], l.default));
    hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
    hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
    hljs.registerAliases(['toml'], { languageName: 'ini' });
    return hljs;
  })();
  return instance;
}

/** Returns highlighted HTML (escaped by highlight.js) or null for unknown languages. */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const hljs = await load();
  if (!hljs.getLanguage(lang)) return null;
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
