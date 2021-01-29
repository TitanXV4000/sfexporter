FROM node:14
WORKDIR /usr/src/
RUN git clone https://github.com/johndwalker/sfexporter.git
WORKDIR /usr/src/sfexporter
RUN npm install
RUN mkdir /sfexports
# If you are building your code for production
# RUN npm ci --only=production
CMD [ "node", "index.js" ]
