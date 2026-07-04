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
