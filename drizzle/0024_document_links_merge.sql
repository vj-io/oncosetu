-- A patient merge moves scan-report pairs to the surviving record, like every other table that follows the person.
GRANT UPDATE ("patient_id") ON "document_links" TO oncosetu_app;
