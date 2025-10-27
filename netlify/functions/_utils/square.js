import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const squareModule = require('square');

const SquareClient =
  squareModule?.SquareClient ??
  squareModule?.Client ??
  squareModule?.default?.SquareClient ??
  squareModule?.default?.Client ??
  squareModule?.Square ??
  squareModule;

const SquareEnvironment =
  squareModule?.SquareEnvironment ??
  squareModule?.Environment ??
  squareModule?.default?.SquareEnvironment ??
  squareModule?.default?.Environment ??
  squareModule?.Square?.SquareEnvironment ??
  null;

let cachedClient;

function mapEnvironment(name) {
  if (SquareEnvironment && SquareEnvironment[name]) {
    return SquareEnvironment[name];
  }
  return name.toLowerCase();
}

function resolveEnvironment(accessToken) {
  const explicit = (process.env.SQUARE_ENVIRONMENT || '').toLowerCase();
  if (explicit === 'sandbox') return mapEnvironment('Sandbox');
  if (explicit === 'production') return mapEnvironment('Production');

  if (process.env.SQUARE_APPLICATION_ID?.startsWith('sandbox-')) return mapEnvironment('Sandbox');

  if (accessToken?.startsWith?.('sandbox-')) return mapEnvironment('Sandbox');

  return mapEnvironment('Production');
}

export function getSquareClient() {
  if (cachedClient) return cachedClient;

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Missing SQUARE_ACCESS_TOKEN environment variable.');
  }

  if (typeof SquareClient !== 'function') {
    throw new Error('Square SDK Client export not available. Ensure dependency is installed correctly.');
  }

  cachedClient = new SquareClient({
    accessToken,
    environment: resolveEnvironment(accessToken)
  });

  return cachedClient;
}

export function getSquareConfig() {
  const applicationId = process.env.SQUARE_APPLICATION_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!applicationId || !locationId) {
    throw new Error('Missing SQUARE_APPLICATION_ID or SQUARE_LOCATION_ID environment variables.');
  }
  return { applicationId, locationId };
}
