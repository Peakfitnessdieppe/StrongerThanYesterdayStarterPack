export default async function handler() {
  const payload = {
    squareApplicationId: process.env.SQUARE_APPLICATION_ID || null,
    squareLocationId: process.env.SQUARE_LOCATION_ID || null,
    calendlyUrl: process.env.CALENDLY_URL || null,
    squareEnvironment: (process.env.SQUARE_ENVIRONMENT || '').toLowerCase() || null,
    priceCents: Number.parseInt(process.env.STARTER_PACK_PRICE_CENTS || '13999', 10),
    currency: process.env.STARTER_PACK_CURRENCY || 'CAD'
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
