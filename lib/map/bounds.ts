export interface BboxArgs {
  min_lng: number
  min_lat: number
  max_lng: number
  max_lat: number
  max_results: number
}

interface LatLngLike {
  lat(): number
  lng(): number
}

export interface BoundsLike {
  getSouthWest(): LatLngLike
  getNorthEast(): LatLngLike
}

export function boundsToBboxArgs(bounds: BoundsLike, maxResults = 200): BboxArgs {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  return {
    min_lng: sw.lng(),
    min_lat: sw.lat(),
    max_lng: ne.lng(),
    max_lat: ne.lat(),
    max_results: maxResults,
  }
}
