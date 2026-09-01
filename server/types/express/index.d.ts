declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }

    interface User {
      id: number;
      registrationCompleted?: boolean;
    }
  }
}

export {};