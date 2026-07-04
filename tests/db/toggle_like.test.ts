import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('toggle_like', () => {
  it('toggles like state for the calling user', async () => {
    const { id: uid, client } = await createTestUser()
    const admin = serviceClient()
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
