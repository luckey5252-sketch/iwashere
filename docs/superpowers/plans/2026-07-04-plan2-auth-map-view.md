# Plan 2: 인증 + 지도 + 보기(읽기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iwashere MVP의 읽기 경로와 인증을 구현한다 — Google 로그인(첫 로그인 시 프로필 자동 생성), POI 숨긴 베이스맵, viewport 핀 로딩, 장소 상세 패널(중첩답글 읽기).

**Architecture:** Next.js(App Router) + `@supabase/ssr`로 브라우저/서버 세션을 다루고, 지도는 `@vis.gl/react-google-maps`로 렌더하되 POI는 코드 내 인라인 스타일로 숨긴다. 테스트 가치가 있는 로직(프로필 트리거, bbox 변환, 답글 트리 빌더)은 실 Supabase/순수 단위로 TDD하고, 지도·OAuth 렌더링은 얇은 어댑터로 두어 브라우저에서 수동 확인한다.

**Tech Stack:** Next.js 16(App Router), TypeScript, `@supabase/ssr`, `@supabase/supabase-js`, `@vis.gl/react-google-maps`, Vitest, 원격 Supabase(PostGIS/pg_trgm).

## Global Constraints

- Node ≥ 22 (설치본 24.18 LTS).
- 비밀키는 `.env.local`/`.env.test`에만 두고 절대 커밋하지 않는다(`.gitignore`의 `.env*` 적용). 클라이언트 노출 키(`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`)는 HTTP referrer 제한 필수.
- Google 의존은 베이스맵 표시뿐 — Places/검색 API 미사용. 검색은 Plan 3.
- Google Maps는 **세션당 지도 1로드** 원칙(지도 인스턴스 재생성 금지).
- UI 언어 영어 기본.
- 테스트는 모킹 없이 실 Supabase에 붙는다(Plan 1 기조). 원격 프로젝트 ref `oxmdrwwfejvxkqwzkofw`, 리전 ap-northeast-2.
- 마이그레이션 push는 세션 풀러로: `npx supabase db push --db-url "postgresql://postgres.oxmdrwwfejvxkqwzkofw:<DB_PW>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"` (이 PC엔 psql 없음, 직접연결 호스트는 IPv4 미해석).
- 상세 패널은 **읽기 전용** — 좋아요/답글/신고 버튼은 Plan 3.

---

## File Structure

```
package.json                               # 수정 — 의존성 추가
.env.local                                 # 신규(커밋 금지) — NEXT_PUBLIC_* 키
middleware.ts                              # 신규 — 세션 갱신 진입점
lib/supabase/client.ts                     # 신규 — 브라우저 클라이언트
lib/supabase/server.ts                     # 신규 — 서버 클라이언트
lib/supabase/middleware.ts                 # 신규 — updateSession
lib/map/basemap-style.ts                   # 신규 — POI off 스타일 배열
lib/map/bounds.ts                          # 신규 — boundsToBboxArgs (순수)
lib/places/thread.ts                       # 신규 — buildThreadTree(순수) + getPlaceThread
supabase/migrations/0010_profile_on_signup.sql  # 신규 — 프로필 자동생성 트리거
components/MapView.tsx                      # 신규
components/PlacePins.tsx                    # 신규
components/PlaceDetailPanel.tsx            # 신규 — 읽기 전용
components/AuthButton.tsx                   # 신규
app/auth/callback/route.ts                 # 신규 — OAuth 콜백
app/page.tsx                               # 수정 — 지도 화면 조립
tests/db/profile_on_signup.test.ts         # 신규 — 트리거 TDD
tests/lib/bounds.test.ts                   # 신규 — 순수 단위
tests/lib/thread.test.ts                   # 신규 — 트리빌더 순수 + getPlaceThread 통합
tests/helpers/supabase.ts                  # 수정 — 프로필 자동생성 전제
tests/db/*.test.ts (Plan 1)                # 수정 — 수동 profiles.insert 제거
```

각 파일은 하나의 책임만 진다. 로직(테스트 대상)과 렌더(수동 확인)를 파일 경계로 분리한다.

---

### Task 1: 의존성 + Supabase 클라이언트 계층 + 세션 미들웨어

**Files:**
- Modify: `package.json` (의존성)
- Create: `.env.local` (커밋 금지)
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `createClient()` (브라우저) → `SupabaseClient` — 이후 컴포넌트에서 사용.
  - `createClient()` (서버, async) → `Promise<SupabaseClient>` — 콜백 라우트에서 사용.
  - `updateSession(request)` → `NextResponse` — 미들웨어에서 사용.

- [ ] **Step 1: 의존성 설치**

```bash
npm install @supabase/ssr @vis.gl/react-google-maps
npm install -D @types/google.maps
```

- [ ] **Step 2: `.env.local` 작성 (커밋 금지)**

`.env.local` (anon 키는 공개용이라 노출 안전, 지도 키는 사용자가 발급):

```
NEXT_PUBLIC_SUPABASE_URL=https://oxmdrwwfejvxkqwzkofw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94bWRyd3dmZWp2eGtxd3prb2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNzEzMDEsImV4cCI6MjA5ODY0NzMwMX0.y1n9E0gpcer9UGO-CrGvS0Kyd89PbHey0kGF_2BcnSU
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<Google Cloud에서 발급한 Maps JS API 키>
```

확인: `git check-ignore .env.local` → `.env.local` 출력되면 무시됨(OK).

- [ ] **Step 3: 브라우저 클라이언트 작성**

`lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 4: 서버 클라이언트 작성**

`lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // 서버 컴포넌트에서 호출된 경우 무시 — 미들웨어가 세션을 갱신함
          }
        },
      },
    },
  )
}
```

- [ ] **Step 5: updateSession 작성**

`lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // 세션 갱신 — getUser() 호출이 만료 토큰을 리프레시한다.
  await supabase.auth.getUser()

  return supabaseResponse
}
```

- [ ] **Step 6: 루트 미들웨어 작성**

`middleware.ts`:

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 7: 타입체크로 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음(0 errors).

- [ ] **Step 8: 커밋**

```bash
git add package.json package-lock.json lib/supabase middleware.ts
git commit -m "feat(auth): supabase ssr client layer + session middleware"
```

> `.env.local`은 커밋되지 않는다(무시됨). 정상.

---

### Task 2: 프로필 자동생성 트리거 + Plan 1 테스트 리팩터

**Files:**
- Create: `supabase/migrations/0010_profile_on_signup.sql`
- Create: `tests/db/profile_on_signup.test.ts`
- Modify: `tests/helpers/supabase.ts`
- Modify: `tests/db/profiles.test.ts`, `tests/db/rls.test.ts`, `tests/db/places.test.ts`, `tests/db/posts.test.ts`, `tests/db/post_photos.test.ts`, `tests/db/likes.test.ts`, `tests/db/reports.test.ts`, `tests/db/geo_functions.test.ts`, `tests/db/search.test.ts`, `tests/db/toggle_like.test.ts`

**Interfaces:**
- Consumes: `profiles` 테이블, `serviceClient`, `cleanup`(Plan 1)
- Produces: `auth.users` insert 시 `public.profiles` 자동 생성. 이후 모든 테스트에서 `createTestUser()` 뒤 프로필이 이미 존재함이 보장됨.

- [ ] **Step 1: 실패하는 트리거 테스트 작성**

`tests/db/profile_on_signup.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('profile auto-creation on signup', () => {
  it('creates a profile from user metadata', async () => {
    const admin = serviceClient()
    const { data, error } = await admin.auth.admin.createUser({
      email: `sig_${Date.now()}@example.com`,
      password: 'password123!',
      email_confirm: true,
      user_metadata: { full_name: 'Jane Traveler', avatar_url: 'https://x/a.png' },
    })
    expect(error).toBeNull()
    const uid = data.user!.id
    const { data: prof } = await admin.from('profiles').select('*').eq('id', uid).single()
    expect(prof!.nickname).toBe('Jane Traveler')
    expect(prof!.avatar_url).toBe('https://x/a.png')
  })

  it('falls back to default nickname without metadata', async () => {
    const admin = serviceClient()
    const { data } = await admin.auth.admin.createUser({
      email: `sig2_${Date.now()}@example.com`,
      password: 'password123!',
      email_confirm: true,
    })
    const uid = data.user!.id
    const { data: prof } = await admin.from('profiles').select('nickname').eq('id', uid).single()
    expect(prof!.nickname).toBe('traveler')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/profile_on_signup.test.ts`
Expected: FAIL (프로필이 자동 생성되지 않아 `.single()`이 0행 → 에러/실패).

- [ ] **Step 3: 트리거 마이그레이션 작성**

`supabase/migrations/0010_profile_on_signup.sql`:

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

- [ ] **Step 4: 원격에 push**

Run: `npx supabase db push --db-url "postgresql://postgres.oxmdrwwfejvxkqwzkofw:<DB_PW>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"`
Expected: `Applying migration 0010_profile_on_signup.sql...` 후 `Finished supabase db push.` (Docker 경고는 무시).

- [ ] **Step 5: 트리거 테스트 통과 확인**

Run: `npm test -- tests/db/profile_on_signup.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: 테스트 헬퍼 정리**

`tests/helpers/supabase.ts`의 `createTestUser` 상단에 주석으로 계약을 명시(코드 변경은 없으나 의미 고정). `createTestUser`가 반환될 때 트리거가 이미 프로필을 만들었음을 문서화:

`createTestUser` 함수 본문 `return { id: data.user!.id, client }` 바로 위에 다음 주석을 추가:

```ts
  // on_auth_user_created 트리거가 이 시점에 public.profiles 행을 이미 생성했다.
  // 따라서 호출부는 profiles를 수동 insert하면 안 된다(PK 충돌).
```

- [ ] **Step 7: `profiles.test.ts` 재작성 (수동 insert → 자동생성 검증)**

`tests/db/profiles.test.ts` 전체를 다음으로 교체:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('profiles', () => {
  it('auto-creates a profile row for a new auth user', async () => {
    const { id } = await createTestUser()
    const db = serviceClient()
    const { data } = await db.from('profiles').select('*').eq('id', id).single()
    expect(data!.id).toBe(id)
    expect(typeof data!.nickname).toBe('string')
  })

  it('allows the owner to update their nickname', async () => {
    const { id } = await createTestUser()
    const db = serviceClient()
    const { error } = await db.from('profiles').update({ nickname: 'tester' }).eq('id', id)
    expect(error).toBeNull()
    const { data } = await db.from('profiles').select('nickname').eq('id', id).single()
    expect(data!.nickname).toBe('tester')
  })
})
```

- [ ] **Step 8: `rls.test.ts`의 수동 프로필 insert 제거**

`tests/db/rls.test.ts`에서 아래 라인을 삭제한다(프로필은 이제 자동 생성됨):

```ts
    await admin.from('profiles').insert([{ id: owner.id, nickname: 'o' }, { id: attacker.id, nickname: 'a' }])
```

- [ ] **Step 9: 나머지 Plan 1 테스트의 수동 프로필 insert 제거**

다음 파일들에서 `from('profiles').insert(...)` 호출 라인을 모두 삭제한다. 위치 확인:

Run: `git grep -n "from('profiles').insert" tests/db/places.test.ts tests/db/posts.test.ts tests/db/post_photos.test.ts tests/db/likes.test.ts tests/db/reports.test.ts tests/db/geo_functions.test.ts tests/db/search.test.ts tests/db/toggle_like.test.ts`

각 매칭 라인(예: `await db.from('profiles').insert({ id: uid, nickname: 'u' })`)을 삭제한다. 이 라인들은 부수효과만 있고 반환값을 쓰지 않으므로 삭제해도 다른 코드가 깨지지 않는다.

- [ ] **Step 10: 전체 회귀 테스트**

Run: `npm test`
Expected: 모든 테스트 PASS(Plan 1 16개 + 트리거 2개). 프로필 PK 충돌 없음.

- [ ] **Step 11: 커밋**

```bash
git add supabase/migrations/0010_profile_on_signup.sql tests/
git commit -m "feat(auth): auto-create profile on signup + refactor fixtures"
```

---

### Task 3: bbox 변환 순수 함수

**Files:**
- Create: `lib/map/bounds.ts`
- Test: `tests/lib/bounds.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `BboxArgs` = `{ min_lng, min_lat, max_lng, max_lat, max_results }` (모두 number) — `places_in_bbox` RPC 인자.
  - `boundsToBboxArgs(bounds, maxResults?=200)` → `BboxArgs`. `bounds`는 `getSouthWest()`/`getNorthEast()`가 `{ lat(), lng() }`를 주는 객체(google.maps.LatLngBounds 호환).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/lib/bounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { boundsToBboxArgs } from '@/lib/map/bounds'

function fakeBounds(swLat: number, swLng: number, neLat: number, neLng: number) {
  return {
    getSouthWest: () => ({ lat: () => swLat, lng: () => swLng }),
    getNorthEast: () => ({ lat: () => neLat, lng: () => neLng }),
  }
}

describe('boundsToBboxArgs', () => {
  it('maps SW/NE corners to bbox args', () => {
    const args = boundsToBboxArgs(fakeBounds(37.55, 126.96, 37.58, 126.99))
    expect(args).toEqual({
      min_lat: 37.55, min_lng: 126.96, max_lat: 37.58, max_lng: 126.99, max_results: 200,
    })
  })

  it('honors a custom maxResults', () => {
    const args = boundsToBboxArgs(fakeBounds(0, 0, 1, 1), 50)
    expect(args.max_results).toBe(50)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/lib/bounds.test.ts`
Expected: FAIL (Cannot find module '@/lib/map/bounds').

- [ ] **Step 3: 구현 작성**

`lib/map/bounds.ts`:

```ts
export interface BboxArgs {
  min_lng: number
  min_lat: number
  max_lng: number
  max_lat: number
  max_results: number
}

interface LatLngLike {
  lat(): number
  lng(): number
}

export interface BoundsLike {
  getSouthWest(): LatLngLike
  getNorthEast(): LatLngLike
}

export function boundsToBboxArgs(bounds: BoundsLike, maxResults = 200): BboxArgs {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  return {
    min_lng: sw.lng(),
    min_lat: sw.lat(),
    max_lng: ne.lng(),
    max_lat: ne.lat(),
    max_results: maxResults,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/lib/bounds.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: 커밋**

```bash
git add lib/map/bounds.ts tests/lib/bounds.test.ts
git commit -m "feat(map): boundsToBboxArgs pure transform"
```

---

### Task 4: 답글 트리 빌더 + getPlaceThread

**Files:**
- Create: `lib/places/thread.ts`
- Test: `tests/lib/thread.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `anonClient`, `createTestUser`, `cleanup`(Plan 1); `posts`/`places` 테이블.
- Produces:
  - `PostRow` = `{ id, parent_id: string|null, author_id, body, like_count: number, created_at: string }`.
  - `ThreadNode` = `PostRow & { replies: ThreadNode[] }`.
  - `buildThreadTree(rows: PostRow[])` → `ThreadNode[]` — 최상위는 **최신순**, `replies`는 **오래된순**(대화 순서).
  - `getPlaceThread(client, placeId)` → `Promise<ThreadNode[]>` — 장소의 posts를 조회(RLS로 is_hidden 제외) 후 트리 구성.

- [ ] **Step 1: 실패하는 순수 트리빌더 테스트 작성**

`tests/lib/thread.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { buildThreadTree, getPlaceThread, type PostRow } from '@/lib/places/thread'
import { serviceClient, anonClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

function row(id: string, parent: string | null, created: string): PostRow {
  return { id, parent_id: parent, author_id: 'a', body: id, like_count: 0, created_at: created }
}

describe('buildThreadTree', () => {
  it('orders top-level newest-first and replies oldest-first', () => {
    const rows: PostRow[] = [
      row('m1', null, '2026-07-01T00:00:00Z'),
      row('m2', null, '2026-07-02T00:00:00Z'),
      row('r1', 'm2', '2026-07-02T01:00:00Z'),
      row('r2', 'm2', '2026-07-02T02:00:00Z'),
    ]
    const tree = buildThreadTree(rows)
    expect(tree.map((n) => n.id)).toEqual(['m2', 'm1']) // 최신 멘트가 위
    expect(tree[0].replies.map((n) => n.id)).toEqual(['r1', 'r2']) // 답글은 오래된순
    expect(tree[1].replies).toEqual([])
  })

  it('treats a reply with an unknown parent as a root', () => {
    const tree = buildThreadTree([row('x', 'missing', '2026-07-01T00:00:00Z')])
    expect(tree.map((n) => n.id)).toEqual(['x'])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/lib/thread.test.ts`
Expected: FAIL (Cannot find module '@/lib/places/thread').

- [ ] **Step 3: 트리빌더 + 페치 구현**

`lib/places/thread.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PostRow {
  id: string
  parent_id: string | null
  author_id: string
  body: string
  like_count: number
  created_at: string
}

export interface ThreadNode extends PostRow {
  replies: ThreadNode[]
}

export function buildThreadTree(rows: PostRow[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>()
  for (const r of rows) byId.set(r.id, { ...r, replies: [] })

  const roots: ThreadNode[] = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) parent.replies.push(node)
    else roots.push(node)
  }

  const newestFirst = (a: ThreadNode, b: ThreadNode) => b.created_at.localeCompare(a.created_at)
  const oldestFirst = (a: ThreadNode, b: ThreadNode) => a.created_at.localeCompare(b.created_at)
  roots.sort(newestFirst)
  for (const node of byId.values()) node.replies.sort(oldestFirst)
  return roots
}

export async function getPlaceThread(
  client: SupabaseClient,
  placeId: string,
): Promise<ThreadNode[]> {
  const { data, error } = await client
    .from('posts')
    .select('id, parent_id, author_id, body, like_count, created_at')
    .eq('place_id', placeId)
  if (error) throw error
  return buildThreadTree((data ?? []) as PostRow[])
}
```

- [ ] **Step 4: 순수 테스트 통과 확인**

Run: `npm test -- tests/lib/thread.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: getPlaceThread 통합 테스트 추가 (실 Supabase, RLS로 is_hidden 제외)**

`tests/lib/thread.test.ts` 끝에 아래 describe 추가:

```ts
describe('getPlaceThread (integration)', () => {
  it('returns a nested thread and excludes hidden posts for anon', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    const { data: place } = await db.from('places')
      .insert({ name: 'P', lat: 37.5, lng: 127, created_by: uid }).select('id').single()

    const { data: top } = await db.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'top', is_hidden: false })
      .select('id').single()
    await db.from('posts').insert([
      { place_id: place!.id, author_id: uid, parent_id: top!.id, body: 'reply', is_hidden: false },
      { place_id: place!.id, author_id: uid, body: 'secret', is_hidden: true },
    ])

    const tree = await getPlaceThread(anonClient(), place!.id)
    expect(tree.length).toBe(1) // 숨김 멘트 제외 → 최상위 1개
    expect(tree[0].body).toBe('top')
    expect(tree[0].replies.map((r) => r.body)).toEqual(['reply'])
  })
})
```

- [ ] **Step 6: 통합 테스트 통과 확인**

Run: `npm test -- tests/lib/thread.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 7: 커밋**

```bash
git add lib/places/thread.ts tests/lib/thread.test.ts
git commit -m "feat(view): thread tree builder + getPlaceThread"
```

---

### Task 5: 베이스맵 (MapView + POI 숨김 스타일)

**Files:**
- Create: `lib/map/basemap-style.ts`, `components/MapView.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- Produces:
  - `BASEMAP_STYLE: google.maps.MapTypeStyle[]` — POI/transit 숨김.
  - `<MapView onSelectPlace={(id: string) => void} />` — 전체화면 지도. (핀은 Task 6에서 주입)

> **선행 설정(사용자, 코드 밖):** Google Cloud Console → Maps JavaScript API 활성화 → API 키 발급 → HTTP referrer 제한(`localhost:3000/*` 및 배포 도메인). 키를 `.env.local`의 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`에 기입.

- [ ] **Step 1: POI 숨김 스타일 작성**

`lib/map/basemap-style.ts`:

```ts
// 베이스맵에서 구글 기본 POI/대중교통 라벨·아이콘을 숨긴다.
// 핀은 오직 사용자가 남긴 멘트(DB)에서만 생성된다.
export const BASEMAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]
```

- [ ] **Step 2: MapView 작성**

`components/MapView.tsx`:

```tsx
'use client'

import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { BASEMAP_STYLE } from '@/lib/map/basemap-style'

const SEOUL = { lat: 37.5665, lng: 126.978 }

export function MapView({ onSelectPlace }: { onSelectPlace: (id: string) => void }) {
  // onSelectPlace는 Task 6에서 PlacePins로 전달된다(현재는 미사용 자리표시).
  void onSelectPlace
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <Map
        defaultCenter={SEOUL}
        defaultZoom={15}
        disableDefaultUI
        clickableIcons={false}
        styles={BASEMAP_STYLE}
        style={{ width: '100%', height: '100dvh' }}
      />
    </APIProvider>
  )
}
```

- [ ] **Step 3: page.tsx에서 지도 렌더**

`app/page.tsx` 전체를 다음으로 교체:

```tsx
'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'

export default function Home() {
  const [, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <MapView onSelectPlace={setPlaceId} />
    </main>
  )
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: 수동 확인 (브라우저)**

Run: `npm run dev` → 브라우저로 `http://localhost:3000` 접속.
Expected:
- 서울 중심 지도가 전체화면으로 뜬다.
- 가게/명소 등 **구글 기본 POI 라벨·아이콘이 보이지 않는다**(깔끔한 베이스맵).
- 콘솔에 지도 API 키 오류가 없다.

문제 시: 키 referrer 제한에 `localhost:3000/*` 포함됐는지, `.env.local` 저장 후 dev 서버 재시작했는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add lib/map/basemap-style.ts components/MapView.tsx app/page.tsx
git commit -m "feat(map): POI-hidden basemap via vis.gl"
```

---

### Task 6: viewport 핀 로딩 (PlacePins)

**Files:**
- Create: `components/PlacePins.tsx`
- Modify: `components/MapView.tsx`

**Interfaces:**
- Consumes: `boundsToBboxArgs`(Task 3), `createClient`(Task 1, 브라우저), `places_in_bbox` RPC(Plan 1), `@vis.gl/react-google-maps`의 `useMap`/`Marker`.
- Produces: `<PlacePins onSelectPlace={(id) => void} />` — 지도 idle 시 현재 bbox의 장소를 마커로 표시, 마커 클릭 시 `onSelectPlace(id)`.

- [ ] **Step 1: PlacePins 작성**

`components/PlacePins.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { createClient } from '@/lib/supabase/client'
import { boundsToBboxArgs } from '@/lib/map/bounds'

interface PlacePin {
  id: string
  name: string
  lat: number
  lng: number
}

export function PlacePins({ onSelectPlace }: { onSelectPlace: (id: string) => void }) {
  const map = useMap()
  const [pins, setPins] = useState<PlacePin[]>([])

  useEffect(() => {
    if (!map) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout>

    const load = async () => {
      const bounds = map.getBounds()
      if (!bounds) return
      const { data } = await supabase.rpc('places_in_bbox', boundsToBboxArgs(bounds))
      setPins((data ?? []) as PlacePin[])
    }

    const listener = map.addListener('idle', () => {
      clearTimeout(timer)
      timer = setTimeout(load, 300) // 디바운스 — 팬/줌 연속 이동 시 과호출 방지
    })

    return () => {
      listener.remove()
      clearTimeout(timer)
    }
  }, [map])

  return (
    <>
      {pins.map((p) => (
        <Marker
          key={p.id}
          position={{ lat: p.lat, lng: p.lng }}
          onClick={() => onSelectPlace(p.id)}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 2: MapView에서 PlacePins 주입**

`components/MapView.tsx`의 `<Map>` 자식으로 핀을 넣고 자리표시 코드를 제거한다. `void onSelectPlace` 라인을 삭제하고, `import { PlacePins } from './PlacePins'`를 추가한 뒤 `<Map ...>`를 다음처럼 자식을 갖도록 변경:

```tsx
      <Map
        defaultCenter={SEOUL}
        defaultZoom={15}
        disableDefaultUI
        clickableIcons={false}
        styles={BASEMAP_STYLE}
        style={{ width: '100%', height: '100dvh' }}
      >
        <PlacePins onSelectPlace={onSelectPlace} />
      </Map>
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: 수동 확인 (시드 데이터로 핀 표시)**

먼저 서울 시청 근처 테스트 장소 1개를 시드한다(원격 DB). 임시 스크립트 `tmp_seed.mjs` 작성:

```js
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.test' })
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: u } = await db.auth.admin.createUser({ email: `seed_${Date.now()}@example.com`, password: 'password123!', email_confirm: true })
const uid = u.user.id // 트리거가 프로필 자동 생성
const { data: place } = await db.from('places').insert({ name: 'Seed Ramen', lat: 37.5665, lng: 126.978, created_by: uid }).select('id').single()
await db.from('posts').insert({ place_id: place.id, author_id: uid, body: 'seed note', is_hidden: false })
console.log('seeded place', place.id)
```

Run: `node tmp_seed.mjs` 후 `npm run dev` → `http://localhost:3000`.
Expected: 서울 시청 위치에 마커가 뜬다. 지도를 팬/줌하면 idle 후 핀이 갱신된다.

정리: `rm tmp_seed.mjs` (시드 데이터는 Task 7 확인에도 재사용하므로 DB에 남겨둔다).

- [ ] **Step 5: 커밋**

```bash
git add components/PlacePins.tsx components/MapView.tsx
git commit -m "feat(map): load place pins for viewport bbox"
```

---

### Task 7: 장소 상세 패널 (읽기 전용)

**Files:**
- Create: `components/PlaceDetailPanel.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `getPlaceThread`/`ThreadNode`(Task 4), `createClient`(Task 1, 브라우저).
- Produces: `<PlaceDetailPanel placeId={string|null} onClose={() => void} />` — 선택 장소의 중첩 스레드를 읽기 렌더. `placeId`가 null이면 렌더 안 함.

- [ ] **Step 1: PlaceDetailPanel 작성**

`components/PlaceDetailPanel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPlaceThread, type ThreadNode } from '@/lib/places/thread'

function ThreadItem({ node, depth }: { node: ThreadNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 16, paddingBlock: 6, borderTop: '1px solid #eee' }}>
      <p style={{ margin: 0 }}>{node.body}</p>
      <small style={{ color: '#888' }}>♥ {node.like_count}</small>
      {node.replies.map((r) => (
        <ThreadItem key={r.id} node={r} depth={depth + 1} />
      ))}
    </div>
  )
}

export function PlaceDetailPanel({
  placeId,
  onClose,
}: {
  placeId: string | null
  onClose: () => void
}) {
  const [thread, setThread] = useState<ThreadNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!placeId) return
    setLoading(true)
    const supabase = createClient()
    getPlaceThread(supabase, placeId)
      .then(setThread)
      .catch(() => setThread([]))
      .finally(() => setLoading(false))
  }, [placeId])

  if (!placeId) return null

  return (
    <aside
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: '50dvh',
        overflow: 'auto',
        background: '#fff',
        borderTop: '1px solid #ddd',
        padding: 16,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
      }}
    >
      <button onClick={onClose} style={{ float: 'right' }}>
        Close
      </button>
      {loading ? (
        <p>Loading…</p>
      ) : thread.length === 0 ? (
        <p>No notes yet.</p>
      ) : (
        thread.map((n) => <ThreadItem key={n.id} node={n} depth={0} />)
      )}
    </aside>
  )
}
```

- [ ] **Step 2: page.tsx에서 패널 연결**

`app/page.tsx` 전체를 다음으로 교체:

```tsx
'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'
import { PlaceDetailPanel } from '@/components/PlaceDetailPanel'

export default function Home() {
  const [placeId, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <MapView onSelectPlace={setPlaceId} />
      <PlaceDetailPanel placeId={placeId} onClose={() => setPlaceId(null)} />
    </main>
  )
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: 수동 확인**

Run: `npm run dev` → `http://localhost:3000` (Task 6에서 시드한 'Seed Ramen' 핀 존재).
Expected:
- 핀 클릭 → 하단 패널이 열리고 'seed note' 멘트가 보인다.
- like_count가 `♥ 0`으로 표시된다.
- Close 클릭 → 패널이 닫힌다.
- 답글이 있으면 들여쓰기되어 렌더된다(오래된순).

- [ ] **Step 5: 커밋**

```bash
git add components/PlaceDetailPanel.tsx app/page.tsx
git commit -m "feat(view): read-only place detail panel with nested replies"
```

---

### Task 8: Google 로그인 (AuthButton + OAuth 콜백)

**Files:**
- Create: `components/AuthButton.tsx`, `app/auth/callback/route.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `createClient`(Task 1, 브라우저/서버).
- Produces: `<AuthButton />` — 로그인/로그아웃 토글. `GET /auth/callback` — OAuth 코드 교환 후 홈으로 리다이렉트.

> **선행 설정(사용자, 코드 밖):**
> 1. Google Cloud Console → OAuth 동의 화면 구성 → OAuth 2.0 클라이언트 ID 생성. 승인된 리다이렉트 URI에 Supabase 콜백 `https://oxmdrwwfejvxkqwzkofw.supabase.co/auth/v1/callback` 추가.
> 2. Supabase 대시보드 → Authentication → Providers → Google 활성화 → Client ID/Secret 입력.
> 3. Supabase → Authentication → URL Configuration → Redirect URLs에 `http://localhost:3000/**` 추가.

- [ ] **Step 1: OAuth 콜백 라우트 작성**

`app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(origin)
}
```

- [ ] **Step 2: AuthButton 작성**

`components/AuthButton.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (user) {
    return (
      <button onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    )
  }

  return (
    <button
      onClick={() =>
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        })
      }
    >
      Sign in with Google
    </button>
  )
}
```

- [ ] **Step 3: page.tsx에 로그인 버튼 배치**

`app/page.tsx` 전체를 다음으로 교체(지도 위 우상단 오버레이):

```tsx
'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'
import { PlaceDetailPanel } from '@/components/PlaceDetailPanel'
import { AuthButton } from '@/components/AuthButton'

export default function Home() {
  const [placeId, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 10 }}>
        <AuthButton />
      </div>
      <MapView onSelectPlace={setPlaceId} />
      <PlaceDetailPanel placeId={placeId} onClose={() => setPlaceId(null)} />
    </main>
  )
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: 수동 확인 (실제 Google 로그인)**

Run: `npm run dev` → `http://localhost:3000`.
Expected:
- 우상단 "Sign in with Google" 버튼 → 클릭 → 구글 동의 화면 → 승인 후 홈으로 복귀.
- 버튼이 "Sign out"으로 바뀐다.
- Supabase 대시보드 → Table editor → `profiles`에 방금 로그인한 계정 행이 **자동 생성**돼 있다(닉네임=구글 이름).
- "Sign out" 클릭 → 다시 "Sign in with Google"로 바뀐다.

- [ ] **Step 6: 커밋**

```bash
git add components/AuthButton.tsx app/auth/callback/route.ts app/page.tsx
git commit -m "feat(auth): Google sign-in button + OAuth callback"
```

---

### Task 9: 전체 회귀 + Plan 2 마무리

**Files:** 없음(검증/문서)

- [ ] **Step 1: 전체 자동 테스트 회귀**

Run: `npm test`
Expected: 전체 PASS (Plan 1 16 + 트리거 2 + bounds 2 + thread 3 = 23 passed).

- [ ] **Step 2: 타입체크 + 프로덕션 빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 타입 에러 0, 빌드 성공.

- [ ] **Step 3: 핵심 읽기 루프 수동 확인 (엔드투엔드)**

Run: `npm run dev`
Expected(한 세션에서 순서대로):
1. POI 숨긴 베이스맵이 뜬다.
2. 시드 핀이 보이고, 팬/줌 시 idle 후 핀이 갱신된다.
3. 핀 클릭 → 상세 패널에 멘트/중첩답글/♥카운트가 읽기 렌더된다.
4. Google 로그인 → 프로필 자동 생성 → 로그아웃까지 동작.

- [ ] **Step 4: 브랜치 마무리**

`superpowers:finishing-a-development-branch` 스킬로 마무리(테스트 그린 확인 → master 병합 등).

---

## Self-Review (작성자 점검 결과)

- **Spec coverage(설계 §1~8 대조):**
  - 인증(§3.2): Task 1(클라이언트/미들웨어) + Task 2(프로필 트리거) + Task 8(로그인/콜백) ✔
  - 지도/POI 숨김(§3.3): Task 5 ✔
  - 핀 로딩(§3.4): Task 3(변환) + Task 6(렌더) ✔
  - 상세 패널 읽기(§3.5): Task 4(로직) + Task 7(렌더) ✔
  - Plan 1 테스트 리팩터(§5): Task 2 ✔
  - 환경변수(§6): Task 1(.env.local), Task 5/8(콘솔 설정 선행) ✔
  - 검증 전략(§2): 로직 TDD(Task 2,3,4) + 수동확인(Task 5,6,7,8) ✔
  - 엣지케이스(§8): 미지 부모→루트(Task 4 테스트), is_hidden 제외(Task 4), 콜백 코드 없음 방어(Task 8 `if (code)`), 빈 상태(Task 7 "No notes yet") ✔
- **Placeholder scan:** 모든 스텝에 실제 코드/명령/기대출력 포함. `MapView`의 `void onSelectPlace`는 Task 5→6 사이 의도된 임시코드(제거 스텝 명시). "TBD/TODO" 없음.
- **Type consistency:** `boundsToBboxArgs`가 반환하는 `BboxArgs`의 키(min_lng/min_lat/max_lng/max_lat/max_results)가 `places_in_bbox`(Plan 1) 파라미터명과 일치. `ThreadNode`/`PostRow`가 Task 4 정의와 Task 7 사용부에서 일치. `createClient`(브라우저 동기 / 서버 async) 시그니처가 사용부와 일치.
- **알려진 선행 의존:** Task 5는 Maps API 키, Task 8은 Google OAuth+Supabase provider 설정이 선행돼야 수동 확인 가능(각 태스크 상단에 명시).
```
