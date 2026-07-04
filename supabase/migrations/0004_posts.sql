create table public.posts (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  parent_id uuid references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  like_count int not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index posts_place_idx on public.posts (place_id, created_at desc);
create index posts_parent_idx on public.posts (parent_id);
create index posts_body_trgm_idx on public.posts using gin (body gin_trgm_ops);
