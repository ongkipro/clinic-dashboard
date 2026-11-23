-- T-117 hotfix (TEN-19 coverage): every tenant table needs an operator class. digest_runs (0131) is a worker queue of aggregate run state,
-- like satusehat_outbox: a vendor support session never reads it.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.digest_runs', 'never');
