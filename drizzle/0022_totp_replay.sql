-- ASVS 2.8.4: an authenticator code is accepted once. The login stores the time step of the last accepted code and
-- refuses a code from that step or an earlier one. Covered by the table-level grants of 0001; staff has no RLS.
ALTER TABLE "staff" ADD COLUMN "totp_last_step" bigint;
