-- Groov update 1.28: run once in Supabase → SQL Editor → New query → Run.
-- Safe to run again.
--
-- ✏️ Before running: put YOUR Groov account email on the line marked ✏️ near
-- the end, so you can see everyone's devices in the app.
--
-- Shared playlists:
--   - the owner decides whether others can add songs
--   - songs can be hidden just for yourself
--   - only the owner, or whoever added a song, can remove it for everyone
-- Devices: how many devices each account is signed in on.

-- Shared playlists ----------------------------------------------------------------
alter table public.playlists add column if not exists members_can_add boolean not null default true;

create table if not exists public.playlist_hidden (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, playlist_id, track_key)
);
alter table public.playlist_hidden enable row level security;

drop policy if exists "see own hidden" on public.playlist_hidden;
drop policy if exists "hide" on public.playlist_hidden;
drop policy if exists "unhide" on public.playlist_hidden;
create policy "see own hidden" on public.playlist_hidden
  for select to authenticated using (user_id = auth.uid());
create policy "hide" on public.playlist_hidden
  for insert to authenticated with check (user_id = auth.uid() and public.can_access_playlist(playlist_id));
create policy "unhide" on public.playlist_hidden
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.can_add_to_playlist(pid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from playlists p where p.id = pid and p.owner_id = auth.uid())
      or exists (
        select 1 from playlists p join playlist_members m on m.playlist_id = p.id
        where p.id = pid and m.user_id = auth.uid() and p.members_can_add
      );
$$;
revoke all on function public.can_add_to_playlist(uuid) from public, anon;
grant execute on function public.can_add_to_playlist(uuid) to authenticated;

drop policy if exists "add songs" on public.playlist_tracks;
create policy "add songs" on public.playlist_tracks
  for insert to authenticated with check (public.can_add_to_playlist(playlist_id));

drop policy if exists "remove songs" on public.playlist_tracks;
create policy "remove songs" on public.playlist_tracks
  for delete to authenticated using (
    added_by = auth.uid()
    or exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid())
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlist_hidden'
  ) then
    alter publication supabase_realtime add table public.playlist_hidden;
  end if;
end $$;

-- Devices ----------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_admins enable row level security;

create or replace function public.my_devices()
returns table (device text, last_active timestamptz, signed_in timestamptz, this_device boolean)
language sql security definer stable set search_path = public, auth as $$
  select s.user_agent, s.updated_at, s.created_at, s.id::text = (auth.jwt() ->> 'session_id')
  from auth.sessions s
  where s.user_id = auth.uid()
    and s.updated_at > now() - interval '30 days'
    and (s.not_after is null or s.not_after > now())
  order by s.updated_at desc;
$$;

create or replace function public.is_groov_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

create or replace function public.all_devices()
returns table (name text, email text, devices bigint, last_active timestamptz, device_list text[])
language plpgsql security definer stable set search_path = public, auth as $$
begin
  if not exists (select 1 from app_admins where user_id = auth.uid()) then
    raise exception 'Only the Groov admin can see this';
  end if;
  return query
    select coalesce(p.display_name, split_part(u.email, '@', 1))::text,
           u.email::text,
           count(s.id),
           max(s.updated_at),
           coalesce(array_remove(array_agg(distinct s.user_agent::text), null), '{}')
    from auth.users u
    left join profiles p on p.id = u.id
    left join auth.sessions s
      on s.user_id = u.id
     and s.updated_at > now() - interval '30 days'
     and (s.not_after is null or s.not_after > now())
    group by u.id, p.display_name, u.email
    order by 3 desc, 4 desc nulls last;
end $$;

revoke all on function public.my_devices() from public, anon;
revoke all on function public.is_groov_admin() from public, anon;
revoke all on function public.all_devices() from public, anon;
grant execute on function public.my_devices() to authenticated;
grant execute on function public.is_groov_admin() to authenticated;
grant execute on function public.all_devices() to authenticated;

insert into public.app_admins (user_id)
select id from auth.users
where lower(email) = lower('YOUR-GROOV-EMAIL@example.com') -- ✏️ your Groov account email
on conflict do nothing;

select case
  when exists (select 1 from public.app_admins)
    then 'Groov update ready ✓  Admin: ' || (select string_agg(u.email, ', ') from public.app_admins a join auth.users u on u.id = a.user_id)
  else 'Update done, but no admin set: check the email on the ✏️ line and run again'
end as status;
