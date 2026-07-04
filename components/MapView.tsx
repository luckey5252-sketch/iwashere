'use client'

import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { BASEMAP_STYLE } from '@/lib/map/basemap-style'

const SEOUL = { lat: 37.5665, lng: 126.978 }

export function MapView({ onSelectPlace }: { onSelectPlace: (id: string) => void }) {
  // onSelectPlace는 Task 6에서 PlacePins로 전달된다(현재는 미사용 자리표시).
  void onSelectPlace
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <Map
        defaultCenter={SEOUL}
        defaultZoom={15}
        disableDefaultUI
        clickableIcons={false}
        styles={BASEMAP_STYLE}
        style={{ width: '100%', height: '100dvh' }}
      />
    </APIProvider>
  )
}
