import { readFile, readdir, writeFile } from "node:fs/promises";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const names = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
const parts = await Promise.all(names.map(async (name) =>
  `\n-- Source: ${name}\n${await readFile(new URL(name, migrations), "utf8")}`,
));
const header = `-- Allexi Bible: one-time Supabase setup for a new Allexi schema.
-- Generated with npm run prepare:supabase. Do not edit the generated SQL.
-- Run this whole file in the project's Supabase SQL Editor as postgres.
-- It installs tables, access policies, editorial functions, Genesis 1 and readiness.
-- Existing Allexi installations must apply only their missing migrations instead.
begin;
do $allexi_setup_guard$
begin
  if to_regclass('public.library_records') is not null
     or to_regclass('public.scripture_settings') is not null
     or to_regclass('app_private.content_admins') is not null then
    raise exception 'Allexi tables already exist. Apply only missing migrations; this one-time setup will not overwrite an existing installation.';
  end if;
end;
$allexi_setup_guard$;
`;
const footer = `
-- Refresh the REST API's function cache after the transaction commits.
notify pgrst, 'reload schema';
commit;

-- Expected: 202611130001, allexi, 31.
select public.app_readiness() as schema_version,
       public.reader_scripture_snapshot()->>'defaultEdition' as default_edition,
       jsonb_array_length(public.reader_scripture_snapshot()->'verses') as published_verses;

-- Create an administrator in Supabase Authentication > Users first.
-- Then run the following separately, replacing the email with that administrator's:
-- insert into app_private.content_admins(user_id)
-- select id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL')
-- on conflict do nothing;
`;
await writeFile(new URL("../supabase/setup.sql", import.meta.url), header + parts.join("\n") + footer);
console.log(`Prepared supabase/setup.sql from ${names.length} ordered migrations.`);
