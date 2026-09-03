-- Gates the new first-login welcome overlay. Defaults false so any newly-created org starts
-- out unseen -- but every org that already exists today has obviously already been through
-- first login, so this migration immediately backfills all of them to true. This is the
-- opposite backfill direction from 0022 (deal_room_limit), and deliberately so: that column
-- needed existing rows left untouched, this one needs existing rows explicitly marked done,
-- or every current user would suddenly see a "welcome to your very first login" popup.
alter table organizations add column onboarding_seen boolean not null default false;
update organizations set onboarding_seen = true;
