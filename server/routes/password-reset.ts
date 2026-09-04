import express from 'express';

const router = express.Router();

// Passwords are owned by Firebase Authentication. Keep this legacy route
// mounted only to return an honest, uniform response; it must never create,
// verify, or consume application-managed reset tokens.
router.use((_req, res) => {
  return res.status(410).json({
    message: "Password resets are handled by Firebase. Use the emailed reset link.",
  });
});

export default router;