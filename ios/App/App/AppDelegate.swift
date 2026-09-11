import UIKit
import Capacitor
import UserNotifications
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        
        // Firebase initialization using GoogleService-Info.plist
        // Firebase credentials are injected at build time via build configuration
        // SECURITY: Never hardcode API keys - use environment variables or CI/CD secrets
        if FirebaseApp.app() == nil {
            if let plistPath = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
               let plistData = NSDictionary(contentsOfFile: plistPath),
               plistData["PROJECT_ID"] != nil {
                print("🔥 [Firebase] Using GoogleService-Info.plist for configuration")
                FirebaseApp.configure()
            } else {
                // Configuration should be provided via GoogleService-Info.plist
                // If missing, Firebase features will be unavailable
                print("⚠️ [Firebase] GoogleService-Info.plist not found - Firebase features unavailable")
                print("⚠️ [Firebase] Please ensure GoogleService-Info.plist is included in the build")
            }
        }
        
        // Set Firebase Messaging delegate for FCM token handling
        Messaging.messaging().delegate = self
        
        // Register for push notifications
        UNUserNotificationCenter.current().delegate = self
        
        // Get initial FCM token on launch (critical for first boot)
        Messaging.messaging().token { token, error in
            if let error = error {
                _ = error
                print("[AppDelegate] FCM registration token fetch failed")
            } else if let token = token {
                print("[AppDelegate] FCM registration token received")
                print("[AppDelegate] Posting FCMTokenReceived notification")
                NotificationCenter.default.post(name: NSNotification.Name("FCMTokenReceived"), object: token)
            }
        }
        
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        clearNativeNotificationResidue()
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
    
    // MARK: - Firebase Push Notification Methods
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // CRITICAL: Set APNs token for Firebase Messaging
        Messaging.messaging().apnsToken = deviceToken
        
        // Forward device token to Capacitor for Firebase messaging
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Forward registration error to Capacitor
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
    
    // MARK: - Background Notification Handling
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Handle background/silent push notifications (content-available: 1)
        // This is crucial for connection requests, new connections, and messages
        
        // Forward to Firebase Messaging for analytics
        Messaging.messaging().appDidReceiveMessage(userInfo)
        
        // Forward to Capacitor for processing (when app becomes active)
        NotificationCenter.default.post(name: NSNotification.Name("BackgroundNotificationReceived"), object: userInfo)
        
        // Process background data updates - CRITICAL for when JS layer is inactive
        guard let notificationType = userInfo["type"] as? String else {
            completionHandler(.noData)
            return
        }
        
        var didProcessData = false
        
        switch notificationType {
        case "connection_request":
            didProcessData = handleConnectionRequest(userInfo)
        case "connection_accepted":
            didProcessData = handleConnectionAccepted(userInfo)
        case "new_connection":
            didProcessData = handleNewConnection(userInfo)
        case "new_message":
            didProcessData = handleNewMessage(userInfo)
        default:
            break
        }
        
        completionHandler(didProcessData ? .newData : .noData)
    }
    
    // MARK: - Background Data Processing
    private func handleConnectionRequest(_ userInfo: [AnyHashable: Any]) -> Bool {
        incrementBadgeCount()
        scheduleLocalNotification(type: "connection_request", userInfo: userInfo)
        print("[AppDelegate] Processed connection request notification")
        return true
    }
    
    private func handleConnectionAccepted(_ userInfo: [AnyHashable: Any]) -> Bool {
        incrementBadgeCount()
        scheduleLocalNotification(type: "connection_accepted", userInfo: userInfo)
        print("[AppDelegate] Processed connection accepted notification")
        return true
    }
    
    private func handleNewConnection(_ userInfo: [AnyHashable: Any]) -> Bool {
        incrementBadgeCount()
        scheduleLocalNotification(type: "new_connection", userInfo: userInfo)
        print("[AppDelegate] Processed new connection notification")
        return true
    }
    
    private func handleNewMessage(_ userInfo: [AnyHashable: Any]) -> Bool {
        incrementBadgeCount()
        scheduleLocalNotification(type: "new_message", userInfo: userInfo)
        print("[AppDelegate] Processed new message notification")
        return true
    }
    
    private func incrementBadgeCount() {
        // Ensure badge updates happen on main thread
        DispatchQueue.main.async {
            let currentBadge = UIApplication.shared.applicationIconBadgeNumber
            UIApplication.shared.applicationIconBadgeNumber = currentBadge + 1
        }
    }
    
    private func scheduleLocalNotification(type: String, userInfo: [AnyHashable: Any]) {
        // CRITICAL: Only schedule local notifications for data-only pushes
        // If the push already has an alert, don't create duplicate notification
        if let aps = userInfo["aps"] as? [String: Any], aps["alert"] != nil {
            print("Skipping local notification - push already has alert")
            return
        }
        
        let content = UNMutableNotificationContent()
        switch type {
        case "connection_request":
            content.title = "New connection request"
        case "connection_accepted":
            content.title = "Connection request accepted"
        case "new_connection":
            content.title = "New connection"
        case "new_message":
            content.title = "New message"
        default:
            content.title = "New notification"
        }
        content.body = "Open Referral to view your notification."
        content.sound = .default
        content.userInfo = ["type": type, "source": "background_data"]
        
        // Immediate trigger for data-only notifications
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let identifier = "background_\(type)_\(Date().timeIntervalSince1970)"
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                _ = error
                print("[AppDelegate] Local notification scheduling failed")
            }
        }
    }

    private func clearNativeNotificationResidue() {
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
        UIApplication.shared.applicationIconBadgeNumber = 0
    }

    
    // MARK: - UNUserNotificationCenterDelegate Methods
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show notification when app is in foreground
        if #available(iOS 14.0, *) {
            completionHandler([.badge, .sound, .banner])
        } else {
            completionHandler([.badge, .sound, .alert])
        }
    }
    
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        // Handle notification tap - forward userInfo to Capacitor for processing
        let userInfo = response.notification.request.content.userInfo
        
        // Forward to Capacitor for handling connection requests, messages, etc.
        NotificationCenter.default.post(name: NSNotification.Name("NotificationTapped"), object: userInfo)
        
        completionHandler()
    }
    
    // MARK: - MessagingDelegate Methods
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        // Forward FCM token to Capacitor for use in web layer
        if let token = fcmToken {
            print("[AppDelegate] FCM token refresh received")
            print("[AppDelegate] Posting FCMTokenReceived notification")
            NotificationCenter.default.post(name: NSNotification.Name("FCMTokenReceived"), object: token)
        } else {
            print("[AppDelegate] FCM token refresh did not provide a token")
        }
    }
    
    // Note: messaging(_:didReceiveMessage:) is deprecated in Firebase Messaging v10+
    // Background and foreground message handling is now done via:
    // - application(_:didReceiveRemoteNotification:fetchCompletionHandler:) for background
    // - userNotificationCenter(_:willPresent:) for foreground display
    // - userNotificationCenter(_:didReceive:) for user taps

}
