import express from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { passwordResetTokens } from '@shared/schema';
import { storage } from '../storage';
import { sendPasswordResetCode } from '../services/email-service';
import { db } from '../db';
import { logger } from '../lib/logger';

const router = express.Router();

// Request a password reset
router.post('/request', async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email("Please enter a valid email address")
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid request data",
        errors: validationResult.error.errors
      });
    }

    const { email } = validationResult.data;

    // Check if user exists
    const user = await storage.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists or not
      return res.status(200).json({
        message: "If an account with that email exists, a password reset code has been sent."
      });
    }

    // Generate a random 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiration to 15 minutes from now
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // Delete any existing reset tokens for this email
    await db.delete(passwordResetTokens)
      .where(eq(passwordResetTokens.email, email));

    // Create a new reset token
    await db.insert(passwordResetTokens).values({
      email,
      token: resetCode,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      used: false
    });

    // Send the reset email
    logger.debug('[Password Reset] Sending reset code');
    
    try {
      const success = await sendPasswordResetCode(email, resetCode);
      logger.debug(`[Password Reset] Email send result: ${success ? 'Success' : 'Failed'}`);

      if (!success) {
        logger.error('[Password Reset] Failed to send reset code email');
        return res.status(500).json({
          message: "Failed to send reset code. Please try again later."
        });
      }
    } catch (error) {
      logger.error('[Password Reset] Error sending email:', error);
      return res.status(500).json({
        message: "Failed to send reset code. Please try again later."
      });
    }

    return res.status(200).json({
      message: "Password reset code has been sent to your email."
    });
  } catch (error) {
    logger.error("[Password Reset] Error requesting reset:", error);
    return res.status(500).json({
      message: "An error occurred while processing your request."
    });
  }
});

// Verify password reset code
router.post('/verify-code', async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email("Please enter a valid email address"),
      code: z.string().length(6, "Verification code must be 6 digits")
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid request data",
        errors: validationResult.error.errors
      });
    }

    const { email, code } = validationResult.data;

    // Find the reset token
    const resetToken = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.email, email),
        eq(passwordResetTokens.token, code),
        eq(passwordResetTokens.used, false)
      )
    });

    if (!resetToken) {
      return res.status(400).json({
        message: "Invalid or expired verification code. Please request a new code."
      });
    }

    // Check if the token is expired
    const now = new Date();
    const expiresAt = new Date(resetToken.expiresAt);
    
    if (now > expiresAt) {
      return res.status(400).json({
        message: "Verification code has expired. Please request a new code."
      });
    }

    // Code is valid, return success
    return res.status(200).json({
      message: "Verification code is valid.",
      verified: true
    });
  } catch (error) {
    logger.error("[Password Reset] Error verifying code:", error);
    return res.status(500).json({
      message: "An error occurred while verifying your code."
    });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email("Please enter a valid email address"),
      code: z.string().length(6, "Verification code must be 6 digits"),
      currentPassword: z.string().optional(),
      newPassword: z.string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9\W]/, "Password must contain at least one number or special character"),
      confirmPassword: z.string()
    }).refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"]
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid request data",
        errors: validationResult.error.errors
      });
    }

    const { email, code } = validationResult.data;

    // Find the reset token
    const resetToken = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.email, email),
        eq(passwordResetTokens.token, code),
        eq(passwordResetTokens.used, false)
      )
    });

    if (!resetToken) {
      return res.status(400).json({
        message: "Invalid or expired verification code. Please request a new code."
      });
    }

    // Check if the token is expired
    const now = new Date();
    const expiresAt = new Date(resetToken.expiresAt);
    
    if (now > expiresAt) {
      return res.status(400).json({
        message: "Verification code has expired. Please request a new code."
      });
    }

    // Get the user
    const user = await storage.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    // Passwords are managed by Firebase Authentication and are not stored in
    // the application database, so this legacy endpoint cannot complete a
    // reset. (It previously crashed at runtime here.) Fail explicitly and
    // direct users to the Firebase email reset flow used by the app.
    return res.status(410).json({
      message: "Password resets are handled through the emailed reset link. Please use the 'Forgot password' option to receive a new link."
    });
  } catch (error) {
    logger.error("[Password Reset] Error resetting password:", error);
    return res.status(500).json({
      message: "An error occurred while resetting your password."
    });
  }
});

export default router;