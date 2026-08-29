#!/bin/bash

echo "Building mobile app for Capacitor..."

# Clean previous build
rm -rf dist/public

# Build with mobile-optimized config
vite build --config vite.mobile.config.ts

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    
    # Sync with Capacitor
    echo "Syncing with Capacitor iOS..."
    npx cap sync ios
    
    if [ $? -eq 0 ]; then
        echo "✅ Capacitor sync successful!"
        echo "🚀 Ready to open iOS project with: npx cap open ios"
    else
        echo "❌ Capacitor sync failed"
        exit 1
    fi
else
    echo "❌ Build failed"
    exit 1
fi