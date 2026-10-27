-- Run AFTER require-login.sql and creating the account in Authentication > Users.
-- Replace the email below. Do not put a password in this SQL file.
do $$
declare
    editor_email text := 'pertaminatcs@gmail.com';
    editor_id uuid;
begin
    select id into editor_id from auth.users where lower(email) = lower(btrim(editor_email));
    if editor_id is null then
        raise exception 'Account not found. Create the account in Authentication > Users first, and check the email.';
    end if;
    insert into public.tcs_editors (user_id) values (editor_id) on conflict (user_id) do nothing;
end;
$$;
