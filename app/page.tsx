'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'
import { PlaceDetailPanel } from '@/components/PlaceDetailPanel'
import { AuthButton } from '@/components/AuthButton'

export default function Home() {
  const [placeId, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 10 }}>
        <AuthButton />
      </div>
      <MapView onSelectPlace={setPlaceId} />
      <PlaceDetailPanel placeId={placeId} onClose={() => setPlaceId(null)} />
    </main>
  )
}
