
# Stage 1: Build TypeScript code
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Stage 2: Production image
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./

RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# COPY credentials.json ./ 

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
