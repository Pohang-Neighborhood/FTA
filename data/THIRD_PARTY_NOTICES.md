# Third-party data notices

FTA의 코드 라이선스와 이 디렉터리의 데이터 출처·이용 조건은 별개다.

## Combined output terms

FTA가 권리를 보유한 범위에서 다음 결합·가공 데이터는 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 조건으로 제공한다.

- `world-cup-2026-players.json`
- `world-cup-2026-player-abilities.json`
- `world-cup-2026-player-abilities.sqlite`
- `world-cup-2026-player-abilities.manifest.json`

재배포 또는 변경할 때는 아래 원출처를 표시하고 동일 조건을 유지하며 이 고지를 보존해야 한다. 이 조건은 FTA가 보유한 권리에만 적용되며, EA·SoFIFA·선수 성명 및 퍼블리시티 등 제3자 권리를 별도로 허가하거나 보증하지 않는다. 생성·검증 코드와 TypeScript 타입에는 저장소 루트의 MIT 라이선스가 적용된다.

## 2026 FIFA World Cup roster

- Source: [2026 FIFA World Cup squads, revision 1365337987](https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_squads&oldid=1365337987)
- Publisher: Wikipedia contributors
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- FTA modifications: 48개 팀과 1,248명의 명단을 정규화하고 PlayerElo 및 능력치 레코드와 결합

## PlayerElo Football Ratings

- Source: [PlayerElo Football Ratings, dataset version 47](https://www.kaggle.com/datasets/mwolters/playerelo-football-ratings)
- Publisher: PlayerElo
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- FTA modifications: 이름·생년월일·국적 기반 매칭 및 추정 모델 입력으로 사용

## FC 26-derived player attributes

- Source: [FC 26 (FIFA 26) Player Data, dataset version 3](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data/versions/3)
- Publisher: rovnez
- Updated: 2025-09-22
- License listed by Kaggle: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Source CSV SHA-256: `4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2`
- FTA modifications:
  - 2026 월드컵 명단에 포함된 선수만 선택·매칭
  - 시뮬레이션용 필드를 선택하고 이름을 변경하거나 가중 합성
  - 미매칭 선수의 추정값을 별도 표시해 생성

원본 데이터셋 설명은 SoFIFA 웹 스크래핑으로 만들어졌다고 밝힌다. Kaggle의 라이선스 표시는 라이선스 제공자가 보유한 권리 범위에서만 적용되며 EA, SoFIFA, 선수의 성명·퍼블리시티 등 제3자 권리를 모두 보증하지 않는다.

Electronic Arts, EA SPORTS FC, FIFA, SoFIFA 및 관련 상표권자는 FTA와 제휴하지 않았으며 FTA를 후원하거나 보증하지 않는다. FTA는 원본 CSV, 선수 얼굴 이미지, 로고 또는 SoFIFA CDN 자산을 저장소에 포함하지 않는다.
