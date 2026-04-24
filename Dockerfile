FROM node:22-slim

WORKDIR /app

# Installiamo le dipendenze
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copiamo tutto il resto
COPY . .

# Build di Mastra
RUN npm run build

# Esponiamo la porta 3000
EXPOSE 3000

# Avviamo il server di Mastra
CMD ["npm", "start"]
