-- FarmGear Zim: run this once in Supabase > SQL Editor > New query.

-- Profiles: one row per signed-in user, readable only by that user.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  role text default 'Farmer',
  town text,
  phone text,
  avatar_path text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile read" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "own profile insert" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "own profile update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Listings: anyone can read, only the owner can change.
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  cat text not null,
  town text not null,
  cond text not null,
  hire integer check (hire > 0),
  buy integer check (buy > 0),
  description text check (char_length(description) <= 600),
  contact_phone text not null,
  seller_name text,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  check (hire is not null or buy is not null)
);
create index if not exists listings_created_idx on public.listings (created_at desc);
alter table public.listings enable row level security;

create policy "listings public read" on public.listings
  for select using (true);
create policy "listings owner insert" on public.listings
  for insert to authenticated with check (auth.uid() = owner);
create policy "listings owner update" on public.listings
  for update to authenticated using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "listings owner delete" on public.listings
  for delete to authenticated using (auth.uid() = owner);

-- Photos: public bucket, each user writes only inside their own folder.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "media upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
