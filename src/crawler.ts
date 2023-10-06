import { FetchRateLimiter } from "../../rate-limit-rules/lib/rate-limiters/fetch.js";
import { writeFile, readFile } from "fs/promises";
import { inspect } from "util";
import { sleep } from "../../rate-limit-rules/lib/index.js";

inspect.defaultOptions.depth = null;

let error = false;
let offset = 0;
const limit = 100;

const league = process.env.LEAGUE || "Ancestor";
const realm = process.env.REALM || "pc";

const fetch = new FetchRateLimiter({
  maxWaitMs: 600000,
  waitOnStateMs: 4000,
}).request;

interface LadderEntry {
  rank: number;
  dead: boolean;
  character: {
    id: string;
    name: string;
    level: number;
    class: string;
    experience: number;
    ancestor?: {
      rank: number;
    };
    depth?: {
      default: number;
      solo: number;
    };
  };
  account: {
    name: string;
    realm: string;
  };
  public?: boolean;
}

const headers = {
  "User-Agent":
    "OAuth crawl-characters/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/)",
};

async function fetchAndSave(
  type: "ladder" | "items" | "passives",
  params: Record<string, any>
) {
  const fileName =
    type === "ladder"
      ? `data/ladder-${params.offset}.json`
      : `data/${type}-${params.accountName}-${params.character}.json`;

  try {
    return (await readFile(fileName)).toString("utf8");
  } catch {}

  const query = new URLSearchParams(params);
  const r = await (type === "ladder"
    ? fetch(`https://www.pathofexile.com/api/ladders?${query}`, {
        headers,
      })
    : type === "items"
    ? fetch("https://www.pathofexile.com/character-window/get-items", {
        method: "POST",
        body: query,
        headers,
      })
    : fetch(
        `https://www.pathofexile.com/character-window/get-passive-skills?${query}`,
        { headers }
      )
  ).catch((error) => {
    return { ok: null, status: null, error };
  });

  if (r.status === 404) {
    throw 404;
  } else if (!r.ok) {
    error = true;
    if ("error" in r) {
      console.error(r.error);
    } else {
      console.error(r);
    }
    throw r;
  }

  const text = await r.text();
  await writeFile(fileName, text, "utf8");
  return text;
}

while (offset < 15000) {
  const ladderJson = await fetchAndSave("ladder", {
    id: league,
    type: "league",
    offset,
    limit,
    realm,
  });

  const ladder: { entries: LadderEntry[] } = JSON.parse(ladderJson);

  for (const { public: isPublic, account, character } of ladder.entries) {
    if (error) break;
    if (!isPublic) continue;

    await Promise.allSettled([
      fetchAndSave("items", {
        character: character.name,
        accountName: account.name,
        realm,
      }),
      fetchAndSave("passives", {
        character: character.name,
        accountName: account.name,
        realm,
      }),
    ]);
  }

  offset += limit;
  if (error) process.exit(1);
}
