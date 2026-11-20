-- PAT-05: a link can carry a short name for who it is for ("Dr. Mehta, Pune"), so a patient with several links can tell them apart.
-- Covered by the table-level grants of 0001. The name is plain text, never part of the encrypted record.
ALTER TABLE "share_links" ADD COLUMN "label" text;
