-- Run in Supabase SQL Editor AFTER schema.sql and auto-weights.sql.
-- Public visitors can read. Only approved, signed-in editors can write.
-- Existing programs and subprograms are preserved. Safe to run again.
begin;

create table if not exists public.tcs_editors (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.tcs_editors enable row level security;
revoke all on public.tcs_editors from public, anon, authenticated;
grant select on public.tcs_editors to authenticated;
drop policy if exists tcs_editors_read_self on public.tcs_editors;
create policy tcs_editors_read_self on public.tcs_editors
    for select to authenticated using (user_id = (select auth.uid()));

-- The allowlist is managed only through SQL Editor, never by the browser.
create or replace function public.tcs_can_edit()
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.tcs_editors where user_id = (select auth.uid())
    );
$$;
revoke all on function public.tcs_can_edit() from public, anon, authenticated;
grant execute on function public.tcs_can_edit() to anon, authenticated;

alter table public.tcs_programs enable row level security;
alter table public.tcs_subprograms enable row level security;

-- Remove both table-level AND legacy column-level write grants.
revoke insert, update, delete, truncate, references, trigger
    on public.tcs_programs, public.tcs_subprograms from public, anon, authenticated;
revoke insert (id, name, subfunction_id, legacy_subfunction, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, target_date, notes, sort_order)
    on public.tcs_programs from public, anon, authenticated;
revoke insert (id, program_id, name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order)
    on public.tcs_subprograms from public, anon, authenticated;

grant select on public.tcs_subfunctions, public.tcs_programs, public.tcs_subprograms,
    public.tcs_program_summary, public.tcs_subfunction_summary to anon, authenticated;
grant insert (id, name, subfunction_id, legacy_subfunction, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, target_date, notes, sort_order), delete
    on public.tcs_programs to authenticated;
grant insert (id, program_id, name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order), delete
    on public.tcs_subprograms to authenticated;

-- Restrictive policies also keep writes locked if a legacy script is rerun
-- and adds a permissive policy/grant for anonymous visitors again.
do $$
declare table_name text;
begin
    foreach table_name in array array['tcs_programs', 'tcs_subprograms'] loop
        execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
        execute format('create policy %I on public.%I for insert to authenticated with check ((select public.tcs_can_edit()))', table_name || '_insert', table_name);
        execute format('create policy %I on public.%I for update to authenticated using ((select public.tcs_can_edit())) with check ((select public.tcs_can_edit()))', table_name || '_update', table_name);
        execute format('create policy %I on public.%I for delete to authenticated using ((select public.tcs_can_edit()))', table_name || '_delete', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_editor_insert', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_editor_update', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_editor_delete', table_name);
        execute format('create policy %I on public.%I as restrictive for insert to public with check ((select auth.uid()) is not null and (select public.tcs_can_edit()))', table_name || '_editor_insert', table_name);
        execute format('create policy %I on public.%I as restrictive for update to public using ((select auth.uid()) is not null and (select public.tcs_can_edit())) with check ((select auth.uid()) is not null and (select public.tcs_can_edit()))', table_name || '_editor_update', table_name);
        execute format('create policy %I on public.%I as restrictive for delete to public using ((select auth.uid()) is not null and (select public.tcs_can_edit()))', table_name || '_editor_delete', table_name);
    end loop;
end;
$$;

revoke execute on function public.tcs_add_subprogram_equal_weights(uuid, text) from public, anon;
grant execute on function public.tcs_add_subprogram_equal_weights(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- NEXT: create an email/password user in Authentication > Users > Add user.
-- Then run grant-editor.sql with that account's email address.
