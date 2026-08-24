-- Take back what Supabase hands out by default.
--
-- New tables in `public` are granted to `anon` unless something says otherwise,
-- and the migration that created delivery_acceptances did not. Row level
-- security was still refusing every row, so nothing was reachable -- but a grant
-- that only fails because a second thing is working is not a thing to leave
-- lying about. The project's own advisor check found it, which is what it is
-- for.

revoke all on public.delivery_acceptances from anon;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Put back the three the delivery surface genuinely needs: a picture desk has
-- no account, and the token is the credential each of them checks.
grant execute on function public.open_delivery(text, text, text) to anon;
grant execute on function public.delivery_assets(text) to anon;
grant execute on function public.record_delivery_download(text, uuid, text, text) to anon;
grant execute on function public.delivery_preview(text, uuid) to anon;
grant execute on function public.accept_delivery(text, text, text, text) to anon;
