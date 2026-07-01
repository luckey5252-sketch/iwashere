create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now()
);

create index reports_status_idx on public.reports (status);
