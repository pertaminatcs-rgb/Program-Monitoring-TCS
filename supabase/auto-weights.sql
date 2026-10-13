-- Run once in Supabase SQL Editor after schema.sql.
-- Adding a subprogram through this RPC divides ALL sibling weights equally.
-- Insert + weight changes are one transaction; existing notes/statuses stay intact.
begin;

-- Convert old fractional weights without disturbing existing whole-number weights.
-- For a valid total of 100, largest-remainder rounding preserves that exact total.
do $$
declare parent_id uuid;
begin
    for parent_id in
        select distinct program_id from public.tcs_subprograms
        where weight <> trunc(weight) order by program_id
    loop
        perform 1 from public.tcs_programs where id = parent_id for update;
        with original as (
            select id, weight, floor(weight) as base,
                sum(weight) over () as total,
                sum(floor(weight)) over () as base_total,
                row_number() over (order by weight - floor(weight) desc, sort_order desc, id desc) as priority
            from public.tcs_subprograms where program_id = parent_id
        ), rounded as (
            select id, case when total = 100
                then base + case when priority <= 100 - base_total then 1 else 0 end
                else round(weight) end as weight
            from original
        )
        update public.tcs_subprograms s set weight = rounded.weight
        from rounded where s.id = rounded.id;
    end loop;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.tcs_subprograms'::regclass and conname = 'tcs_subprograms_integer_weight'
    ) then
        alter table public.tcs_subprograms add constraint tcs_subprograms_integer_weight
            check (weight = trunc(weight));
    end if;
end;
$$;

create or replace function public.tcs_add_subprogram_equal_weights(
    p_program_id uuid,
    p_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    parent public.tcs_programs%rowtype;
    new_id uuid;
    result jsonb;
begin
    if p_name is null or length(btrim(p_name)) = 0 then
        raise exception 'Nama subprogram wajib diisi.' using errcode = '22023';
    end if;

    -- Serialize additions for the same parent, including concurrent users.
    select * into parent from public.tcs_programs
    where id = p_program_id for update;
    if not found then
        raise exception 'Program tidak ditemukan. Muat ulang data.' using errcode = 'P0002';
    end if;

    insert into public.tcs_subprograms (
        program_id, name, subfunction_id, legacy_subfunction, weight, status, sort_order
    ) values (
        parent.id, btrim(p_name), parent.subfunction_id, parent.legacy_subfunction, 0, 'initiate',
        coalesce((select max(s.sort_order) + 1 from public.tcs_subprograms s where s.program_id = parent.id), 0)
    ) returning id into new_id;

    -- Whole percentages only. Distribute the remainder to the last rows.
    -- 3 children => 33, 33, 34; sum is exactly 100.
    with ordered as (
        select id,
            row_number() over (order by sort_order, id) as position,
            count(*) over () as total
        from public.tcs_subprograms where program_id = parent.id
    ), shares as (
        select id, (100 / total + case when position > total - mod(100, total) then 1 else 0 end)::numeric as weight
        from ordered
    )
    update public.tcs_subprograms s
    set weight = shares.weight
    from shares where s.id = shares.id;

    select to_jsonb(s) into result from public.tcs_subprograms s where s.id = new_id;
    return result;
end;
$$;

revoke all on function public.tcs_add_subprogram_equal_weights(uuid, text) from public;
grant execute on function public.tcs_add_subprogram_equal_weights(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
