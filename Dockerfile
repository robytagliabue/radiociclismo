FROM node:20-alpine

WORKDIR /app

# 1. Copia i file di dipendenze
COPY package*.json ./

# 2. Installa le dipendenze
RUN npm install

# 3. Copia il codice sorgente
COPY . .

# 4. Verifica TypeScript (solo controllo, non emette file)
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
