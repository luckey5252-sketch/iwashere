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
