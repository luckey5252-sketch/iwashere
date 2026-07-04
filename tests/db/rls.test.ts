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

    await attacker.client.from('posts')
      .update({ body: 'hacked' }).eq('id', post!.id)
    // RLS로 0행 매칭 → 변경이 일어나면 안 됨
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
