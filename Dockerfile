FROM node:20-alpine AS production

# Set Node.js environment to production
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the application code
COPY . .

#  Create an unprivileged user and a group 'appuser'
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create directories for uploads and metadata and assign them to the appuser.
RUN mkdir -p /usr/src/app/uploads && \
    mkdir -p /usr/src/app/metadata && \
    chown -R appuser:appgroup /usr/src/app/uploads && \
    chown -R appuser:appgroup /usr/src/app/metadata && \
    chown -R appuser:appgroup /usr/src/app

# --- Set Permissions for Read-Only Access ---

# 1. Remove write permission (a-w) for ALL users on the main file.
RUN chmod a-w server.js
RUN chmod a-w package.json

# 2. Recursively remove write permission (a-w) from the folders.
# This prevents the creation, deletion, or modification of files inside them.
RUN chmod -R a-w public views

# ---

# Switch to the unprivileged user
USER appuser

# Expose the port on which the app is running
# The default is 3000, can be overwritten by PORT Env Var
EXPOSE 3000

# Standard command to start the application
CMD ["node", "server.js"]