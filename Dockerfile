FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache \
    curl \
    nghttp2 \
    ca-certificates \
    libgcc \
    libstdc++ \
    nss

# Verifica che HTTP/2 sia disponibile
RUN curl --version | grep -i http2 || echo "⚠️ HTTP/2 non disponibile"

COPY package*.json ./
RUN npm install
ARG CACHEBUST=4
COPY . .
EXPOSE 8080
CMD ["npm", "run", "start"]