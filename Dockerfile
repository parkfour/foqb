# FOQB as a container: `app` is the Next.js server, `migrate` applies
# supabase/migrations to a self-hosted Supabase database. docker/compose.yml
# runs both alongside Supabase's own Postgres, Auth and PostgREST images.
#
# No Supabase URL or key is baked in: the browser never talks to Supabase,
# and the server reads them from the environment at runtime, so one image
# serves any instance.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG CI_GIT_SHA=unknown
ENV CI_GIT_SHA=$CI_GIT_SHA NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM postgres:17-bookworm AS migrate
COPY supabase/migrations /migrations
COPY docker/migrate.sh /usr/local/bin/migrate.sh
ENTRYPOINT ["/usr/local/bin/migrate.sh"]
