########
# BASE
########
FROM node:24-alpine3.23 AS base

WORKDIR /usr/app

COPY package*.json ./

########
# BUILD
########
FROM base AS build

# Copy all tsconfig
COPY tsconfig.json ./

# Add dev deps
RUN npm ci

# Copy source code
COPY src src

RUN npm run build

########
# DEPLOY
########
FROM base AS deploy


RUN npm ci --omit=dev

# Steal compiled code from build image
COPY --from=build /usr/app/dist dist

USER node

ARG COMMIT_SHA=""

ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA}

CMD [ "node", "/usr/app/dist/index.js" ]