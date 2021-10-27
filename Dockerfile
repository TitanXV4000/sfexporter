FROM buildkite/puppeteer:5.2.1
WORKDIR /usr/src/apps
RUN apt-get update
RUN apt-get -y install git
RUN mkdir /sfexports
RUN git clone https://github.com/TitanXV4000/sfexporter.git
WORKDIR /usr/src/apps/sfexporter
RUN npm install
# If you are building your code for production
# RUN npm ci --only=production
CMD [ "node", "index.js" ]
