declare module 'express-session' {
  interface SessionData {
    userId?: number;
    authEpoch?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      authMethod?: 'jwt' | 'session';
      authSessionId?: string;
    }

    interface User {
      id: number;
      registrationCompleted?: boolean;
      accountStatus?: string;
      authEpoch?: number;
    }
  }
}

export {};