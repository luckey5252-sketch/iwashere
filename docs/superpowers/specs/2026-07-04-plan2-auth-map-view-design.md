# Plan 2 — 인증 + 지도 + 보기(읽기) 설계

- 작성일: 2026-07-04
- 상태: 승인됨 (브레인스토밍 완료)
- 상위 설계: [2026-07-01-iwashere-field-notes-map-design.md](2026-07-01-iwashere-field-notes-map-design.md)
- 선행: Plan 1(기반 + 백엔드 데이터 계층) 완료 — 스키마·지리/검색/좋아요 함수·RLS가 원격 Supabase에서 검증됨.

---

## 1. 범위

MVP 핵심 루프 중 **읽기 경로 + 인증**을 구현한다.

**포함:**
- Supabase 브라우저/서버 클라이언트(`@supabase/ssr`) + 세션 갱신 미들웨어.
- Google OAuth 로그인/로그아웃. 첫 로그인 시 `profiles` 행 **자동 생성**(DB 트리거).
- POI 숨긴 Google 베이스맵(vis.gl React 래퍼 + 코드 내 JSON 스타일).
- viewport(bbox) 안 장소 핀 로딩(`places_in_bbox` RPC).
- 핀 탭 → 장소 상세 패널: 멘트 **최신순 + 중첩답글 렌더(읽기 전용)**.

**범위 밖 (Plan 3 이후):**
- 멘트/답글 **작성**, 사진 업로드, 검색 UI, 좋아요/신고 **버튼**(상호작용). 상세 패널은 `like_count`를 숫자로 **표시만** 한다.
- 핀 클러스터링(YAGNI — 실제 과다 문제 발생 시 도입). `places_in_bbox`의 `max_results` 상한으로만 방어.
- E2E(Playwright)는 Plan 4.

**읽기는 비로그인도 가능**(RLS 공개읽기). 로그인은 Plan 3 쓰기의 기반으로 이번에 구축한다.

---

## 2. 검증 전략

Plan 1의 "모킹 없이 실 Supabase" TDD 기조를 유지하되, 자동테스트가 깨지기 쉬운 지도/OAuth 렌더링은 수동 확인으로 분리한다.

**로직 계층 TDD (자동):**
- 프로필 자동생성 트리거 — 실 Supabase(유저 생성 → 프로필 자동 존재).
- `buildThreadTree(rows)` 순수 트리빌더 — 픽스처 단위테스트(중첩·최신순·is_hidden 제외).
- `getPlaceThread(client, placeId)` — 실 Supabase 통합 1건(is_hidden 제외 확인).
- `boundsToBboxArgs(bounds)` 순수 변환 — 단위테스트.

**수동/브라우저 확인:**
- Google 로그인 종단(실 OAuth), 로그아웃, 세션 유지.
- 베이스맵에서 POI/transit 숨김.
- viewport 핀 표시 및 핀 탭 → 상세 패널.

---

## 3. 컴포넌트 구조 (유닛별 책임 · 의존 · 테스트)

### 3.1 Supabase 클라이언트 계층
- `lib/supabase/client.ts` — `createBrowserClient`(브라우저용, anon 키).
- `lib/supabase/server.ts` — `createServerClient`(서버 컴포넌트/라우트, 쿠키 기반).
- `middleware.ts` — 요청마다 세션 쿠키 갱신(`updateSession` 패턴).
- 의존: `@supabase/ssr`, `@supabase/supabase-js`. 테스트: 수동(세션 유지).

### 3.2 인증
- `components/AuthButton.tsx` — 로그인 시 `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`, 로그아웃 `signOut()`. 로그인 상태에 따라 아바타/로그아웃 표시.
- `app/auth/callback/route.ts` — OAuth 콜백. `exchangeCodeForSession(code)` 후 앱으로 리다이렉트.
- `supabase/migrations/0010_profile_on_signup.sql`:
  ```sql
  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public
  as $$
  begin
    insert into public.profiles (id, nickname, avatar_url)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'traveler'),
      coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
    )
    on conflict (id) do nothing;
    return new;
  end;
  $$;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
  ```
- 의존: `profiles` 테이블(Plan 1). 테스트: 실 Supabase — 메타데이터 있는/없는 유저 생성 → 프로필 자동 생성 및 값 확인.

### 3.3 지도
- `lib/map/basemap-style.ts` — POI/transit 라벨·아이콘을 끄는 인라인 Google Maps 스타일 배열(`featureType: poi/transit`, `stylers: visibility off`).
- `components/MapView.tsx` — `@vis.gl/react-google-maps`의 `<APIProvider>` + `<Map>`. `styles`에 위 배열 주입. 모바일 우선 전체화면. **세션당 1로드**(지도 인스턴스 재생성 금지).
- 의존: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. 테스트: 수동.

### 3.4 핀 로딩 (viewport → bbox → RPC)
- `lib/map/bounds.ts` — `boundsToBboxArgs(bounds)`: 지도 `LatLngBounds`를 `{ min_lng, min_lat, max_lng, max_lat, max_results }`로 변환(순수함수).
- `components/PlacePins.tsx` — 지도 `idle` 이벤트 디바운스 후 현재 bounds로 브라우저 클라이언트가 `places_in_bbox` 호출 → 마커 렌더. 핀 탭 → 상위(page) 상태로 선택 장소 id 전달.
- 의존: `places_in_bbox`(Plan 1). 테스트: `boundsToBboxArgs` 단위(순수). RPC 자체는 Plan 1에서 검증됨.

### 3.5 장소 상세 패널 (읽기)
- `lib/places/thread.ts`
  - `buildThreadTree(rows)` — 평면 posts 배열을 `parent_id` 기준 중첩 트리로 구성. 최상위(멘트)는 **최신순**, 각 노드에 `replies[]`. 순수함수.
  - `getPlaceThread(client, placeId)` — 해당 장소의 posts를 조회(RLS 공개읽기라 is_hidden=false만 노출) 후 `buildThreadTree` 반환. 사진·like_count 포함.
- `components/PlaceDetailPanel.tsx` — 모바일 하단 시트(데스크톱 사이드). 멘트/중첩답글/사진/like_count **읽기 렌더**. 상호작용 버튼 없음(Plan 3).
- 의존: `posts`/`post_photos`(Plan 1), RLS. 테스트: `buildThreadTree` 순수 단위 + `getPlaceThread` 실 Supabase 1건.

---

## 4. 데이터 흐름

1. 앱 로드 → `middleware`가 세션 쿠키 갱신 → 지도 화면 렌더(공개, 로그인 불필요).
2. 지도 `idle`(디바운스) → `boundsToBboxArgs` → `places_in_bbox` → 마커.
3. 마커 탭 → `getPlaceThread(placeId)` → 상세 패널에 중첩 스레드 렌더.
4. 로그인 버튼 → Google OAuth → `/auth/callback` 코드교환 → 세션 쿠키. **첫 가입 시** `on_auth_user_created` 트리거가 프로필 생성.

---

## 5. Plan 1 테스트 리팩터 (트리거 도입 영향)

프로필 트리거가 가입 시 `profiles`를 자동 생성하므로, Plan 1 테스트들의 수동 `profiles.insert(...)`는 자동생성 행과 **PK 충돌**한다. 실제 동작(가입=프로필)을 진실로 삼아 정리한다:

- `tests/helpers/supabase.ts`의 `createTestUser()`는 "프로필이 이미 존재함"을 전제로 반환(필요 시 프로필 조회/대기 헬퍼 제공).
- Plan 1 DB 테스트들에서 수동 `profiles.insert({ id, nickname })` 제거. 닉네임이 특정값이어야 하는 곳은 `update`로 대체.
- 트리거 함수는 `on conflict (id) do nothing`으로 방어.
- 회귀: `npm test` 전체 그린 유지.

---

## 6. 환경변수 & 설정

`.env.local`(커밋 금지, `.env*` 무시됨):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 브라우저 클라이언트.
- `SUPABASE_SERVICE_ROLE_KEY` — 서버 전용(노출 금지).
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — HTTP referrer 제한 필수.

콘솔 설정(코드 밖):
- Google Cloud: Maps JavaScript API 활성화 + API 키(referrer 제한). OAuth 2.0 클라이언트(승인된 리다이렉트 URI에 Supabase 콜백 URL).
- Supabase 대시보드: Auth → Google provider에 Client ID/Secret 입력. Redirect URLs에 로컬/배포 도메인 등록.

`.env.test`(Plan 1)는 그대로 유지 — 앱은 `NEXT_PUBLIC_` 접두 변수를 별도로 쓴다.

---

## 7. 파일 구조 (신규/수정)

```
middleware.ts                              # 신규 — 세션 갱신
lib/supabase/client.ts                     # 신규
lib/supabase/server.ts                     # 신규
lib/map/basemap-style.ts                   # 신규 — POI off 스타일
lib/map/bounds.ts                          # 신규 — boundsToBboxArgs (순수)
lib/places/thread.ts                       # 신규 — buildThreadTree(순수) + getPlaceThread
app/layout.tsx                             # 수정 — 메타/뷰포트
app/page.tsx                               # 수정 — 지도 화면 조립
app/auth/callback/route.ts                 # 신규 — OAuth 콜백
components/MapView.tsx                      # 신규
components/PlacePins.tsx                    # 신규
components/PlaceDetailPanel.tsx            # 신규 — 읽기 전용
components/AuthButton.tsx                   # 신규
supabase/migrations/0010_profile_on_signup.sql  # 신규 — 트리거
tests/db/profile_on_signup.test.ts         # 신규 — 트리거 TDD
tests/lib/bounds.test.ts                   # 신규 — 순수 단위
tests/lib/thread.test.ts                   # 신규 — buildThreadTree 순수 + getPlaceThread 통합
tests/helpers/supabase.ts                  # 수정 — 프로필 자동생성 전제
tests/db/*.test.ts (Plan 1)                # 수정 — 수동 profiles.insert 제거
```

의존성 추가: `@supabase/ssr`, `@vis.gl/react-google-maps`.

---

## 8. 엣지케이스

- 세션 만료 → middleware가 갱신, 실패 시 비로그인 상태로 강등(읽기는 계속 가능).
- 지도 API 키 누락/오류 → 명확한 안내(빈 지도 방지).
- viewport에 장소 없음 → 빈 상태(핀 없음, 안내는 Plan 3 작성 유도와 연결).
- 상세 패널: 답글 없는 멘트 → replies 빈 배열, 정상 렌더.
- OAuth 콜백 실패(코드 없음/교환 실패) → 로그인 화면으로 안전 복귀.

---

## 9. 다음 Plan

- **Plan 3 — 작성 + 검색 + 상호작용**: 현장 멘트 작성(geolocation+핀+후보추천+장소생성+사진압축), 검색 UI, 답글·좋아요·신고 버튼.
- **Plan 4 — E2E**: Playwright로 로그인→작성→검색→답글 종단 검증.
