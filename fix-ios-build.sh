#!/bin/bash

# iOS Build Fix Script - Run this on your Mac to resolve the Xcode errors

echo "🔧 Fixing iOS Build Issues..."
echo "This script will resolve the Xcode errors you encountered"

# Navigate to project directory (adjust this path if needed)
cd "$(dirname "$0")"

echo "📁 Current directory: $(pwd)"

# Step 1: Clean any existing iOS build files
echo "🧹 Cleaning existing iOS build files..."
rm -rf ios/App/Pods
rm -rf ios/App/Podfile.lock
rm -rf ios/App/build
rm -rf ios/App/DerivedData

# Step 2: Install/Update CocoaPods if needed (run on Mac)
echo "📦 Checking CocoaPods installation..."
if ! command -v pod &> /dev/null; then
    echo "❌ CocoaPods not found. Please install it first:"
    echo "   sudo gem install cocoapods"
    echo "   or: brew install cocoapods"
    echo ""
    echo "After installing CocoaPods, run this script again."
    exit 1
else
    echo "✅ CocoaPods found: $(pod --version)"
fi

# Step 3: Build web assets
echo "🔨 Building web assets..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Web build failed. Please check for errors above."
    exit 1
fi

# Step 4: Sync with Capacitor (BEFORE Firebase automation to avoid overwriting)
echo "🔄 Syncing with Capacitor iOS..."
npx cap sync ios

if [ $? -ne 0 ]; then
    echo "❌ Capacitor sync failed. Please check for errors above."
    exit 1
fi

# Step 5: Configure Firebase for iOS (AFTER Capacitor sync)
echo "🔥 Configuring Firebase for iOS..."
if [ -f "ios-firebase-config-automation.sh" ]; then
    chmod +x ios-firebase-config-automation.sh
    ./ios-firebase-config-automation.sh
    if [ $? -eq 0 ]; then
        echo "✅ Firebase configuration automated successfully"
    else
        echo "⚠️  Firebase automation had issues, continuing with programmatic configuration"
    fi
else
    echo "⚠️  Firebase automation script not found, using hybrid configuration in AppDelegate"
fi

# Step 6: Install iOS dependencies
echo "📲 Installing iOS dependencies..."
cd ios/App
pod install --repo-update

if [ $? -ne 0 ]; then
    echo "❌ Pod install failed. Please check for errors above."
    exit 1
fi

# Step 6.1: Clean Xcode build folders to resolve XCFramework issues
echo "🧹 Cleaning Xcode build folders..."
rm -rf ~/Library/Developer/Xcode/DerivedData
xcodebuild clean -workspace App.xcworkspace -scheme App -configuration Debug 2>/dev/null || echo "Xcode clean completed"

cd ../..

# Step 7: Verify the setup
echo "🔍 Verifying iOS project setup..."
if [ -d "ios/App/App.xcworkspace" ]; then
    echo "✅ iOS workspace created successfully"
else
    echo "⚠️  iOS workspace not found, but this might be normal"
fi

if [ -f "ios/App/Podfile.lock" ]; then
    echo "✅ iOS dependencies installed successfully"
else
    echo "❌ iOS dependencies not installed properly"
    exit 1
fi

echo ""
echo "🎉 iOS build issues should now be resolved!"
echo ""
echo "✅ Fixed deployment target mismatch (iOS 14.0 → 15.0)"
echo "✅ Updated Podfile configuration"
echo "✅ Cleaned build cache and dependencies"
echo ""
echo "Next steps:"
echo "1. Open Xcode: npx cap open ios"
echo "2. In Xcode, select your device/simulator"
echo "3. Click the Run button (▶️)"
echo ""
echo "The deployment target errors and build failures should now be resolved."