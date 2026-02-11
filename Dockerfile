# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /usr/app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build the application
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /usr/app
ENV NODE_ENV=production
ENV PORT=9911

# Copy build artifacts and necessary files
COPY --from=builder /usr/app/.next ./.next
COPY --from=builder /usr/app/public ./public
COPY --from=builder /usr/app/package.json ./package.json
COPY --from=builder /usr/app/node_modules ./node_modules
COPY --from=builder /usr/app/next.config.ts ./next.config.ts

EXPOSE 9911
CMD ["npm", "run", "start"]
