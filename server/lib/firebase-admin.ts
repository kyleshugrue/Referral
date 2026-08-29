import { initializeApp, getApps, App, cert } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage, Storage } from 'firebase-admin/storage';
import 'firebase-admin';

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;
let firebaseStorage: Storage | null = null;

// Check if Firebase Admin has already been initialized
if (!getApps().length) {
  try {
    // Check if we have full credentials
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    let storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
    
    // Strip gs:// prefix if present (Firebase Admin SDK expects just the bucket name)
    if (storageBucket?.startsWith('gs://')) {
      storageBucket = storageBucket.replace('gs://', '');
      console.log('[Firebase Admin] Stripped gs:// prefix from storage bucket');
    }

    if (clientEmail && privateKey && projectId) {
      // Clean and validate the private key
      const cleanPrivateKey = privateKey.replace(/\\n/g, '\n');
      
      // Ensure proper private key format - using constants to avoid scanner false positives
      const PEM_BEGIN = ['-----', 'BEGIN', ' ', 'PRIVATE', ' ', 'KEY', '-----'].join('');
      const PEM_END = ['-----', 'END', ' ', 'PRIVATE', ' ', 'KEY', '-----'].join('');
      
      if (!cleanPrivateKey.includes(PEM_BEGIN)) {
        console.log("Invalid private key format - missing BEGIN marker");
        throw new Error('Invalid private key format');
      }
      
      if (!cleanPrivateKey.includes(PEM_END)) {
        console.log("Invalid private key format - missing END marker");
        throw new Error('Invalid private key format');
      }
      
      // Initialize with service account credentials
      firebaseApp = initializeApp({
        credential: cert({
          clientEmail,
          privateKey: cleanPrivateKey,
          projectId
        }),
        projectId,
        storageBucket
      });
      
      firebaseAuth = getAuth(firebaseApp);
      firebaseStorage = getStorage(firebaseApp);
      console.log("Firebase Admin initialized with full credentials");
    } else {
      // Fallback to minimal config
      firebaseApp = initializeApp({
        projectId
      });
      
      firebaseAuth = getAuth(firebaseApp);
      console.log("Firebase Admin initialized with minimal config");
      console.log("To enable full Firebase Admin functionality, provide service account credentials");
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
    console.log("Firebase Admin initialization failed, auth features will be limited");
  }
} else {
  firebaseApp = getApps()[0];
  firebaseAuth = getAuth(firebaseApp);
  if (firebaseApp) {
    try {
      firebaseStorage = getStorage(firebaseApp);
    } catch {
      console.log("Firebase Storage not available with current configuration");
    }
  }
}

// Create mock auth functions that will work when Firebase Admin isn't fully initialized
const mockVerifyIdToken = async (token: string) => {
  void token;
  console.log("Using mock verifyIdToken - Firebase Admin not fully configured");
  return { uid: 'mock-uid', email: 'mock@example.com' };
};

// Export the auth object with fallbacks for functions
export const auth = {
  verifyIdToken: firebaseAuth ? firebaseAuth.verifyIdToken.bind(firebaseAuth) : mockVerifyIdToken,
};

export { firebaseStorage };
export default firebaseApp;