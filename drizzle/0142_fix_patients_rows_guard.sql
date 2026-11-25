-- Hotfix for CI 45719923702 (T-128 follow-up): nest TG_TABLE_NAME = 'patients' check inside
-- patients_rows_guard() so PL/pgSQL does not parse OLD.opening_batch_id when the shared trigger
-- fires on contact_points or guardians.
CREATE OR REPLACE FUNCTION public.patients_rows_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'patients' AND TG_OP = 'UPDATE' THEN
    IF OLD.opening_batch_id IS NOT NULL
       AND NOT OLD.opening_reversed
       AND NEW.opening_reversed
       AND (NEW.id, NEW.tenant_id, NEW.mrn, NEW.full_name, NEW.birth_date, NEW.sex, NEW.identity_type, NEW.identity_enc,
            NEW.identity_bidx, NEW.no_identity_reason, NEW.religion, NEW.occupation, NEW.education, NEW.marital_status,
            NEW.address, NEW.ihs_patient_id, NEW.registered_branch_id, NEW.opening_batch_id, NEW.created_by, NEW.created_as, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.tenant_id, OLD.mrn, OLD.full_name, OLD.birth_date, OLD.sex, OLD.identity_type, OLD.identity_enc,
            OLD.identity_bidx, OLD.no_identity_reason, OLD.religion, OLD.occupation, OLD.education, OLD.marital_status,
            OLD.address, OLD.ihs_patient_id, OLD.registered_branch_id, OLD.opening_batch_id, OLD.created_by, OLD.created_as, OLD.created_at) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'patient records are never deleted or rewritten here' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patients_rows_guard() FROM PUBLIC;
