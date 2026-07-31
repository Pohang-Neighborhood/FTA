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

test("server-renders the actual-player scenario simulator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>FTA \| Football Tactics Architect<\/title>/i);
  assert.match(html, /<main[^>]*class="sim-page"/i);
  assert.match(html, /<h1[^>]*>선수 움직임·패스 시뮬레이션<\/h1>/i);
  assert.match(html, /class="sim-pitch"/i);
  assert.match(html, /aria-live="polite"/i);
  assert.match(html, /id="sim-home-team"/i);
  assert.match(html, /id="sim-away-team"/i);
  assert.match(html, /South Korea(?:<!-- -->)? 공격 ↑/i);
  assert.match(html, /Brazil(?:<!-- -->)? 공격 ↓/i);
  assert.match(
    html,
    /aria-label="화살표 색상: 공격수 빨강, 미드필더 초록, 수비수 파랑, 골키퍼 노랑"/i,
  );
  assert.match(html, /초기 공 위치·소유/i);
  assert.match(html, /패스 지시/i);
  assert.match(html, /장면 길이/i);
  assert.match(
    html,
    /property="og:image"[^>]*content="http:\/\/localhost(?::3000)?\/og\.png"/i,
  );

  const playerButtons = html.match(/<button[^>]*data-sim-token=/gi) ?? [];
  const homePlayers = html.match(/data-sim-token="home:[^"]+"/gi) ?? [];
  const awayPlayers = html.match(/data-sim-token="away:[^"]+"/gi) ?? [];
  assert.equal(playerButtons.length, 22);
  assert.equal(homePlayers.length, 11);
  assert.equal(awayPlayers.length, 11);
  assert.match(
    html,
    /data-sim-token="home:[^"]+"[^>]*class="[^"]*sim-player-position-gk/i,
  );
  assert.match(
    html,
    /data-sim-token="home:[^"]+"[^>]*class="[^"]*sim-player-position-df/i,
  );
  assert.match(
    html,
    /data-sim-token="home:[^"]+"[^>]*class="[^"]*sim-player-position-mf/i,
  );
  assert.match(
    html,
    /data-sim-token="home:[^"]+"[^>]*class="[^"]*sim-player-position-fw/i,
  );
  assert.match(html, /<button[^>]*data-sim-ball/i);
  assert.match(
    html,
    /aria-label="우리 팀 Jo Hyeon-woo, 21번, GK\. 드래그 또는 방향키로 시작 위치 이동\. 선택 후 경기장을 눌러 경로 지정"/i,
  );
  assert.match(
    html,
    /aria-label="상대 팀 Alisson, 1번, GK\. 드래그 또는 방향키로 시작 위치 이동\. 자동 반응 선수 정보 보기"/i,
  );
  assert.match(html, /선수와 공을 드래그하면 시작 위치가 바뀝니다/i);

  assert.doesNotMatch(
    html,
    /Prototype data|isInferred|provenance|secondaryPosition|codex-preview|Building your site|react-loading-skeleton/i,
  );
});
