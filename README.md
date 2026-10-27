# Content Book by Tee: website

The official site for Content Book by Tee (CBT), the content studio in Glasgow and India. It has three parts:

- **The site** (`/`): the cover, the work, the services, how a project runs, about Tisha, and the enquiry form.
- **The enquiry backend** (`/api/enquiries`): saves every enquiry to a database and can email the studio.
- **The studio desk** (`/admin`): a password-protected screen where the team reads enquiries, moves them along (new → replied → call booked → won / closed), keeps notes, and edits the work shown on the site.

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
| `server/db.js` | Database tables, the service list, the enquiry statuses, and the work seeded on first run |
| `server/auth.js` | Desk sign-in (signed cookie), rate limiting |
| `server/mail.js` | Optional email alert for new enquiries |
| `server/render.js` | Puts the work, the form options and the wordmark into the page |
| `server/views/home.html` | The page itself |
| `public/styles.css` | Colours and type at the top, then one block per section, then tablet, phone and motion |
| `public/main.js` | Clip playback, section entrances, and the enquiry form |
| `public/admin/` | The studio desk |
| `public/assets/brand/` | The logo traced to SVG (`word-content.svg`, `word-book.svg`, `bytee.svg`, `drawing.svg`, `logo.svg`), the paper texture, icons and the social card |
| `public/assets/media/` | Clips and stills cut from our own reels |
| `test/api.test.js` | The tests |

## How the design works

- **The page is the book's cover.** The top of the first screen is three of our own reels playing side by side (the Blank Street matcha pour, the Chalo Baithak singer, the KDP dhol night). Under them, the name runs edge to edge in the logo's own lettering.
- **The lettering is the real logo.** `content book`, `BY-TEE` and the one-line drawing were traced from the logo PNG into SVG paths, so they stay sharp at any size and take any colour. On phones the name stacks into two lines.
- **Colours come from the brand.** The paper is the supplied texture (`paper.webp`, average `#c0d6bb`). The ink `#1e2a1f` is the logo's line. The button green `#2c4a33` is the green of the Instagram headlines. The footer turns the page over: dark ground, sage lettering.
- **Type** is Fraunces, a soft serif close to the one on the Instagram posts, used for everything else.
- **The form is the first chapter.** It is written as a sentence ("My name is… I run… Based in… Help with…"). The heading becomes "Chapter one: *your brand*" as the visitor types. After sending, the visitor's answers come back as the opening lines of their chapter. Clicking a service fills in "Help with".
- **No prices.** The page says pricing is agreed on a call, around the budget the client sets.
- **Motion.** The clips play only while on screen. Each section's parts rise in as you reach them, the name settles as you scroll off the cover, and the footer name grows in. All of it switches off for people who ask for reduced motion. Their browser shows still frames and everything stays readable.

> This PC has Windows "Animation effects" turned off, so browsers here report *reduced motion*: the clips show as still frames and nothing animates. That is the page respecting the setting, not a bug. To see the motion, turn on **Settings → Accessibility → Visual effects → Animation effects**, or view the site on a phone.

## The studio desk

Sign in at `/admin` with `ADMIN_PASSWORD`.

- **Enquiries.** These are newest first and can be filtered by status. Open one to read it and reply by email (a button opens a pre-addressed email). Change its status as it moves along, or keep notes for the team.
- **Work.** Add, edit, hide or remove the pieces shown in the Work section. Upload an image (JPG, PNG or WebP, up to 5 MB) or point at a path. Position sets the order. The layout repeats every three pieces: left at 3:2, right at 4:5, inset at 16:9.

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

## Deploy

The site needs a server, so GitHub Pages will not run it. Any Node host works if it keeps files between deploys. For example:

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

- [ ] **Kumoe (10K views) and Flame & Ice.** These are named in the work and client lists but are not on the public Instagram grid. Check the numbers and that we can name them.
- [ ] **Client permission.** The page shows our reels for Chalo Baithak, Blank Street and KDP Studios, and stills cut from them. Check each client is happy to be shown.
- [ ] **Play counts** are Instagram's as of 26 October 2026: 8,466, 2,173, 4,412 and 1,715. Update them on the desk when they change.
- [ ] **About.** The facts say founder Tisha, based in Glasgow and India. Add a surname or photo only if Tisha wants them.
- [ ] **Services.** The list and the one-line descriptions are our wording from the Instagram bio and captions. Check that they match what we sell.
- [ ] **Email alerts.** Set up SMTP so enquiries reach contentbook7@gmail.com as well as the desk.
- [ ] **Domain.** Point the domain at the host and update the `og:image` link to the full URL so social previews work.
