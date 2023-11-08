import { Parser, Grammar } from "nearley";
import { readdir } from "fs/promises";
import path from "path";

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

const file = Bun.file("mods/poetrage-mods.json");
const exists = await file.exists();
const data = exists
  ? await file.json()
  : await fetch(
      "https://raw.githubusercontent.com/lvlvllvlvllvlvl/poetrage/main/src/data/mods.json"
    ).then((r) => r.json());
if (!exists) {
  Bun.write(file, JSON.stringify(data));
}

for (const [text, modData] of Object.entries(data.mods)) {
  const trade_ids = (Object.values(modData as any)[0] as any)?.stat?.trade_stat;
  if (!trade_ids) {
    console.log(modData);
  }
  const postprocess = () => ({ text, trade_ids });
  const symbols = text
    .split(/\s+/)
    .filter((s) => s)
    .map((literal) => (literal.includes("#") ? literal : { literal }));
  grammar.ParserRules.push({ name: "mod", postprocess, symbols });
}
grammar.ParserRules.push(...formats);

type Mods = { text: string; trade_ids: string[] }[];
const results = {} as {
  [item: string]: {
    [mods: string]: {
      builds: number;
      mods: Mods;
      average?: number;
      prices?: number[];
      search?: {};
    };
  };
};
for (const fileName of await readdir("data")) {
  if (!fileName.startsWith("items-") && !fileName.startsWith("passives-")) {
    continue;
  }
  const char = await Bun.file(path.join("data", fileName)).json();
  for (const item of char.items || []) {
    if (item.frameType === 3 && item.implicitMods && item.corrupted) {
      let mods = [] as Mods;
      for (const mod of item.implicitMods as string[]) {
        const parser = new Parser(Grammar.fromCompiled(grammar));
        const feed = mod
          .toLowerCase()
          .split(/\s+/)
          .filter((s) => s);
        try {
          parser.feed(feed as any);
          if (!parser.results?.length) {
            // probably not a corrupted mod
          } else if (!parser.results[0].text) {
            console.log("unexpected results", parser.results);
          } else {
            mods.push(parser.results[0]);
          }
        } catch (e) {
          console.error(feed, e);
        }
      }
      if (mods.length) {
        const stats = mods.map((m) => m.text).join(", ");
        const result = (results[item.name] = results[item.name] || {});
        if (!result[stats]) {
          const file = Bun.file(
            path.join("mods", `result-${item.name} ${stats}.json`)
          );
          result[stats] = { builds: 0, mods };
          if (await file.exists()) {
            const { average, prices, search } = await file.json();
            delete search.result;
            result[stats] = { average, prices, search, ...result[stats] };
          }
        }
        result[stats].builds++;
      }
    }
  }
}

Bun.write("mods/mods.json", JSON.stringify(results));

Bun.write(
  "mods/mods-sorted.json",
  JSON.stringify(
    Object.entries(results)
      .flatMap(([item, values]) =>
        Object.entries(values).map(([stats, data]) => ({
          item,
          stats,
          ...data,
        }))
      )
      .sort((l, r) => r.builds - l.builds),
    undefined,
    2
  )
);
