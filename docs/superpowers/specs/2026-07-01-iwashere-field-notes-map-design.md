# iwashere — 현장 멘트 지도 (MVP) 설계

- 작성일: 2026-07-01
- 상태: 승인됨 (브레인스토밍 완료)
- 범위: 첫 스펙 = **핵심 루프 + 인증**

---

## 1. 개요

여행자가 깔끔한 베이스맵 위에서 **현장에서 장소에 짧은 멘트와 사진을 남기고**, **검색으로 멘트가 달린 장소를 찾아 읽고 답글·좋아요로 상호작용**하는 모바일 우선 웹 서비스.

구글 리뷰와의 차별점:
- 지도에는 구글 기본 POI(가게/명소 핀)를 **숨김**. 핀은 오직 **사용자가 남긴 멘트**에서 생성됨.
- 검색은 구글 장소 검색이 아니라 **우리 DB에 쌓인 멘트 텍스트를 전문검색**해서 매칭되는 장소를 지도에 표시.
- 시의성 있는 현장 정보(예: "오늘 쉐프가 출근 안 해서 음식이 별로였다")를 하이브리드로 다룸 — **최신 멘트가 위로, 과거 멘트도 보존**.

### 타깃 / 정체성
- 주 타깃: **글로벌 / 외국인 여행자** (예: 한국 방문 외국인). UI 영어 기본, 다국어는 후속.
- 사용 환경: **모바일 우선 반응형 웹**. 데스크톱도 지원하되 폰이 메인.
- 지향: 최종적으로 전체 서비스(인증·확장성·모더레이션). 단 **이 스펙은 MVP 핵심 루프로 한정**.

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트엔드 | Next.js (App Router), 모바일 우선 반응형 |
| 지도 | Google Maps JavaScript API (POI 숨긴 커스텀 스타일, 핀=DB) |
| 위치 | 브라우저 Geolocation API (무료) |
| 백엔드 | Supabase — Auth / Postgres(+PostGIS) / Storage |
| 인증 | Supabase Auth + **Google OAuth** |
| 검색 | Postgres 전문검색 + `pg_trgm` (멘트 텍스트) |
| 배포 | Vercel(프론트) + Supabase(백엔드), 무료티어 시작 |

**구글 의존은 "베이스맵 표시"만** → 가장 비싼 Places(검색/자동완성) API를 쓰지 않음. 검색은 자체 DB 전문검색으로 처리하여 비용 최소화.

### 비용 메모 (Google Maps Platform, 2026)
- 2025-03부터 월 $200 크레딧 폐지 → SKU별 무료 한도 방식.
- Maps JavaScript(Dynamic Maps): 월 10,000회 무료, 초과 시 ~$7/1,000회.
- 본 앱은 **세션당 지도 1로드**, Places 미사용 → 초기 사실상 무료.
- 리버스 지오코딩(주소 자동제안)은 MVP에서 **생략**(사용자가 장소명 직접 입력). 필요 시 후속에 Geocoding(월 1만 무료) 추가.

---

## 3. 데이터 모델

```
profiles
  id            uuid  PK (= auth.users.id)
  nickname      text
  avatar_url    text
  created_at    timestamptz

places
  id            uuid  PK
  name          text          -- 첫 등록자가 명명 (하이브리드)
  lat           double precision
  lng           double precision
  geog          geography(Point, 4326)   -- PostGIS, 근접/bbox 쿼리용
  created_by    uuid  FK profiles
  created_at    timestamptz

posts                          -- 멘트와 답글 통합
  id            uuid  PK
  place_id      uuid  FK places
  parent_id     uuid  FK posts NULL    -- NULL=최상위 멘트, 값 있으면 답글(중첩)
  author_id     uuid  FK profiles
  body          text
  like_count    int   default 0
  is_hidden     boolean default false  -- 모더레이션(신고 처리) 용
  created_at    timestamptz

post_photos
  id            uuid  PK
  post_id       uuid  FK posts
  storage_path  text
  width         int
  height        int

likes
  post_id       uuid  FK posts
  user_id       uuid  FK profiles
  created_at    timestamptz
  UNIQUE(post_id, user_id)       -- 중복 좋아요 방지

reports
  id            uuid  PK
  target_post_id uuid FK posts
  reporter_id   uuid  FK profiles
  reason        text
  status        text default 'open'   -- open|reviewed|dismissed
  created_at    timestamptz
```

### 모델링 결정
- **멘트/답글 통합(posts + parent_id)**: 중첩 스레드를 자기참조로 구현. 좋아요·신고·사진이 멘트와 답글에 동일하게 적용되어 단순.
- **places 자체 보유**: 좌표 근접(`ST_DWithin`, 반경 ~50m)으로 후보 추천 + 사용자가 확정/명명(하이브리드). 구글 장소 데이터에 의존하지 않음.
- `like_count`는 비정규화 캐시(트리거 또는 RPC로 갱신), 정렬·표시 성능용.

---

## 4. 핵심 사용자 흐름

### ① 지도 탐색
지도 이동 시 현재 화면(bbox) 안의 places를 조회(PostGIS bbox 쿼리, limit) → 핀 표시. 핀 탭 → 하단 패널에 해당 장소 멘트들이 **최신순(보존)**. 멘트 펼치면 중첩 답글 표시.

### ② 현장에서 멘트 남기기 (FAB)
1. GPS로 현재 위치 획득.
2. 지도에서 핀 드래그로 미세조정.
3. 반경 ~50m 기존 장소 후보 리스트 표시 → 맞으면 선택, 없으면 "새 장소" 생성 + 이름 입력.
4. 본문 작성 + 사진 첨부(클라이언트 압축) → Storage 업로드 → post 생성.

### ③ 검색
검색창 단어 입력 → posts 전문검색(`pg_trgm` 부분일치 + 전문검색) → 매칭 멘트가 있는 **장소들**을 지도 핀 + 리스트로 표시 → 탭하면 해당 장소·매칭 멘트로 이동(하이라이트).

### ④ 답글 / 좋아요 / 신고
- 답글: 멘트·답글에 중첩 답글 작성.
- 좋아요: 멘트·답글 토글(likes 유니크), `like_count` 갱신.
- 신고: 사유 선택 → reports 적재. **검토는 수동**(이 스펙에선 운영자 대시보드 없음, DB/수동 처리).

---

## 5. 기술적 핵심 결정 & 엣지케이스

- **검색(다국어)**: 글로벌 타깃이라 언어 혼재 → MVP는 `pg_trgm`(부분일치) + 단순 전문검색 조합. 형태소분석은 후속.
- **지리쿼리**: PostGIS `geography`. 화면 bbox 조회 + 50m 반경 후보. 핀 과다 시 클라이언트 클러스터링.
- **베이스맵**: Google Maps 커스텀 스타일로 `poi`/`transit` 라벨·아이콘 visibility off → 깔끔한 베이스맵.
- **엣지케이스**:
  - GPS 거부/실패 → 지도 탭으로 위치 수동 지정 폴백.
  - 사진 업로드 실패 → 재시도·개별 제거 UI.
  - 빈 상태(주변/검색 결과 멘트 없음) → 안내 + "첫 멘트 남기기" 유도.
  - 중복 장소 방지 → 후보를 눈에 띄게 강조, "새 장소"는 한 번 더 확인.

---

## 6. 인증 & 보안 (RLS)

- Supabase Auth Google OAuth. 최초 로그인 시 `profiles` 행 생성(닉네임 기본값/설정).
- RLS 정책:
  - 읽기: places/posts/post_photos/likes 공개(is_hidden=false).
  - 쓰기: 인증 사용자만 생성.
  - 수정·삭제: 본인 글만(author_id = auth.uid()).
  - reports: 인증 사용자 생성 가능, 조회는 본인/운영자.

---

## 7. 테스트 & 품질

- **TDD 기반**(테스트 먼저).
- 단위: 지리쿼리(bbox/반경), 검색 매칭, 좋아요 토글, 장소 후보 추천 — Supabase 로컬 DB로.
- 통합/E2E: 핵심 루프(로그인→멘트작성→검색→답글) Playwright.
- 보안: RLS 정책 테스트(남의 글 수정/삭제 불가 등).

---

## 8. 범위 밖 (후속 스펙)

순차 진행 예정, 본 스펙에 미포함:
- 짧은 영상 업로드(트랜스코딩·썸네일·용량제한).
- 자동 모더레이션(욕설/스팸 텍스트 필터, AI 이미지 검열).
- 운영자 대시보드(신고 검토 큐).
- 다국어(i18n) 골격.
- 카카오/애플 등 추가 소셜 로그인.
- 리버스 지오코딩 기반 주소 자동제안.

---

## 9. 결정 요약 (브레인스토밍)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 규모 | 전체 서비스 지향 (단 첫 스펙은 MVP) |
| 2 | 정체성 | 하이브리드(최신↑ + 보존) |
| 3 | 기기 | 모바일 우선 반응형 |
| 4 | 스택 | Next.js + Supabase |
| 5 | 지도 | Google Maps(베이스맵만), 검색은 자체 DB |
| 6 | 멘트-장소 | 장소 단위 묶음 |
| 7 | 장소 특정 | 하이브리드(좌표 자동추천 + 사용자 명명) |
| 8 | 인증 | 소셜 로그인 중심 |
| 9 | 타깃 | 글로벌/외국인 여행자 (Google 로그인, 영어 기본) |
| 10 | 미디어 | 사진 먼저, 영상 후속 |
| 11 | 답글/반응 | 중첩 답글 + 좋아요 |
| 12 | 모더레이션 | 신고 기반 + 수동 검토 |
| 13 | 첫 범위 | 핵심 루프 + 인증 |
