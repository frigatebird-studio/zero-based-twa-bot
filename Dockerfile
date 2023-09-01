FROM node:18.16.1
WORKDIR /usr/src/app

COPY . .

RUN npm i && npm run build

CMD ["npm", "run","start"]
