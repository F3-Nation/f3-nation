export async function GET() {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Docs</title>
    <link rel="icon" type="image/svg+xml" href="https://orpc.unnoq.com/icon.svg" />
    <style>
      html, body, #app { height: 100%; margin: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      // Prefer explicit global to avoid race conditions
      (window.Scalar || Scalar).createApiReference('#app', {
        // Point to the generated OpenAPI spec
        url: '/docs/openapi.json',
        hideClientButton: false,
        hideModels: false,
        theme: 'kepler',
        darkMode: true,
        authentication: {
          securitySchemes: {
            bearerAuth: { token: '' },
          },
        },
      });
    </script>
  </body>
  </html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
