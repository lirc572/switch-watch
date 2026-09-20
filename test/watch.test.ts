import { describe, expect, test } from "bun:test";
import type { Source, SourceResult } from "../src/types.ts";
import { diff, hitKey, nextState, parseState, scanAll } from "../src/watch.ts";

const source: Source = {
  id: "s1",
  label: "Source one",
  url: "https://example.com/1",
  kind: "html",
  watchOnChange: true,
};

function result(hash: string, hits: SourceResult["hits"] = []): SourceResult {
  return { source, status: 200, hash, hits };
}

describe("parseState", () => {
  test("returns empty state for missing or corrupt input", () => {
    expect(parseState(null).hashes).toEqual({});
    expect(parseState("not json").reported).toEqual([]);
  });

  test("round-trips a valid state", () => {
    const s = parseState(
      JSON.stringify({ version: 1, updatedAt: "x", hashes: { a: "b" }, reported: ["k"] }),
    );
    expect(s.hashes.a).toBe("b");
    expect(s.reported).toEqual(["k"]);
  });
});

describe("diff", () => {
  const hit = {
    sourceId: "s1",
    sourceLabel: "Source one",
    url: source.url,
    match: "Nintendo Switch 2",
    context: "Top up ...",
  };

  test("reports new Switch hits", () => {
    const state = parseState(null);
    const { changes } = diff([result("h1", [hit])], state);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("new-hits");
  });

  test("does not re-report already seen hits", () => {
    const state = parseState(
      JSON.stringify({ hashes: {}, reported: [hitKey(hit)] }),
    );
    const { changes } = diff([result("h1", [hit])], state);
    expect(changes).toHaveLength(0);
  });

  test("reports a body change on opted-in sources", () => {
    const state = parseState(JSON.stringify({ hashes: { s1: "old" }, reported: [] }));
    const { changes } = diff([result("new")], state);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("changed");
  });
});

describe("nextState", () => {
  test("records hashes and reported keys", () => {
    const state = parseState(null);
    const next = nextState([result("h1")], state, ["s1:x"]);
    expect(next.hashes.s1).toBe("h1");
    expect(next.reported).toEqual(["s1:x"]);
  });
});

describe("scanAll", () => {
  test("uses the injected fetch and bounded concurrency", async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response("<html>Nintendo Switch OLED gift</html>", { status: 200 });
    }) as unknown as typeof fetch;

    const sources: Source[] = [
      { id: "a", label: "A", url: "https://x/a", kind: "html" },
      { id: "b", label: "B", url: "https://x/b", kind: "html" },
    ];
    const results = await scanAll(sources, { fetch: fakeFetch, concurrency: 2 });
    expect(results).toHaveLength(2);
    expect(calls.sort()).toEqual(["https://x/a", "https://x/b"]);
    expect(results[0]!.hits.length).toBeGreaterThan(0);
    expect(results[0]!.hash).toHaveLength(64);
  });

  test("captures fetch errors without throwing", async () => {
    const fakeFetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const results = await scanAll([source], { fetch: fakeFetch, retries: 1 });
    expect(results[0]!.error).toContain("boom");
    expect(results[0]!.status).toBe(0);
  });

  test("treats a 2xx bot-challenge page as a soft failure", async () => {
    const fakeFetch = (async () =>
      new Response("Just a moment... cf_chl_ enabled", {
        status: 202,
      })) as unknown as typeof fetch;
    const results = await scanAll([source], { fetch: fakeFetch, retries: 1 });
    expect(results[0]!.error).toContain("challenge");
    expect(results[0]!.hash).toBe("");
    expect(results[0]!.hits).toEqual([]);
  });

  test("retries then succeeds", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) return new Response("Just a moment...", { status: 202 });
      return new Response("Nintendo Switch 2 free gift", { status: 200 });
    }) as unknown as typeof fetch;
    const results = await scanAll([source], { fetch: fakeFetch, retries: 2 });
    expect(calls).toBe(2);
    expect(results[0]!.hits.length).toBe(1);
  });

  test("soft failure keeps the previous hash so the next run doesn't false-alarm", () => {
    const state = parseState(
      JSON.stringify({ hashes: { s1: "good" }, reported: [] }),
    );
    const failed: SourceResult = {
      source,
      status: 202,
      hash: "",
      hits: [],
      error: "challenge",
    };
    const next = nextState([failed], state, []);
    expect(next.hashes.s1).toBe("good");
  });
});
