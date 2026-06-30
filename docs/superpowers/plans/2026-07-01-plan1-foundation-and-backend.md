# Plan 1: 기반 + 백엔드 데이터 계층 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iwashere MVP의 프로젝트 골격과 백엔드 데이터 계층(스키마·지리쿼리·검색·좋아요·RLS)을 테스트와 함께 구축한다.

**Architecture:** Next.js(App Router) + TypeScript 프로젝트를 스캐폴딩하고, Supabase 로컬(Postgres + PostGIS + pg_trgm)에 마이그레이션으로 스키마를 만든다. 지리/검색/좋아요 로직은 SQL 함수(RPC)로 캡슐화하고, 접근제어는 RLS로 강제한다. 모든 DB 로직은 Vitest + `@supabase/supabase-js`가 로컬 Supabase 인스턴스에 직접 붙어 검증한다(모킹 없음).

**Tech Stack:** Next.js, TypeScript, Supabase CLI(로컬 Postgres/PostGIS/pg_trgm), `@supabase/supabase-js`, Vitest.

## Global Constraints

- 타깃 UI 언어: 영어 기본(이 Plan은 백엔드라 UI 카피 없음).
- 비밀키는 `.env.local`/`.env.test`에만 두고 절대 커밋하지 않는다(`.gitignore` 적용 확인).
- 구글 의존은 베이스맵 표시뿐 — 이 Plan에는 구글 호출 코드가 없다.
- 멘트와 답글은 단일 `posts` 테이블 + `parent_id` 자기참조로 표현한다.
- 장소는 자체 보유: 좌표 근접(PostGIS `ST_DWithin`, 반경 50m 기본)으로 후보 추천.
- 검색은 자체 DB 전문검색(`pg_trgm`)으로만 수행한다(Places API 금지).
- 좌표계는 WGS84(SRID 4326). 거리는 미터 단위(`geography`).
- TDD: 모든 task는 실패하는 테스트 → 최소 구현 → 통과 → 커밋 순서.
- 테스트는 로컬 Supabase가 떠 있는 상태(`supabase start`)를 전제로 한다.

---

## File Structure

```
package.json                         # 스크립트/의존성
tsconfig.json
next.config.ts
vitest.config.ts                     # 테스트 러너 설정
.env.test                            # 로컬 supabase 키(커밋 금지)
supabase/
  config.toml                        # supabase init 산출물
  migrations/
    0001_extensions.sql              # postgis, pg_trgm
    0002_profiles.sql
    0003_places.sql                  # geog + 트리거 + 인덱스
    0004_posts.sql                   # parent_id 자기참조
    0005_post_photos.sql
    0006_likes.sql                   # like_count 트리거
    0007_reports.sql
    0008_functions.sql               # places_in_bbox, nearby_places, search_places, toggle_like
    0009_rls.sql                     # 전 테이블 RLS 정책
tests/
  helpers/supabase.ts                # 서비스롤/유저 클라이언트 + 유저생성 헬퍼
  db/extensions.test.ts
  db/profiles.test.ts
  db/places.test.ts
  db/posts.test.ts
  db/post_photos.test.ts
  db/likes.test.ts
  db/reports.test.ts
  db/geo_functions.test.ts
  db/search.test.ts
  db/toggle_like.test.ts
  db/rls.test.ts
```

각 마이그레이션 파일은 하나의 테이블/관심사만 책임진다. 테스트는 관심사별로 분리한다.

---

### Task 1: 프로젝트 스캐폴딩 + 테스트 러너

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx` (Next 동작 확인용 최소 페이지)
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `npm test`(Vitest), `npm run dev`(Next) 스크립트.

- [ ] **Step 1: Next.js + 의존성 설치**

```bash
npx create-next-app@latest . --typescript --app --eslint --no-tailwind --no-src-dir --import-alias "@/*"
npm install @supabase/supabase-js
npm install -D vitest dotenv
```

- [ ] **Step 2: `vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // DB 공유 테스트 — 직렬 실행으로 격리
  },
})
```

- [ ] **Step 3: `package.json`에 test 스크립트 추가**

`scripts`에 다음을 추가(이미 있는 `dev`/`build` 유지):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 실패하는 스모크 테스트 작성**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: PASS (1 passed)

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Vitest"
```

---

### Task 2: Supabase 로컬 + 확장(extensions) 마이그레이션 + 테스트 헬퍼

**Files:**
- Create: `supabase/migrations/0001_extensions.sql`
- Create: `tests/helpers/supabase.ts`
- Create: `.env.test`
- Test: `tests/db/extensions.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `serviceClient()` → RLS 우회 서비스롤 클라이언트(픽스처용).
  - `anonClient()` → 익명 키 클라이언트.
  - `createTestUser(email?)` → `{ id, client }` 인증된 유저 클라이언트 + uid.
  - `cleanup()` → 테스트가 만든 행 삭제 헬퍼(서비스롤로 전체 truncate).

- [ ] **Step 1: Supabase 초기화 및 시작**

```bash
npx supabase init
npx supabase start
```

출력에 표시되는 `API URL`, `anon key`, `service_role key`를 다음 단계 `.env.test`에 기입.

- [ ] **Step 2: `.env.test` 작성 (커밋 금지)**

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<supabase start 출력의 anon key>
SUPABASE_SERVICE_ROLE_KEY=<supabase start 출력의 service_role key>
```

`.gitignore`에 `.env*.local`이 있으므로 `.env.test`도 추가:

```bash
printf "\n.env.test\n" >> .gitignore
```

- [ ] **Step 3: 확장 마이그레이션 작성**

`supabase/migrations/0001_extensions.sql`:

```sql
create extension if not exists postgis;
create extension if not exists pg_trgm;
```

- [ ] **Step 4: 마이그레이션 적용**

Run: `npx supabase migration up`
Expected: 적용 성공, 에러 없음.

- [ ] **Step 5: 테스트 헬퍼 작성**

`tests/helpers/supabase.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } })
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } })
}

let counter = 0
export async function createTestUser(): Promise<{ id: string; client: SupabaseClient }> {
  const admin = serviceClient()
  counter += 1
  const email = `t${counter}_${Date.now()}@example.com`
  const password = 'password123!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw signInErr
  return { id: data.user!.id, client }
}

export async function cleanup() {
  const admin = serviceClient()
  // 자식→부모 순서로 삭제(FK 안전)
  for (const t of ['reports', 'likes', 'post_photos', 'posts', 'places', 'profiles']) {
    await admin.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000')
  }
}
```

- [ ] **Step 6: 실패하는 확장 테스트 작성**

`tests/db/extensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serviceClient } from '../helpers/supabase'

describe('extensions', () => {
  it('has postgis and pg_trgm installed', async () => {
    const db = serviceClient()
    const { data, error } = await db.rpc('exec_extensions_check')
    // RPC가 없으면 fallback: 직접 쿼리
    if (error) {
      const { data: ext } = await db
        .from('pg_extension')
        .select('extname')
      // pg_extension은 일반 클라이언트로 접근 불가할 수 있으므로 아래 SQL 함수로 대체
    }
    expect(error === null || true).toBe(true)
  })
})
```

> 주의: PostgREST로는 시스템 카탈로그 직접 조회가 어렵다. 다음 단계에서 확인용 SQL 함수를 마이그레이션에 추가해 결정론적으로 만든다.

- [ ] **Step 7: 확인용 함수 추가 후 테스트를 결정론적으로 수정**

`supabase/migrations/0001_extensions.sql` 끝에 추가:

```sql
create or replace function public.installed_extensions()
returns table(name text)
language sql stable security definer set search_path = public, pg_catalog
as $$ select extname::text from pg_extension $$;
```

Run: `npx supabase migration up`

`tests/db/extensions.test.ts`를 다음으로 교체:

```ts
import { describe, it, expect } from 'vitest'
import { serviceClient } from '../helpers/supabase'

describe('extensions', () => {
  it('has postgis and pg_trgm installed', async () => {
    const { data, error } = await serviceClient().rpc('installed_extensions')
    expect(error).toBeNull()
    const names = (data as { name: string }[]).map((r) => r.name)
    expect(names).toContain('postgis')
    expect(names).toContain('pg_trgm')
  })
})
```

- [ ] **Step 8: 테스트 실행해 통과 확인**

Run: `npm test -- tests/db/extensions.test.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/0001_extensions.sql tests/helpers/supabase.ts tests/db/extensions.test.ts .gitignore
git commit -m "feat(db): postgis + pg_trgm extensions and test harness"
```

---

### Task 3: profiles 테이블

**Files:**
- Create: `supabase/migrations/0002_profiles.sql`
- Test: `tests/db/profiles.test.ts`

**Interfaces:**
- Consumes: `createTestUser`, `serviceClient`, `cleanup`
- Produces: `profiles(id uuid pk, nickname text, avatar_url text, created_at timestamptz)` — 다른 테이블의 FK 대상.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/profiles.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('profiles', () => {
  it('stores a profile row linked to an auth user', async () => {
    const { id } = await createTestUser()
    const db = serviceClient()
    const { error } = await db.from('profiles').insert({ id, nickname: 'tester' })
    expect(error).toBeNull()
    const { data } = await db.from('profiles').select('*').eq('id', id).single()
    expect(data!.nickname).toBe('tester')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/profiles.test.ts`
Expected: FAIL (relation "profiles" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0002_profiles.sql`:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default 'traveler',
  avatar_url text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0002_profiles.sql tests/db/profiles.test.ts
git commit -m "feat(db): profiles table"
```

---

### Task 4: places 테이블 (PostGIS geog + 트리거 + 인덱스)

**Files:**
- Create: `supabase/migrations/0003_places.sql`
- Test: `tests/db/places.test.ts`

**Interfaces:**
- Consumes: `createTestUser`, `serviceClient`, `cleanup`
- Produces: `places(id uuid pk, name text, lat float8, lng float8, geog geography(Point,4326), created_by uuid, created_at)`. `geog`는 lat/lng로부터 트리거가 자동 생성. GIST 인덱스 `places_geog_idx`, btree `places_latlng_idx`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/places.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

async function seedProfile() {
  const { id } = await createTestUser()
  await serviceClient().from('profiles').insert({ id, nickname: 'u' })
  return id
}

describe('places', () => {
  it('derives geog from lat/lng on insert', async () => {
    const uid = await seedProfile()
    const db = serviceClient()
    const { data, error } = await db
      .from('places')
      .insert({ name: 'Gukbap House', lat: 37.5665, lng: 126.978, created_by: uid })
      .select('id, name')
      .single()
    expect(error).toBeNull()
    expect(data!.name).toBe('Gukbap House')
    // geog가 채워졌는지: 자기 자신 반경 1m 안에 잡혀야 함
    const { data: near } = await db.rpc('nearby_places', {
      in_lat: 37.5665, in_lng: 126.978, radius_m: 5, max_results: 10,
    })
    // nearby_places는 Task 9에서 구현 — 여기선 geog 채움만 우선 검증 위해 직접 컬럼 확인으로 대체
    expect(near === null || Array.isArray(near)).toBe(true)
  })
})
```

> 위 테스트는 `nearby_places`(Task 9) 의존을 피하기 위해, 실제로는 `geog` 채움만 검증한다. 아래처럼 단순화한다.

`tests/db/places.test.ts`를 다음으로 작성:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('places', () => {
  it('inserts a place and auto-fills geog from lat/lng', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })

    const { data, error } = await db
      .from('places')
      .insert({ name: 'Gukbap House', lat: 37.5665, lng: 126.978, created_by: uid })
      .select('id, name, geog')
      .single()

    expect(error).toBeNull()
    expect(data!.name).toBe('Gukbap House')
    expect(data!.geog).not.toBeNull() // 트리거가 geog 채움
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/places.test.ts`
Expected: FAIL (relation "places" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0003_places.sql`:

```sql
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  geog geography(Point, 4326),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.places_set_geog()
returns trigger language plpgsql as $$
begin
  new.geog := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  return new;
end;
$$;

create trigger places_set_geog_trg
  before insert or update of lat, lng on public.places
  for each row execute function public.places_set_geog();

create index places_geog_idx on public.places using gist (geog);
create index places_latlng_idx on public.places (lat, lng);
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/places.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0003_places.sql tests/db/places.test.ts
git commit -m "feat(db): places table with PostGIS geog trigger and indexes"
```

---

### Task 5: posts 테이블 (멘트/답글 통합, parent_id 자기참조)

**Files:**
- Create: `supabase/migrations/0004_posts.sql`
- Test: `tests/db/posts.test.ts`

**Interfaces:**
- Consumes: places, profiles
- Produces: `posts(id, place_id, parent_id self-ref null, author_id, body, like_count int default 0, is_hidden bool default false, created_at)`. 인덱스: `posts_place_idx(place_id)`, `posts_parent_idx(parent_id)`, `posts_body_trgm_idx`(gin trgm).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/posts.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

async function seedPlace() {
  const { id: uid } = await createTestUser()
  const db = serviceClient()
  await db.from('profiles').insert({ id: uid, nickname: 'u' })
  const { data } = await db.from('places')
    .insert({ name: 'P', lat: 37.5, lng: 127, created_by: uid })
    .select('id').single()
  return { uid, placeId: data!.id, db }
}

describe('posts', () => {
  it('creates a top-level post and a nested reply', async () => {
    const { uid, placeId, db } = await seedPlace()

    const { data: top, error: e1 } = await db.from('posts')
      .insert({ place_id: placeId, author_id: uid, body: 'chef was off today' })
      .select('id, parent_id, like_count, is_hidden').single()
    expect(e1).toBeNull()
    expect(top!.parent_id).toBeNull()
    expect(top!.like_count).toBe(0)
    expect(top!.is_hidden).toBe(false)

    const { data: reply, error: e2 } = await db.from('posts')
      .insert({ place_id: placeId, author_id: uid, parent_id: top!.id, body: 'really?' })
      .select('id, parent_id').single()
    expect(e2).toBeNull()
    expect(reply!.parent_id).toBe(top!.id)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/posts.test.ts`
Expected: FAIL (relation "posts" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0004_posts.sql`:

```sql
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  parent_id uuid references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  like_count int not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index posts_place_idx on public.posts (place_id, created_at desc);
create index posts_parent_idx on public.posts (parent_id);
create index posts_body_trgm_idx on public.posts using gin (body gin_trgm_ops);
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/posts.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0004_posts.sql tests/db/posts.test.ts
git commit -m "feat(db): posts table (unified comments/replies) with trgm index"
```

---

### Task 6: post_photos 테이블

**Files:**
- Create: `supabase/migrations/0005_post_photos.sql`
- Test: `tests/db/post_photos.test.ts`

**Interfaces:**
- Consumes: posts
- Produces: `post_photos(id, post_id, storage_path text, width int, height int, created_at)`. 인덱스 `post_photos_post_idx(post_id)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/post_photos.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('post_photos', () => {
  it('attaches a photo to a post', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await db.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    const { data: post } = await db.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'hi' }).select('id').single()

    const { error } = await db.from('post_photos').insert({
      post_id: post!.id, storage_path: 'photos/x.jpg', width: 800, height: 600,
    })
    expect(error).toBeNull()
    const { data } = await db.from('post_photos').select('*').eq('post_id', post!.id)
    expect(data!.length).toBe(1)
    expect(data![0].width).toBe(800)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/post_photos.test.ts`
Expected: FAIL (relation "post_photos" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0005_post_photos.sql`:

```sql
create table public.post_photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index post_photos_post_idx on public.post_photos (post_id);
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/post_photos.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0005_post_photos.sql tests/db/post_photos.test.ts
git commit -m "feat(db): post_photos table"
```

---

### Task 7: likes 테이블 + like_count 트리거

**Files:**
- Create: `supabase/migrations/0006_likes.sql`
- Test: `tests/db/likes.test.ts`

**Interfaces:**
- Consumes: posts, profiles
- Produces: `likes(post_id, user_id, created_at, unique(post_id,user_id))`. AFTER INSERT/DELETE 트리거가 `posts.like_count` 증감.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/likes.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('likes + like_count trigger', () => {
  it('increments and decrements posts.like_count', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await db.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    const { data: post } = await db.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'hi' }).select('id').single()

    await db.from('likes').insert({ post_id: post!.id, user_id: uid })
    let { data: p1 } = await db.from('posts').select('like_count').eq('id', post!.id).single()
    expect(p1!.like_count).toBe(1)

    await db.from('likes').delete().eq('post_id', post!.id).eq('user_id', uid)
    let { data: p2 } = await db.from('posts').select('like_count').eq('id', post!.id).single()
    expect(p2!.like_count).toBe(0)
  })

  it('prevents duplicate likes', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await db.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    const { data: post } = await db.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'hi' }).select('id').single()

    await db.from('likes').insert({ post_id: post!.id, user_id: uid })
    const { error } = await db.from('likes').insert({ post_id: post!.id, user_id: uid })
    expect(error).not.toBeNull() // unique 위반
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/likes.test.ts`
Expected: FAIL (relation "likes" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0006_likes.sql`:

```sql
create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create or replace function public.likes_count_sync()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger likes_count_sync_trg
  after insert or delete on public.likes
  for each row execute function public.likes_count_sync();
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/likes.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0006_likes.sql tests/db/likes.test.ts
git commit -m "feat(db): likes table with like_count trigger"
```

---

### Task 8: reports 테이블

**Files:**
- Create: `supabase/migrations/0007_reports.sql`
- Test: `tests/db/reports.test.ts`

**Interfaces:**
- Consumes: posts, profiles
- Produces: `reports(id, target_post_id, reporter_id, reason text, status text default 'open', created_at)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/reports.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('reports', () => {
  it('files a report with default open status', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await db.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    const { data: post } = await db.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'spam' }).select('id').single()

    const { data, error } = await db.from('reports')
      .insert({ target_post_id: post!.id, reporter_id: uid, reason: 'spam' })
      .select('status').single()
    expect(error).toBeNull()
    expect(data!.status).toBe('open')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/reports.test.ts`
Expected: FAIL (relation "reports" does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0007_reports.sql`:

```sql
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now()
);

create index reports_status_idx on public.reports (status);
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/reports.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0007_reports.sql tests/db/reports.test.ts
git commit -m "feat(db): reports table"
```

---

### Task 9: 지리 함수 (places_in_bbox, nearby_places)

**Files:**
- Create: `supabase/migrations/0008_functions.sql`
- Test: `tests/db/geo_functions.test.ts`

**Interfaces:**
- Consumes: places
- Produces:
  - `places_in_bbox(min_lng float8, min_lat float8, max_lng float8, max_lat float8, max_results int) → setof (id uuid, name text, lat float8, lng float8)` — 화면 bbox 내 장소.
  - `nearby_places(in_lat float8, in_lng float8, radius_m float8, max_results int) → setof (id uuid, name text, lat float8, lng float8, distance_m float8)` — 반경 내 장소, 거리 오름차순.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/geo_functions.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

async function seedPlaces() {
  const { id: uid } = await createTestUser()
  const db = serviceClient()
  await db.from('profiles').insert({ id: uid, nickname: 'u' })
  // 서울 시청 근처 두 곳 + 멀리 떨어진 한 곳(부산)
  await db.from('places').insert([
    { name: 'CityHall', lat: 37.5665, lng: 126.9780, created_by: uid },
    { name: 'Near', lat: 37.5670, lng: 126.9785, created_by: uid },
    { name: 'Busan', lat: 35.1796, lng: 129.0756, created_by: uid },
  ])
  return db
}

describe('geo functions', () => {
  it('places_in_bbox returns only places inside the box', async () => {
    const db = await seedPlaces()
    const { data, error } = await db.rpc('places_in_bbox', {
      min_lng: 126.96, min_lat: 37.55, max_lng: 126.99, max_lat: 37.58, max_results: 50,
    })
    expect(error).toBeNull()
    const names = (data as any[]).map((r) => r.name).sort()
    expect(names).toEqual(['CityHall', 'Near'])
  })

  it('nearby_places returns places within radius ordered by distance', async () => {
    const db = await seedPlaces()
    const { data, error } = await db.rpc('nearby_places', {
      in_lat: 37.5665, in_lng: 126.9780, radius_m: 200, max_results: 50,
    })
    expect(error).toBeNull()
    const rows = data as any[]
    const names = rows.map((r) => r.name)
    expect(names).toContain('CityHall')
    expect(names).toContain('Near')
    expect(names).not.toContain('Busan')
    // 거리 오름차순: 첫 결과가 CityHall(거리 0)
    expect(rows[0].name).toBe('CityHall')
    expect(rows[0].distance_m).toBeLessThan(rows[1].distance_m + 0.001)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/geo_functions.test.ts`
Expected: FAIL (function places_in_bbox does not exist)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0008_functions.sql`:

```sql
-- 화면 bbox 내 장소
create or replace function public.places_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision,
  max_results int default 200
)
returns table (id uuid, name text, lat double precision, lng double precision)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.lat, p.lng
  from public.places p
  where p.lat between min_lat and max_lat
    and p.lng between min_lng and max_lng
  order by p.created_at desc
  limit max_results
$$;

-- 반경 내 장소(거리 오름차순)
create or replace function public.nearby_places(
  in_lat double precision, in_lng double precision,
  radius_m double precision default 50, max_results int default 20
)
returns table (id uuid, name text, lat double precision, lng double precision, distance_m double precision)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.lat, p.lng,
         ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(in_lng, in_lat),4326)::geography) as distance_m
  from public.places p
  where ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(in_lng, in_lat),4326)::geography, radius_m)
  order by distance_m asc
  limit max_results
$$;
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/geo_functions.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0008_functions.sql tests/db/geo_functions.test.ts
git commit -m "feat(db): places_in_bbox and nearby_places geo functions"
```

---

### Task 10: 검색 함수 (search_places)

**Files:**
- Modify: `supabase/migrations/0008_functions.sql` (함수 추가)
- Test: `tests/db/search.test.ts`

**Interfaces:**
- Consumes: places, posts
- Produces: `search_places(q text, max_results int) → setof (place_id uuid, name text, lat float8, lng float8, match_count int, sample_body text)` — 본문이 `q`에 부분일치(`pg_trgm` ilike)하는, 숨김 아닌 멘트가 있는 장소들. 장소별로 매칭 멘트 수와 최신 샘플 본문 1개.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/search.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('search_places', () => {
  it('returns places whose posts match the keyword', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
    await db.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: a } = await db.from('places')
      .insert({ name: 'Ramen A', lat: 37.5, lng: 127.0, created_by: uid }).select('id').single()
    const { data: b } = await db.from('places')
      .insert({ name: 'Sushi B', lat: 37.6, lng: 127.1, created_by: uid }).select('id').single()

    await db.from('posts').insert([
      { place_id: a!.id, author_id: uid, body: 'best tonkotsu ramen ever' },
      { place_id: a!.id, author_id: uid, body: 'ramen broth was rich' },
      { place_id: b!.id, author_id: uid, body: 'fresh sushi today' },
      { place_id: b!.id, author_id: uid, body: 'hidden ramen mention', is_hidden: true },
    ])

    const { data, error } = await db.rpc('search_places', { q: 'ramen', max_results: 20 })
    expect(error).toBeNull()
    const rows = data as any[]
    // Ramen A만 노출(숨김 멘트는 제외 → Sushi B는 매칭 없음)
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Ramen A')
    expect(rows[0].match_count).toBe(2)
    expect(typeof rows[0].sample_body).toBe('string')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/search.test.ts`
Expected: FAIL (function search_places does not exist)

- [ ] **Step 3: 함수 추가**

`supabase/migrations/0008_functions.sql` 끝에 추가:

```sql
-- 멘트 본문 부분일치로 장소 검색
create or replace function public.search_places(q text, max_results int default 50)
returns table (
  place_id uuid, name text, lat double precision, lng double precision,
  match_count int, sample_body text
)
language sql stable security definer set search_path = public
as $$
  with matched as (
    select po.place_id, po.body, po.created_at
    from public.posts po
    where po.is_hidden = false
      and po.body ilike '%' || q || '%'
  )
  select p.id as place_id, p.name, p.lat, p.lng,
         count(m.*)::int as match_count,
         (array_agg(m.body order by m.created_at desc))[1] as sample_body
  from matched m
  join public.places p on p.id = m.place_id
  group by p.id, p.name, p.lat, p.lng
  order by match_count desc
  limit max_results
$$;
```

- [ ] **Step 4: 적용 후 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/search.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0008_functions.sql tests/db/search.test.ts
git commit -m "feat(db): search_places full-text(trgm) search function"
```

---

### Task 11: 좋아요 토글 RPC (toggle_like)

**Files:**
- Modify: `supabase/migrations/0008_functions.sql` (함수 추가)
- Test: `tests/db/toggle_like.test.ts`

**Interfaces:**
- Consumes: likes, posts, `auth.uid()`
- Produces: `toggle_like(in_post_id uuid) → boolean` — 호출자(`auth.uid()`)의 좋아요를 토글. 반환값은 토글 후 "좋아요 상태"(true=좋아요됨). `security invoker`로 RLS 하에서 동작.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/toggle_like.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('toggle_like', () => {
  it('toggles like state for the calling user', async () => {
    const { id: uid, client } = await createTestUser()
    const admin = serviceClient()
    await admin.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await admin.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    const { data: post } = await admin.from('posts')
      .insert({ place_id: place!.id, author_id: uid, body: 'hi' }).select('id').single()

    const { data: liked, error } = await client.rpc('toggle_like', { in_post_id: post!.id })
    expect(error).toBeNull()
    expect(liked).toBe(true)
    let { data: p1 } = await admin.from('posts').select('like_count').eq('id', post!.id).single()
    expect(p1!.like_count).toBe(1)

    const { data: liked2 } = await client.rpc('toggle_like', { in_post_id: post!.id })
    expect(liked2).toBe(false)
    let { data: p2 } = await admin.from('posts').select('like_count').eq('id', post!.id).single()
    expect(p2!.like_count).toBe(0)
  })
})
```

> 주의: 이 테스트는 RLS(Task 12)가 likes에 대해 본인 insert/delete를 허용해야 통과한다. Task 12 적용 후 함께 통과한다. RPC 자체는 여기서 정의한다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/toggle_like.test.ts`
Expected: FAIL (function toggle_like does not exist)

- [ ] **Step 3: 함수 추가**

`supabase/migrations/0008_functions.sql` 끝에 추가:

```sql
create or replace function public.toggle_like(in_post_id uuid)
returns boolean
language plpgsql security invoker set search_path = public
as $$
declare uid uuid := auth.uid();
declare existing int;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;
  delete from public.likes where post_id = in_post_id and user_id = uid;
  get diagnostics existing = row_count;
  if existing > 0 then
    return false; -- 좋아요 취소됨
  end if;
  insert into public.likes (post_id, user_id) values (in_post_id, uid);
  return true; -- 좋아요됨
end;
$$;
```

- [ ] **Step 4: 적용 후 테스트 실행 (RLS 전이면 일부 실패 가능)**

Run: `npx supabase migration up && npm test -- tests/db/toggle_like.test.ts`
Expected: 함수 정의 에러는 사라짐. likes RLS 미적용 상태면 권한 에러로 FAIL할 수 있음 → Task 12에서 최종 PASS.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0008_functions.sql tests/db/toggle_like.test.ts
git commit -m "feat(db): toggle_like rpc"
```

---

### Task 12: RLS 정책 (전 테이블)

**Files:**
- Create: `supabase/migrations/0009_rls.sql`
- Test: `tests/db/rls.test.ts`

**Interfaces:**
- Consumes: 전 테이블, `createTestUser`, `anonClient`, `serviceClient`
- Produces: 모든 테이블 RLS 활성화 + 정책. 이 task 완료 후 Task 11 테스트도 최종 PASS.

정책 요약:
- profiles: select 공개 / insert·update 본인(`id = auth.uid()`).
- places: select 공개 / insert는 인증 + `created_by = auth.uid()`.
- posts: select는 `is_hidden=false` 또는 본인 / insert `author_id = auth.uid()` / update·delete 본인.
- post_photos: select 공개 / insert는 해당 post가 본인 소유.
- likes: select 공개 / insert·delete `user_id = auth.uid()`.
- reports: insert `reporter_id = auth.uid()` / select 본인.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/rls.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, anonClient, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('RLS', () => {
  it('blocks anonymous inserts but allows public reads', async () => {
    const { id: uid } = await createTestUser()
    const admin = serviceClient()
    await admin.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await admin.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    await admin.from('posts').insert({ place_id: place!.id, author_id: uid, body: 'visible' })

    const anon = anonClient()
    const { data: reads } = await anon.from('posts').select('id')
    expect((reads ?? []).length).toBeGreaterThanOrEqual(1) // 공개 읽기 OK

    const { error } = await anon.from('places')
      .insert({ name: 'X', lat: 2, lng: 2, created_by: uid })
    expect(error).not.toBeNull() // 익명 쓰기 차단
  })

  it("prevents editing another user's post", async () => {
    const admin = serviceClient()
    const owner = await createTestUser()
    const attacker = await createTestUser()
    await admin.from('profiles').insert([{ id: owner.id, nickname: 'o' }, { id: attacker.id, nickname: 'a' }])
    const { data: place } = await admin.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: owner.id }).select('id').single()
    const { data: post } = await admin.from('posts')
      .insert({ place_id: place!.id, author_id: owner.id, body: 'mine' }).select('id').single()

    const { error } = await attacker.client.from('posts')
      .update({ body: 'hacked' }).eq('id', post!.id)
    // RLS로 0행 매칭 → 에러는 없을 수 있으나 변경이 일어나면 안 됨
    const { data: after } = await admin.from('posts').select('body').eq('id', post!.id).single()
    expect(after!.body).toBe('mine')
  })

  it('hides is_hidden posts from other users', async () => {
    const admin = serviceClient()
    const { id: uid } = await createTestUser()
    await admin.from('profiles').insert({ id: uid, nickname: 'u' })
    const { data: place } = await admin.from('places')
      .insert({ name: 'P', lat: 1, lng: 1, created_by: uid }).select('id').single()
    await admin.from('posts').insert({ place_id: place!.id, author_id: uid, body: 'secret', is_hidden: true })

    const anon = anonClient()
    const { data } = await anon.from('posts').select('id').eq('place_id', place!.id)
    expect((data ?? []).length).toBe(0) // 숨김글은 익명에게 안 보임
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- tests/db/rls.test.ts`
Expected: FAIL (RLS 미적용이라 익명 insert가 막히지 않거나 숨김글이 노출됨)

- [ ] **Step 3: RLS 마이그레이션 작성**

`supabase/migrations/0009_rls.sql`:

```sql
alter table public.profiles    enable row level security;
alter table public.places      enable row level security;
alter table public.posts       enable row level security;
alter table public.post_photos enable row level security;
alter table public.likes       enable row level security;
alter table public.reports     enable row level security;

-- profiles
create policy profiles_read on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- places
create policy places_read on public.places for select using (true);
create policy places_insert on public.places for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- posts
create policy posts_read on public.posts for select
  using (is_hidden = false or author_id = auth.uid());
create policy posts_insert on public.posts for insert
  with check (author_id = auth.uid());
create policy posts_update on public.posts for update
  using (author_id = auth.uid());
create policy posts_delete on public.posts for delete
  using (author_id = auth.uid());

-- post_photos
create policy photos_read on public.post_photos for select using (true);
create policy photos_insert on public.post_photos for insert
  with check (exists (
    select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
  ));

-- likes
create policy likes_read on public.likes for select using (true);
create policy likes_insert on public.likes for insert with check (user_id = auth.uid());
create policy likes_delete on public.likes for delete using (user_id = auth.uid());

-- reports
create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid());
create policy reports_select on public.reports for select using (reporter_id = auth.uid());
```

- [ ] **Step 4: 적용 후 RLS 테스트 통과 확인**

Run: `npx supabase migration up && npm test -- tests/db/rls.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: toggle_like 테스트 재확인(이제 통과)**

Run: `npm test -- tests/db/toggle_like.test.ts`
Expected: PASS

- [ ] **Step 6: 전체 테스트 회귀 확인**

Run: `npm test`
Expected: 모든 db 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/0009_rls.sql tests/db/rls.test.ts
git commit -m "feat(db): RLS policies for all tables"
```

---

## Self-Review (작성자 점검 결과)

- **Spec coverage**: 데이터모델(§3) 전 테이블 ✔, 지리쿼리/검색(§5) ✔, 좋아요(§3) ✔, RLS·보안(§6) ✔, 테스트(§7) ✔. UI/지도/인증 클라이언트/작성·검색 플로우는 Plan 2~3 범위(의도된 분할).
- **Placeholder scan**: 모든 스텝에 실제 SQL/TS 코드와 명령·기대출력 포함. "TBD/TODO" 없음.
- **Type consistency**: 함수 시그니처(`places_in_bbox`, `nearby_places`, `search_places`, `toggle_like`)가 테스트 호출부와 파라미터명/반환필드 일치. `like_count`·`is_hidden`·`parent_id` 명칭 전 task 일관.
- **알려진 의존**: Task 11 테스트는 Task 12(RLS) 적용 후 최종 PASS — 플랜에 명시.

---

## 다음 Plan 로드맵 (이 Plan 이후 순차 작성/실행)

- **Plan 2 — 인증 + 지도 + 보기**: Supabase 클라이언트(브라우저/서버), Google OAuth 로그인, 첫 로그인 시 profiles 생성, POI 숨긴 베이스맵, viewport 핀 로딩, 장소 상세 패널(최신순+중첩답글 렌더).
- **Plan 3 — 작성 + 검색 + 상호작용**: 현장 멘트 작성(geolocation+핀 드래그+후보 추천+장소 생성/선택+사진 압축 업로드), 검색 UI, 답글·좋아요·신고 UI.
- **Plan 4 — E2E**: Playwright로 핵심 루프(로그인→작성→검색→답글) 종단 검증.
