'use client'

import { useEffect, useState } from 'react'
import { Marker, useMap } from '@vis.gl/react-google-maps'
import { createClient } from '@/lib/supabase/client'
import { boundsToBboxArgs } from '@/lib/map/bounds'

interface PlacePin {
  id: string
  name: string
  lat: number
  lng: number
}

export function PlacePins({ onSelectPlace }: { onSelectPlace: (id: string) => void }) {
  const map = useMap()
  const [pins, setPins] = useState<PlacePin[]>([])

  useEffect(() => {
    if (!map) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout>

    const load = async () => {
      const bounds = map.getBounds()
      if (!bounds) return
      const { data } = await supabase.rpc('places_in_bbox', boundsToBboxArgs(bounds))
      setPins((data ?? []) as PlacePin[])
    }

    const listener = map.addListener('idle', () => {
      clearTimeout(timer)
      timer = setTimeout(load, 300) // 디바운스 — 팬/줌 연속 이동 시 과호출 방지
    })

    return () => {
      listener.remove()
      clearTimeout(timer)
    }
  }, [map])

  return (
    <>
      {pins.map((p) => (
        <Marker
          key={p.id}
          position={{ lat: p.lat, lng: p.lng }}
          onClick={() => onSelectPlace(p.id)}
        />
      ))}
    </>
  )
}
