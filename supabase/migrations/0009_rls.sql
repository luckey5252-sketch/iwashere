alter table public.profiles    enable row level security;
alter table public.places      enable row level security;
alter table public.posts       enable row level security;
alter table public.post_photos enable row level security;
alter table public.likes       enable row level security;
alter table public.reports     enable row level security;

-- profiles
create policy profiles_read on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- places
create policy places_read on public.places for select using (true);
create policy places_insert on public.places for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- posts
create policy posts_read on public.posts for select
  using (is_hidden = false or author_id = auth.uid());
create policy posts_insert on public.posts for insert
  with check (author_id = auth.uid());
create policy posts_update on public.posts for update
  using (author_id = auth.uid());
create policy posts_delete on public.posts for delete
  using (author_id = auth.uid());

-- post_photos
create policy photos_read on public.post_photos for select using (true);
create policy photos_insert on public.post_photos for insert
  with check (exists (
    select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
  ));

-- likes
create policy likes_read on public.likes for select using (true);
create policy likes_insert on public.likes for insert with check (user_id = auth.uid());
create policy likes_delete on public.likes for delete using (user_id = auth.uid());

-- reports
create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid());
create policy reports_select on public.reports for select using (reporter_id = auth.uid());
