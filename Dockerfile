########
# BASE
########
FROM node:16-alpine3.14 as base

WORKDIR /usr/src/app

########
# BUILD
########
FROM base as build

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only
RUN apk add --no-cache make gcc g++ python3 \
    && npm ci --only=production

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

# Steal node_modules from base image
COPY --from=build /usr/src/app/node_modules node_modules

# Steal compiled code from build image
COPY --from=build /usr/src/app/dist dist

# Copy package.json for version number
COPY package*.json ormconfig.js ./

# RUN mkdir config

ARG COMMIT_SHA=""

ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA}

CMD [ "node", "/usr/src/app/dist/index.js" ]