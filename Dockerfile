FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production --package-lock=false

COPY . .

RUN mkdir -p avatars

EXPOSE 3000

CMD ["node", "server.js"]
