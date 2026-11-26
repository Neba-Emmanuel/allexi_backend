-- Switch existing installations to Allexi after the Genesis content import.
-- Increment the snapshot revision so connected readers invalidate their caches.
do $$
begin
  if not exists(select 1 from public.scripture_publications where edition='allexi') then
    raise exception 'Apply the Allexi Genesis content migration before setting its default.';
  end if;
  with changed as (
    update public.scripture_settings
    set default_edition='allexi', revision=revision+1
    where id and default_edition <> 'allexi'
    returning revision
  )
  insert into public.scripture_history(edition,action,before_text,after_text,revision,actor_id)
  select 'allexi','set_default','kjv','allexi',revision,null from changed;
end;
$$;
