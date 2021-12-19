########
# BASE
########
FROM node:16-alpine3.14 as base
WORKDIR /usr/src/app

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only, then remove build tools
RUN apk add --no-cache make gcc g++ python && \
    npm ci --only=production && \
    apk del make gcc g++ python

########
# BUILD
########
FROM base as build

# Copy all *.json, *.js, *.ts
COPY . .
# Prod deps already installed, add dev deps
RUN npm i

RUN npm run build

########
# DEPLOY
########
FROM node:16-alpine3.14 as deploy
WORKDIR /usr/src/app

ENV NPM_CONFIG_LOGLEVEL warn

# Steal node_modules from base image
COPY --from=base /usr/src/app/node_modules ./node_modules/

# Steal compiled code from build image
COPY --from=build /usr/src/app/dist ./

# Copy package.json for version number
COPY package*.json ./

RUN mkdir config

# RUN ls -al

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]