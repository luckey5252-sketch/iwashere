'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView'

export default function Home() {
  const [, setPlaceId] = useState<string | null>(null)
  return (
    <main>
      <MapView onSelectPlace={setPlaceId} />
    </main>
  )
}
