-- A patient merge moves voice clips with the rest of the record (src/server/admin/duplicates.ts MOVE), so the app role
-- needs UPDATE on patient_id, as 0026 gave document_read_cache. Without it every merge failed at voice_clips.
GRANT UPDATE ("patient_id") ON "voice_clips" TO oncosetu_app;
