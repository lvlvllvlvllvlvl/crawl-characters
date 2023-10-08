interface NearleyToken {
  value: any;
  [key: string]: any;
}

interface NearleyLexer {
  reset: (chunk: string, info: any) => void;
  next: () => NearleyToken | undefined;
  save: () => any;
  formatError: (token: never) => string;
  has: (tokenType: string) => boolean;
}

interface NearleyRule {
  name: string;
  symbols: NearleySymbol[];
  postprocess?: (d: any[], loc?: number, reject?: {}) => any;
}

type NearleySymbol =
  | string
  | { literal: any }
  | { test: (token: any) => boolean };

interface Grammar {
  Lexer: NearleyLexer | undefined;
  ParserRules: NearleyRule[];
  ParserStart: string;
}

const grammar: Grammar = {
  Lexer: undefined,
  ParserRules: [],
  ParserStart: "mod",
};

const word = { test: () => true };
const plus = { test: (token: string) => token.startsWith("+") };
const percent = { test: (token: string) => token.endsWith("%") };
const pluspercent = {
  test: (token: string) => token.startsWith("+") && token.endsWith("%"),
};
const parens = {
  test: (token: string) => token.startsWith("(") && token.endsWith(")"),
};
const lparen = { test: (token: string) => token.startsWith("(") };
const rparen = { test: (token: string) => token.endsWith(")") };
const times = { test: (token: string) => token.endsWith("x") };
const parentimes = {
  test: (token: string) => token.startsWith("(×") && token.endsWith(")"),
};

const formats: NearleyRule[] = [
  { name: "#", symbols: [word] },
  { name: "#", symbols: ["#", word] },
  { name: "+#", symbols: [plus] },
  { name: "+#", symbols: ["+#", word] },
  { name: "#%", symbols: [percent] },
  { name: "#%", symbols: [word, "#%"] },
  { name: "+#%", symbols: [pluspercent] },
  { name: "+#%", symbols: ["+#", percent] },
  { name: "(#", symbols: [lparen] },
  { name: "#)", symbols: [rparen] },
  { name: "#)", symbols: [word, rparen] },
  { name: "(#)", symbols: [parens] },
  { name: "(#)", symbols: [lparen, rparen] },
  { name: "#x", symbols: [times] },
  { name: "(×#)", symbols: [parentimes] },
];

const known = new Set(formats.map((f) => f.name));

const file = Bun.file("data/trade-stats.json");
const exists = await file.exists();
const data = exists
  ? await file.json()
  : await fetch("https://www.pathofexile.com/api/trade/data/stats", {
      headers: {
        "User-Agent":
          "OAuth mod-grammar/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/)",
      },
    }).then((r) => r.json());
if (!exists) {
  Bun.write(file, JSON.stringify(data));
}

for (const { label, entries } of data.result) {
  const typeLabel = { literal: label };
  for (const { id, text, option } of entries) {
    if (option?.options?.length) {
      for (const { id: value, text } of option.options) {
        const postprocess = () => ({ id, text, value });
        const symbols = (text as string)
          .split(/\s+/)
          .filter((s) => s)
          .map((literal) =>
            literal.includes("#")
              ? { literal: literal.replace("#", text) }
              : { literal }
          );
        grammar.ParserRules.push(
          { name: "mod", postprocess, symbols },
          { name: "mod", postprocess, symbols: [typeLabel, ...symbols] }
        );
      }
    } else {
      const postprocess = () => ({ id, text });
      const symbols = (text as string)
        .split(/\s+/)
        .filter((s) => s)
        .map((literal) => (literal.includes("#") ? literal : { literal }));
      const unknown = symbols.filter(
        (s) => typeof s === "string" && !known.has(s)
      );
      if (unknown.length) {
        console.warn("unmatched format string", unknown);
      }
      grammar.ParserRules.push(
        { name: "mod", postprocess, symbols },
        { name: "mod", postprocess, symbols: [typeLabel, ...symbols] }
      );
    }
  }
}
grammar.ParserRules.push(...formats);

export {};
