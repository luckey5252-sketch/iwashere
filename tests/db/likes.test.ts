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
