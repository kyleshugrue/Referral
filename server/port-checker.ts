import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

interface PortProcess {
  pid: number;
  command: string;
}

/**
 * Find processes using a specific port with enhanced error handling
 */
async function findProcessOnPort(port: number): Promise<PortProcess | null> {
  try {
    console.log(`[${new Date().toISOString()}] Checking for processes on port ${port}...`);
    const { stdout, stderr } = await execAsync(`lsof -i :${port} -F pc`);

    if (stderr) {
      console.error(`[${new Date().toISOString()}] Error from lsof:`, stderr);
      return null;
    }

    if (!stdout) {
      console.log(`[${new Date().toISOString()}] No process found on port ${port}`);
      return null;
    }

    // Parse lsof output format
    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length < 2) {
      console.warn(`[${new Date().toISOString()}] Unexpected lsof output format:`, stdout);
      return null;
    }

    const pid = parseInt(lines[0].substring(1)); // Remove 'p' prefix
    const command = lines[1].substring(1); // Remove 'c' prefix

    if (isNaN(pid)) {
      console.error(`[${new Date().toISOString()}] Invalid PID in lsof output:`, lines[0]);
      return null;
    }

    console.log(`[${new Date().toISOString()}] Found process: PID=${pid}, Command=${command}`);
    return { pid, command };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error finding process on port ${port}:`, error);
    return null;
  }
}

/**
 * Kill a process by PID with enhanced error handling
 */
async function killProcess(pid: number): Promise<boolean> {
  try {
    console.log(`[${new Date().toISOString()}] Attempting to terminate process ${pid}...`);

    // First try SIGTERM
    await execAsync(`kill ${pid}`);

    // Wait briefly to see if process terminates gracefully
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if process is still running
    try {
      await execAsync(`ps -p ${pid}`);
      // If we get here, process is still running - try SIGKILL
      console.log(`[${new Date().toISOString()}] Process ${pid} still running, attempting force kill...`);
      await execAsync(`kill -9 ${pid}`);
    } catch {
      // Process not found - it terminated successfully with SIGTERM
      console.log(`[${new Date().toISOString()}] Process ${pid} terminated successfully`);
      return true;
    }

    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error killing process ${pid}:`, error);
    return false;
  }
}

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
 * Ensure port is free by finding and killing any process using it
 */
export async function ensurePortIsFree(port: number, maxAttempts = 3): Promise<boolean> {
  console.log(`[${new Date().toISOString()}] Ensuring port ${port} is free...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[${new Date().toISOString()}] Attempt ${attempt} of ${maxAttempts}`);

    // Check if port is already available
    if (await isPortAvailable(port)) {
      console.log(`[${new Date().toISOString()}] Port ${port} is already free`);
      return true;
    }

    // Find process using the port
    const process = await findProcessOnPort(port);
    if (!process) {
      console.warn(`[${new Date().toISOString()}] No process found but port ${port} is in use`);
      // Wait longer between attempts if we can't find the process
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }

    console.log(`[${new Date().toISOString()}] Found process ${process.command} (PID: ${process.pid}) using port ${port}`);

    // Kill the process
    const killed = await killProcess(process.pid);
    if (!killed) {
      console.error(`[${new Date().toISOString()}] Failed to kill process ${process.pid}`);
      // Wait longer between attempts if kill failed
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }

    console.log(`[${new Date().toISOString()}] Successfully terminated process ${process.pid}`);

    // Wait a bit longer for the port to be released
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify port is now available
    if (await isPortAvailable(port)) {
      console.log(`[${new Date().toISOString()}] Port ${port} is now free`);
      return true;
    }
  }

  console.error(`[${new Date().toISOString()}] Failed to free port ${port} after ${maxAttempts} attempts`);
  return false;
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