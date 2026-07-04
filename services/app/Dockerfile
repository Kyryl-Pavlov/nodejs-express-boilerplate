FROM node:22-slim AS builder

WORKDIR /repo

# build-essential/python3 let bcrypt (native) compile from source if no prebuilt
# binding matches this exact glibc/Node ABI combination — builder-only, doesn't
# bloat the runtime image below.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY services/app/package.json services/app/tsconfig.json ./services/app/
COPY services/app/prisma ./services/app/prisma
COPY lambda/package.json lambda/tsconfig.json ./lambda/

RUN npm ci

COPY services/app/src ./services/app/src

RUN npx prisma generate --schema services/app/prisma/schema.prisma
RUN npm run build --workspace=services/app
RUN npm prune --omit=dev

FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/services/app/package.json ./services/app/package.json
COPY --from=builder /repo/services/app/dist ./services/app/dist
COPY --from=builder /repo/services/app/prisma ./services/app/prisma

RUN addgroup --system app && adduser --system --ingroup app app
ENV HOME=/tmp
USER app

EXPOSE 5000

CMD ["node", "services/app/dist/server.js"]
