import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('reports', () => {
  it('files a report with default open status', async () => {
    const { id: uid } = await createTestUser()
    const db = serviceClient()
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
