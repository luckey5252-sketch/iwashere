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

    // 균일 키로 삽입 — PostgREST 벌크 insert는 객체 키 합집합으로 컬럼셋을 만들어
    // 키 누락 행에 명시적 NULL을 넣으므로, is_hidden을 모든 행에 명시한다.
    await db.from('posts').insert([
      { place_id: a!.id, author_id: uid, body: 'best tonkotsu ramen ever', is_hidden: false },
      { place_id: a!.id, author_id: uid, body: 'ramen broth was rich', is_hidden: false },
      { place_id: b!.id, author_id: uid, body: 'fresh sushi today', is_hidden: false },
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
