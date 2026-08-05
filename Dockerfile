FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production)
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Ensure auth_info folder exists
RUN mkdir -p auth_info

# Run the bot
CMD ["node", "index.js"]
