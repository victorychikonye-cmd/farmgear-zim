-- FarmGear Zim: Agricultural Marketplace + Market Prices.
-- Already applied to the FarmGear Zim project. Run it only on a different Supabase project
-- (after supabase.sql and messaging.sql). To make yourself an administrator afterwards, run:
--   update public.user_profiles set role = 'admin' where email = 'YOUR EMAIL HERE';

create extension if not exists pg_trgm with schema extensions;

-- Helper functions live in a private schema that the public API cannot call.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create domain public.zw_province as text check (value in (
  'Bulawayo','Harare','Manicaland','Mashonaland Central','Mashonaland East','Mashonaland West',
  'Masvingo','Matabeleland North','Matabeleland South','Midlands'));
create domain public.listing_unit as text check (value in ('kg','tonnes','bags','crates','animals'));
create domain public.price_unit as text check (value in ('kg','tonne','head'));

-- 1. user_profiles ---------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 80),
  user_type text not null default 'Farmer' check (char_length(user_type) <= 40),
  phone text check (phone is null or phone ~ '^[+0-9 ()-]{9,20}$'),
  province public.zw_province,
  district text check (char_length(district) <= 60),
  town text check (char_length(town) <= 60),
  avatar_path text,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_profiles_role_idx on public.user_profiles (role) where role = 'admin';
alter table public.user_profiles enable row level security;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles u
                 where u.id = (select auth.uid()) and u.role = 'admin' and u.status = 'active');
$$;
create or replace function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.user_profiles u
                     where u.id = (select auth.uid()) and u.status = 'suspended');
$$;
revoke all on function private.is_admin(), private.is_active() from public, anon;
grant execute on function private.is_admin(), private.is_active() to authenticated;

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create or replace function private.user_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.email := (select u.email from auth.users u where u.id = new.id);
    if caller is not null and not private.is_admin() then new.role := 'user'; new.status := 'active'; end if;
  else
    if caller is not null and not private.is_admin() then
      if new.role is distinct from old.role or new.status is distinct from old.status then
        raise exception 'Only an administrator can change roles or suspend users';
      end if;
      new.email := old.email;
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
create trigger user_profiles_guard before insert or update on public.user_profiles
  for each row execute function private.user_profiles_guard();

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- 2. product_categories ------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 2 and 60),
  kind text not null check (kind in ('crop','produce','livestock','other')),
  default_unit public.listing_unit not null default 'kg',
  price_unit public.price_unit not null default 'kg',
  stale_after_days integer not null default 14 check (stale_after_days between 1 and 365),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.product_categories enable row level security;
create trigger product_categories_touch before update on public.product_categories
  for each row execute function private.touch_updated_at();

-- 3. products (farmer listings) ------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.product_categories (id),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  description text check (char_length(description) <= 800),
  quantity numeric(12,2) not null check (quantity > 0),
  unit public.listing_unit not null,
  price numeric(12,2) not null check (price > 0),
  province public.zw_province not null,
  district text check (char_length(district) <= 60),
  town text check (char_length(town) <= 60),
  contact_phone text not null check (contact_phone ~ '^[+0-9 ()-]{9,20}$'),
  seller_name text check (char_length(seller_name) <= 80),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  status text not null default 'active' check (status in ('active','sold','removed')),
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_feed_idx on public.products (status, created_at desc);
create index products_owner_idx on public.products (owner);
create index products_category_idx on public.products (category_id);
create index products_location_idx on public.products (province, district);
create index products_price_idx on public.products (price);
create index products_title_trgm_idx on public.products using gin (title extensions.gin_trgm_ops);
alter table public.products enable row level security;

create or replace function private.products_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.products x where x.owner = new.owner and x.created_at > now() - interval '1 day') >= 30 then
      raise exception 'Daily posting limit reached. Try again tomorrow.';
    end if;
    new.status := 'active';
    new.sold_at := null;
    new.seller_name := coalesce(nullif(btrim(new.seller_name), ''),
      (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.owner), 'Farmer');
  else
    if new.owner is distinct from old.owner then raise exception 'The owner of a listing cannot be changed'; end if;
    if new.status = 'removed' and old.status <> 'removed' and not private.is_admin() then
      raise exception 'Only an administrator can remove a listing';
    end if;
    if old.status = 'removed' and new.status <> 'removed' and not private.is_admin() then
      raise exception 'This listing was removed by an administrator';
    end if;
    if new.status = 'sold' and old.status <> 'sold' then new.sold_at := now(); end if;
    if new.status = 'active' and old.status = 'sold' then new.sold_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger products_guard before insert or update on public.products
  for each row execute function private.products_guard();

-- 4. buyer_requests ----------------------------------------------------------------------
create table public.buyer_requests (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.product_categories (id),
  product_name text not null check (char_length(btrim(product_name)) between 2 and 80),
  quantity numeric(12,2) not null check (quantity > 0),
  unit public.listing_unit not null,
  target_price numeric(12,2) check (target_price > 0),
  province public.zw_province not null,
  district text check (char_length(district) <= 60),
  town text check (char_length(town) <= 60),
  notes text check (char_length(notes) <= 600),
  contact_name text check (char_length(contact_name) <= 80),
  contact_phone text not null check (contact_phone ~ '^[+0-9 ()-]{9,20}$'),
  status text not null default 'open' check (status in ('open','fulfilled','closed','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index buyer_requests_feed_idx on public.buyer_requests (status, created_at desc);
create index buyer_requests_owner_idx on public.buyer_requests (owner);
create index buyer_requests_category_idx on public.buyer_requests (category_id);
create index buyer_requests_location_idx on public.buyer_requests (province, district);
create index buyer_requests_name_trgm_idx on public.buyer_requests using gin (product_name extensions.gin_trgm_ops);
alter table public.buyer_requests enable row level security;

create or replace function private.buyer_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.buyer_requests x where x.owner = new.owner and x.created_at > now() - interval '1 day') >= 20 then
      raise exception 'Daily request limit reached. Try again tomorrow.';
    end if;
    new.status := 'open';
    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''),
      (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.owner), 'Buyer');
  else
    if new.owner is distinct from old.owner then raise exception 'The owner of a request cannot be changed'; end if;
    if new.status = 'removed' and old.status <> 'removed' and not private.is_admin() then
      raise exception 'Only an administrator can remove a request';
    end if;
    if old.status = 'removed' and new.status <> 'removed' and not private.is_admin() then
      raise exception 'This request was removed by an administrator';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger buyer_requests_guard before insert or update on public.buyer_requests
  for each row execute function private.buyer_requests_guard();

-- 5. saved_listings ------------------------------------------------------------------------
create table public.saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);
create index saved_listings_product_idx on public.saved_listings (product_id);
alter table public.saved_listings enable row level security;
create trigger saved_listings_touch before update on public.saved_listings
  for each row execute function private.touch_updated_at();

-- 6. enquiries (purchase enquiries and replies to buy requests) --------------------------------
create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  buyer_request_id uuid references public.buyer_requests (id) on delete set null,
  subject text,
  message text not null check (char_length(btrim(message)) between 2 and 800),
  quantity_wanted numeric(12,2) check (quantity_wanted > 0),
  offer_price numeric(12,2) check (offer_price > 0),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[+0-9 ()-]{9,20}$'),
  sender_name text,
  status text not null default 'new' check (status in ('new','read','replied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiries_sender_idx on public.enquiries (sender, created_at desc);
create index enquiries_recipient_idx on public.enquiries (recipient, created_at desc);
create index enquiries_product_idx on public.enquiries (product_id);
create index enquiries_request_idx on public.enquiries (buyer_request_id);
alter table public.enquiries enable row level security;

create or replace function private.enquiries_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p record; r record;
begin
  if num_nonnulls(new.product_id, new.buyer_request_id) <> 1 then
    raise exception 'An enquiry must be about one listing or one buy request';
  end if;
  if new.product_id is not null then
    select owner, title, status into p from public.products where id = new.product_id;
    if not found or p.status <> 'active' then raise exception 'This listing is not available'; end if;
    new.recipient := p.owner; new.subject := p.title;
  else
    select owner, product_name, status into r from public.buyer_requests where id = new.buyer_request_id;
    if not found or r.status <> 'open' then raise exception 'This buy request is not open'; end if;
    new.recipient := r.owner; new.subject := r.product_name;
  end if;
  if new.recipient = new.sender then raise exception 'You cannot send an enquiry to yourself'; end if;
  if (select count(*) from public.enquiries e where e.sender = new.sender and e.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many enquiries in the last hour. Try again later.';
  end if;
  new.sender_name := coalesce((select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.sender), 'FarmGear user');
  new.status := 'new';
  return new;
end $$;
create trigger enquiries_before_insert before insert on public.enquiries
  for each row execute function private.enquiries_before_insert();

create or replace function private.enquiries_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.recipient and not private.is_admin() then
    raise exception 'Only the recipient can update an enquiry';
  end if;
  new.sender := old.sender; new.recipient := old.recipient;
  new.product_id := old.product_id; new.buyer_request_id := old.buyer_request_id;
  new.subject := old.subject; new.message := old.message;
  new.quantity_wanted := old.quantity_wanted; new.offer_price := old.offer_price;
  new.contact_phone := old.contact_phone; new.sender_name := old.sender_name;
  new.updated_at := now();
  return new;
end $$;
create trigger enquiries_before_update before update on public.enquiries
  for each row execute function private.enquiries_before_update();

-- 7. listing_reports (extra table: lets users report fraudulent listings to admins) -----------------
create table public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  buyer_request_id uuid references public.buyer_requests (id) on delete cascade,
  reason text not null check (reason in ('fraud','wrong_info','already_sold','inappropriate','spam','other')),
  details text check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(product_id, buyer_request_id) = 1),
  unique (reporter, product_id),
  unique (reporter, buyer_request_id)
);
create index listing_reports_status_idx on public.listing_reports (status, created_at desc);
create index listing_reports_product_idx on public.listing_reports (product_id);
create index listing_reports_request_idx on public.listing_reports (buyer_request_id);
alter table public.listing_reports enable row level security;
create trigger listing_reports_touch before update on public.listing_reports
  for each row execute function private.touch_updated_at();

-- 8. agricultural_prices (current recorded price per commodity, market, unit, currency) ---------
create table public.agricultural_prices (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories (id),
  market_name text not null check (char_length(btrim(market_name)) between 2 and 80),
  market_type text not null check (market_type in ('buyer','grain_market','licensed_buyer','livestock_market','trading_centre')),
  province public.zw_province,
  district text check (char_length(district) <= 60),
  location text check (char_length(location) <= 80),
  unit public.price_unit not null,
  currency text not null default 'USD' check (currency in ('USD','ZWG')),
  price numeric(12,2) not null check (price > 0),
  recorded_on date not null,
  source_name text not null check (char_length(btrim(source_name)) between 2 and 120),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  notes text check (char_length(notes) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, market_name, unit, currency)
);
create index agricultural_prices_updated_by_idx on public.agricultural_prices (updated_by);
alter table public.agricultural_prices enable row level security;

-- 9. price_history (every dated observation) ----------------------------------------------------
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  price_id uuid references public.agricultural_prices (id) on delete set null,
  category_id uuid not null references public.product_categories (id),
  market_name text not null,
  market_type text not null check (market_type in ('buyer','grain_market','licensed_buyer','livestock_market','trading_centre')),
  province public.zw_province,
  district text,
  location text,
  unit public.price_unit not null,
  currency text not null default 'USD' check (currency in ('USD','ZWG')),
  price numeric(12,2) not null check (price > 0),
  recorded_on date not null,
  source_name text not null check (char_length(btrim(source_name)) between 2 and 120),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (category_id, market_name, unit, currency, recorded_on)
);
create index price_history_price_idx on public.price_history (price_id);
create index price_history_series_idx on public.price_history (category_id, unit, currency, recorded_on);
create index price_history_recorded_by_idx on public.price_history (recorded_by);
alter table public.price_history enable row level security;

create or replace function private.price_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.recorded_on > current_date + 1 then raise exception 'The price date cannot be in the future'; end if;
  if tg_op = 'UPDATE' and new.recorded_on < old.recorded_on then
    raise exception 'This price is older than the current record (%). Add it as a historical entry instead.', old.recorded_on;
  end if;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger a_price_before_write before insert or update on public.agricultural_prices
  for each row execute function private.price_before_write();

create or replace function private.price_sync_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.price_history (price_id, category_id, market_name, market_type, province, district, location,
                                    unit, currency, price, recorded_on, source_name, source_url, recorded_by)
  values (new.id, new.category_id, new.market_name, new.market_type, new.province, new.district, new.location,
          new.unit, new.currency, new.price, new.recorded_on, new.source_name, new.source_url, new.updated_by)
  on conflict (category_id, market_name, unit, currency, recorded_on) do update set
    price_id = excluded.price_id, market_type = excluded.market_type, province = excluded.province,
    district = excluded.district, location = excluded.location, price = excluded.price,
    source_name = excluded.source_name, source_url = excluded.source_url, recorded_by = excluded.recorded_by;
  return null;
end $$;
create trigger b_price_sync_history after insert or update on public.agricultural_prices
  for each row execute function private.price_sync_history();

-- 10. price_alerts -------------------------------------------------------------------------------
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.product_categories (id),
  market_name text,
  unit public.price_unit not null,
  currency text not null default 'USD' check (currency in ('USD','ZWG')),
  direction text not null default 'above' check (direction in ('above','below')),
  target_price numeric(12,2) check (target_price > 0),
  change_pct numeric(5,2) check (change_pct > 0 and change_pct <= 100),
  active boolean not null default true,
  triggered_at timestamptz,
  triggered_price numeric(12,2),
  triggered_market text,
  trigger_reason text,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_price is not null or change_pct is not null)
);
create index price_alerts_user_idx on public.price_alerts (user_id);
create index price_alerts_match_idx on public.price_alerts (category_id, unit, currency) where active;
alter table public.price_alerts enable row level security;
create trigger price_alerts_touch before update on public.price_alerts
  for each row execute function private.touch_updated_at();

create or replace function private.price_eval_alerts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare prev numeric;
begin
  select h.price into prev from public.price_history h
   where h.category_id = new.category_id and h.market_name = new.market_name
     and h.unit = new.unit and h.currency = new.currency and h.recorded_on < new.recorded_on
   order by h.recorded_on desc limit 1;
  update public.price_alerts a set
    triggered_at = now(), triggered_price = new.price, triggered_market = new.market_name,
    trigger_reason = case
      when a.target_price is not null and ((a.direction = 'above' and new.price >= a.target_price)
                                           or (a.direction = 'below' and new.price <= a.target_price))
        then 'Reached your target of ' || a.target_price
      else 'Changed by ' || round(abs(new.price - prev) / prev * 100, 1) || '% since the last recorded price' end,
    updated_at = now()
  where a.active and a.category_id = new.category_id
    and (a.market_name is null or a.market_name = new.market_name)
    and a.unit = new.unit and a.currency = new.currency
    and (a.triggered_at is null or (a.seen_at is not null and a.seen_at >= a.triggered_at))
    and ((a.target_price is not null and ((a.direction = 'above' and new.price >= a.target_price)
                                          or (a.direction = 'below' and new.price <= a.target_price)))
         or (a.change_pct is not null and prev is not null and prev > 0
             and abs(new.price - prev) / prev * 100 >= a.change_pct));
  return null;
end $$;
create trigger c_price_eval_alerts after insert or update on public.agricultural_prices
  for each row execute function private.price_eval_alerts();

-- Price board: current price plus previous, highest, lowest and % change, all derived from history.
create view public.price_board with (security_invoker = true) as
select p.id, p.category_id, p.market_name, p.market_type, p.province, p.district, p.location,
       p.unit, p.currency, p.price, p.recorded_on, p.source_name, p.source_url, p.notes, p.updated_at,
       prev.price as previous_price, prev.recorded_on as previous_recorded_on,
       case when prev.price > 0 then round((p.price - prev.price) / prev.price * 100, 2) end as change_pct,
       st.highest_price, st.lowest_price, st.record_count
from public.agricultural_prices p
left join lateral (
  select h.price, h.recorded_on from public.price_history h
  where h.category_id = p.category_id and h.market_name = p.market_name
    and h.unit = p.unit and h.currency = p.currency and h.recorded_on < p.recorded_on
  order by h.recorded_on desc limit 1) prev on true
left join lateral (
  select max(h.price) as highest_price, min(h.price) as lowest_price, count(*) as record_count
  from public.price_history h
  where h.category_id = p.category_id and h.market_name = p.market_name
    and h.unit = p.unit and h.currency = p.currency) st on true;
grant select on public.price_board to anon, authenticated;

-- Row level security ---------------------------------------------------------------------------
create policy "profiles read own or admin" on public.user_profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());
create policy "profiles insert own" on public.user_profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles update own or admin" on public.user_profiles for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());

create policy "categories public read" on public.product_categories for select to anon, authenticated using (true);
create policy "categories admin insert" on public.product_categories for insert to authenticated with check (private.is_admin());
create policy "categories admin update" on public.product_categories for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "categories admin delete" on public.product_categories for delete to authenticated using (private.is_admin());

create policy "products read anon" on public.products for select to anon using (status in ('active','sold'));
create policy "products read signed in" on public.products for select to authenticated
  using (status in ('active','sold') or owner = (select auth.uid()) or private.is_admin());
create policy "products insert own" on public.products for insert to authenticated
  with check (owner = (select auth.uid()) and private.is_active());
create policy "products update own or admin" on public.products for update to authenticated
  using (owner = (select auth.uid()) or private.is_admin())
  with check ((owner = (select auth.uid()) and private.is_active()) or private.is_admin());
create policy "products delete own or admin" on public.products for delete to authenticated
  using (owner = (select auth.uid()) or private.is_admin());

create policy "requests read anon" on public.buyer_requests for select to anon using (status = 'open');
create policy "requests read signed in" on public.buyer_requests for select to authenticated
  using (status = 'open' or owner = (select auth.uid()) or private.is_admin());
create policy "requests insert own" on public.buyer_requests for insert to authenticated
  with check (owner = (select auth.uid()) and private.is_active());
create policy "requests update own or admin" on public.buyer_requests for update to authenticated
  using (owner = (select auth.uid()) or private.is_admin())
  with check ((owner = (select auth.uid()) and private.is_active()) or private.is_admin());
create policy "requests delete own or admin" on public.buyer_requests for delete to authenticated
  using (owner = (select auth.uid()) or private.is_admin());

create policy "saved read own" on public.saved_listings for select to authenticated using (user_id = (select auth.uid()));
create policy "saved insert own" on public.saved_listings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved delete own" on public.saved_listings for delete to authenticated using (user_id = (select auth.uid()));

create policy "enquiries read involved" on public.enquiries for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()) or private.is_admin());
create policy "enquiries insert own" on public.enquiries for insert to authenticated
  with check (sender = (select auth.uid()) and private.is_active());
create policy "enquiries update recipient" on public.enquiries for update to authenticated
  using (recipient = (select auth.uid())) with check (recipient = (select auth.uid()));
create policy "enquiries delete involved" on public.enquiries for delete to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()) or private.is_admin());

create policy "reports insert own" on public.listing_reports for insert to authenticated
  with check (reporter = (select auth.uid()) and private.is_active());
create policy "reports read own or admin" on public.listing_reports for select to authenticated
  using (reporter = (select auth.uid()) or private.is_admin());
create policy "reports admin update" on public.listing_reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy "reports admin delete" on public.listing_reports for delete to authenticated using (private.is_admin());

create policy "prices public read" on public.agricultural_prices for select to anon, authenticated using (true);
create policy "prices admin insert" on public.agricultural_prices for insert to authenticated with check (private.is_admin());
create policy "prices admin update" on public.agricultural_prices for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "prices admin delete" on public.agricultural_prices for delete to authenticated using (private.is_admin());

create policy "history public read" on public.price_history for select to anon, authenticated using (true);
create policy "history admin insert" on public.price_history for insert to authenticated with check (private.is_admin());
create policy "history admin update" on public.price_history for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "history admin delete" on public.price_history for delete to authenticated using (private.is_admin());

create policy "alerts read own" on public.price_alerts for select to authenticated using (user_id = (select auth.uid()));
create policy "alerts insert own" on public.price_alerts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "alerts update own" on public.price_alerts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "alerts delete own" on public.price_alerts for delete to authenticated using (user_id = (select auth.uid()));

-- Reference data: product categories (no prices are seeded) -------------------------------------
insert into public.product_categories (slug, name, kind, default_unit, price_unit, sort_order) values
  ('maize', 'Maize', 'crop', 'tonnes', 'tonne', 1),
  ('soya-beans', 'Soya beans', 'crop', 'tonnes', 'tonne', 2),
  ('tobacco', 'Tobacco', 'crop', 'kg', 'kg', 3),
  ('groundnuts', 'Groundnuts', 'crop', 'tonnes', 'tonne', 4),
  ('sunflower', 'Sunflower', 'crop', 'tonnes', 'tonne', 5),
  ('wheat', 'Wheat', 'crop', 'tonnes', 'tonne', 6),
  ('sorghum', 'Sorghum', 'crop', 'tonnes', 'tonne', 7),
  ('sugar-beans', 'Sugar beans', 'crop', 'tonnes', 'tonne', 8),
  ('vegetables', 'Vegetables', 'produce', 'crates', 'kg', 9),
  ('fruits', 'Fruits', 'produce', 'crates', 'kg', 10),
  ('cattle', 'Cattle', 'livestock', 'animals', 'head', 11),
  ('goats', 'Goats', 'livestock', 'animals', 'head', 12),
  ('sheep', 'Sheep', 'livestock', 'animals', 'head', 13),
  ('chickens', 'Chickens', 'livestock', 'animals', 'head', 14),
  ('other-livestock', 'Other livestock', 'livestock', 'animals', 'head', 15);

-- Move existing equipment profiles into user_profiles ------------------------------------------
insert into public.user_profiles (id, email, full_name, user_type, phone, town, avatar_path, created_at)
select u.id, u.email, nullif(p.name, ''), coalesce(nullif(p.role, ''), 'Farmer'),
       case when p.phone ~ '^[+0-9 ()-]{9,20}$' then p.phone end, nullif(p.town, ''), p.avatar_path, u.created_at
from auth.users u left join public.profiles p on p.id = u.id
on conflict (id) do nothing;

-- Chat names now come from user_profiles (falling back to the old profiles table).
create or replace function public.conv_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select owner, title, seller_name into l from public.listings where id = new.listing_id;
  if not found then raise exception 'Listing not found'; end if;
  new.seller := l.owner;
  new.listing_title := l.title;
  new.seller_name := coalesce(nullif(l.seller_name, ''), 'Seller');
  new.buyer := auth.uid();
  new.buyer_name := coalesce(
    (select nullif(u.full_name, '') from public.user_profiles u where u.id = auth.uid()),
    (select nullif(p.name, '') from public.profiles p where p.id = auth.uid()),
    'Buyer');
  new.last_body := null;
  new.last_sender := null;
  new.last_at := now();
  new.buyer_read_at := now();
  new.seller_read_at := now();
  return new;
end $$;
