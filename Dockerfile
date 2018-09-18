FROM node:onbuild

# Create app directory
RUN mkdir -p /brobot
WORKDIR /brobot

# Install app dependencies
COPY package.json /brobot
RUN npm install

# Bundle app source
COPY . /brobot

# CMD [ "npm", "start" ]
CMD npm start