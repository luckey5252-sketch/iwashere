import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, cleanup } from '../helpers/supabase'

afterEach(cleanup)

describe('profile auto-creation on signup', () => {
  it('creates a profile from user metadata', async () => {
    const admin = serviceClient()
    const { data, error } = await admin.auth.admin.createUser({
      email: `sig_${Date.now()}@example.com`,
      password: 'password123!',
      email_confirm: true,
      user_metadata: { full_name: 'Jane Traveler', avatar_url: 'https://x/a.png' },
    })
    expect(error).toBeNull()
    const uid = data.user!.id
    const { data: prof } = await admin.from('profiles').select('*').eq('id', uid).single()
    expect(prof!.nickname).toBe('Jane Traveler')
    expect(prof!.avatar_url).toBe('https://x/a.png')
  })

  it('falls back to default nickname without metadata', async () => {
    const admin = serviceClient()
    const { data } = await admin.auth.admin.createUser({
      email: `sig2_${Date.now()}@example.com`,
      password: 'password123!',
      email_confirm: true,
    })
    const uid = data.user!.id
    const { data: prof } = await admin.from('profiles').select('nickname').eq('id', uid).single()
    expect(prof!.nickname).toBe('traveler')
  })
})
