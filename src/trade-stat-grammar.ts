import { Parser, Grammar } from "nearley";
import { performance } from "perf_hooks";

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

interface CompiledRules {
  Lexer: NearleyLexer | undefined;
  ParserRules: NearleyRule[];
  ParserStart: string;
}

const grammar: CompiledRules = {
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
  { name: "+#", symbols: [plus] },
  { name: "#%", symbols: [percent] },
  { name: "+#%", symbols: [pluspercent] },
  { name: "(#", symbols: [lparen] },
  { name: "#)", symbols: [rparen] },
  { name: "(#)", symbols: [parens] },
  { name: "#x", symbols: [times] },
  { name: "(×#)", symbols: [parentimes] },
];

const known = new Set(formats.map((f) => f.name));

let file = Bun.file("data/trade-stats.json");
let exists = await file.exists();
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
file = Bun.file("data/repoe-stats.json");
exists = await file.exists();
const translations = exists
  ? await file.json()
  : await fetch(
      "https://lvlvllvlvllvlvl.github.io/RePoE/stat_translations.min.json"
    ).then((r) => r.json());
if (!exists) {
  Bun.write(file, JSON.stringify(translations));
}

for (const { label, entries } of data.result) {
  const typeLabel = { literal: label };
  for (const { id, text, option } of entries) {
    if (option?.options?.length) {
      for (const opt of option.options) {
        const postprocess = () => ({ id, text, option: opt });
        const symbols = (text as string)
          .replace("#", opt.text)
          .split(/\s+/)
          .filter((s) => s)
          .map((literal) => ({ literal }));
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

console.log("checking", translations.length, "translations");
let time = performance.now() + 5000;

translations.forEach((translation: any, i: number) => {
  if (performance.now() > time) {
    console.log(i);
    time = performance.now() + 5000;
  }
  let found = null;
  let err = null;
  translation.English.forEach(
    ({ string, format }: { string: string; format: string[] }) => {
      let parser = new Parser(Grammar.fromCompiled(grammar));
      format?.forEach((f, i) => (string = string.replace(`{${i}}`, f)));
      const feed = string.split(/\s+/).filter((s) => s);
      try {
        parser.feed(feed as any);
        if (!parser.results?.length) {
        } else if (!parser.results[0].text) {
          console.log("unexpected results", parser.results);
        } else {
          found = parser.results;
          return;
        }
      } catch (e) {
        err = e;
      }
      if (string.includes("\n")) {
        for (const line of string.split("\n")) {
          const parser = new Parser(Grammar.fromCompiled(grammar));
          const feed = line.split(/\s+/).filter((s) => s);
          try {
            parser.feed(feed as any);
            if (!parser.results?.length) {
            } else if (!parser.results[0].text) {
              console.log("unexpected results", parser.results);
            } else {
              found = parser.results;
              return;
            }
          } catch (e) {
            err = e;
            if (line.includes("Chitus")) {
              console.log(line, e);
            }
          }
        }
      }
    }
  );
  if (!found && translation.trade_stats?.length) {
    console.log("missed match from file", translation, err);
  }
  if (found && !translation.trade_stats?.length) {
    console.log("match not in file", translation, found);
  }
});
