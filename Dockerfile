########
# BASE
########
FROM keymetrics/pm2:12-alpine as base
WORKDIR /usr/src/markbot

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
FROM keymetrics/pm2:12-alpine as deploy
WORKDIR /usr/src/markbot

ENV NPM_CONFIG_LOGLEVEL warn

# Steal node_modules from base image
COPY --from=base /usr/src/markbot/node_modules ./node_modules/

# Steal compiled code from build image
COPY --from=build /usr/src/markbot/dist ./

# Copy package.json for version number
COPY package*.json ./

# Copy PM2 config
COPY ecosystem.config.js .

RUN mkdir config

# RUN ls -al

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]