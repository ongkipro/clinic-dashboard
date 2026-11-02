// Fixture for the isolation gate self-test; never served.
export function GET() {
  return new Response(null, { status: 404 });
}
