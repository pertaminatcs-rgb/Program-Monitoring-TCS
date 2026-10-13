-- TCS Dashboard: run this file in Supabase > SQL Editor.
-- Temporary mode WITHOUT LOGIN: anyone with the public project connection
-- can read, insert, update, and delete program/subprogram records.
-- No existing program records are deleted or sample programs inserted.
begin;

create table if not exists public.tcs_subfunctions (
    id smallint primary key,
    name text not null unique
);

insert into public.tcs_subfunctions (id, name) values
    (1, 'Terminal Standardization'),
    (2, 'Channel Standardization'),
    (3, 'Terminal Code & Standardization'),
    (4, 'Procedure & Compliance')
on conflict (id) do update set name = excluded.name;

create table if not exists public.tcs_programs (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(btrim(name)) between 1 and 200),
    subfunction_id smallint references public.tcs_subfunctions(id),
    -- Preserve unmapped labels such as C&S during the browser-data migration.
    legacy_subfunction text not null default '' check (length(legacy_subfunction) <= 200),
    target_date date,
    notes text not null default '' check (length(notes) <= 5000),
    sort_order integer not null default 0 check (sort_order >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.tcs_subprograms (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null references public.tcs_programs(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 200),
    subfunction_id smallint references public.tcs_subfunctions(id),
    legacy_subfunction text not null default '' check (length(legacy_subfunction) <= 200),
    weight numeric(5,2) not null default 0 check (weight between 0 and 100),
    constraint tcs_subprograms_integer_weight check (weight = trunc(weight)),
    status text not null default 'initiate'
        check (status in ('initiate', 'ongoing', 'finish')),
    target_date date,
    notes text not null default '' check (length(notes) <= 5000),
    sort_order integer not null default 0 check (sort_order >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists tcs_programs_subfunction_idx on public.tcs_programs(subfunction_id);
create index if not exists tcs_subprograms_program_idx on public.tcs_subprograms(program_id, sort_order, id);
create index if not exists tcs_subprograms_subfunction_idx on public.tcs_subprograms(subfunction_id);

create or replace function public.tcs_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
revoke all on function public.tcs_set_updated_at() from public, anon, authenticated;

drop trigger if exists tcs_programs_updated_at on public.tcs_programs;
create trigger tcs_programs_updated_at before update on public.tcs_programs
    for each row execute function public.tcs_set_updated_at();
drop trigger if exists tcs_subprograms_updated_at on public.tcs_subprograms;
create trigger tcs_subprograms_updated_at before update on public.tcs_subprograms
    for each row execute function public.tcs_set_updated_at();

-- Weight totals may be incomplete while the user is editing.
-- The summary exposes a validation flag and a NULL progress for such drafts.
create or replace view public.tcs_program_summary
with (security_invoker = true) as
select
    p.id, p.name, p.subfunction_id, p.legacy_subfunction,
    p.target_date, p.notes, p.sort_order, p.created_at, p.updated_at,
    count(s.id)::integer as subprogram_count,
    coalesce(sum(s.weight), 0) as weight_total,
    (count(s.id) > 0 and coalesce(sum(s.weight), 0) = 100) as weight_valid,
    case
        when count(s.id) = 0 then 'initiate'
        when count(s.id) filter (where s.status = 'initiate') = count(s.id) then 'initiate'
        when count(s.id) filter (where s.status = 'finish') = count(s.id) then 'finish'
        else 'ongoing'
    end as status,
    case
        when count(s.id) = 0 then 0::numeric
        when sum(s.weight) <> 100 then null::numeric
        else coalesce(sum(s.weight) filter (where s.status = 'finish'), 0)
    end as progress
from public.tcs_programs p
left join public.tcs_subprograms s on s.program_id = p.id
group by p.id;

-- Diagram: left = total subprograms; right = status breakdown.
-- Count by each SUBPROGRAM's subfunction, regardless of its parent's subfunction.
create or replace view public.tcs_subfunction_summary
with (security_invoker = true) as
select
    f.id as subfunction_id, f.name as subfunction_name,
    count(s.id)::integer as total_subprograms,
    (count(s.id) filter (where s.status = 'initiate'))::integer as initiate_count,
    (count(s.id) filter (where s.status = 'ongoing'))::integer as ongoing_count,
    (count(s.id) filter (where s.status = 'finish'))::integer as finish_count
from public.tcs_subfunctions f
left join public.tcs_subprograms s on s.subfunction_id = f.id
group by f.id, f.name;

alter table public.tcs_subfunctions enable row level security;
alter table public.tcs_programs enable row level security;
alter table public.tcs_subprograms enable row level security;

revoke all on public.tcs_subfunctions, public.tcs_programs, public.tcs_subprograms,
    public.tcs_program_summary, public.tcs_subfunction_summary from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.tcs_subfunctions, public.tcs_programs, public.tcs_subprograms,
    public.tcs_program_summary, public.tcs_subfunction_summary to anon, authenticated;
grant insert (id, name, subfunction_id, legacy_subfunction, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, target_date, notes, sort_order), delete
    on public.tcs_programs to anon, authenticated;
grant insert (id, program_id, name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order),
    update (name, subfunction_id, legacy_subfunction, weight, status, target_date, notes, sort_order), delete
    on public.tcs_subprograms to anon, authenticated;

-- Reference subfunctions can be read, but not modified from the website.
drop policy if exists tcs_subfunctions_read on public.tcs_subfunctions;
create policy tcs_subfunctions_read on public.tcs_subfunctions
    for select to anon, authenticated using (true);

drop policy if exists tcs_programs_read on public.tcs_programs;
create policy tcs_programs_read on public.tcs_programs
    for select to anon, authenticated using (true);
drop policy if exists tcs_programs_insert on public.tcs_programs;
create policy tcs_programs_insert on public.tcs_programs
    for insert to anon, authenticated with check (true);
drop policy if exists tcs_programs_update on public.tcs_programs;
create policy tcs_programs_update on public.tcs_programs
    for update to anon, authenticated using (true) with check (true);
drop policy if exists tcs_programs_delete on public.tcs_programs;
create policy tcs_programs_delete on public.tcs_programs
    for delete to anon, authenticated using (true);

drop policy if exists tcs_subprograms_read on public.tcs_subprograms;
create policy tcs_subprograms_read on public.tcs_subprograms
    for select to anon, authenticated using (true);
drop policy if exists tcs_subprograms_insert on public.tcs_subprograms;
create policy tcs_subprograms_insert on public.tcs_subprograms
    for insert to anon, authenticated with check (true);
drop policy if exists tcs_subprograms_update on public.tcs_subprograms;
create policy tcs_subprograms_update on public.tcs_subprograms
    for update to anon, authenticated using (true) with check (true);
drop policy if exists tcs_subprograms_delete on public.tcs_subprograms;
create policy tcs_subprograms_delete on public.tcs_subprograms
    for delete to anon, authenticated using (true);

commit;
