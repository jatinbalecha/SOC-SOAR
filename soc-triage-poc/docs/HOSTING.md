# Free hosting

> **Want n8n itself online without the laptop?** See `docs/HOSTING_N8N_CLOUD.md`: n8n Cloud (14-day free trial) for the workflows and Streamlit Community Cloud (free) for the console.

There are two things to put online, and they need different hosting:

| What | How | Cost | Always on? |
|---|---|---|---|
| **Project website** (Stage 6) | GitHub Pages, plus the claude.ai link you already have | Free | Yes |
| **Live system** (console + n8n + agents) | Runs on the team laptop; `3_SHARE_ONLINE.bat` gives a password-protected public link through a free Cloudflare tunnel | Free | Only while the laptop is on and sharing |

## Why the live system is not on a cloud host (checked October 2026)

- **Hugging Face Spaces:** Docker apps now need a paid plan to create. Only static sites are free.
- **Render free tier:** 512 MB RAM and 0.1 CPU, sleeps after 15 minutes, and storage is wiped on every restart. n8n plus the console do not run reliably on that.
- **Railway, Fly.io, Google Cloud Run, Oracle Cloud:** a trial, no free tier for new accounts, or a credit card is required.

Running on the laptop and sharing a link is free and reliable for the evaluation and the demo. It is also the safer design: the n8n editor and webhooks never leave the laptop, and only the password-protected console is reachable from outside.

The `deploy/` folder has a Dockerfile and start-up script for **any Docker host**, if you later get one: a paid Hugging Face Space, a college server, or a cloud VM. It has not been tested on a real host.

## A. Website on GitHub Pages (permanent, free)

1. Create a free account at **github.com**.
2. Click **+ → New repository**:
   - Name it, for example, `soc-triage-website`.
   - Choose **Public** (required for free Pages).
   - Click **Create repository**.
3. On the new repository page, click **"uploading an existing file"**.
4. Drag in **`website\index.html`** from the project folder, then click **Commit changes**.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source: Deploy from a branch**, choose **Branch: main / (root)**, and click **Save**.
6. After 1–2 minutes the site is live at `https://<your-github-username>.github.io/soc-triage-website/`.

**To update the site** after the benchmark, interview or video:

1. Edit `website\content.json`.
2. Run `python tools\build_website.py`.
3. Upload the new `website\index.html` to the repository again (Add file → Upload files). It replaces the old one.

## B. Live console link (while the laptop is on)

1. Run **`2_START.bat`** as usual and wait until the console opens.
2. Double-click **`3_SHARE_ONLINE.bat`**.
   - **First time only:** it downloads Cloudflare's free `cloudflared` tool (about 60 MB) into `tools\bin`. No account is needed.
   - Choose a **password** of at least 8 characters. Anyone opening the link must type it.
   - After about a minute it shows a link such as `https://some-random-words.trycloudflare.com` and copies it to the clipboard.
3. Send the **link and the password** to your evaluators.
4. When you are done, press **Enter** in the share window. The link stops working at once.

**Good to know:**

- **The link changes** every time you share. Share it on the day of the evaluation.
- **Keep everything on:** the laptop, the "SOC n8n server" window and the share window must stay open, and the laptop must not sleep. Set Windows **Power → Sleep: Never** while sharing.
- **If it says the tunnel did not start,** the network (often a college or office firewall) is blocking it. Try a phone hotspot.
- **Quotas:** visitors' alerts use your Groq free quota. The password keeps strangers from using it up.
- **Cloudflare's quick tunnels are meant for testing and demos, with no uptime guarantee.** For a fixed, permanent address you would need a free Cloudflare account with a named tunnel and your own domain. That is not needed for the hackathon.

## What is exposed, and what is not

| Component | Reachable from the internet? |
|---|---|
| Console copy on port 8502 (password-protected) | Yes, through the tunnel |
| Console on port 8501 (team's own use) | No, localhost only |
| n8n editor and webhooks (port 5678) | No, localhost only |
| Mock model server | No, localhost only |
| Groq API key | Never. Held in memory by n8n only |
