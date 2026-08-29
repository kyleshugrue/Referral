#!/bin/bash

# iOS Build Verification Script
# Verifies that Firebase configuration and push notifications are properly set up

echo "🔍 iOS Build Verification"
echo "=========================="

# Configuration
APPDELEGATE_FILE="ios/App/App/AppDelegate.swift"
PLIST_FILE="ios/App/App/GoogleService-Info.plist"
XCODE_PROJECT="ios/App/App.xcodeproj/project.pbxproj"
PODFILE="ios/App/Podfile"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status with colors
print_status() {
    local status=$1
    local message=$2
    case $status in
        "pass")
            echo -e "${GREEN}✅${NC} $message"
            ;;
        "fail")
            echo -e "${RED}❌${NC} $message"
            ;;
        "warn")
            echo -e "${YELLOW}⚠️${NC}  $message"
            ;;
        "info")
            echo -e "ℹ️  $message"
            ;;
    esac
}

# Function to check file exists
check_file_exists() {
    local file=$1
    local name=$2
    if [ -f "$file" ]; then
        print_status "pass" "$name exists"
        return 0
    else
        print_status "fail" "$name not found at: $file"
        return 1
    fi
}

# Function to verify AppDelegate.swift configuration
verify_appdelegate() {
    echo "📱 Verifying AppDelegate.swift configuration..."
    
    local score=0
    local total=0
    
    # Check Firebase imports
    total=$((total + 1))
    if grep -q "import FirebaseCore" "$APPDELEGATE_FILE" && grep -q "import FirebaseMessaging" "$APPDELEGATE_FILE"; then
        print_status "pass" "Firebase imports present"
        score=$((score + 1))
    else
        print_status "fail" "Missing Firebase imports"
    fi
    
    # Check hybrid Firebase configuration
    total=$((total + 1))
    if grep -q "Hybrid Firebase initialization" "$APPDELEGATE_FILE"; then
        print_status "pass" "Hybrid Firebase initialization implemented"
        score=$((score + 1))
    else
        print_status "warn" "Hybrid Firebase initialization not found, checking for programmatic config..."
        if grep -q "FirebaseApp.configure" "$APPDELEGATE_FILE"; then
            print_status "pass" "Firebase configuration present"
            score=$((score + 1))
        else
            print_status "fail" "No Firebase configuration found"
        fi
    fi
    
    # Check Firebase Messaging delegate
    total=$((total + 1))
    if grep -q "Messaging.messaging().delegate = self" "$APPDELEGATE_FILE"; then
        print_status "pass" "Firebase Messaging delegate configured"
        score=$((score + 1))
    else
        print_status "fail" "Firebase Messaging delegate not configured"
    fi
    
    # Check UNUserNotificationCenter delegate
    total=$((total + 1))
    if grep -q "UNUserNotificationCenter.current().delegate = self" "$APPDELEGATE_FILE"; then
        print_status "pass" "UNUserNotificationCenter delegate configured"
        score=$((score + 1))
    else
        print_status "fail" "UNUserNotificationCenter delegate not configured"
    fi
    
    # Check APNs token handling
    total=$((total + 1))
    if grep -q "Messaging.messaging().apnsToken = deviceToken" "$APPDELEGATE_FILE"; then
        print_status "pass" "APNs token forwarding to Firebase Messaging"
        score=$((score + 1))
    else
        print_status "fail" "APNs token not forwarded to Firebase Messaging"
    fi
    
    # Check background notification handling
    total=$((total + 1))
    if grep -q "didReceiveRemoteNotification.*fetchCompletionHandler" "$APPDELEGATE_FILE"; then
        print_status "pass" "Background notification handling implemented"
        score=$((score + 1))
    else
        print_status "fail" "Background notification handling missing"
    fi
    
    # Check MessagingDelegate implementation
    total=$((total + 1))
    if grep -q "MessagingDelegate" "$APPDELEGATE_FILE"; then
        print_status "pass" "MessagingDelegate protocol implemented"
        score=$((score + 1))
    else
        print_status "fail" "MessagingDelegate protocol not implemented"
    fi
    
    echo "📊 AppDelegate.swift Score: $score/$total"
    return $((total - score))
}

# Function to verify GoogleService-Info.plist
verify_firebase_plist() {
    echo "🔥 Verifying GoogleService-Info.plist..."
    
    if ! check_file_exists "$PLIST_FILE" "GoogleService-Info.plist"; then
        print_status "warn" "GoogleService-Info.plist not found - will use programmatic configuration"
        return 1
    fi
    
    # Check if registered in Xcode project
    if grep -q "GoogleService-Info.plist" "$XCODE_PROJECT"; then
        print_status "pass" "GoogleService-Info.plist registered in Xcode project"
    else
        print_status "warn" "GoogleService-Info.plist not registered in Xcode project"
    fi
    
    # Validate plist content if plutil is available
    if command -v plutil &> /dev/null; then
        local bundle_id
        local project_id
        local api_key
        
        bundle_id=$(plutil -extract BUNDLE_ID raw "$PLIST_FILE" 2>/dev/null || echo "")
        project_id=$(plutil -extract PROJECT_ID raw "$PLIST_FILE" 2>/dev/null || echo "")
        api_key=$(plutil -extract API_KEY raw "$PLIST_FILE" 2>/dev/null || echo "")
        
        if [ -n "$bundle_id" ] && [ -n "$project_id" ] && [ -n "$api_key" ]; then
            print_status "pass" "GoogleService-Info.plist contains required keys"
            print_status "info" "Bundle ID: $bundle_id"
            print_status "info" "Project ID: $project_id"
        else
            print_status "fail" "GoogleService-Info.plist missing required keys"
            return 1
        fi
    else
        print_status "warn" "Cannot validate plist content - plutil not available"
    fi
    
    return 0
}

# Function to verify Capacitor configuration
verify_capacitor_config() {
    echo "⚡ Verifying Capacitor configuration..."
    
    if ! check_file_exists "capacitor.config.ts" "Capacitor configuration"; then
        return 1
    fi
    
    # Check push notification configuration
    if grep -q "PushNotifications" "capacitor.config.ts" && grep -q "FirebaseMessaging" "capacitor.config.ts"; then
        print_status "pass" "Push notification plugins configured"
    else
        print_status "warn" "Push notification plugins not found in configuration"
    fi
    
    return 0
}

# Function to verify Podfile dependencies
verify_podfile() {
    echo "📦 Verifying Podfile dependencies..."
    
    if ! check_file_exists "$PODFILE" "Podfile"; then
        return 1
    fi
    
    local score=0
    local total=0
    
    # Check Firebase messaging dependency
    total=$((total + 1))
    if grep -q "CapacitorFirebaseMessaging" "$PODFILE"; then
        print_status "pass" "Firebase Messaging Capacitor plugin in Podfile"
        score=$((score + 1))
    else
        print_status "fail" "Firebase Messaging Capacitor plugin missing from Podfile"
    fi
    
    # Check push notifications dependency
    total=$((total + 1))
    if grep -q "CapacitorPushNotifications" "$PODFILE"; then
        print_status "pass" "Push Notifications Capacitor plugin in Podfile"
        score=$((score + 1))
    else
        print_status "fail" "Push Notifications Capacitor plugin missing from Podfile"
    fi
    
    echo "📊 Podfile Score: $score/$total"
    return $((total - score))
}

# Function to verify iOS project structure
verify_ios_project() {
    echo "📂 Verifying iOS project structure..."
    
    local score=0
    local total=0
    
    # Check essential directories
    total=$((total + 1))
    if [ -d "ios/App" ]; then
        print_status "pass" "iOS App directory exists"
        score=$((score + 1))
    else
        print_status "fail" "iOS App directory missing"
    fi
    
    # Check Xcode project file
    total=$((total + 1))
    if check_file_exists "$XCODE_PROJECT" "Xcode project file"; then
        score=$((score + 1))
    fi
    
    # Check if workspace exists (after pod install)
    total=$((total + 1))
    if [ -d "ios/App/App.xcworkspace" ]; then
        print_status "pass" "Xcode workspace exists (CocoaPods configured)"
        score=$((score + 1))
    else
        print_status "warn" "Xcode workspace not found - run 'pod install' in ios/App"
    fi
    
    echo "📊 iOS Project Score: $score/$total"
    return $((total - score))
}

# Function to run comprehensive verification
run_verification() {
    echo "🚀 Starting comprehensive iOS build verification..."
    echo ""
    
    local total_errors=0
    
    # Run all verification checks
    verify_appdelegate
    total_errors=$((total_errors + $?))
    echo ""
    
    verify_firebase_plist
    echo ""
    
    verify_capacitor_config
    echo ""
    
    verify_podfile
    total_errors=$((total_errors + $?))
    echo ""
    
    verify_ios_project
    echo ""
    
    # Summary
    echo "📋 Verification Summary"
    echo "======================"
    
    if [ $total_errors -eq 0 ]; then
        print_status "pass" "All critical verifications passed!"
        echo ""
        echo "🎉 iOS project is ready for push notifications!"
        echo ""
        echo "Next steps:"
        echo "1. Run: npx cap sync ios"
        echo "2. Open Xcode: npx cap open ios"
        echo "3. Enable Push Notifications capability in Xcode"
        echo "4. Enable Background Modes → Remote notifications in Xcode"
        echo "5. Build and test on physical device"
    else
        print_status "warn" "Found $total_errors issue(s) that need attention"
        echo ""
        echo "🔧 Please address the issues above before building"
        echo ""
        echo "To fix automatically, run:"
        echo "1. ./fix-ios-build.sh"
        echo "2. ./ios-firebase-config-automation.sh"
    fi
}

# Main execution
case "${1:-}" in
    "appdelegate")
        verify_appdelegate
        ;;
    "firebase")
        verify_firebase_plist
        ;;
    "capacitor")
        verify_capacitor_config
        ;;
    "podfile")
        verify_podfile
        ;;
    "project")
        verify_ios_project
        ;;
    *)
        run_verification
        ;;
esac