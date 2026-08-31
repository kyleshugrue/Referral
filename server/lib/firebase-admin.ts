import { initializeApp, getApps, App, cert } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage, Storage } from 'firebase-admin/storage';
import 'firebase-admin';
import { logger } from './logger';

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;
let firebaseStorage: Storage | null = null;

export interface FirebaseAdminConfig {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  storageBucket?: string;
}

export function isSyntheticSmokeTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === 'true' && env.SMOKE_TEST === 'true';
}

const PEM_BEGIN = ['-----', 'BEGIN', ' ', 'PRIVATE', ' ', 'KEY', '-----'].join('');
const PEM_END = ['-----', 'END', ' ', 'PRIVATE', ' ', 'KEY', '-----'].join('');

export function readFirebaseAdminConfig(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseAdminConfig | null {
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  // Some existing deployments expose the bucket through the frontend
  // configuration name. This fallback affects storage selection only; Admin
  // authentication still requires the server-only project ID and credentials.
  let storageBucket = (
    env.FIREBASE_STORAGE_BUCKET?.trim() || env.VITE_FIREBASE_STORAGE_BUCKET?.trim()
  );

  if (!clientEmail || !privateKey || !projectId) return null;
  if (!privateKey.includes(PEM_BEGIN) || !privateKey.includes(PEM_END)) {
    throw new Error('FIREBASE_PRIVATE_KEY has an invalid format');
  }

  // Firebase Admin expects a bucket name, not a gs:// URL.
  if (storageBucket?.startsWith('gs://')) {
    storageBucket = storageBucket.slice('gs://'.length);
  }

  return { clientEmail, privateKey, projectId, storageBucket };
}

export class FirebaseAdminUnavailableError extends Error {
  constructor() {
    super('Firebase Admin authentication is unavailable');
    this.name = 'FirebaseAdminUnavailableError';
  }
}

function initializeFirebaseAdmin(): void {
  if (isSyntheticSmokeTest()) {
    logger.info('[Firebase Admin] Skipped for synthetic CI smoke test');
    return;
  }

  const existingApp = getApps()[0];
  if (existingApp) {
    firebaseApp = existingApp;
    firebaseAuth = getAuth(existingApp);
    try {
      firebaseStorage = getStorage(existingApp);
    } catch {
      logger.warn('[Firebase Admin] Storage is unavailable');
    }
    return;
  }

  try {
    const config = readFirebaseAdminConfig();
    if (!config) {
      logger.warn(
        '[Firebase Admin] Configuration is incomplete; Firebase authentication is unavailable until server credentials are configured',
      );
      return;
    }

    firebaseApp = initializeApp({
      credential: cert(config),
      projectId: config.projectId,
      storageBucket: config.storageBucket,
    });
    firebaseAuth = getAuth(firebaseApp);
    firebaseStorage = getStorage(firebaseApp);
    logger.info('[Firebase Admin] Initialized with service-account credentials');
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Firebase Admin initialization failed; refusing to start production authentication',
        { cause: error },
      );
    }
    logger.warn('[Firebase Admin] Initialization failed outside production; authentication is unavailable');
  }
}

initializeFirebaseAdmin();

export const auth = {
  verifyIdToken: async (token: string) => {
    if (!firebaseAuth) throw new FirebaseAdminUnavailableError();
    return firebaseAuth.verifyIdToken(token);
  },
};

export { firebaseStorage };
export default firebaseApp;