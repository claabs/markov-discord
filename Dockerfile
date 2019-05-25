FROM keymetrics/pm2:latest-stretch
# Create app directory
WORKDIR /usr/src/markbot

# Install app dependencies
COPY package*.json ./

# If you are building your code for production
ENV NPM_CONFIG_LOGLEVEL warn
RUN npm ci --only=production

# Bundle app source
COPY . .
RUN mkdir config

RUN ls -al

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]