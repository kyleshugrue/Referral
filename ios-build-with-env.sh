#!/bin/bash

# iOS Build Script with Secure Environment Variable Handling
# This script helps you build the iOS app with proper environment variables
# without storing secrets in files that could be accidentally committed.

set -e

echo "=============================================="
echo "  iOS Build Script - Secure Environment Setup"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a variable is set
check_var() {
    local var_name=$1
    local var_value=$(eval echo \$$var_name)
    if [ -z "$var_value" ]; then
        return 1
    fi
    return 0
}

# Function to get value from Keychain
get_from_keychain() {
    local key_name=$1
    security find-generic-password -a "$USER" -s "$key_name" -w 2>/dev/null || echo ""
}

# Function to prompt for value securely
prompt_for_value() {
    local var_name=$1
    local description=$2
    local current_value=$(eval echo \$$var_name)
    
    if [ -n "$current_value" ]; then
        echo -e "${GREEN}✓${NC} $var_name is already set"
        return
    fi
    
    # Try to get from Keychain first
    local keychain_value=$(get_from_keychain "$var_name")
    if [ -n "$keychain_value" ]; then
        export $var_name="$keychain_value"
        echo -e "${GREEN}✓${NC} $var_name loaded from Keychain"
        return
    fi
    
    # Prompt user
    echo -e "${YELLOW}?${NC} Enter $var_name ($description):"
    read -s value
    if [ -n "$value" ]; then
        export $var_name="$value"
        echo -e "${GREEN}✓${NC} $var_name set"
        
        # Ask if user wants to save to Keychain
        echo -n "  Save to Keychain for future builds? (y/n): "
        read save_choice
        if [ "$save_choice" = "y" ] || [ "$save_choice" = "Y" ]; then
            security add-generic-password -a "$USER" -s "$var_name" -w "$value" 2>/dev/null || \
            security delete-generic-password -a "$USER" -s "$var_name" 2>/dev/null && \
            security add-generic-password -a "$USER" -s "$var_name" -w "$value"
            echo -e "  ${GREEN}Saved to Keychain${NC}"
        fi
    else
        echo -e "${RED}✗${NC} $var_name not set - this may cause issues"
    fi
}

echo -e "${BLUE}Step 1: Checking/Setting Environment Variables${NC}"
echo "------------------------------------------------"
echo ""

# Required Firebase variables
echo -e "${YELLOW}Firebase Authentication (REQUIRED):${NC}"
prompt_for_value "VITE_FIREBASE_API_KEY" "Firebase API Key"
prompt_for_value "VITE_FIREBASE_PROJECT_ID" "Firebase Project ID"
prompt_for_value "VITE_FIREBASE_APP_ID" "Firebase App ID"
prompt_for_value "VITE_FIREBASE_AUTH_DOMAIN" "e.g., your-project.firebaseapp.com"
prompt_for_value "VITE_FIREBASE_STORAGE_BUCKET" "e.g., your-project.firebasestorage.app"

echo ""
echo -e "${YELLOW}Firebase iOS-Specific (OPTIONAL - press Enter to skip):${NC}"
prompt_for_value "VITE_FIREBASE_NATIVE_API_KEY" "iOS-specific API key, if different"
prompt_for_value "VITE_FIREBASE_NATIVE_APP_ID" "iOS Firebase App ID"

echo ""
echo -e "${YELLOW}API Configuration (REQUIRED for iOS):${NC}"
# Set default for API base URL
if [ -z "$VITE_API_BASE_URL" ]; then
    export VITE_API_BASE_URL="https://referral-mobile-app-kylejshugrue.replit.app"
    echo -e "${GREEN}✓${NC} VITE_API_BASE_URL set to production default"
else
    echo -e "${GREEN}✓${NC} VITE_API_BASE_URL is already set"
fi

echo ""
echo -e "${YELLOW}Google Analytics (OPTIONAL - press Enter to skip):${NC}"
prompt_for_value "VITE_GA_MEASUREMENT_ID" "e.g., G-XXXXXXXXXX"

echo ""
echo "------------------------------------------------"
echo -e "${BLUE}Step 2: Verifying Required Variables${NC}"
echo "------------------------------------------------"
echo ""

# Verify critical variables are set
missing_vars=0

if ! check_var "VITE_FIREBASE_API_KEY"; then
    echo -e "${RED}✗ VITE_FIREBASE_API_KEY is missing - authentication will fail!${NC}"
    missing_vars=1
fi

if ! check_var "VITE_FIREBASE_PROJECT_ID"; then
    echo -e "${RED}✗ VITE_FIREBASE_PROJECT_ID is missing - authentication will fail!${NC}"
    missing_vars=1
fi

if ! check_var "VITE_FIREBASE_APP_ID"; then
    echo -e "${RED}✗ VITE_FIREBASE_APP_ID is missing - authentication will fail!${NC}"
    missing_vars=1
fi

if ! check_var "VITE_API_BASE_URL"; then
    echo -e "${RED}✗ VITE_API_BASE_URL is missing - API calls will fail!${NC}"
    missing_vars=1
fi

if [ $missing_vars -eq 1 ]; then
    echo ""
    echo -e "${RED}ERROR: Missing required environment variables.${NC}"
    echo "Please set the missing variables and run this script again."
    echo ""
    echo "To find these values:"
    echo "1. Go to Firebase Console: https://console.firebase.google.com"
    echo "2. Select your project → Project Settings → General"
    echo "3. Scroll to 'Your apps' → Select Web app"
    echo "4. Copy values from the Firebase SDK snippet"
    exit 1
fi

echo -e "${GREEN}✓ All required environment variables are set${NC}"
echo ""

echo "------------------------------------------------"
echo -e "${BLUE}Step 3: Building Production Bundle${NC}"
echo "------------------------------------------------"
echo ""

# Backup and swap to production config
echo "Setting up production configuration..."
if [ -f "capacitor.config.production.ts" ]; then
    cp capacitor.config.ts capacitor.config.development.ts 2>/dev/null || true
    cp capacitor.config.production.ts capacitor.config.ts
    echo -e "${GREEN}✓${NC} Production config applied"
else
    echo -e "${YELLOW}!${NC} No production config found, using current config"
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf dist/
rm -rf ios/App/App/public/
rm -rf node_modules/.cache/
rm -rf ios/App/App/capacitor.config.json

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build production bundle
echo "Building production bundle with environment variables..."
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Production build complete${NC}"
echo ""

echo "------------------------------------------------"
echo -e "${BLUE}Step 4: Installing iOS Pods${NC}"
echo "------------------------------------------------"
echo ""

# Install/update pods
echo "Installing iOS pods..."
cd ios/App && pod install --repo-update && cd ../..

if [ $? -ne 0 ]; then
    echo -e "${RED}Pod install failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Pods installed${NC}"
echo ""

echo "------------------------------------------------"
echo -e "${BLUE}Step 5: Syncing to iOS${NC}"
echo "------------------------------------------------"
echo ""

# Sync to iOS
npx cap sync ios

if [ $? -ne 0 ]; then
    echo -e "${RED}Capacitor sync failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ iOS sync complete${NC}"
echo ""

echo "------------------------------------------------"
echo -e "${BLUE}Step 6: Verifying Build${NC}"
echo "------------------------------------------------"
echo ""

# Verify environment variables were baked in
echo "Verifying Firebase config in build..."
if grep -rq "undefined.firebaseapp.com" dist/ 2>/dev/null; then
    echo -e "${RED}✗ ERROR: Firebase config shows 'undefined' - environment variables were NOT baked in!${NC}"
    echo "  Please verify your environment variables are set correctly and rebuild."
    exit 1
else
    echo -e "${GREEN}✓ Firebase config looks correct${NC}"
fi

echo "Verifying API base URL in build..."
if grep -rq "referral-mobile-app" dist/ 2>/dev/null; then
    echo -e "${GREEN}✓ API base URL is configured${NC}"
else
    echo -e "${YELLOW}! Could not verify API base URL - check manually if issues occur${NC}"
fi

echo ""

echo "=============================================="
echo -e "${GREEN}  BUILD COMPLETE!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Run: npx cap open ios"
echo "2. In Xcode, select your device/simulator"
echo "3. Click Run (▶️) to test the build"
echo "4. Verify login works with valid credentials"
echo "5. Once tested, archive for TestFlight"
echo ""

# Ask if user wants to open Xcode
echo -n "Open Xcode now? (y/n): "
read open_choice
if [ "$open_choice" = "y" ] || [ "$open_choice" = "Y" ]; then
    npx cap open ios
fi
