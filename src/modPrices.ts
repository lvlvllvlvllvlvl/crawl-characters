import path from "path";
import { FetchRateLimiter } from "rate-limit-rules/lib/rate-limiters/fetch";
import { filterOutliers } from "./filterOutliers";
import { BunFile } from "bun";

const league = process.env.LEAGUE || "Ancestor";

const sorted: {
  item: string;
  stats: string;
  mods: [
    {
      text: string;
      trade_ids: string[];
    }
  ];
  count: number;
}[] = await Bun.file("mods/mods-sorted.json").json();

const { currencyDetails, lines } = await fetch(
  `https://poe.ninja/api/data/currencyoverview?league=${league}&type=Currency`
).then((r) => r.json());

const idByName = Object.fromEntries(
  currencyDetails.map(({ name, tradeId }: Record<string, string>) => [
    name,
    tradeId,
  ])
);
const currencyValue = Object.fromEntries(
  lines.map(
    ({
      currencyTypeName,
      chaosEquivalent,
    }: {
      currencyTypeName: string;
      chaosEquivalent: number;
    }) => [idByName[currencyTypeName], chaosEquivalent]
  )
);

const rateLimiter = new FetchRateLimiter({ maxWaitMs: 5000 });

const headers = {
  "User-Agent":
    "OAuth crawl-characters/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/)",
  "Content-Type": "application/json",
  Accept: "application/json",
};

let error = false;
async function fetchAndSave(name: string, stats: any, file: BunFile) {
  try {
    const search = await rateLimiter
      .request(`https://www.pathofexile.com/api/trade/search/${league}`, {
        method: "POST",
        body: JSON.stringify({
          query: {
            name,
            stats,
            status: { option: "onlineleague" },
            filters: {
              trade_filters: { filters: { indexed: { option: "1week" } } },
            },
          },
          sort: { price: "asc" },
        }),
        headers,
      })
      .then((r) => r.json());
    if (search.error) {
      console.error(
        "error searching",
        file.name,
        rateLimiter["state"],
        search.error
      );
      error = true;
      return;
    }

    const { result } = !search.total
      ? { result: [] }
      : await rateLimiter
          .request(
            `https://www.pathofexile.com/api/trade/fetch/${search.result
              .slice(0, 10)
              .join(",")}?query=${search.id}`
          )
          .then((r) => r.json());

    const prices: number[] = result.map(
      ({
        listing: {
          price: { currency, amount },
        },
      }: any) =>
        currency === "chaos" ? amount : currencyValue[currency] * amount
    );
    const filtered = filterOutliers(prices.filter((v) => !isNaN(v)));
    const sum = filtered.reduce((a, b) => a + b, 0);
    const average = sum / filtered.length;
    await Bun.write(
      file,
      JSON.stringify({ average, prices, filtered, sum, result, search })
    );
  } catch (e) {
    console.error(file.name, e);
    error = true;
  }
}

let task = null;
for (const { item, stats, mods } of sorted) {
  const file = Bun.file(path.join("mods", `result-${item} ${stats}.json`));
  if (await file.exists()) continue;
  if (error) break;

  const next = fetchAndSave(
    item,
    mods.map((m) => ({
      type: "count",
      value: { min: 1 },
      filters: m.trade_ids.map((id) => ({ id })),
    })),
    file
  );
  await task;
  task = next;
  if (error) break;
}
if (error) process.exit(1);
