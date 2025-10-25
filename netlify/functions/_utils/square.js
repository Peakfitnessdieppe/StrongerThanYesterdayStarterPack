import square from 'square';

let cachedClient;

function resolveEnvironment(accessToken) {
  const explicit = (process.env.SQUARE_ENVIRONMENT || '').toLowerCase();
  if (explicit === 'sandbox' || explicit === 'production') {
    return explicit;
  }

  if (process.env.SQUARE_APPLICATION_ID?.startsWith('sandbox-')) {
    return 'sandbox';
  }

  if (accessToken?.startsWith?.('sandbox-')) {
    return 'sandbox';
  }

  return 'production';
}

export function getSquareClient() {
  if (cachedClient) return cachedClient;

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Missing SQUARE_ACCESS_TOKEN environment variable.');
  }

  cachedClient = new square.Client({
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
