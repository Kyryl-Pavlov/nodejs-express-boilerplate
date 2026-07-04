# Local development — runs poll() which long-polls SQS in a loop.
# docker-compose uses this file. Not for AWS Lambda deployment.
FROM node:22-slim

WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY services/app/package.json services/app/tsconfig.json ./services/app/
COPY services/app/prisma ./services/app/prisma
COPY lambda/package.json lambda/tsconfig.json ./lambda/

RUN npm ci
RUN npx prisma generate --schema services/app/prisma/schema.prisma

COPY lambda/src ./lambda/src

RUN addgroup --system app && adduser --system --ingroup app app
ENV HOME=/tmp
USER app

CMD ["npm", "run", "dev", "--workspace=lambda"]
