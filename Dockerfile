# Portfolio AI — production image.
# Plain Node app (no build step): install prod deps, copy source, run as non-root.
# The private bio and .env are NOT baked in — they're injected at runtime
# (K8s Secret volume + env). See .dockerignore.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source (public/, lib/, server.js). content/ and logs/ are excluded
# by .dockerignore; the bio is mounted at runtime.
COPY . .

# Drop to the unprivileged user shipped in the base image.
USER node

EXPOSE 8787
CMD ["node", "server.js"]
