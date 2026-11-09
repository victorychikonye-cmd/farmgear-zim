-- FarmGear Zim: equipment booking, reviews, verified accounts and trust.
-- Already applied to the FarmGear Zim project. Run it only on a different Supabase project,
-- after supabase.sql, messaging.sql, marketplace.sql and community.sql.

create extension if not exists btree_gist with schema extensions;

-- Verified badge lives on the account; only administrators can change it.
alter table public.user_profiles add column verified boolean not null default false;
alter table public.user_profiles add column verified_at timestamptz;

create or replace function private.user_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.email := (select u.email from auth.users u where u.id = new.id);
    if caller is not null and not private.is_admin() then
      new.role := 'user'; new.status := 'active'; new.verified := false; new.verified_at := null;
    end if;
  else
    if caller is not null and not private.is_admin() then
      if new.role is distinct from old.role or new.status is distinct from old.status or new.verified is distinct from old.verified then
        raise exception 'Only an administrator can change roles, verification or suspend users';
      end if;
      new.email := old.email;
      new.verified_at := old.verified_at;
    end if;
    if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active')
       and not exists (select 1 from public.user_profiles x
                       where x.id <> old.id and x.role = 'admin' and x.status = 'active') then
      raise exception 'There must be at least one active administrator';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- public_profiles: the only account details everyone can see (name, badge, rating)
create table public.public_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  verified boolean not null default false,
  member_since timestamptz not null default now(),
  rating_avg numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  jobs_done integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.public_profiles enable row level security;
create policy "public profiles read" on public.public_profiles for select to anon, authenticated using (true);

create or replace function private.sync_public_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.public_profiles (id, display_name, verified, member_since)
  values (new.id, coalesce(nullif(btrim(new.full_name), ''), 'FarmGear member'), new.verified, new.created_at)
  on conflict (id) do update set display_name = excluded.display_name, verified = excluded.verified, updated_at = now();
  return null;
end $$;
create trigger user_profiles_sync_public after insert or update of full_name, verified on public.user_profiles
  for each row execute function private.sync_public_profile();

insert into public.public_profiles (id, display_name, verified, member_since)
select id, coalesce(nullif(btrim(full_name), ''), 'FarmGear member'), verified, created_at from public.user_profiles
on conflict (id) do nothing;

-- verification_requests: a user asks for the verified badge, an administrator decides
create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 3 and 80),
  phone text not null check (phone ~ '^[+0-9 ()-]{9,20}$'),
  province public.zw_province,
  town text check (char_length(town) <= 60),
  about text not null check (char_length(btrim(about)) between 10 and 500),
  reference_name text check (char_length(reference_name) <= 80),
  reference_phone text check (reference_phone is null or reference_phone ~ '^[+0-9 ()-]{9,20}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  admin_note text check (char_length(admin_note) <= 300),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index verification_one_pending on public.verification_requests (user_id) where status = 'pending';
create index verification_user_idx on public.verification_requests (user_id);
create index verification_status_idx on public.verification_requests (status, created_at desc);
create index verification_reviewer_idx on public.verification_requests (reviewed_by);
alter table public.verification_requests enable row level security;

create or replace function private.verification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.user_profiles u where u.id = new.user_id and u.verified) then
      raise exception 'Your account is already verified';
    end if;
    new.status := 'pending'; new.admin_note := null; new.reviewed_by := null; new.reviewed_at := null;
  else
    new.user_id := old.user_id; new.full_name := old.full_name; new.phone := old.phone; new.province := old.province;
    new.town := old.town; new.about := old.about; new.reference_name := old.reference_name;
    new.reference_phone := old.reference_phone; new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger verification_guard before insert or update on public.verification_requests
  for each row execute function private.verification_guard();

create or replace function private.verification_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.user_profiles set verified = true, verified_at = now() where id = new.user_id;
  elsif new.status = 'revoked' and old.status is distinct from 'revoked' then
    update public.user_profiles set verified = false, verified_at = null where id = new.user_id;
  end if;
  return null;
end $$;
create trigger verification_apply after update on public.verification_requests
  for each row execute function private.verification_apply();

create policy "verification insert own" on public.verification_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active());
create policy "verification read own or admin" on public.verification_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
create policy "verification admin update" on public.verification_requests for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy "verification admin delete" on public.verification_requests for delete to authenticated using (private.is_admin());

-- bookings: a renter asks to hire a piece of equipment for dates, the owner accepts or declines
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings (id) on delete set null,
  listing_title text,
  renter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner uuid not null references auth.users (id) on delete cascade,
  renter_name text,
  owner_name text,
  start_date date not null,
  end_date date not null,
  days integer generated always as (end_date - start_date + 1) stored,
  daily_price integer,
  total_price integer generated always as ((end_date - start_date + 1) * daily_price) stored,
  note text check (char_length(note) <= 400),
  renter_phone text not null check (renter_phone ~ '^[+0-9 ()-]{9,20}$'),
  location text check (char_length(location) <= 100),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','completed')),
  status_note text check (char_length(status_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  exclude using gist (listing_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status in ('accepted','completed'))
);
create index bookings_renter_idx on public.bookings (renter, created_at desc);
create index bookings_owner_idx on public.bookings (owner, created_at desc);
create index bookings_listing_idx on public.bookings (listing_id);
alter table public.bookings enable row level security;

create or replace function private.bookings_insert_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record; today date := (now() at time zone 'Africa/Harare')::date;
begin
  select owner, title, hire, seller_name into l from public.listings where id = new.listing_id;
  if not found then raise exception 'This equipment is no longer listed'; end if;
  if l.hire is null then raise exception 'This equipment is not listed for hire'; end if;
  new.owner := l.owner;
  if new.renter = new.owner then raise exception 'You cannot book your own equipment'; end if;
  if new.start_date < today then raise exception 'The start date cannot be in the past'; end if;
  if new.end_date - new.start_date > 59 then raise exception 'You can book for at most 60 days at a time'; end if;
  if exists (select 1 from public.bookings b where b.listing_id = new.listing_id and b.status in ('accepted','completed')
             and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'These dates are already booked. Pick other dates.';
  end if;
  if (select count(*) from public.bookings b where b.renter = new.renter and b.status = 'pending') >= 10 then
    raise exception 'You have too many waiting requests. Wait for answers or cancel some.';
  end if;
  new.listing_title := l.title;
  new.daily_price := l.hire;
  new.owner_name := coalesce(nullif(btrim(l.seller_name), ''), (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = l.owner), 'Owner');
  new.renter_name := coalesce((select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.renter), 'Renter');
  new.status := 'pending'; new.status_note := null;
  return new;
end $$;
create trigger bookings_insert_guard before insert on public.bookings
  for each row execute function private.bookings_insert_guard();

create or replace function private.bookings_update_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); today date := (now() at time zone 'Africa/Harare')::date;
begin
  new.listing_id := old.listing_id; new.listing_title := old.listing_title; new.renter := old.renter; new.owner := old.owner;
  new.renter_name := old.renter_name; new.owner_name := old.owner_name; new.start_date := old.start_date; new.end_date := old.end_date;
  new.daily_price := old.daily_price; new.note := old.note; new.renter_phone := old.renter_phone;
  new.location := old.location; new.created_at := old.created_at;
  if new.status is distinct from old.status then
    if caller is not null then
      if caller = old.owner then
        if not ((old.status = 'pending' and new.status in ('accepted','declined'))
                or (old.status = 'accepted' and new.status in ('completed','cancelled'))) then
          raise exception 'You cannot change a % booking to %', old.status, new.status;
        end if;
        if new.status = 'completed' and today < old.start_date then
          raise exception 'You can mark it completed once the hire has started';
        end if;
      elsif caller = old.renter then
        if not (old.status in ('pending','accepted') and new.status = 'cancelled') then
          raise exception 'You can only cancel a waiting or accepted booking';
        end if;
      else
        raise exception 'Only the owner or the renter can change this booking';
      end if;
    end if;
  else
    new.status_note := old.status_note;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger bookings_update_guard before update on public.bookings
  for each row execute function private.bookings_update_guard();

create policy "bookings read involved" on public.bookings for select to authenticated
  using (renter = (select auth.uid()) or owner = (select auth.uid()) or private.is_admin());
create policy "bookings insert own" on public.bookings for insert to authenticated
  with check (renter = (select auth.uid()) and private.is_active());
create policy "bookings update involved" on public.bookings for update to authenticated
  using (renter = (select auth.uid()) or owner = (select auth.uid()))
  with check (renter = (select auth.uid()) or owner = (select auth.uid()));
create policy "bookings admin delete" on public.bookings for delete to authenticated using (private.is_admin());

-- listing_busy: dates already taken (no personal details), so everyone can see them in the booking form
create table public.listing_busy (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  start_date date not null,
  end_date date not null
);
create index listing_busy_listing_idx on public.listing_busy (listing_id, start_date);
alter table public.listing_busy enable row level security;
create policy "busy dates read" on public.listing_busy for select to anon, authenticated using (true);

create or replace function private.bookings_sync_busy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('accepted','completed') and new.listing_id is not null then
    insert into public.listing_busy (booking_id, listing_id, start_date, end_date)
    values (new.id, new.listing_id, new.start_date, new.end_date)
    on conflict (booking_id) do update set start_date = excluded.start_date, end_date = excluded.end_date;
  else
    delete from public.listing_busy where booking_id = new.id;
  end if;
  return null;
end $$;
create trigger bookings_sync_busy after insert or update on public.bookings
  for each row execute function private.bookings_sync_busy();

-- reviews: only after a completed booking, one per person per booking
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  reviewer uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reviewee uuid not null references auth.users (id) on delete cascade,
  reviewer_name text,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, reviewer)
);
create index reviews_reviewer_idx on public.reviews (reviewer);
create index reviews_reviewee_idx on public.reviews (reviewee, created_at desc);
alter table public.reviews enable row level security;

create or replace function private.refresh_trust(uid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.public_profiles p set
    rating_avg = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r where r.reviewee = p.id), 0),
    rating_count = (select count(*) from public.reviews r where r.reviewee = p.id),
    jobs_done = (select count(*) from public.bookings b where (b.owner = p.id or b.renter = p.id) and b.status = 'completed'),
    updated_at = now()
  where p.id = uid;
$$;

create or replace function private.reviews_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  select renter, owner, status into b from public.bookings where id = new.booking_id;
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'completed' then raise exception 'You can review after the hire is marked completed'; end if;
  if new.reviewer = b.renter then new.reviewee := b.owner;
  elsif new.reviewer = b.owner then new.reviewee := b.renter;
  else raise exception 'Only people in this booking can review it';
  end if;
  new.reviewer_name := coalesce((select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.reviewer), 'FarmGear member');
  new.comment := nullif(btrim(new.comment), '');
  return new;
end $$;
create trigger reviews_guard before insert on public.reviews
  for each row execute function private.reviews_guard();

create or replace function private.reviews_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_trust(new.reviewee);
  return null;
end $$;
create trigger reviews_after after insert on public.reviews
  for each row execute function private.reviews_after();

create or replace function private.bookings_after_complete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.refresh_trust(new.owner);
    perform private.refresh_trust(new.renter);
  end if;
  return null;
end $$;
create trigger bookings_after_complete after update on public.bookings
  for each row execute function private.bookings_after_complete();

create policy "reviews public read" on public.reviews for select to anon, authenticated using (true);
create policy "reviews insert own" on public.reviews for insert to authenticated
  with check (reviewer = (select auth.uid()) and private.is_active());
create policy "reviews admin delete" on public.reviews for delete to authenticated using (private.is_admin());
