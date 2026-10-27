# Content Book by Tee: website

The official site for Content Book by Tee (CBT), the content studio in Glasgow and India. It has three parts:

- **The site** (`/`): who we are, what we offer, how we work, why businesses work with us, a note from Tisha, a link to our work on Instagram, the committee, the FAQ and the enquiry form.
- **The enquiry backend** (`/api/enquiries`): saves every enquiry to a database and can email the studio.
- **The studio desk** (`/admin`): a password-protected screen where the team reads enquiries, moves them along (new → replied → call booked → won / closed) and keeps notes.

It runs on Node.js 22 with Express and SQLite (Node's built-in `node:sqlite`), with no build step.

## Run it locally

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` and set `ADMIN_PASSWORD` (the desk stays locked without it), then start the server:

```bash
npm run dev
```

Open http://localhost:3000 for the site and http://localhost:3000/admin for the desk. The database and uploaded images are created in `data/`, which is never committed.

```bash
npm test
```

The tests cover the form (with and without JavaScript), validation, the spam trap, desk sign-in, enquiry status changes, adding and hiding work, image uploads and HTML escaping.

## Files

| Path | What it is |
|---|---|
| `server/index.js` | Starts the server |
| `server/app.js` | Pages, the public API and the desk API, with validation and security headers |
| `server/content.js` | The service list, the enquiry statuses, and the work seeded on first run |
| `server/store/` | Where data lives: SQLite on a disk (`sqlite.js`) or Upstash Redis on Vercel (`redis.js`) |
| `api/index.js`, `vercel.json` | The Vercel entry point and routing |
| `server/auth.js` | Desk sign-in (signed cookie), rate limiting |
| `server/mail.js` | Optional email alert for new enquiries |
| `server/render.js` | Puts the form options and the wordmark into the page |
| `server/views/home.html` | The page itself |
| `public/styles.css` | Colours and type at the top, then one block per section, then tablet, phone and motion |
| `public/main.js` | Clip playback, section entrances, and the enquiry form |
| `public/admin/` | The studio desk |
| `public/assets/brand/` | The logo traced to SVG (`word-content.svg`, `word-book.svg`, `bytee.svg`, `drawing.svg`, `logo.svg`), the paper texture, icons and the social card |
| `public/assets/media/` | Clips and stills cut from our own reels |
| `test/api.test.js` | The tests |

## How the design works

- **Cosy, and about the offer.** Rounded cream cards on the sage paper, the logo in an arched window, a soft serif for headings. The page sells what we do and how we do it: no numbers and no client names. The work itself lives on Instagram, and the page links there.
- **The logo is real.** `content book`, `BY-TEE` and the one-line drawing were traced from the logo PNG into SVG, so they stay sharp in the nav at any size.
- **Colours come from the brand.** The paper is the supplied texture (`paper.webp`, average `#c0d6bb`). The ink `#1e2a1f` is the logo's line. The button green `#2c4a33` is the green of the Instagram headlines. Contact and footer are on the dark green.
- **Type.** Headings are Fraunces, a soft serif. Reading text is Work Sans.
- **Committee.** The "Our committee" section says "Coming soon. Stay tuned." until the team is ready to be shown. It is in `server/views/home.html` under `id="team"`.
- **The form** asks for name, brand, city, the service and email, and fills in the service when you click an "Ask about…" link.
- **No prices.** The page says pricing is agreed on a call, around the budget the client sets.
- **Motion.** Each section rises in as you reach it, and cards lift on hover. All of it switches off for people who ask for reduced motion.

> This PC has Windows "Animation effects" turned off, so browsers here report *reduced motion* and nothing animates. To see the motion, turn on **Settings → Accessibility → Visual effects → Animation effects**, or view the site on a phone.

## The studio desk

Sign in at `/admin` with `ADMIN_PASSWORD`.

- **Enquiries.** These are newest first and can be filtered by status. Open one to read it and reply by email (a button opens a pre-addressed email). Change its status as it moves along, or keep notes for the team.

To get an email for every enquiry, fill in the `SMTP_*` settings in `.env`. For Gmail use `smtp.gmail.com`, port `465` and an [app password](https://myaccount.google.com/apppasswords). Without SMTP, enquiries are still saved and shown on the desk.

## API

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/enquiries` | New enquiry: `name`, `brand`, `city`, `service`, `email`, `message`. JSON gets JSON back; a plain form post is redirected to `/?sent=1#write`. Limited to 5 per 10 minutes per visitor. |
| `GET` | `/api/work` | Published work |
| `POST` | `/api/desk/login` · `/api/desk/logout` | Sign in or out of the desk |
| `GET` | `/api/desk/enquiries?status=` | Enquiries, with counts per status |
| `PATCH` / `DELETE` | `/api/desk/enquiries/:id` | Change `status` or `notes`, or delete |
| `GET` / `POST` | `/api/desk/work` | List or add work |
| `PATCH` / `DELETE` | `/api/desk/work/:id` | Edit or remove work |
| `POST` | `/api/desk/uploads` | Upload an image as a data URL |

## Deploy on Vercel

GitHub Pages only serves static files, so it cannot run the form or the desk. Vercel can. `vercel.json` sends every request that is not a file in `public/` to `api/index.js`, which runs the same Express app.

Vercel has no disk that lasts, so on Vercel the data lives in **Upstash Redis** (free tier). The app switches to it automatically when its credentials are set.

1. **Import the repo.** Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub and import `Tejas-kaushik/Official---CBT-`. Leave the build settings as they are.
2. **Add the database.** In the project, open **Storage → Create → Upstash for Redis** (free plan) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
3. **Set the desk password.** In **Settings → Environment Variables**, add `ADMIN_PASSWORD`. Optionally add `SESSION_SECRET` and the `SMTP_*` settings for email alerts.
4. **Redeploy.** Under **Deployments**, open the latest one, choose **Redeploy**, then open the site and `/admin`.

On Vercel the desk links images instead of uploading them: paste an `https://` image link, or add the file to `public/assets/` and push.

## Deploy on a server with a disk

Any Node host that keeps files between deploys runs it with SQLite instead. For example:

- **Render**: a Web Service with build command `npm install`, start command `npm start`, and a persistent disk mounted at `/var/data`.
- **Railway**: a service from this repository with a volume mounted at `/data`.

Set these on the host:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD` | a strong password |
| `SESSION_SECRET` | a long random string |
| `DATA_DIR` | the persistent disk's path (for example `/var/data`) |
| `SMTP_*`, `NOTIFY_EMAIL` | optional, for email alerts |

Without a persistent disk, enquiries and uploads are lost every time the host restarts.

## Confirm before launch

- [ ] **About.** The facts say founder Tisha, based in Glasgow and India. Add a surname or photo only if Tisha wants them.
- [ ] **Services.** The list and the one-line descriptions are our wording from the Instagram bio and captions. Check that they match what we sell.
- [ ] **Email alerts.** Set up SMTP so enquiries reach contentbook7@gmail.com as well as the desk.
- [ ] **Domain.** Point the domain at the host and update the `og:image` link to the full URL so social previews work.
