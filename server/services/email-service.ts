import { logger } from '../lib/logger';

// Basic email service interface
interface EmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

// Simplified email function that logs the email details
// This is a stub implementation for development/testing
export async function sendEmail(params: EmailParams): Promise<boolean> {
  logger.debug('[Email] Would send email', { subject: params.subject });
  
  // This is a stub implementation - in production, you'd integrate with an email service
  return true;
}

export async function sendPasswordResetCode(
  to: string,
  code: string
): Promise<boolean> {
  void to;
  void code;
  logger.debug('[Password Reset] Sending reset code');
  
  // This is a stub implementation - in production, you'd integrate with an email service
  
  logger.debug('[Password Reset] Email send result: Success (Simulated)');
  return true;
}

export async function sendVerificationCode(
  to: string, 
  code: string
): Promise<boolean> {
  void to;
  void code;
  logger.debug('[Email Verification] Sending verification code');
  
  // This is a stub implementation - in production, you'd integrate with an email service
  
  logger.debug('[Email Verification] Email sent: Success (Simulated)');
  return true;
}

export async function sendEmailConfirmation(
  to: string, 
  token: string = '', 
  userId: number = 0
): Promise<boolean> {
  void to;
  void token;
  logger.debug('[Email Confirmation] Sending confirmation email', { userId });
  
  // This is a stub implementation - in production, you'd integrate with an email service
  
  logger.debug('[Email Confirmation] Email sent: Success (Simulated)');
  return true;
}