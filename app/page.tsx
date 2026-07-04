'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'
import { PlaceDetailPanel } from '@/components/PlaceDetailPanel'

export default function Home() {
  const [placeId, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <MapView onSelectPlace={setPlaceId} />
      <PlaceDetailPanel placeId={placeId} onClose={() => setPlaceId(null)} />
    </main>
  )
}
