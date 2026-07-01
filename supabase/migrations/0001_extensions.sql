create extension if not exists postgis;
create extension if not exists pg_trgm;

create or replace function public.installed_extensions()
returns table(name text)
language sql stable security definer set search_path = public, pg_catalog
as $$ select extname::text from pg_extension $$;
