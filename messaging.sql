-- FarmGear Zim: in-app messaging. Already applied to the FarmGear Zim project.
-- Run it only if you set up a different Supabase project.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings (id) on delete set null,
  listing_title text,
  buyer uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seller uuid not null references auth.users (id) on delete cascade,
  buyer_name text,
  seller_name text,
  last_body text,
  last_sender uuid,
  last_at timestamptz not null default now(),
  buyer_read_at timestamptz not null default now(),
  seller_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (buyer <> seller),
  unique (listing_id, buyer)
);
create index if not exists conversations_buyer_idx on public.conversations (buyer);
create index if not exists conversations_seller_idx on public.conversations (seller);
create index if not exists conversations_listing_idx on public.conversations (listing_id);
alter table public.conversations enable row level security;

create policy "conversations participants read" on public.conversations
  for select to authenticated
  using ((select auth.uid()) = buyer or (select auth.uid()) = seller);
create policy "conversations buyer start" on public.conversations
  for insert to authenticated
  with check ((select auth.uid()) = buyer);

-- The server fills in who the seller is and both names, so nobody can fake them.
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
  new.buyer_name := coalesce((select nullif(p.name, '') from public.profiles p where p.id = auth.uid()), 'Buyer');
  new.last_body := null;
  new.last_sender := null;
  new.last_at := now();
  new.buyer_read_at := now();
  new.seller_read_at := now();
  return new;
end $$;
create trigger conv_before_insert before insert on public.conversations
  for each row execute function public.conv_before_insert();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);
create index if not exists messages_sender_idx on public.messages (sender);
alter table public.messages enable row level security;

create policy "messages participants read" on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c
                 where c.id = conversation_id and (select auth.uid()) in (c.buyer, c.seller)));
create policy "messages participants send" on public.messages
  for insert to authenticated
  with check (sender = (select auth.uid())
              and exists (select 1 from public.conversations c
                          where c.id = conversation_id and (select auth.uid()) in (c.buyer, c.seller)));

create or replace function public.msg_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations c set
    last_body = left(new.body, 120),
    last_sender = new.sender,
    last_at = new.created_at,
    buyer_read_at = case when c.buyer = new.sender then new.created_at else c.buyer_read_at end,
    seller_read_at = case when c.seller = new.sender then new.created_at else c.seller_read_at end
  where c.id = new.conversation_id;
  return new;
end $$;
create trigger msg_after_insert after insert on public.messages
  for each row execute function public.msg_after_insert();

create or replace function public.mark_read(p_conv uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversations set
    buyer_read_at = case when buyer = (select auth.uid()) then now() else buyer_read_at end,
    seller_read_at = case when seller = (select auth.uid()) then now() else seller_read_at end
  where id = p_conv and (select auth.uid()) in (buyer, seller);
$$;

revoke all on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;
revoke all on function public.conv_before_insert() from public, anon, authenticated;
revoke all on function public.msg_after_insert() from public, anon, authenticated;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
