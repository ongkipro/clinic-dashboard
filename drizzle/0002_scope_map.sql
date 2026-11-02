CREATE TABLE "scope_map" (
	"table_name" text PRIMARY KEY NOT NULL,
	"policy_kind" text NOT NULL,
	"owning_module" text NOT NULL,
	"reader_roles" text[] NOT NULL,
	"writer_service" text NOT NULL,
	"branch_semantics" text NOT NULL,
	CONSTRAINT "scope_map_policy_kind_check" CHECK ("scope_map"."policy_kind" in ('tenant-shared','clinical','branch-scoped','tenant-ledger','platform'))
);
