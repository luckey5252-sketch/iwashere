create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default 'traveler',
  avatar_url text,
  created_at timestamptz not null default now()
);
