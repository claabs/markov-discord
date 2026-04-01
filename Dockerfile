########
# BASE
########
FROM node:24-alpine3.23 AS base

WORKDIR /usr/app

COPY package*.json ./

#############
# BUILD BASE
#############

FROM base AS buildbase

# Install build tools for bufferutils
RUN apk add --no-cache make gcc g++ python3

############
# PROD DEPS
############

FROM buildbase AS proddeps

# Install prod deps only
RUN npm ci --omit=dev

########
# BUILD
########
FROM buildbase AS build

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

USER node

# Steal node_modules from proddeps
COPY --from=proddeps /usr/app/node_modules node_modules

# Steal compiled code from build image
COPY --from=build /usr/app/dist dist

ARG COMMIT_SHA=""

ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA}

CMD [ "node", "/usr/app/dist/index.js" ]