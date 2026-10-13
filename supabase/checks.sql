-- Run AFTER schema.sql in Supabase SQL Editor.
-- All test data is rolled back. A successful run ends with a PASS row.
begin;
set local role anon;

do $$
declare
    p uuid := gen_random_uuid();
    first_sub uuid := gen_random_uuid();
    second_sub uuid := gen_random_uuid();
    result record;
    before_total integer;
    before_channel integer;
begin
    select total_subprograms into before_total from public.tcs_subfunction_summary where subfunction_id = 1;
    select total_subprograms into before_channel from public.tcs_subfunction_summary where subfunction_id = 2;

    insert into public.tcs_programs (id, name, subfunction_id, notes)
    values (p, 'TEST ONLY: TCS database', 1, 'Rolled back after verification');
    select * into result from public.tcs_program_summary where id = p;
    if result.status <> 'initiate' or result.progress <> 0 or result.subprogram_count <> 0 then
        raise exception 'FAIL: empty program summary';
    end if;

    insert into public.tcs_subprograms (id, program_id, name, subfunction_id, weight, status) values
        (first_sub, p, 'TEST ONLY: first stage', 1, 50, 'initiate'),
        (second_sub, p, 'TEST ONLY: second stage', 1, 50, 'initiate');
    select * into result from public.tcs_program_summary where id = p;
    if result.status <> 'initiate' or result.progress <> 0 or result.weight_total <> 100 or not result.weight_valid then
        raise exception 'FAIL: initial 100 percent weight summary';
    end if;

    update public.tcs_subprograms set status = 'finish' where id = first_sub;
    select * into result from public.tcs_program_summary where id = p;
    if result.status <> 'ongoing' or result.progress <> 50 then
        raise exception 'FAIL: mixed Initiate and Finish must be On Going, progress 50';
    end if;

    update public.tcs_subprograms set status = 'finish' where id = second_sub;
    select * into result from public.tcs_program_summary where id = p;
    if result.status <> 'finish' or result.progress <> 100 then
        raise exception 'FAIL: all Finish must give progress 100';
    end if;

    update public.tcs_subprograms set weight = 40 where id = first_sub;
    select * into result from public.tcs_program_summary where id = p;
    if result.weight_total <> 90 or result.weight_valid or result.progress is not null then
        raise exception 'FAIL: total weight 90 must be an invalid draft';
    end if;
    update public.tcs_subprograms set weight = 70 where id = first_sub;
    select * into result from public.tcs_program_summary where id = p;
    if result.weight_total <> 120 or result.weight_valid or result.progress is not null then
        raise exception 'FAIL: total weight 120 must be an invalid draft';
    end if;

    begin
        update public.tcs_subprograms set weight = 101 where id = first_sub;
        raise exception 'FAIL: weight above 100 was accepted';
    exception when check_violation then null;
    end;
    begin
        update public.tcs_subprograms set status = 'unknown' where id = first_sub;
        raise exception 'FAIL: unknown status was accepted';
    exception when check_violation then null;
    end;
    begin
        insert into public.tcs_subprograms (program_id, name) values (gen_random_uuid(), 'Missing parent');
        raise exception 'FAIL: missing parent was accepted';
    exception when foreign_key_violation then null;
    end;
    begin
        update public.tcs_subfunctions set name = 'Not allowed' where id = 1;
        raise exception 'FAIL: anonymous client modified reference subfunctions';
    exception when insufficient_privilege then null;
    end;

    update public.tcs_programs set target_date = '2026-12-31', notes = 'Updated test note' where id = p;
    select * into result from public.tcs_programs where id = p;
    if result.target_date <> date '2026-12-31' or result.notes <> 'Updated test note' then
        raise exception 'FAIL: anonymous program update';
    end if;

    update public.tcs_subprograms set subfunction_id = 2 where id = second_sub;
    select * into result from public.tcs_subfunction_summary where subfunction_id = 1;
    if result.total_subprograms <> before_total + 1 then raise exception 'FAIL: first chart total'; end if;
    select * into result from public.tcs_subfunction_summary where subfunction_id = 2;
    if result.total_subprograms <> before_channel + 1 then raise exception 'FAIL: chart must use child subfunction'; end if;

    delete from public.tcs_subprograms where id = first_sub;
    if exists (select 1 from public.tcs_subprograms where id = first_sub) then raise exception 'FAIL: subprogram delete'; end if;
    delete from public.tcs_programs where id = p;
    if exists (select 1 from public.tcs_subprograms where program_id = p) then raise exception 'FAIL: cascade delete'; end if;
    select * into result from public.tcs_subfunction_summary where subfunction_id = 2;
    if result.total_subprograms <> before_channel then raise exception 'FAIL: deletion did not update chart'; end if;
end;
$$;

reset role;
set local role authenticated;
do $$
declare p uuid := gen_random_uuid();
begin
    insert into public.tcs_programs (id, name) values (p, 'TEST ONLY: authenticated access');
    update public.tcs_programs set notes = 'Updated' where id = p;
    if not exists (select 1 from public.tcs_programs where id = p and notes = 'Updated') then
        raise exception 'FAIL: authenticated CRUD';
    end if;
    delete from public.tcs_programs where id = p;
end;
$$;
reset role;
rollback;
select 'PASS: CRUD, constraints, status, weighted completion, chart, and cascade deletion' as result;
