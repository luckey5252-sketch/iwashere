create table public.post_photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index post_photos_post_idx on public.post_photos (post_id);
