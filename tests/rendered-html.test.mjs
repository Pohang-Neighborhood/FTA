import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("server-renders the staged match setup before the simulator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>FTA \| Football Tactics Architect<\/title>/i);
  assert.match(html, /<main[^>]*class="sim-page"/i);
  assert.match(html, /data-sim-setup-step="teams"/i);
  assert.match(html, /<h1[^>]*id="sim-setup-flow-title"[^>]*>경기 설정<\/h1>/i);
  assert.match(html, /aria-label="초기 설정 단계"/i);
  assert.match(html, /대결 국가 지정/i);
  assert.match(html, /자동 배치 확인/i);
  assert.match(html, /id="sim-setup-home-team"/i);
  assert.match(html, /id="sim-setup-away-team"/i);
  assert.match(html, /South Korea/i);
  assert.match(html, /Brazil/i);
  assert.match(html, /동일 국가는 양쪽에 동시에 선택할 수 없습니다/i);
  assert.match(html, /포메이션 선택/i);
  assert.doesNotMatch(html, /class="sim-pitch"/i);
  assert.doesNotMatch(html, /id="sim-home-team"|id="sim-away-team"/i);
  assert.match(
    html,
    /property="og:image"[^>]*content="http:\/\/localhost(?::3000)?\/og\.png"/i,
  );

  assert.doesNotMatch(
    html,
    /Prototype data|isInferred|provenance|secondaryPosition|codex-preview|Building your site|react-loading-skeleton/i,
  );

  const stylesheet = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(stylesheet, /\.sim-setup-workspace\s*\{/s);
  assert.match(stylesheet, /\.sim-team-choice-grid\s*\{/s);
  assert.match(stylesheet, /\.sim-formation-team-grid\s*\{/s);
  assert.match(stylesheet, /\.sim-setup-mini-pitch\s*\{/s);
  assert.match(stylesheet, /\.sim-setup-reset-confirmation\s*\{/s);
  assert.match(stylesheet, /\.sim-player-name\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(stylesheet, /\.sim-target-cursor\s*\{/s);
  assert.match(stylesheet, /\.sim-player-pass-target\s+\.sim-player-disc\s*\{/s);
  assert.match(
    stylesheet,
    /@media \(max-width: 1080px\)[\s\S]*grid-template-areas:\s*"setup"\s*"pitch"\s*"inspector";/,
  );
  assert.doesNotMatch(
    stylesheet,
    /\.sim-player-name\s*\{\s*display:\s*none;/s,
  );
});
