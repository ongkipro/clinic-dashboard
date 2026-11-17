// The vendor's AutoLaris H2H port (TD-42; T-103). Server side only; the API key never reaches this module's callers, the database, logs or
// fixtures. Only the three payment endpoints the vendor billing uses: GET /api/h2h/list_payment, POST /api/h2h/create_payment,
// POST /api/h2h/advice. Shipping endpoints are never called. Tests and local runs use the mock (mock.ts); no live adapter exists yet.

// One HTTP exchange as the server saw it: the HTTP status (null = no response: timeout / network) and the JSON body.
export type Exchange = { http: number | null; body: Record<string, unknown> | null };

export type Channel = { channel_code: string; name: string; admin: string; tipe_admin: string };

export type CreatePayment = {
  reff_id: string;
  channel_code: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  expired: string; // YYYYMMDDHHMMSS, Asia/Jakarta (the provider has not published the timezone)
  amount: string; // the principal, before the provider's fee
  callback_url: string; // empty: a callback is never proof of payment (TD-42)
};

export type AutolarisPort = {
  listPayment(): Promise<Exchange>;
  createPayment(req: CreatePayment): Promise<Exchange>;
  advice(transactionId: string): Promise<Exchange>;
};

// The success envelope (TD-42): HTTP 2xx and rc "00". Nothing in `data` is consumed otherwise.
export const envelopeOk = (x: Exchange) => x.http !== null && x.http >= 200 && x.http < 300 && x.body !== null && x.body.rc === "00";
