FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV DATABASE_URL=postgresql://tore:tore@localhost:5432/tore_legal_data?schema=public

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.base.json turbo.json ./
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/api/dist/index.js"]
