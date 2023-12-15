import { mkdir, readFile, writeFile } from "fs/promises";
import { FetchRateLimiter } from "rate-limit-rules/lib/rate-limiters/fetch.js";
import { inspect } from "util";

inspect.defaultOptions.depth = null;

let error = false;
let offset = 0;
const limit = 100;

const league = process.env.LEAGUE || "Affliction";
const realm = process.env.REALM || "pc";

await mkdir("data", { recursive: true });

const fetch = new FetchRateLimiter({ maxWaitMs: 1000 }).request;

interface LadderEntry {
  rank: number;
  dead: boolean;
  character: {
    id: string;
    name: string;
    level: number;
    class: string;
    experience: number;
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

const headers: HeadersInit = {
  "User-Agent":
    "OAuth crawl-characters/1.0.0 (contact: https://github.com/lvlvllvlvllvlvl/)",
};

if (process.env.POESESSID) {
  console.debug("found POESESSID")
  headers.Cookie = `POESESSID=${process.env.POESESSID}`
}

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

  if (r.status === 404 || r.status === 403) {
    throw "ignored error";
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

  let task = null;
  for (const { public: isPublic, account, character } of ladder.entries) {
    if (error) break;
    if (!isPublic) continue;

    const next = Promise.allSettled([
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
    await task;
    task = next;
  }

  offset += limit;
  if (error) process.exit(1);
}
