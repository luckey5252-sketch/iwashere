-- 화면 bbox 내 장소
create or replace function public.places_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision,
  max_results int default 200
)
returns table (id uuid, name text, lat double precision, lng double precision)
language sql stable security definer set search_path = public, extensions
as $$
  select p.id, p.name, p.lat, p.lng
  from public.places p
  where p.lat between min_lat and max_lat
    and p.lng between min_lng and max_lng
  order by p.created_at desc
  limit max_results
$$;

-- 반경 내 장소(거리 오름차순)
create or replace function public.nearby_places(
  in_lat double precision, in_lng double precision,
  radius_m double precision default 50, max_results int default 20
)
returns table (id uuid, name text, lat double precision, lng double precision, distance_m double precision)
language sql stable security definer set search_path = public, extensions
as $$
  select p.id, p.name, p.lat, p.lng,
         ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(in_lng, in_lat),4326)::geography) as distance_m
  from public.places p
  where ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(in_lng, in_lat),4326)::geography, radius_m)
  order by distance_m asc
  limit max_results
$$;

-- 멘트 본문 부분일치로 장소 검색
create or replace function public.search_places(q text, max_results int default 50)
returns table (
  place_id uuid, name text, lat double precision, lng double precision,
  match_count int, sample_body text
)
language sql stable security definer set search_path = public, extensions
as $$
  with matched as (
    select po.place_id, po.body, po.created_at
    from public.posts po
    where po.is_hidden = false
      and po.body ilike '%' || q || '%'
  )
  select p.id as place_id, p.name, p.lat, p.lng,
         count(m.*)::int as match_count,
         (array_agg(m.body order by m.created_at desc))[1] as sample_body
  from matched m
  join public.places p on p.id = m.place_id
  group by p.id, p.name, p.lat, p.lng
  order by match_count desc
  limit max_results
$$;

-- 좋아요 토글(호출자 기준)
create or replace function public.toggle_like(in_post_id uuid)
returns boolean
language plpgsql security invoker set search_path = public
as $$
declare uid uuid := auth.uid();
declare existing int;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;
  delete from public.likes where post_id = in_post_id and user_id = uid;
  get diagnostics existing = row_count;
  if existing > 0 then
    return false; -- 좋아요 취소됨
  end if;
  insert into public.likes (post_id, user_id) values (in_post_id, uid);
  return true; -- 좋아요됨
end;
$$;
