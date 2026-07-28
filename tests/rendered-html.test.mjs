import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete tactics workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>FTA \| Football Tactics Architect<\/title>/i);
  assert.match(html, /<main[^>]*class="workspace"/i);
  assert.match(html, /<h1>Match Lab<\/h1>/i);
  assert.match(html, /data-testid="tactics-pitch"/i);
  assert.match(html, /aria-live="polite"/i);
  assert.match(html, /Prototype data/i);
  assert.match(
    html,
    /property="og:image"[^>]*content="http:\/\/localhost(?::3000)?\/og\.png"/i,
  );

  const playerButtons = html.match(/<button[^>]*data-player-token=/gi) ?? [];
  assert.equal(playerButtons.length, 11);
  assert.match(html, /aria-label="서민규, 9번, ST\. 방향키로 위치 이동"/i);

  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
