declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    interface User {
      id: number;
      registrationCompleted?: boolean;
    }
  }
}

export {};