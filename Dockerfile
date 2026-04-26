FROM node:20-alpine

WORKDIR /app

# Installa curl
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install

ARG CACHEBUST=3
COPY . .

EXPOSE 8080

CMD ["npm", "run", "start"]
