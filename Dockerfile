FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Invalida cache
ARG CACHEBUST=2
COPY . .

RUN echo "=== src ===" && ls -la /app/src && echo "=== mastra ===" && ls -la /app/src/mastra

EXPOSE 8080

CMD ["npm", "run", "start"]
