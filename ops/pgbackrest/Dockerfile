# PostgreSQL 16 with pgBackRest (H-07, DR-1): WAL archiving and base backups to a
# repository whose location and credentials are configuration (ARCH-9). Production uses
# the same image as the database server; Coolify's own database backups stay off (ARCH-6).
FROM postgres:16.15-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest=2.60.0-1.pgdg12+1 tini=0.19.0-1+b3 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
COPY --chmod=0755 entrypoint-pgbackrest.sh /usr/local/bin/entrypoint-pgbackrest.sh
# tini is PID 1 (HYG-005): pgBackRest's async archive-push/archive-get workers detach and are adopted
# by PID 1; if that were the postmaster, a worker exiting with an error code (e.g. object storage
# down) would make PostgreSQL restart the whole cluster. tini forwards the stop signal (SIGINT,
# inherited) to the entrypoint, which execs postgres.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint-pgbackrest.sh"]
CMD ["postgres"]
