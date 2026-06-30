# iwashere

여행자가 깔끔한 베이스맵 위에서 **현장에서 장소에 짧은 멘트+사진을 남기고**, **검색으로 멘트가 달린 장소를 찾아 읽고 답글·좋아요로 상호작용**하는 모바일 우선 웹 서비스.

> 핵심 설계: [docs/superpowers/specs/2026-07-01-iwashere-field-notes-map-design.md](docs/superpowers/specs/2026-07-01-iwashere-field-notes-map-design.md)

## 정체성 (절대 흔들리면 안 되는 원칙)

- 지도에는 **구글 기본 POI(가게/명소 핀)를 숨긴다.** 핀은 오직 **사용자가 남긴 멘트**에서 생긴다.
- 검색은 구글 장소 검색이 아니라 **자체 DB의 멘트 텍스트 전문검색**이다. (가장 비싼 Places API를 쓰지 않는다 — 비용 핵심)
- 구글 의존은 **베이스맵 표시 한 가지**로 제한한다.
- 콘텐츠는 하이브리드: **최신 멘트가 위로, 과거 멘트도 보존**된다.
- 타깃은 **글로벌/외국인 여행자**. UI 영어 기본. (다국어 i18n은 후속)

## 기술 스택

- 프론트: **Next.js (App Router)**, 모바일 우선 반응형
- 지도: **Google Maps JavaScript API** (POI 숨김 커스텀 스타일)
- 위치: 브라우저 **Geolocation API** (무료)
- 백엔드: **Supabase** — Auth(Google OAuth) / Postgres(+PostGIS) / Storage
- 검색: Postgres 전문검색 + **pg_trgm**
- 배포: Vercel + Supabase (무료티어)

## 데이터 모델 (요약)

`profiles` · `places`(PostGIS geog) · `posts`(멘트/답글 통합, `parent_id` 자기참조 중첩) · `post_photos` · `likes`(유니크) · `reports`.

상세 스키마/RLS는 설계 문서 §3, §6 참조.

## 작업 규칙

- **TDD 우선** — 구현 전 테스트부터. (지리쿼리·검색·좋아요 토글·RLS 정책)
- **YAGNI** — 아래 "범위 밖" 항목을 미리 만들지 않는다.
- 비밀키(`GOOGLE_MAPS_API_KEY`, Supabase 키)는 `.env.local`, 절대 커밋 금지. 클라이언트 노출용 키는 도메인/Referer 제한 필수.
- Google Maps 호출은 **세션당 지도 1로드** 원칙을 깨지 않는다. 비용 폭증 방지.
- 새 작업은 브레인스토밍 → 설계문서 → 구현계획 순서를 따른다.

## 현재 범위 (첫 스펙)

**핵심 루프 + 인증**: 지도 탐색 → 현장 멘트+사진 작성 → 검색 → 읽기/중첩답글/좋아요/신고(수동검토) + Google 로그인.

## 범위 밖 (후속 스펙 — 지금 만들지 말 것)

영상 업로드 · 자동 모더레이션(욕설/이미지 필터) · 운영자 대시보드 · 다국어(i18n) · 카카오/애플 로그인 · 리버스 지오코딩 주소 자동제안.
