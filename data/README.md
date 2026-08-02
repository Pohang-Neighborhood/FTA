# 2026 월드컵 선수·능력치 데이터

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

FTA가 권리를 보유한 범위에서 결합 데이터인 `world-cup-2026-players.json`, `world-cup-2026-player-abilities.json`, `world-cup-2026-player-abilities.sqlite`, `world-cup-2026-player-abilities.manifest.json`은 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 조건으로 제공한다. 재배포할 때는 아래 세 출처를 표시하고 동일 조건을 유지하며 `THIRD_PARTY_NOTICES.md`의 고지를 보존해야 한다. 생성·검증 코드와 TypeScript 타입에 적용되는 저장소의 MIT 라이선스는 이 데이터 이용 조건과 별개다.

## 시뮬레이션용 능력치 데이터베이스

다음 세 파일은 같은 1,248명의 시뮬레이션용 능력치를 담는다.

- `world-cup-2026-player-abilities.sqlite`: 조회용 정본 SQLite 데이터베이스
- `world-cup-2026-player-abilities.json`: 웹 클라이언트용 동일 데이터 내보내기
- `world-cup-2026-player-abilities.manifest.json`: 입력·출력 파일의 크기, SHA-256, 인원수

SQLite에는 `players`, `abilities`, `goalkeeper_abilities`, `data_sources`, `metadata` 테이블과 팀·포지션·출처·추정 여부 인덱스가 있다. JSON 소비자는 `world-cup-2026-player-abilities.types.ts` 타입을 사용할 수 있다.

### 능력치 스키마

모든 값은 정수 `0...100`이다.

- 움직임: `speed`, `acceleration`, `sprintSpeed`, `agility`, `balance`, `stamina`, `strength`
- 기술·전술: `passing`, `ballControl`, `attacking`, `defending`, `positioning`, `reactions`, `decisionMaking`
- 비교 기준: `overall`
- 골키퍼 전용: `diving`, `handling`, `distribution`, `positioning`, `reflexes`, `sweeping`

공통 능력치는 FC26 세부 필드에서 시뮬레이션 의미에 맞게 선택하거나 가중 합성했다. 예를 들어 `passing`은 숏패스·롱패스·시야·크로스, `defending`은 마킹·인터셉트·스탠딩/슬라이딩 태클을 결합한다. 골키퍼는 비어 있는 FC26 `pace`·`passing`·`defending` 대신 골키퍼 전용 필드를 사용한다. 정확한 정의와 가중치는 `scripts/lib/player-ability-data.mjs` 및 JSON `metadata.abilityDefinitions`에 고정돼 있다.

### 직접값과 추정값

- 925명: 이름·생년월일을 우선 대조하고, 축약명은 국적 또는 복수 이름 토큰을 보조 근거로 확인한 FC26 직접값. 귀화·대표팀 변경 선수는 충분한 이름 근거가 있으면 국적 표기가 달라도 동일인으로 허용한다.
- 323명: 같은 포지션으로 확인된 FC26 직접 매칭 선수 중 나이와 PlayerElo가 가까운 이웃으로 계산한 FTA 추정값
- 추정값 중 281명은 PlayerElo를 사용하고, PlayerElo가 없는 42명은 같은 포지션 donor 중앙값을 사용한다.

추정 모델 `fc26-playerelo-knn-v1`은 능력치별로 필드 선수 11명, 골키퍼 7명의 가까운 이웃을 사용하며 결과를 해당 포지션 donor의 P05~P95 범위로 제한한다. 난수는 사용하지 않는다. 모든 선수는 다음 품질 필드를 가진다.

- `source`: `fc26` 또는 `fta_estimate`
- `isInferred`: 직접값과 추정값 구분
- `confidence` / `confidenceLevel`: 매칭 또는 추정 근거의 신뢰도
- `matchMethod`: 이름 매칭 또는 추정 방식
- `sourcePlayerId`: 직접 FC26 ID, 추정값은 `null`
- `donorPlayerIds`: 능력치별로 선택된 donor ID의 합집합. 필드별 이웃이 달라 11명 또는 7명보다 많을 수 있다.
- `meanNeighborDistance`: 모든 능력치별 donor 선택의 평균 거리
- `sourcePositionCompatible`: 월드컵 포지션과 FC26 세부 포지션의 호환 여부

`confidence`는 실제 경기력의 정확도를 보증하는 값이 아니라 신원 매칭과 추정 근거의 강도를 뜻한다.

### 생성과 검증

Node.js 22.13 이상과 `unzip`이 필요하다. 고정된 Kaggle v3 원본을 온라인에서 받아 생성한다.

```bash
node scripts/import-world-cup-player-abilities.mjs
```

검증된 원본 CSV를 이미 내려받았다면 네트워크 없이 같은 논리 데이터를 만들 수 있다.

```bash
node scripts/import-world-cup-player-abilities.mjs \
  --fc26-csv /path/to/FC26_20250921.csv
```

입력 파일의 크기·SHA-256·18,405행·110필드·FC26 update 4가 고정값과 다르면 생성이 중단된다. 원본 18,405명 CSV와 ZIP은 저장소에 포함하지 않는다.

JSON은 지원 런타임 사이에서도 바이트 단위로 재현된다. SQLite는 스키마와 행 데이터가 같더라도 Node.js에 번들된 SQLite 버전에 따라 파일 바이트가 달라질 수 있다. 저장소에 포함된 SQLite의 정확한 SHA-256을 재현해야 한다면 manifest의 `generator.nodeVersion`과 `generator.sqliteVersion`을 사용한다.

```bash
node scripts/validate-world-cup-player-abilities.mjs
node --test tests/world-cup-player-abilities.test.mjs
```

검증기는 1,248명 전체, 능력치 범위, FC26 ID 중복, 직접값/추정값 구분, 골키퍼 스키마, donor 범위, SQLite 무결성, JSON/SQLite 일치, manifest 체크섬을 확인한다.

### 능력치 출처와 라이선스

- [FC 26 (FIFA 26) Player Data v3](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data/versions/3), rovnez, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 원본 CSV SHA-256: `4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2`
- FTA 변경: 월드컵 선수 선택·매칭, 필드 선택·이름 변경·가중 합성, 미매칭 선수 추정

원본 데이터 설명은 SoFIFA를 웹 스크래핑해 생성했다고 밝힌다. Kaggle의 CC BY 4.0 표시는 제3자인 EA 또는 SoFIFA의 모든 권리까지 보증하지 않는다. EA SPORTS FC 및 SoFIFA는 FTA와 제휴하거나 FTA를 후원·보증하지 않는다. 상세 고지는 `THIRD_PARTY_NOTICES.md`를 참고한다.
