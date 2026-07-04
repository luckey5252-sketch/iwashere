create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  geog geography(Point, 4326),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.places_set_geog()
returns trigger language plpgsql
set search_path = public, extensions as $$
begin
  new.geog := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  return new;
end;
$$;

create trigger places_set_geog_trg
  before insert or update of lat, lng on public.places
  for each row execute function public.places_set_geog();

create index places_geog_idx on public.places using gist (geog);
create index places_latlng_idx on public.places (lat, lng);
