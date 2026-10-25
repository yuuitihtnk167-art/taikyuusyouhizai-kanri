import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

test("offline navigation serves cached forms and settings without dropping return parameters", async () => {
  const handlers = new Map();
  const cached = new Map();
  const origin = "https://example.test/";
  const context = createContext({
    URL, Request, Response,
    self: {
      registration: { scope: origin },
      clients: { claim() {} },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    caches: {
      open: async () => ({
        addAll: async (requests) => {
          for (const request of requests) cached.set(request.url, request.url);
        },
      }),
      match: async (request) => cached.get(typeof request === "string" ? request : request.url),
    },
    fetch: async () => { throw new Error("offline"); },
  });
  runInContext(readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context);
  await new Promise((resolve, reject) => handlers.get("install")({
    waitUntil: (promise) => promise.then(resolve, reject),
  }));

  const navigate = async (path, mode = "navigate") => {
    const request = { url: new URL(path, origin).href, method: "GET", mode };
    let response;
    handlers.get("fetch")({ request, respondWith: (promise) => { response = promise; } });
    const result = await response;
    assert.equal(request.url, new URL(path, origin).href);
    return result;
  };
  for (const path of [
    "form.html?from=hidden",
    "pc-management/form.html?from=hidden",
    "form.html?id=item-1&from=hidden",
    "pc-management/form.html?id=part-1&from=hidden",
    "settings.html?from=hidden",
    "settings.html?from=pc-hidden",
  ]) {
    assert.equal(await navigate(path), new URL(path.split("?")[0], origin).href);
  }
  // Prefer an exact cached URL when available; do not ignore asset version parameters.
  cached.set(origin + "form.html?from=hidden", "exact cached form");
  assert.equal(await navigate("form.html?from=hidden"), "exact cached form");
  assert.equal(await navigate("unknown.html?from=hidden"), origin + "login.html");
  assert.equal((await navigate("style.css?v=unknown", "cors")).type, "error");
});
