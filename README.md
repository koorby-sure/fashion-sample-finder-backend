# Fashion Sample Finder Backend

Backend for a GitHub Pages frontend. It provides:

- `POST /api/search` — upload sample image + optional brand, returns visual search matches.
- `POST /api/screenshot` — captures a PNG screenshot of a selected website URL.
- `GET /health` — health check.

## Deploy on Render

1. Create a new GitHub repository, for example `fashion-sample-finder-backend`.
2. Upload these files to the root of the repository.
3. Go to Render → New → Web Service.
4. Connect the GitHub repository.
5. Choose Docker runtime. Render will use the included `Dockerfile`.
6. Add environment variables:

```env
SERPAPI_API_KEY=your_serpapi_key_here
DEMO_MODE=false
ALLOWED_ORIGINS=*
```

For production, replace `ALLOWED_ORIGINS=*` with your GitHub Pages origin, for example:

```env
ALLOWED_ORIGINS=https://yourname.github.io
```

`PUBLIC_BASE_URL` can usually be left empty because Render provides `RENDER_EXTERNAL_URL` automatically. If visual search fails because the uploaded image URL is not public, set:

```env
PUBLIC_BASE_URL=https://your-backend-name.onrender.com
```

## Test

Open:

```text
https://your-backend-name.onrender.com/health
```

Expected response:

```json
{"ok":true}
```

Then paste this base URL into the Backend URL field in the GitHub Pages frontend.
