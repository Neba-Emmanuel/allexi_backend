-- Run in the project's Supabase SQL Editor as postgres, after setup.sql.
-- The Auth account must already exist. This never changes its password.
begin;
do $allexi_grant_support_admin$
declare
  admin_user_id uuid;
begin
  if to_regclass('app_private.content_admins') is null then
    raise exception 'Install the Allexi schema with setup.sql first.';
  end if;
  select id into admin_user_id from auth.users
  where lower(email) = 'allexhairdrick@icloud.com';
  if admin_user_id is null then
    raise exception 'The support-email Auth account does not exist yet.';
  end if;
  insert into app_private.content_admins(user_id)
  values (admin_user_id) on conflict do nothing;
end;
$allexi_grant_support_admin$;
commit;

-- Expected: the support email with administrator = true.
select u.email, true as administrator
from auth.users u join app_private.content_admins a on a.user_id = u.id
where lower(u.email) = 'allexhairdrick@icloud.com';
