FROM dopplerhq/cli:3-alpine AS doppler
FROM node:20-alpine

COPY --from=doppler /bin/doppler /usr/local/bin/doppler

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["doppler", "run", "--", "node", "dist/index.js"]
