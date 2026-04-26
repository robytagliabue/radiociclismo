FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN echo "=== CONTENUTO /app ===" && ls -la /app && echo "=== CONTENUTO /app/src ===" && ls -la /app/src || echo "❌ src/ NON ESISTE"

EXPOSE 8080
CMD ["npm", "run", "start"]