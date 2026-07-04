import { describe, it, expect } from 'vitest'
import { serviceClient } from '../helpers/supabase'

describe('extensions', () => {
  it('has postgis and pg_trgm installed', async () => {
    const { data, error } = await serviceClient().rpc('installed_extensions')
    expect(error).toBeNull()
    const names = (data as { name: string }[]).map((r) => r.name)
    expect(names).toContain('postgis')
    expect(names).toContain('pg_trgm')
  })
})
