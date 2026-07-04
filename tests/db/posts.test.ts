import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

async function seedPlace() {
  const { id: uid } = await createTestUser()
  const db = serviceClient()
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
