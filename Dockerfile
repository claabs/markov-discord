########
# BASE
########
FROM node:20-alpine3.20 as base

WORKDIR /usr/app

RUN apk add --no-cache tini

############
# PROD DEPS
############

FROM base as prodDeps

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only
RUN apk add --no-cache make gcc g++ python3 \
    && npm ci --omit=dev

########
# BUILD
########
FROM base as build

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only
RUN apk add --no-cache make gcc g++ python3 \
    && npm ci --omit=dev

# Copy all jsons
COPY package*.json tsconfig.json ./

# Add dev deps
RUN npm ci

# Copy source code
COPY src src

RUN npm run build

########
# DEPLOY
########
FROM base as deploy

USER node

# Steal node_modules from base image
COPY --from=prodDeps /usr/app/node_modules node_modules

# Steal compiled code from build image
COPY --from=build /usr/app/dist dist

# Copy package.json for version number
COPY package.json ./

# RUN mkdir config

ARG COMMIT_SHA=""

ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA}

ENTRYPOINT ["/sbin/tini", "--"]
CMD [ "node", "/usr/app/dist/index.js" ]