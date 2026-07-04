// 베이스맵에서 구글 기본 POI/대중교통 라벨·아이콘을 숨긴다.
// 핀은 오직 사용자가 남긴 멘트(DB)에서만 생성된다.
export const BASEMAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]
