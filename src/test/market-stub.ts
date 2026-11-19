// A market and its site as fetch answers, for the market unit tests.
export const serving =
  (routes: Record<string, Response | Error>) =>
  async (input: unknown): Promise<Response> => {
    const found = routes[String(input)] ?? new Response('{}', { status: 404 });
    if (found instanceof Error) throw found;
    return found.clone();
  };

export const doc = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// The market's own 404 for an id it does not list.
export const unknownId = (id: string) =>
  doc({ success: false, error: { code: 'NOT_FOUND', message: `no listed extension ${id}` } }, 404);

export const named = { markets: ['https://market.test/'] };
