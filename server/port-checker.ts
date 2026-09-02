import net from 'net';

/**
 * Check if a port is available with better error handling
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`[${new Date().toISOString()}] Testing if port ${port} is available...`);

    const tester = net.createServer()
      .once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[${new Date().toISOString()}] Port ${port} is in use`);
          resolve(false);
        } else {
          console.error(`[${new Date().toISOString()}] Error checking port ${port}:`, err);
          resolve(false);
        }
      })
      .once('listening', () => {
        tester.once('close', () => {
          console.log(`[${new Date().toISOString()}] Port ${port} is available`);
          resolve(true);
        }).close();
      });

    tester.listen(port, '0.0.0.0');
  });
}

/**
 * Non-destructive startup preflight. A port owned by another process is an
 * expected bind error, not permission for this process to terminate it.
 */
export async function ensurePortIsFree(port: number): Promise<boolean> {
  return isPortAvailable(port);
}

/**
 * Checks if a port is already in use with enhanced diagnostics
 */
export async function isPortTaken(port: number): Promise<boolean> {
  return !(await isPortAvailable(port));
}

/**
 * Waits for a port to become available with enhanced diagnostics
 */
export async function waitForPortToFree(port: number, timeout = 10000): Promise<void> {
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeout) {
    attempts++;
    console.log(`[${new Date().toISOString()}] Checking port ${port} availability (attempt ${attempts})`);

    if (await isPortAvailable(port)) {
      console.log(`[${new Date().toISOString()}] Port ${port} is now available`);
      return;
    }

    // Wait between checks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Timeout waiting for port ${port} to become available after ${attempts} attempts`);
}

export const PORT = process.env.PORT || 5000;