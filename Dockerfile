FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# DEBUG: mostra cosa c'è in /app dopo il COPY
RUN ls -la /app && ls -la /app/src || echo "src/ NON ESISTE!"

EXPOSE 8080
CMD ["npm", "run", "start"]