# Plan 3 — 멘트 작성 플로우 (Note Compose) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행자가 현장에서 지도 중앙에 위치를 맞추고, 카테고리를 정한 새 장소(또는 근처 기존 장소)에 짧은 텍스트 멘트를 남긴다.

**Architecture:** `places`에 고정 enum 카테고리 컬럼을 추가하고, place(신규)+post를 한 트랜잭션에 만드는 원자적 `create_note` RPC를 둔다. 클라이언트는 화면 정중앙 고정 핀으로 위치를 잡고, 중앙 말풍선에서 (근처 후보 선택 / 새 장소는 카테고리→이름→본문) 입력 후 RPC 한 번으로 저장한다. 저장 후 기존 `PlacePins`를 refetch해 새 핀을 즉시 노출한다.

**Tech Stack:** Next.js 16(App Router) · React 19 · `@vis.gl/react-google-maps` · Supabase(Postgres+PostGIS, RLS) · Vitest.

## Global Constraints

- 사진 첨부·Storage 버킷은 **이 플랜 범위 밖**(후속). Plan 3는 텍스트 노트만 만든다.
- 카테고리 필터 메뉴·핀 카운트 뱃지·검색·답글·좋아요·신고는 **Plan 4**. 만들지 않는다.
- UI 기본 언어 **영어**(글로벌 여행자 타깃).
- 비밀키(Supabase, Maps)는 `.env.local`/`.env.test`에만. 절대 커밋 금지.
- DB 마이그레이션은 클라우드 Supabase(ref `oxmdrwwfejvxkqwzkofw`, region ap-northeast-2)에 **세션 풀러**로 push. 직접연결 호스트는 IPv4 미해석이라 사용 불가.
- 마이그레이션 적용 커맨드(Plan 1과 동일, DB 비밀번호는 운영자 입력·미커밋):
  ```bash
  npx supabase db push --db-url "postgresql://postgres.oxmdrwwfejvxkqwzkofw:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
  ```
- 테스트 헬퍼: `tests/helpers/supabase.ts`의 `serviceClient()` / `anonClient()` / `createTestUser()`(트리거가 `profiles`를 이미 생성하므로 수동 insert 금지) / `cleanup()`. DB 테스트는 `afterEach(cleanup)`.
- 전체 테스트: `npm test` (Vitest, `fileParallelism:false` 직렬). 타입체크: `npx tsc --noEmit`. 빌드: `npm run build`.
- React 컴포넌트는 이 저장소에 테스트 하네스(jsdom/RTL)가 없다 → 컴포넌트 태스크는 **`tsc`+`build` 통과 + 수동 브라우저 확인**으로 검증(Plan 2 패턴). 순수 로직만 Vitest로 TDD.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `supabase/migrations/0011_place_category.sql` | `place_category` enum + `places.category` 컬럼 | 1 |
| `supabase/migrations/0012_create_note.sql` | 원자적 `create_note(place 신규+post)` RPC | 2 |
| `lib/places/categories.ts` | 카테고리 값·라벨 상수/타입 | 3 |
| `lib/geo/geolocation.ts` | `getCurrentPosition` 프라미스 래퍼(폴백) | 4 |
| `lib/places/createNote.ts` | `create_note` RPC 얇은 래퍼 | 5 |
| `components/ComposeFab.tsx` | FAB + 로그인 게이트 + 작성모드 시작 | 6 |
| `components/ComposeNote.tsx` | 중앙 십자선 오버레이 + 중앙 말풍선(상태머신) | 7·8 |
| `components/MapView.tsx` (수정) | 작성모드·refreshKey 전달, ComposeNote 슬롯 | 7·9 |
| `components/PlacePins.tsx` (수정) | `refreshKey` prop → 저장 후 refetch | 9 |
| `app/page.tsx` (수정) | 상태(composing/refreshKey) 배선 | 6·9 |
| `tests/db/place_category.test.ts` | 카테고리 컬럼 DB 테스트 | 1 |
| `tests/db/create_note.test.ts` | create_note RPC DB 테스트 | 2 |
| `tests/lib/categories.test.ts` | 카테고리 상수 유닛 | 3 |
| `tests/lib/geolocation.test.ts` | geolocation 폴백 유닛 | 4 |
| `tests/lib/createNote.test.ts` | createNote 래퍼 유닛 | 5 |

---

## Task 1: `places` 카테고리 컬럼

**Files:**
- Create: `supabase/migrations/0011_place_category.sql`
- Test: `tests/db/place_category.test.ts`

**Interfaces:**
- Consumes: 기존 `places`(0003), `createTestUser`/`serviceClient`/`cleanup`.
- Produces: enum 타입 `public.place_category` = `('restaurant','attraction','shopping','lodging','other')`; `places.category place_category not null default 'other'`.

- [ ] **Step 1: Write the failing test**

`tests/db/place_category.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('places.category', () => {
  it('defaults to other when omitted', async () => {
    const { id: uid } = await createTestUser()
    const admin = serviceClient()
    const { data, error } = await admin.from('places')
      .insert({ name: 'D', lat: 1, lng: 1, created_by: uid })
      .select('category').single()
    expect(error).toBeNull()
    expect(data!.category).toBe('other')
  })

  it('stores a valid category value', async () => {
    const { id: uid } = await createTestUser()
    const admin = serviceClient()
    const { data, error } = await admin.from('places')
      .insert({ name: 'R', lat: 1, lng: 1, created_by: uid, category: 'restaurant' })
      .select('category').single()
    expect(error).toBeNull()
    expect(data!.category).toBe('restaurant')
  })

  it('rejects an invalid category value', async () => {
    const { id: uid } = await createTestUser()
    const admin = serviceClient()
    const { error } = await admin.from('places')
      .insert({ name: 'B', lat: 1, lng: 1, created_by: uid, category: 'invalid' })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/place_category.test.ts`
Expected: FAIL — `category` 컬럼 없음(첫 테스트에서 `data.category` undefined) / invalid 삽입이 거부되지 않음.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0011_place_category.sql`:
```sql
create type public.place_category as enum
  ('restaurant', 'attraction', 'shopping', 'lodging', 'other');

alter table public.places
  add column category public.place_category not null default 'other';
```

- [ ] **Step 4: Apply the migration to the cloud DB**

Run (DB 비밀번호는 운영자 입력):
```bash
npx supabase db push --db-url "postgresql://postgres.oxmdrwwfejvxkqwzkofw:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```
Expected: `0011_place_category.sql` applied 로그.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/place_category.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Regression — full suite still green**

Run: `npm test`
Expected: 기존 24 + 신규 3 = 27 tests PASS (기존 places 테스트가 컬럼 추가로 깨지지 않음 확인).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0011_place_category.sql tests/db/place_category.test.ts
git commit -m "feat(places): add fixed-enum category column"
```

---

## Task 2: `create_note` RPC

**Files:**
- Create: `supabase/migrations/0012_create_note.sql`
- Test: `tests/db/create_note.test.ts`

**Interfaces:**
- Consumes: Task 1의 `place_category`, 기존 `places`/`posts`/RLS(0009), `places_set_geog_trg`.
- Produces: RPC `create_note(in_place_id uuid, in_name text, in_lat double precision, in_lng double precision, in_category place_category, in_body text) returns table(post_id uuid, place_id uuid)`. `security invoker`. `auth.uid()` 없으면 예외. `in_place_id` NULL이면 place 생성 후 그 id 사용, 아니면 그대로 사용. post는 항상 `parent_id=NULL`.

- [ ] **Step 1: Write the failing tests**

`tests/db/create_note.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, anonClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('create_note', () => {
  it('creates a new place and a top-level post (new-place path)', async () => {
    const { id: uid, client } = await createTestUser()
    const { data, error } = await client.rpc('create_note', {
      in_place_id: null, in_name: 'Test Cafe', in_lat: 37.5, in_lng: 127.0,
      in_category: 'restaurant', in_body: 'great coffee',
    })
    expect(error).toBeNull()
    const row = (data as { post_id: string; place_id: string }[])[0]
    expect(row.post_id).toBeTruthy()
    expect(row.place_id).toBeTruthy()

    const admin = serviceClient()
    const { data: place } = await admin.from('places').select('*').eq('id', row.place_id).single()
    expect(place!.category).toBe('restaurant')
    expect(place!.created_by).toBe(uid)
    expect(place!.name).toBe('Test Cafe')

    const { data: post } = await admin.from('posts').select('*').eq('id', row.post_id).single()
    expect(post!.place_id).toBe(row.place_id)
    expect(post!.author_id).toBe(uid)
    expect(post!.parent_id).toBeNull()
    expect(post!.body).toBe('great coffee')
  })

  it('adds a post to an existing place without creating a place (existing-place path)', async () => {
    const { id: uid, client } = await createTestUser()
    const admin = serviceClient()
    const { data: place } = await admin.from('places')
      .insert({ name: 'X', lat: 1, lng: 1, created_by: uid, category: 'shopping' })
      .select('id').single()

    const { count: before } = await admin.from('places').select('*', { count: 'exact', head: true })
    const { data, error } = await client.rpc('create_note', {
      in_place_id: place!.id, in_name: null, in_lat: 1, in_lng: 1,
      in_category: null, in_body: 'nice shop',
    })
    expect(error).toBeNull()
    const row = (data as { post_id: string; place_id: string }[])[0]
    expect(row.place_id).toBe(place!.id)

    const { count: after } = await admin.from('places').select('*', { count: 'exact', head: true })
    expect(after).toBe(before) // 장소 증가 없음

    const { data: post } = await admin.from('posts').select('place_id, author_id').eq('id', row.post_id).single()
    expect(post!.place_id).toBe(place!.id)
    expect(post!.author_id).toBe(uid)
  })

  it('rejects anonymous callers (authentication required)', async () => {
    const anon = anonClient()
    const { error } = await anon.rpc('create_note', {
      in_place_id: null, in_name: 'Nope', in_lat: 1, in_lng: 1,
      in_category: 'other', in_body: 'x',
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/create_note.test.ts`
Expected: FAIL — `create_note` 함수 없음(RPC 에러).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0012_create_note.sql`:
```sql
create or replace function public.create_note(
  in_place_id uuid,
  in_name     text,
  in_lat      double precision,
  in_lng      double precision,
  in_category public.place_category,
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
    values (in_name, in_lat, in_lng, coalesce(in_category, 'other'), uid)
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

- [ ] **Step 4: Apply the migration to the cloud DB**

Run:
```bash
npx supabase db push --db-url "postgresql://postgres.oxmdrwwfejvxkqwzkofw:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```
Expected: `0012_create_note.sql` applied.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/db/create_note.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_create_note.sql tests/db/create_note.test.ts
git commit -m "feat(posts): atomic create_note RPC (place-or-post)"
```

---

## Task 3: 카테고리 상수 모듈

**Files:**
- Create: `lib/places/categories.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Produces: `PLACE_CATEGORIES: readonly PlaceCategory[]`; `type PlaceCategory = 'restaurant'|'attraction'|'shopping'|'lodging'|'other'`; `CATEGORY_LABELS: Record<PlaceCategory,string>`.

- [ ] **Step 1: Write the failing test**

`tests/lib/categories.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PLACE_CATEGORIES, CATEGORY_LABELS } from '@/lib/places/categories'

describe('place categories', () => {
  it('has the five fixed categories in order', () => {
    expect(PLACE_CATEGORIES).toEqual(['restaurant', 'attraction', 'shopping', 'lodging', 'other'])
  })

  it('maps every category to an English label', () => {
    for (const c of PLACE_CATEGORIES) {
      expect(typeof CATEGORY_LABELS[c]).toBe('string')
      expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0)
    }
    expect(CATEGORY_LABELS.restaurant).toBe('Restaurant')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Write the implementation**

`lib/places/categories.ts`:
```ts
export const PLACE_CATEGORIES = [
  'restaurant',
  'attraction',
  'shopping',
  'lodging',
  'other',
] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  restaurant: 'Restaurant',
  attraction: 'Attraction',
  shopping: 'Shopping',
  lodging: 'Lodging',
  other: 'Other',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/places/categories.ts tests/lib/categories.test.ts
git commit -m "feat(places): category constants and labels"
```

---

## Task 4: Geolocation 래퍼

**Files:**
- Create: `lib/geo/geolocation.ts`
- Test: `tests/lib/geolocation.test.ts`

**Interfaces:**
- Produces: `interface Coords { lat: number; lng: number }`; `getCurrentPosition(timeoutMs?: number): Promise<Coords | null>` — 성공 시 좌표, 거부/미지원/에러 시 `null`(폴백 신호).

- [ ] **Step 1: Write the failing test**

`tests/lib/geolocation.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getCurrentPosition } from '@/lib/geo/geolocation'

const g = globalThis as unknown as { navigator?: { geolocation?: unknown } }

afterEach(() => {
  vi.restoreAllMocks()
  delete g.navigator
})

describe('getCurrentPosition', () => {
  it('resolves coords on success', async () => {
    g.navigator = {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 37.5, longitude: 127.0 } }),
      },
    }
    const result = await getCurrentPosition()
    expect(result).toEqual({ lat: 37.5, lng: 127.0 })
  })

  it('resolves null when the user denies (error callback)', async () => {
    g.navigator = {
      geolocation: {
        getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 1 }),
      },
    }
    const result = await getCurrentPosition()
    expect(result).toBeNull()
  })

  it('resolves null when geolocation is unavailable', async () => {
    g.navigator = {}
    const result = await getCurrentPosition()
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/geolocation.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Write the implementation**

`lib/geo/geolocation.ts`:
```ts
export interface Coords {
  lat: number
  lng: number
}

// 성공 시 좌표, 거부/미지원/타임아웃 시 null(호출부는 지도 중심 폴백).
export function getCurrentPosition(timeoutMs = 8000): Promise<Coords | null> {
  return new Promise((resolve) => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (!nav || !nav.geolocation) {
      resolve(null)
      return
    }
    nav.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, enableHighAccuracy: true },
    )
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/geolocation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/geo/geolocation.ts tests/lib/geolocation.test.ts
git commit -m "feat(geo): getCurrentPosition wrapper with fallback"
```

---

## Task 5: `createNote` 클라이언트 래퍼

**Files:**
- Create: `lib/places/createNote.ts`
- Test: `tests/lib/createNote.test.ts`

**Interfaces:**
- Consumes: Task 3 `PlaceCategory`; supabase client `.rpc()`.
- Produces:
  - `interface CreateNoteInput { placeId?: string | null; name?: string | null; lat: number; lng: number; category?: PlaceCategory | null; body: string }`
  - `interface CreateNoteResult { postId: string; placeId: string }`
  - `createNote(supabase, input): Promise<CreateNoteResult>` — `create_note` RPC 호출, 반환 배열 첫 행을 매핑, 에러 시 throw.

- [ ] **Step 1: Write the failing test**

`tests/lib/createNote.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createNote } from '@/lib/places/createNote'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeSupabase(recorder: { args?: unknown }) {
  return {
    rpc: async (_fn: string, args: unknown) => {
      recorder.args = args
      return { data: [{ post_id: 'post-1', place_id: 'place-1' }], error: null }
    },
  } as unknown as SupabaseClient
}

describe('createNote', () => {
  it('maps a new-place input to create_note args and returns ids', async () => {
    const rec: { args?: unknown } = {}
    const result = await createNote(fakeSupabase(rec), {
      name: 'Cafe', lat: 37.5, lng: 127.0, category: 'restaurant', body: 'hi',
    })
    expect(rec.args).toEqual({
      in_place_id: null, in_name: 'Cafe', in_lat: 37.5, in_lng: 127.0,
      in_category: 'restaurant', in_body: 'hi',
    })
    expect(result).toEqual({ postId: 'post-1', placeId: 'place-1' })
  })

  it('passes an existing placeId through as in_place_id', async () => {
    const rec: { args?: unknown } = {}
    await createNote(fakeSupabase(rec), {
      placeId: 'place-9', lat: 1, lng: 1, body: 'x',
    })
    expect((rec.args as { in_place_id: string }).in_place_id).toBe('place-9')
    expect((rec.args as { in_category: unknown }).in_category).toBeNull()
  })

  it('throws when the RPC returns an error', async () => {
    const failing = {
      rpc: async () => ({ data: null, error: { message: 'authentication required' } }),
    } as unknown as SupabaseClient
    await expect(
      createNote(failing, { lat: 1, lng: 1, body: 'x' }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/createNote.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Write the implementation**

`lib/places/createNote.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaceCategory } from './categories'

export interface CreateNoteInput {
  placeId?: string | null // 기존 장소 id, 새 장소면 생략/null
  name?: string | null // 새 장소일 때만
  lat: number
  lng: number
  category?: PlaceCategory | null // 새 장소일 때만
  body: string
}

export interface CreateNoteResult {
  postId: string
  placeId: string
}

export async function createNote(
  supabase: SupabaseClient,
  input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const { data, error } = await supabase.rpc('create_note', {
    in_place_id: input.placeId ?? null,
    in_name: input.name ?? null,
    in_lat: input.lat,
    in_lng: input.lng,
    in_category: input.category ?? null,
    in_body: input.body,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { post_id: string; place_id: string }
  return { postId: row.post_id, placeId: row.place_id }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/createNote.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/places/createNote.ts tests/lib/createNote.test.ts
git commit -m "feat(places): createNote client wrapper for create_note RPC"
```

---

## Task 6: ComposeFab + 작성모드 상태 배선

**Files:**
- Create: `components/ComposeFab.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `@/lib/supabase/client` `createClient`(현 로그인 유저 확인).
- Produces: `<ComposeFab onStart={() => void} />` — 우하단 `＋` FAB. 로그인 상태면 클릭 시 `onStart()`, 비로그인이면 안내 후 무동작. `app/page.tsx`가 `composing` 상태를 소유하고 `MapView`에 전달(Task 7·9에서 소비).

- [ ] **Step 1: Write ComposeFab**

`components/ComposeFab.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function ComposeFab({ onStart }: { onStart: () => void }) {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const handleClick = () => {
    if (!signedIn) {
      window.alert('Sign in to leave a note.')
      return
    }
    onStart()
  }

  return (
    <button
      onClick={handleClick}
      aria-label="Leave a note"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 20,
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        background: '#2563eb',
        color: '#fff',
        fontSize: 28,
        lineHeight: '56px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'pointer',
      }}
    >
      ＋
    </button>
  )
}
```

- [ ] **Step 2: Wire compose state into app/page.tsx**

Replace `app/page.tsx` with:
```tsx
'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'
import { PlaceDetailPanel } from '@/components/PlaceDetailPanel'
import { AuthButton } from '@/components/AuthButton'
import { ComposeFab } from '@/components/ComposeFab'

export default function Home() {
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <main>
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 10 }}>
        <AuthButton />
      </div>
      <MapView
        onSelectPlace={setPlaceId}
        composing={composing}
        refreshKey={refreshKey}
        onPosted={() => {
          setComposing(false)
          setRefreshKey((k) => k + 1)
        }}
        onCancelCompose={() => setComposing(false)}
      />
      {!composing && <ComposeFab onStart={() => setComposing(true)} />}
      <PlaceDetailPanel placeId={placeId} onClose={() => setPlaceId(null)} />
    </main>
  )
}
```

- [ ] **Step 3: Add the new MapView props (temporary, keeps build green)**

Modify `components/MapView.tsx` signature to accept the new props (consumed fully in Task 7·9). Replace the component signature and body:
```tsx
'use client'

import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { BASEMAP_STYLE } from '@/lib/map/basemap-style'
import { PlacePins } from './PlacePins'

const SEOUL = { lat: 37.5665, lng: 126.978 }

export function MapView({
  onSelectPlace,
  composing,
  refreshKey,
  onPosted,
  onCancelCompose,
}: {
  onSelectPlace: (id: string) => void
  composing: boolean
  refreshKey: number
  onPosted: () => void
  onCancelCompose: () => void
}) {
  // composing / onPosted / onCancelCompose 는 Task 7에서, refreshKey 는 Task 9에서 소비.
  void composing
  void onPosted
  void onCancelCompose
  void refreshKey
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
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
    </APIProvider>
  )
}
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 둘 다 성공(에러 0).

- [ ] **Step 5: Commit**

```bash
git add components/ComposeFab.tsx components/MapView.tsx app/page.tsx
git commit -m "feat(compose): FAB + compose-mode state wiring"
```

---

## Task 7: ComposeNote — 위치 지정 + 작성 말풍선

**Files:**
- Create: `components/ComposeNote.tsx`
- Modify: `components/MapView.tsx`

**Interfaces:**
- Consumes: `@vis.gl/react-google-maps` `useMap`; Task 3 `PLACE_CATEGORIES`/`CATEGORY_LABELS`/`PlaceCategory`; Task 4 `getCurrentPosition`; Task 5 `createNote`; `@/lib/supabase/client` `createClient`; `nearby_places` RPC(0008).
- Produces: `<ComposeNote onPosted={() => void} onCancel={() => void} />` — `<Map>` 자식으로 렌더. 위치단계(중앙 십자선 + GPS 센터링 + Confirm/Cancel) → 작성단계(중앙 말풍선: 근처 후보 선택 / 새 장소 카테고리→이름→본문 → Post). 저장 성공 시 `onPosted()`, 취소 시 `onCancel()`.

- [ ] **Step 1: Write ComposeNote**

`components/ComposeNote.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import { createClient } from '@/lib/supabase/client'
import { getCurrentPosition } from '@/lib/geo/geolocation'
import { createNote } from '@/lib/places/createNote'
import {
  PLACE_CATEGORIES,
  CATEGORY_LABELS,
  type PlaceCategory,
} from '@/lib/places/categories'

interface Candidate {
  id: string
  name: string
  distance_m: number
}

type Phase = 'locating' | 'composing'

export function ComposeNote({
  onPosted,
  onCancel,
}: {
  onPosted: () => void
  onCancel: () => void
}) {
  const map = useMap()
  const [phase, setPhase] = useState<Phase>('locating')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [placeId, setPlaceId] = useState<string | null>(null) // 선택된 기존 장소
  const [category, setCategory] = useState<PlaceCategory | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 진입 시 GPS로 센터링(실패하면 현재 지도 중심 유지 = 폴백).
  useEffect(() => {
    if (!map) return
    let cancelled = false
    getCurrentPosition().then((c) => {
      if (cancelled || !c) return
      map.setCenter({ lat: c.lat, lng: c.lng })
    })
    return () => {
      cancelled = true
    }
  }, [map])

  const confirmLocation = async () => {
    if (!map) return
    const center = map.getCenter()
    if (!center) return
    const lat = center.lat()
    const lng = center.lng()
    setCoords({ lat, lng })
    const supabase = createClient()
    const { data } = await supabase.rpc('nearby_places', {
      in_lat: lat,
      in_lng: lng,
      radius_m: 50,
      max_results: 20,
    })
    setCandidates((data ?? []) as Candidate[])
    setPhase('composing')
  }

  const selectCandidate = (id: string) => {
    setPlaceId(id)
    setCategory(null)
    setName('')
  }

  const selectNewPlace = () => {
    setPlaceId(null)
  }

  const canPost =
    body.trim().length > 0 &&
    (placeId !== null || (category !== null && name.trim().length > 0))

  const submit = async () => {
    if (!coords || !canPost) return
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      await createNote(supabase, {
        placeId: placeId ?? undefined,
        name: placeId ? undefined : name.trim(),
        lat: coords.lat,
        lng: coords.lng,
        category: placeId ? undefined : category!,
        body: body.trim(),
      })
      onPosted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post')
      setSaving(false)
    }
  }

  // 위치 단계: 중앙 십자선 + Confirm/Cancel
  if (phase === 'locating') {
    return (
      <>
        <CenterPin />
        <div style={barStyle}>
          <button onClick={onCancel} style={ghostBtn}>
            Cancel
          </button>
          <span style={{ color: '#fff', fontSize: 13 }}>
            Move the map to place the pin
          </span>
          <button onClick={confirmLocation} style={primaryBtn}>
            Confirm location
          </button>
        </div>
      </>
    )
  }

  // 작성 단계: 중앙 말풍선
  return (
    <>
      <CenterPin />
      <div style={bubbleStyle}>
        {candidates.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
              Add to a nearby place
            </div>
            {candidates.map((c) => (
              <label key={c.id} style={rowStyle}>
                <input
                  type="radio"
                  name="place"
                  checked={placeId === c.id}
                  onChange={() => selectCandidate(c.id)}
                />
                {c.name} · {Math.round(c.distance_m)}m
              </label>
            ))}
            <label style={rowStyle}>
              <input
                type="radio"
                name="place"
                checked={placeId === null}
                onChange={selectNewPlace}
              />
              ＋ New place here
            </label>
          </div>
        )}

        {placeId === null && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {PLACE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={category === c ? chipActive : chip}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Place name"
              style={inputStyle}
            />
          </>
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a note…"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />

        {error && <div style={{ color: '#c00', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <button onClick={onCancel} style={ghostBtn}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canPost || saving} style={primaryBtn}>
            {saving ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </>
  )
}

function CenterPin() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -100%)',
        fontSize: 32,
        zIndex: 15,
        pointerEvents: 'none',
      }}
    >
      📍
    </div>
  )
}

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: 12,
  background: 'rgba(0,0,0,0.7)',
}

const bubbleStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 20,
  width: 'min(92vw, 360px)',
  background: '#fff',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 0',
  fontSize: 14,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 8,
  marginBottom: 8,
  border: '1px solid #ccc',
  borderRadius: 8,
  fontSize: 14,
}

const chip: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #ccc',
  borderRadius: 999,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
}

const chipActive: React.CSSProperties = {
  ...chip,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
}

const ghostBtn: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ccc',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 8,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
}
```

- [ ] **Step 2: Render ComposeNote inside the map during compose mode**

Modify `components/MapView.tsx` — import and render, replacing the `void` placeholders for `composing`/`onPosted`/`onCancelCompose`:
```tsx
'use client'

import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { BASEMAP_STYLE } from '@/lib/map/basemap-style'
import { PlacePins } from './PlacePins'
import { ComposeNote } from './ComposeNote'

const SEOUL = { lat: 37.5665, lng: 126.978 }

export function MapView({
  onSelectPlace,
  composing,
  refreshKey,
  onPosted,
  onCancelCompose,
}: {
  onSelectPlace: (id: string) => void
  composing: boolean
  refreshKey: number
  onPosted: () => void
  onCancelCompose: () => void
}) {
  void refreshKey // Task 9에서 PlacePins로 전달
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <Map
        defaultCenter={SEOUL}
        defaultZoom={15}
        disableDefaultUI
        clickableIcons={false}
        styles={BASEMAP_STYLE}
        style={{ width: '100%', height: '100dvh' }}
      >
        <PlacePins onSelectPlace={onSelectPlace} />
        {composing && <ComposeNote onPosted={onPosted} onCancel={onCancelCompose} />}
      </Map>
    </APIProvider>
  )
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 둘 다 성공. (참고: `nearby_places` 파라미터명은 `in_lat`/`in_lng`/`radius_m`/`max_results` — 0008 정의와 일치.)

- [ ] **Step 4: Commit**

```bash
git add components/ComposeNote.tsx components/MapView.tsx
git commit -m "feat(compose): center-pin location + note bubble (category/name/body)"
```

---

## Task 8: 수동 브라우저 검증 — 작성 라운드트립

**Files:** (없음 — 검증 전용 태스크)

**Interfaces:**
- Consumes: Task 6·7 산출물 + 실행 중 dev 서버 + 로그인 세션.

- [ ] **Step 1: Start dev server**

Run: `npm run dev` (백그라운드) → http://localhost:3000

- [ ] **Step 2: Verify the compose round-trip (logged in)**

수동 체크리스트(사용자):
1. Google 로그인 상태에서 우하단 `＋` FAB가 보인다.
2. FAB 탭 → 화면 중앙에 📍 십자선 + 하단 바(Cancel / Confirm location). GPS 허용 시 현재 위치로 지도가 이동(거부해도 진행 가능 = 폴백).
3. 지도를 움직여 위치를 맞추고 Confirm location → 중앙 말풍선.
4. (근처 seed 장소 있으면) "Add to a nearby place" 후보가 보인다. 새 장소로: 카테고리 칩 선택 → 이름 입력 → 본문 입력.
5. Post → 말풍선 닫힘, 그 자리에 **새 핀 등장**(Task 9의 refetch 배선 이후 완전 동작; 이 태스크 시점엔 페이지 새로고침으로 확인 가능).
6. 새 핀 탭 → 상세 패널에 방금 쓴 본문이 보인다.

- [ ] **Step 3: Verify logged-out gate**

로그아웃 상태에서 FAB 탭 → "Sign in to leave a note." 안내, 작성모드 진입 안 됨.

- [ ] **Step 4: Record result**

문제 없으면 이 태스크 완료로 표시. 문제가 있으면 해당 구현 태스크로 돌아가 수정.

> 커밋 없음(코드 변경 없는 검증 태스크).

---

## Task 9: 저장 후 핀 refetch 배선 + 최종 검증

**Files:**
- Modify: `components/PlacePins.tsx`
- Modify: `components/MapView.tsx`

**Interfaces:**
- Consumes: page의 `refreshKey`(Task 6에서 이미 `onPosted`가 증가시킴), `MapView`가 이를 `PlacePins`로 전달.
- Produces: `PlacePins`가 `refreshKey` prop 변경 시 bbox를 재조회 → 방금 만든 핀이 새로고침 없이 등장.

- [ ] **Step 1: Add refreshKey prop to PlacePins and refetch on change**

Modify `components/PlacePins.tsx`:
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

export function PlacePins({
  onSelectPlace,
  refreshKey = 0,
}: {
  onSelectPlace: (id: string) => void
  refreshKey?: number
}) {
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

    load() // refreshKey 변경 시(및 최초) 즉시 재조회

    const listener = map.addListener('idle', () => {
      clearTimeout(timer)
      timer = setTimeout(load, 300)
    })

    return () => {
      listener.remove()
      clearTimeout(timer)
    }
  }, [map, refreshKey])

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

- [ ] **Step 2: Pass refreshKey through MapView to PlacePins**

Modify `components/MapView.tsx` — remove the `void refreshKey` and forward it:
```tsx
        <PlacePins onSelectPlace={onSelectPlace} refreshKey={refreshKey} />
```
(나머지 MapView 코드는 Task 7 상태 그대로 유지.)

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 둘 다 성공.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: 전체 PASS (기존 24 + place_category 3 + create_note 3 + categories 2 + geolocation 3 + createNote 3 = 38 tests).

- [ ] **Step 5: Manual — pin appears without reload**

`npm run dev` → 로그인 → FAB로 노트 작성 → Post 직후 **새로고침 없이** 핀이 등장하는지 확인.

- [ ] **Step 6: Commit**

```bash
git add components/PlacePins.tsx components/MapView.tsx
git commit -m "feat(compose): refetch pins after posting a note"
```

---

## Self-Review

**Spec coverage (설계문서 §1~§7):**
- §2 카테고리 컬럼 → Task 1 ✅
- §3 create_note RPC(신규/기존/인증/원자성) → Task 2 ✅
- §4 작성 플로우(FAB·GPS·중앙핀·위치확정·중앙말풍선·후보/카테고리→이름→본문·저장·refetch) → Task 6·7·9 ✅
- §4 중복 방지(반경50m 후보) → Task 7 `nearby_places` + 후보 라디오 ✅
- §5 컴포넌트/파일(categories/geolocation/createNote/ComposeNote/ComposeFab + page/MapView/PlacePins) → Task 3·4·5·6·7·9 ✅
- §6 테스트(DB: 신규/기존/인증/enum · 유닛: categories/geolocation/createNote) → Task 1·2·3·4·5 ✅
- §6 엣지(GPS거부 폴백·빈본문 비활성·새장소 name+category 필수·비로그인 게이트·저장실패 유지) → Task 6·7 + Task 8 수동검증 ✅
- §1 제외항목(사진/Storage·필터·카운트·검색·답글·좋아요·신고) → 어떤 태스크에도 없음 ✅ (YAGNI 준수)

**Placeholder scan:** `void` 표기는 Task 6에서 의도적으로 도입해 Task 7·9에서 제거하는 명시적 단계로 처리(빌드 그린 유지). "TBD/TODO" 없음. 모든 코드 스텝에 완전한 코드 포함.

**Type consistency:**
- `PlaceCategory`(Task 3) → `CreateNoteInput.category`(Task 5) → `ComposeNote` state(Task 7) 일치.
- `create_note` 파라미터명 `in_place_id/in_name/in_lat/in_lng/in_category/in_body` → 마이그레이션(Task 2)·`createNote` 래퍼(Task 5) 일치.
- `nearby_places` 파라미터 `in_lat/in_lng/radius_m/max_results` → 0008 정의와 Task 7 호출 일치, 반환 `id/name/distance_m` → `Candidate` 인터페이스 일치.
- `create_note` 반환 `(post_id, place_id)` → `createNote`가 배열 첫 행 매핑 → `CreateNoteResult{postId,placeId}` 일치.
- `MapView` props(`composing/refreshKey/onPosted/onCancelCompose`) → page 전달(Task 6)·소비(Task 7·9) 일치.
