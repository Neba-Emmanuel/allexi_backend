-- Preserve editorial work when its author deletes their account.
alter table public.scripture_drafts drop constraint scripture_drafts_updated_by_fkey;
alter table public.scripture_drafts add constraint scripture_drafts_updated_by_fkey
  foreign key(updated_by) references auth.users(id) on delete set null;
alter table public.scripture_history drop constraint scripture_history_actor_id_fkey;
alter table public.scripture_history add constraint scripture_history_actor_id_fkey
  foreign key(actor_id) references auth.users(id) on delete set null;

-- Validate at the database boundary too: clients can call Supabase RPC directly.
alter function public.sync_library(jsonb) set schema app_private;
revoke all on function app_private.sync_library(jsonb) from public, anon, authenticated;
create function public.sync_library(changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; total integer;
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>100 then
    raise exception 'Expected at most 100 changes' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Invalid change' using errcode='22023';
    end if;
    if (select count(*) from jsonb_object_keys(item)) <> 9
      or not item ?& array['id','kind','book','chapter','verse','text','color','deleted','mutation_id'] then
      raise exception 'Unexpected change fields' using errcode='22023';
    end if;
    if jsonb_typeof(item->'book') is distinct from 'number' or jsonb_typeof(item->'chapter') is distinct from 'number'
      or jsonb_typeof(item->'verse') is distinct from 'number'
      or (item->>'book') !~ '^[0-9]{1,2}$' or (item->>'chapter') !~ '^[0-9]{1,3}$' or (item->>'verse') !~ '^[0-9]{1,3}$'
      or jsonb_typeof(item->'text') is distinct from 'string' or jsonb_typeof(item->'deleted') is distinct from 'boolean'
      or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'kind') is distinct from 'string'
      or jsonb_typeof(item->'mutation_id') is distinct from 'string'
      or item->>'kind' not in ('bookmark','highlight','note','progress')
      or length(item->>'text')>20000 or length(item->>'id')>100
      or item->>'mutation_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->'color' <> 'null'::jsonb and (jsonb_typeof(item->'color') is distinct from 'string' or item->>'color' not in ('gold','sage','mint','rose','slate')))
      or item->>'id' <> (case when item->>'kind'='progress' then 'progress'
        else (item->>'book')||'.'||(item->>'chapter')||'.'||(item->>'verse')||'.'||(item->>'kind') end)
    then raise exception 'Invalid change' using errcode='22023'; end if;
    select verse_count into total from public.scripture_chapters where book=(item->>'book')::integer and chapter=(item->>'chapter')::integer;
    if total is null or (item->>'verse')::integer not between 1 and total then
      raise exception 'Unknown scripture verse' using errcode='22023';
    end if;
  end loop;
  return app_private.sync_library(changes);
end;
$$;
revoke all on function public.sync_library(jsonb) from public, anon;
grant execute on function public.sync_library(jsonb) to authenticated;

-- Versioned readiness probe is read-only and contains no private information.
create function public.app_readiness() returns text language sql stable set search_path='' as $$
  select '202611130001'::text;
$$;
revoke all on function public.app_readiness() from public;
grant execute on function public.app_readiness() to anon, authenticated;
