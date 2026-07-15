import type { NextFunction, Request, Response } from "express";

/** Public read-only demo: no saving, deleting, or paid AI calls. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function demoModeGuard(_req: Request, res: Response, next: NextFunction) {
  if (isDemoMode()) {
    return res.status(403).json({
      error: "This is a read-only demo — saving, deleting, and AI extraction are disabled.",
    });
  }
  next();
}
