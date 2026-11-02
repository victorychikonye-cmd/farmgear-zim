-- FarmGear Zim: Farmer Community (tips, questions, comments). Already applied to the FarmGear Zim project.
-- Run it only on a different Supabase project, after marketplace.sql.

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  topic text not null check (topic in ('crops','livestock','pests_diseases','soil_water','equipment','markets','weather','question','other')),
  title text not null check (char_length(btrim(title)) between 3 and 100),
  body text not null check (char_length(btrim(body)) between 3 and 1500),
  photo_path text,
  province public.zw_province,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_posts_feed_idx on public.community_posts (created_at desc);
create index community_posts_topic_idx on public.community_posts (topic, created_at desc);
create index community_posts_author_idx on public.community_posts (author);
create index community_posts_title_trgm_idx on public.community_posts using gin (title extensions.gin_trgm_ops);
alter table public.community_posts enable row level security;

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  author uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  body text not null check (char_length(btrim(body)) between 1 and 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_comments_post_idx on public.community_comments (post_id, created_at);
create index community_comments_author_idx on public.community_comments (author);
alter table public.community_comments enable row level security;

create table public.community_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);
create index community_likes_user_idx on public.community_likes (user_id);
alter table public.community_likes enable row level security;

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null check (reason in ('wrong_advice','dangerous','spam','abuse','other')),
  details text check (char_length(details) <= 300),
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, reporter)
);
create index community_reports_status_idx on public.community_reports (status, created_at desc);
create index community_reports_reporter_idx on public.community_reports (reporter);
alter table public.community_reports enable row level security;

create or replace function private.community_posts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.community_posts x where x.author = new.author and x.created_at > now() - interval '1 day') >= 20 then
      raise exception 'Daily posting limit reached. Try again tomorrow.';
    end if;
    new.author_name := coalesce((select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.author), 'Farmer');
  else
    new.author := old.author; new.author_name := old.author_name; new.photo_path := old.photo_path; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger community_posts_guard before insert or update on public.community_posts
  for each row execute function private.community_posts_guard();

create or replace function private.community_comments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.community_comments x where x.author = new.author and x.created_at > now() - interval '1 day') >= 60 then
      raise exception 'Daily comment limit reached. Try again tomorrow.';
    end if;
    new.author_name := coalesce((select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = new.author), 'Farmer');
  else
    new.post_id := old.post_id; new.author := old.author; new.author_name := old.author_name; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger community_comments_guard before insert or update on public.community_comments
  for each row execute function private.community_comments_guard();

create trigger community_likes_touch before update on public.community_likes
  for each row execute function private.touch_updated_at();
create trigger community_reports_touch before update on public.community_reports
  for each row execute function private.touch_updated_at();

-- Feed with counts and "did I mark it helpful"
create view public.community_feed with (security_invoker = true) as
select p.*,
  (select count(*) from public.community_likes l where l.post_id = p.id) as helpful_count,
  (select count(*) from public.community_comments c where c.post_id = p.id) as comment_count,
  exists (select 1 from public.community_likes l where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me
from public.community_posts p;
grant select on public.community_feed to anon, authenticated;

-- Row level security
create policy "posts public read" on public.community_posts for select to anon, authenticated using (true);
create policy "posts insert own" on public.community_posts for insert to authenticated
  with check (author = (select auth.uid()) and private.is_active());
create policy "posts update own" on public.community_posts for update to authenticated
  using (author = (select auth.uid())) with check (author = (select auth.uid()) and private.is_active());
create policy "posts delete own or admin" on public.community_posts for delete to authenticated
  using (author = (select auth.uid()) or private.is_admin());

create policy "comments public read" on public.community_comments for select to anon, authenticated using (true);
create policy "comments insert own" on public.community_comments for insert to authenticated
  with check (author = (select auth.uid()) and private.is_active());
create policy "comments delete own or admin" on public.community_comments for delete to authenticated
  using (author = (select auth.uid()) or private.is_admin());

create policy "likes public read" on public.community_likes for select to anon, authenticated using (true);
create policy "likes insert own" on public.community_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active());
create policy "likes delete own" on public.community_likes for delete to authenticated using (user_id = (select auth.uid()));

create policy "creports insert own" on public.community_reports for insert to authenticated
  with check (reporter = (select auth.uid()) and private.is_active());
create policy "creports read own or admin" on public.community_reports for select to authenticated
  using (reporter = (select auth.uid()) or private.is_admin());
create policy "creports admin update" on public.community_reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy "creports admin delete" on public.community_reports for delete to authenticated using (private.is_admin());
