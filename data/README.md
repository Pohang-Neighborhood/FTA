# 2026 월드컵 선수 데이터

`world-cup-2026-players.json`은 2026 FIFA 월드컵 최종 등록 선수 1,248명을 FTA에서 읽을 수 있도록 팀 단위로 저장한 데이터다.

## 포함 필드

- 명단: 국가, 조, 이름, 등번호, 포지션, 생년월일, 대회 전 A매치 기록, 클럽, 주장 여부
- PlayerElo: Elo, 전체 순위, 28일 전 Elo/순위, 출전 경기 수, 커리어·최근 180일 EAR
- 품질 정보: 출처 리비전/버전, 정규화한 원본 레코드의 SHA-256, 매칭 방식, 매칭률, 미매칭 수

TypeScript 소비자는 `world-cup-2026-players.types.ts`의 `WorldCupPlayerData` 타입을 사용할 수 있다. `playerElo`가 `null`인 선수는 이름·생년월일·국적을 보수적으로 대조해도 단일 후보가 확인되지 않은 경우다.

## 생성과 검증

온라인에서 고정 버전 원본을 다시 받아 생성하려면 `unzip`과 Node.js 22 이상이 필요하다.

```bash
node scripts/import-world-cup-players.mjs
node scripts/validate-world-cup-players.mjs
node --test tests/world-cup-player-data.test.mjs
```

이미 내려받은 원본이 있다면 네트워크 없이 생성할 수 있다.

```bash
node scripts/import-world-cup-players.mjs \
  --squads-html /path/to/squads.html \
  --playerelo-csv /path/to/players.csv \
  --output data/world-cup-2026-players.json
```

## 해석 제한

PlayerElo는 경기 결과에 대한 선수의 기여도를 추정한 값이다. 선수의 순수 재능이나 속도, 패스, 수비 같은 개별 기술 점수가 아니다. 따라서 이 데이터는 Elo와 EAR을 원형 그대로 보존하며 세부 능력치를 임의로 만들어내지 않는다.

## 출처와 라이선스

- 명단: [2026 FIFA World Cup squads, revision 1365337987](https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_squads&oldid=1365337987), Wikipedia contributors, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- 평점: [PlayerElo Football Ratings, dataset version 47](https://www.kaggle.com/datasets/mwolters/playerelo-football-ratings), PlayerElo, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

결합 결과인 `world-cup-2026-players.json`을 재배포할 때는 두 출처를 표시하고 CC BY-SA 4.0 조건을 따라야 한다. 저장소의 코드 라이선스와 데이터 라이선스는 별개다.
