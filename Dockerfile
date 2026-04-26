# ✅ Dockerfile corretto
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Questo step mancava!
RUN npm install

COPY . .

RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
