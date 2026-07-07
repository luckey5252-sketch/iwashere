import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('profiles', () => {
  it('auto-creates a profile row for a new auth user', async () => {
    const { id } = await createTestUser()
    const db = serviceClient()
    const { data } = await db.from('profiles').select('*').eq('id', id).single()
    expect(data!.id).toBe(id)
    expect(typeof data!.nickname).toBe('string')
  })

  it('allows the owner to update their nickname', async () => {
    const { id } = await createTestUser()
    const db = serviceClient()
    const { error } = await db.from('profiles').update({ nickname: 'tester' }).eq('id', id)
    expect(error).toBeNull()
    const { data } = await db.from('profiles').select('nickname').eq('id', id).single()
    expect(data!.nickname).toBe('tester')
  })
})
