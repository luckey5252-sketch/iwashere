# iwashere Plan 3 — 멘트 작성 플로우 (Note Compose) 설계

- 작성일: 2026-07-08
- 상태: 승인됨 (브레인스토밍 완료)
- 상위 설계: [2026-07-01-iwashere-field-notes-map-design.md](2026-07-01-iwashere-field-notes-map-design.md) §4②
- 선행: Plan 1(기반+백엔드, master 병합), Plan 2(인증+지도+읽기, master 병합 `236874d`)

---

## 1. 범위

핵심 루프의 **"쓰기" 절반** 중 첫 조각: **현장에서 장소에 카테고리를 정하고 짧은 멘트를 남기는** 텍스트 우선 작성 플로우 + `places` 카테고리 도입.

### 포함 (Plan 3)
- `places`에 **카테고리**(고정 enum 5종) 컬럼 추가.
- **작성 플로우**: FAB → GPS 센터링 → 화면 정중앙 고정 핀으로 위치 지정 → 위치확정 → 중앙 말풍선에서 (반경 50m 기존 장소 후보 선택 **또는** 새 장소: 카테고리 → 이름 → 본문) → 저장.
- 저장은 **원자적 RPC** `create_note`로 place(신규 시)+post를 한 트랜잭션에 생성.
- 저장 후 지도 핀 **refetch**로 새 핀 즉시 반영.

### 제외 (명시적 이월)
- **사진 첨부 + Storage 버킷**: 방식 미확정 → 보류. Plan 3는 텍스트 노트만. 확정 후 fast-follow.
- **카테고리 필터 메뉴 / 핀 카운트 뱃지**: Plan 4.
- **검색 · 중첩 답글 작성 · 좋아요 · 신고**: Plan 4.

> Plan 3는 Plan 2의 읽기 자산(viewport 핀 + 상세 패널) 위에 얹혀 "작성→핀 등장→탭하면 패널에서 읽기" 루프를 독립적으로 완성·검증한다.

---

## 2. 데이터 모델 변경

### 신규 마이그레이션 `0011_place_category.sql`
```sql
create type public.place_category as enum
  ('restaurant', 'attraction', 'shopping', 'lodging', 'other');

alter table public.places
  add column category public.place_category not null default 'other';
```

- 카테고리는 **장소의 속성**(물리적 지점의 성격). 첫 생성자가 지정, 이후 그 장소에 다는 멘트는 카테고리를 상속.
- `default 'other'` — 기존 행 및 미지정 방어.

> **RPC 반환 확장은 Plan 4로 이월.** `places_in_bbox`/`nearby_places` 반환에 `category`를 더하는 건 필터 메뉴(소비자)가 있는 Plan 4에서 함께 한다. Plan 3는 컬럼 추가에만 그쳐 안정된 RPC를 소비자 없이 변경하지 않는다. (작성 플로우의 기존-장소 후보는 `create_note(in_place_id, …)`가 서버에서 카테고리를 상속하므로 클라이언트가 후보의 category를 알 필요가 없다.)

---

## 3. 백엔드 — `create_note` RPC

### 신규 마이그레이션 `0012_create_note.sql`
```sql
create or replace function public.create_note(
  in_place_id uuid,        -- 기존 장소에 달면 그 id, 새 장소면 NULL
  in_name     text,        -- 새 장소일 때만 사용
  in_lat      double precision,
  in_lng      double precision,
  in_category public.place_category,  -- 새 장소일 때만 사용
  in_body     text
)
returns table (post_id uuid, place_id uuid)
language plpgsql security invoker set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  new_post uuid;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  if in_place_id is null then
    insert into public.places (name, lat, lng, category, created_by)
    values (in_name, in_lat, in_lng, in_category, uid)
    returning id into pid;
  else
    pid := in_place_id;
  end if;

  insert into public.posts (place_id, author_id, body, parent_id)
  values (pid, uid, in_body, null)
  returning id into new_post;

  return query select new_post, pid;
end;
$$;
```

### 결정
- **`security invoker`** — 호출자의 RLS로 실행. `places_insert`/`posts_insert` 정책이 `created_by = auth.uid()` / `author_id = auth.uid()`를 강제하므로 위조 불가. 함수가 `uid`를 직접 박아 이중 보증.
- **원자성** — place(신규)+post를 한 함수 트랜잭션에 넣어 "장소만 생기고 멘트 실패" 부분상태 방지.
- **좌표 처리** — `places.lat/lng` 삽입 시 기존 `places_set_geog_trg` 트리거가 `geog` 자동 채움(변경 없음).
- 클라이언트는 이 RPC 하나만 호출. place·post를 각각 두 번 왕복하지 않음.

---

## 4. 작성 플로우 UX

### 상태 머신 (`ComposeNote`)
```
idle ──FAB tap──▶ locating ──confirm──▶ composing ──post──▶ idle(refetch)
                     │                       │
                   cancel                  cancel
                     ▼                       ▼
                    idle                    idle
```

### 단계
1. **진입** — 우하단 **FAB `＋`**. 로그인 상태에서만 활성. 비로그인 탭 시 "Sign in to leave a note" 유도(로그인 버튼 강조).
2. **위치 지정 (`locating`)**
   - Geolocation API로 현재 위치 획득 → 지도 센터 이동.
   - **GPS 거부/실패 → 현재 지도 중심 유지**(폴백, 에러 안내 토스트).
   - 화면 **정중앙에 고정 핀/십자선** 오버레이. 유저가 지도를 팬/줌해 중앙을 정확한 지점에 맞춤(핀은 중앙 고정, 지도가 움직임).
   - `Confirm location` / `Cancel`.
3. **작성 (`composing`)** — 위치확정 시 지도 중심 lat/lng 캡처 → `nearby_places(lat, lng, 50)` 조회 → **화면 정중앙 말풍선** 오픈:
   - **후보 있으면**: 상단에 "Add to a nearby place" 리스트(예: `○ Cheonggyecheon bench · 12m`). 선택 시 → 그 장소에 멘트 추가, **카테고리 상속**(카테고리 단계 건너뜀) → 본문 입력.
   - **후보 없거나 "＋ New place here" 선택 시**: **카테고리 5칩 선택 → 장소명 입력 → 본문(멘션) 입력**. (요구 순서: 카테고리 먼저 → 멘션.)
   - `Post` 버튼: 본문 비어있으면 비활성. 새 장소 경로는 name·category도 필수.
4. **저장/반영** — `create_note` 호출 → 성공 시 말풍선 닫힘, `idle` 복귀, **핀 refetch** → 새 핀 등장. 실패 시 말풍선 유지 + 에러 안내(재시도 가능).

### 중복 장소 방지
반경 50m 후보를 말풍선 상단에 눈에 띄게 노출하여 기존 장소 재사용을 유도. "＋ New place"는 별도 선택으로 한 번 더 의식하게 함.

---

## 5. 컴포넌트 / 파일

| 파일 | 역할 | 의존 |
|---|---|---|
| `lib/places/categories.ts` | 카테고리 5종 값+영어 라벨 상수, 타입 | — |
| `lib/geo/geolocation.ts` | `getCurrentPosition` 프라미스 래퍼(거부/타임아웃 폴백) | 브라우저 Geolocation |
| `lib/places/createNote.ts` | `create_note` RPC 얇은 래퍼(입력 정규화, 결과 반환) | supabase client |
| `components/ComposeNote.tsx` | 중앙 십자선 오버레이 + 중앙 말풍선, 상태머신, 후보/카테고리/본문 입력 | vis.gl `useMap`, createNote, nearby_places |
| `components/ComposeFab.tsx` | FAB + 작성모드 토글, 로그인 게이트 | AuthButton 상태 |
| `app/page.tsx` | ComposeFab/ComposeNote 배선 + 작성 후 `refreshKey`로 PlacePins refetch | — |
| `components/PlacePins.tsx` (수정) | `refreshKey` prop 수신 → effect 의존성에 추가해 refetch | 기존 |
| `components/MapView.tsx` (수정) | 작성모드 상태·refreshKey 전달, 중앙 오버레이 슬롯 | 기존 |

### 경계
- `ComposeNote`는 **지도 조작(useMap)과 저장(createNote)만** 알고, 렌더는 자기 말풍선 UI로 한정. 읽기 패널(`PlaceDetailPanel`)과 독립.
- `createNote` / `geolocation` / `categories`는 UI 없는 순수 모듈 → 유닛테스트 대상.

---

## 6. 테스트 (TDD 우선)

### DB (클라우드 Supabase, service_role/anon)
- `create_note` **신규 장소 경로**: `in_place_id=NULL` → `places` 1행(category·created_by=caller 확인) + `posts` 1행(parent_id NULL) 생성, 반환 id 일치.
- `create_note` **기존 장소 경로**: `in_place_id` 지정 → `places` 증가 없음, `posts`만 추가.
- **인증 필수**: anon 컨텍스트 호출 → 예외(`authentication required`) 또는 RLS 거부.
- **author/created_by 위조 불가**: 함수가 `auth.uid()`를 강제하므로 타 유저 id로 기록 불가.
- `places.category` 컬럼 기본값·enum 제약 확인(신규 장소 category 저장, 잘못된 값 거부).

### 유닛 (Vitest)
- `categories.ts`: 5종 값·라벨 매핑.
- `geolocation.ts`: 성공 시 좌표 반환, 거부/에러 시 폴백 신호.
- `createNote.ts`: 신규/기존 분기 인자 구성, RPC 호출 형태.

### 엣지케이스
- GPS 거부 → 지도 중심 폴백 + 안내.
- 빈 본문 → Post 비활성.
- 새 장소인데 name/category 미입력 → Post 비활성.
- 비로그인 작성 시도 → 로그인 유도.
- 저장 실패 → 말풍선 유지 + 재시도.
- 중복 장소 → 후보 강조로 재사용 유도.

---

## 7. 결정 요약

| # | 항목 | 결정 |
|---|---|---|
| 1 | 분해 | Plan 3 = 작성 플로우 + 카테고리(타이트). 검색·상호작용 Plan 4 |
| 2 | 카테고리 | 고정 enum 5종(restaurant/attraction/shopping/lodging/other) + 필터 All. `places`에 컬럼 |
| 3 | 작성 UI | 라이브 지도 + **화면 정중앙 고정 핀** + **중앙 말풍선** |
| 4 | 입력 순서 | (새 장소) 카테고리 → 이름 → 본문 |
| 5 | 위치 폴백 | GPS 거부 시 지도 중심 |
| 6 | 중복 방지 | 반경 50m 후보 노출·선택 유지 |
| 7 | 저장 | 원자적 `create_note` RPC(place 신규+post) |
| 8 | 사진 | **보류**(Storage 포함) → 후속 |
| 9 | 필터·카운트뱃지 | Plan 4 이월 |
