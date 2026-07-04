import { describe, it, expect, afterEach } from 'vitest'
import { serviceClient, createTestUser, cleanup } from '../helpers/supabase'

afterEach(cleanup)

async function seedPlaces() {
  const { id: uid } = await createTestUser()
  const db = serviceClient()
  await db.from('profiles').insert({ id: uid, nickname: 'u' })
  // 서울 시청 근처 두 곳 + 멀리 떨어진 한 곳(부산)
  await db.from('places').insert([
    { name: 'CityHall', lat: 37.5665, lng: 126.9780, created_by: uid },
    { name: 'Near', lat: 37.5670, lng: 126.9785, created_by: uid },
    { name: 'Busan', lat: 35.1796, lng: 129.0756, created_by: uid },
  ])
  return db
}

describe('geo functions', () => {
  it('places_in_bbox returns only places inside the box', async () => {
    const db = await seedPlaces()
    const { data, error } = await db.rpc('places_in_bbox', {
      min_lng: 126.96, min_lat: 37.55, max_lng: 126.99, max_lat: 37.58, max_results: 50,
    })
    expect(error).toBeNull()
    const names = (data as any[]).map((r) => r.name).sort()
    expect(names).toEqual(['CityHall', 'Near'])
  })

  it('nearby_places returns places within radius ordered by distance', async () => {
    const db = await seedPlaces()
    const { data, error } = await db.rpc('nearby_places', {
      in_lat: 37.5665, in_lng: 126.9780, radius_m: 200, max_results: 50,
    })
    expect(error).toBeNull()
    const rows = data as any[]
    const names = rows.map((r) => r.name)
    expect(names).toContain('CityHall')
    expect(names).toContain('Near')
    expect(names).not.toContain('Busan')
    // 거리 오름차순: 첫 결과가 CityHall(거리 0)
    expect(rows[0].name).toBe('CityHall')
    expect(rows[0].distance_m).toBeLessThan(rows[1].distance_m + 0.001)
  })
})
