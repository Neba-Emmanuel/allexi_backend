-- Apply in the Supabase SQL editor, or with `supabase db push`.
create table public.library_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('bookmark','highlight','note','progress')),
  book integer not null check (book between 0 and 65),
  chapter integer not null check (chapter between 1 and 150),
  verse integer not null check (verse between 1 and 176),
  text text not null default '' check (length(text) <= 20000),
  color text check (color in ('gold','sage','mint','rose','slate')),
  deleted boolean not null default false,
  mutation_id uuid not null,
  revision bigint not null default 1,
  primary key (user_id,id),
  check (id = case when kind = 'progress' then 'progress' else book||'.'||chapter||'.'||verse||'.'||kind end)
);
create table public.applied_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  primary key (user_id,mutation_id)
);
alter table public.library_records enable row level security;
alter table public.applied_mutations enable row level security;
create policy "Read own library" on public.library_records for select to authenticated using ((select auth.uid()) = user_id);
-- Writes go through the bounded, idempotent RPC below; direct writes are revoked.
revoke all on public.library_records from anon, authenticated;
grant select on public.library_records to authenticated;
revoke all on public.applied_mutations from anon, authenticated;

create or replace function public.sync_library(changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  inserted integer;
  snapshot jsonb;
  acknowledged jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) > 100 then
    raise exception 'Expected at most 100 changes';
  end if;
  -- Serializes each user's snapshots and writes within this transaction.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  for item in select value from jsonb_array_elements(changes) loop
    if item->>'mutation_id' is null or item->>'id' is null then raise exception 'Invalid change'; end if;
    insert into public.applied_mutations(user_id,mutation_id) values (uid,(item->>'mutation_id')::uuid) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 1 then
      insert into public.library_records(user_id,id,kind,book,chapter,verse,text,color,deleted,mutation_id)
      values(uid,item->>'id',item->>'kind',(item->>'book')::integer,(item->>'chapter')::integer,(item->>'verse')::integer,item->>'text',item->>'color',(item->>'deleted')::boolean,(item->>'mutation_id')::uuid)
      on conflict(user_id,id) do update set kind=excluded.kind,book=excluded.book,chapter=excluded.chapter,verse=excluded.verse,text=excluded.text,color=excluded.color,deleted=excluded.deleted,mutation_id=excluded.mutation_id,revision=public.library_records.revision+1;
    end if;
    acknowledged := acknowledged || jsonb_build_array(item->>'mutation_id');
  end loop;
  select coalesce(jsonb_agg(to_jsonb(r)-'user_id'),'[]'::jsonb) into snapshot from public.library_records r where user_id=uid;
  return jsonb_build_object('records',snapshot,'acknowledged',acknowledged);
end;
$$;
revoke all on function public.sync_library(jsonb) from public, anon;
grant execute on function public.sync_library(jsonb) to authenticated;
