FROM node:20-alpine

WORKDIR /app

# Installa curl e le librerie per il supporto HTTP/2 (nghttp2)
# Su Alpine è necessario aggiungere esplicitamente queste dipendenze
RUN apk add --no-cache \
    curl \
    libgcc \
    libstdc++ \
    nss \
    libcurl \
    nghttp2-libs

COPY package*.json ./
RUN npm install

ARG CACHEBUST=3
COPY . .

EXPOSE 8080

CMD ["npm", "run", "start"]
