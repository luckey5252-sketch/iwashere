import { describe, it, expect } from 'vitest'
import { boundsToBboxArgs } from '@/lib/map/bounds'

function fakeBounds(swLat: number, swLng: number, neLat: number, neLng: number) {
  return {
    getSouthWest: () => ({ lat: () => swLat, lng: () => swLng }),
    getNorthEast: () => ({ lat: () => neLat, lng: () => neLng }),
  }
}

describe('boundsToBboxArgs', () => {
  it('maps SW/NE corners to bbox args', () => {
    const args = boundsToBboxArgs(fakeBounds(37.55, 126.96, 37.58, 126.99))
    expect(args).toEqual({
      min_lat: 37.55, min_lng: 126.96, max_lat: 37.58, max_lng: 126.99, max_results: 200,
    })
  })

  it('honors a custom maxResults', () => {
    const args = boundsToBboxArgs(fakeBounds(0, 0, 1, 1), 50)
    expect(args.max_results).toBe(50)
  })
})
