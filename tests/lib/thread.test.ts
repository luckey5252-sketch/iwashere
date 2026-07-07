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
