# syntax=docker/dockerfile:1
# pg_dump client matching the shared Postgres 18 server.
FROM postgres:18.6-alpine
RUN apk add --no-cache rclone \
 && install -d -o postgres -g postgres -m 700 /backups
COPY --chmod=755 deploy/backup.sh /usr/local/bin/backup.sh
USER postgres
ENV BACKUP_DIR=/backups
HEALTHCHECK --interval=10m --timeout=10s --start-period=10m --retries=1 \
  CMD find /backups/daily -name 'daily-*.dump' -mmin -1560 | grep -q . \
   && { [ -z "$BACKUP_OFFSITE_REMOTE" ] || find /backups/offsite.ok -mmin -1560 | grep -q .; }
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["schedule"]
