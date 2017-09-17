FROM node:onbuild

# Create app directory
RUN mkdir -p /blockbot
WORKDIR /blockbot

# Install app dependencies
COPY package.json /blockbot
RUN npm install

# Bundle app source
COPY . /blockbot

# CMD [ "npm", "start" ]
CMD npm start