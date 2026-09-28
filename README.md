<p align="center">
  <img src="icons/icon.svg" width="128" height="128" alt="OpDiScan logo">
</p>

<h1 align="center">OpDiScan</h1>

<p align="center"><strong>Open-source document scanning, directly in your browser.</strong></p>

<p align="center">
  <a href="https://github.com/jhnbrd/OpDiScan/actions/workflows/deployment.yml"><img src="https://github.com/jhnbrd/OpDiScan/actions/workflows/deployment.yml/badge.svg" alt="Production deployment"></a>
  <a href="https://github.com/jhnbrd/OpDiScan/releases"><img src="https://img.shields.io/github/v/release/jhnbrd/OpDiScan?display_name=tag" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jhnbrd/OpDiScan" alt="MIT License"></a>
</p>

OpDiScan is a lightweight, self-hostable Progressive Web App that turns a phone or computer camera into a document scanner. It detects page edges, corrects perspective, enhances the result, combines multiple pages, and exports JPG, PNG, or PDF files. There are no accounts, subscriptions, advertisements, or server-side document processing.

> **Public app:** [scan.jhnbrd.com](https://scan.jhnbrd.com)

## Features

- Live rear-camera preview with automatic document-edge detection
- Perspective correction and page flattening
- Color, grayscale, and high-contrast black-and-white filters
- Multiple pages in a single PDF
- JPG and PNG export for individual pages
- Local image import when a camera is unavailable
- Installable PWA with an application icon and offline app shell
- Responsive interface for phones, tablets, and desktops
- Static architecture that is easy to host with Docker and Nginx
- No application database, user account, analytics, or document upload

## Use the hosted app

1. Open [scan.jhnbrd.com](https://scan.jhnbrd.com) in a current browser.
2. Allow camera access when prompted, or select **Import** to choose an existing image.
3. Place the whole document inside the camera view. A green outline appears when OpDiScan detects its edges.
4. Press the round capture button.
5. Choose Color, Grayscale, or B&W and review the result.
6. Add more pages if needed, then export a PDF or download the current page as JPG or PNG.

The camera API requires a secure context. Use the hosted HTTPS address or `localhost`; camera access normally will not work from an unsecured LAN address such as `http://192.168.x.x:8074`.

## Install as a PWA

### Android (Chrome or Edge)

1. Open the hosted app.
2. Open the browser menu.
3. Select **Install app** or **Add to Home screen**.
4. Confirm the installation, then launch OpDiScan from the home screen.

### iPhone or iPad (Safari)

1. Open the hosted app in Safari.
2. Tap **Share**.
3. Select **Add to Home Screen**.
4. Confirm by tapping **Add**.

### Desktop (Chrome or Edge)

Open the hosted app and use the install icon in the address bar, or use the **Install** button when it appears in OpDiScan.

## How it works

OpDiScan performs its document processing in the browser:

1. A low-resolution copy of the live camera frame is analyzed with OpenCV.js.
2. Grayscale conversion, blur, edge detection, and contour approximation identify a likely four-corner document.
3. On capture, the full-resolution frame is perspective-warped into a flat rectangle.
4. The selected enhancement is applied locally.
5. jsPDF creates multi-page PDF files in the browser.
6. The finished file is downloaded by the browser.

Captured pages exist only in the current tab's memory and are cleared when the page is closed or refreshed. OpDiScan itself does not upload or permanently store them.

## Self-host with Docker Compose

### Requirements

- Git
- Docker Engine with Docker Compose v2, or Docker Desktop
- HTTPS for camera use on devices other than the host machine

Clone and start the application:

```sh
git clone https://github.com/jhnbrd/OpDiScan.git
cd OpDiScan
docker compose up -d --build
```

The included configuration publishes OpDiScan on host port `8074`:

```text
http://SERVER_IP:8074
```

The mapping is `8074:80`: port 8074 belongs to the host, while port 80 exists only inside the OpDiScan container. Other containers can use their own internal port 80 without conflict.

Useful management commands:

```sh
docker compose ps
docker compose logs -f scanner-web
docker compose pull
docker compose up -d --build
docker compose down
```

`docker compose down` removes the containers and network, but it does not delete documents because OpDiScan never stores scanned documents on the server.

## Deploy through Cloudflare Tunnel

Cloudflare Tunnel provides the HTTPS origin needed by browser camera APIs without exposing an inbound router port.

1. In Cloudflare Zero Trust, open **Networks > Tunnels** and create a tunnel.
2. Add the public hostname `scan.jhnbrd.com` (or your own domain when self-hosting).
3. Set its service URL to `http://scanner-web:80`.
4. Copy the generated tunnel token.
5. In the project directory, create a `.env` file:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=replace-with-your-token
```

6. Start the web app and tunnel profile:

```sh
docker compose --profile tunnel up -d --build
```

Never commit the `.env` file or publish the tunnel token. The host mapping `8074:80` may remain enabled for LAN administration; Cloudflare connects to `scanner-web:80` over the private Compose network.

## Deploy with Portainer

OpDiScan includes a separate Compose definition for automatic Git-based updates. It uses read-only bind mounts so a Portainer GitOps refresh does not need to rebuild a Docker image.

1. In Portainer, go to **Stacks > Add stack** and choose **Repository**.
2. Set the repository URL to `https://github.com/jhnbrd/OpDiScan.git`.
3. Set the repository reference to `refs/heads/main`.
4. Set the Compose path to `docker-compose.gitops.yml`.
5. Enable **Relative path volumes**. This is required for the application-file mounts.
6. Enable **GitOps updates**.
7. Choose **Polling** and set the fetch interval to `5 minutes` (or a longer interval if preferred).
8. Enable **Force redeployment**. Portainer re-clones repositories into a new path, so the container must be recreated to mount the refreshed files.
9. Optionally enable **Re-pull image** to receive Nginx image updates during redeployment.
10. If this stack should run the included tunnel, add `COMPOSE_PROFILES=tunnel` and `CLOUDFLARE_TUNNEL_TOKEN=your-token` as environment variables. Otherwise leave the tunnel profile disabled.
11. Deploy the stack.

After this one-time setup, Portainer compares the deployed commit with `origin/main` at each interval. When the commit changes, it pulls the repository and recreates the application container with the updated files. Git is the source of truth; edits made directly on the server may be overwritten.

If Cloudflare Tunnel is managed in another stack, leave the `tunnel` profile disabled and route that tunnel to the server's port `8074`. If it is managed by this stack, enable the `tunnel` profile and route it to `http://scanner-web:80`.

## Updating

From the cloned repository:

```sh
git pull --ff-only
docker compose up -d --build
```

Browsers may briefly retain the prior service-worker cache after an update. Close all OpDiScan tabs and reopen the app if an old version remains visible.

## Deployment status and releases

Every push to `main` registers [scan.jhnbrd.com](https://scan.jhnbrd.com) as the production environment in GitHub. This reports the existing Cloudflare Tunnel deployment and does not modify or redeploy the server.

To publish a release, create and push a semantic version tag:

```sh
git tag -a v1.0.0 -m "OpDiScan v1.0.0"
git push origin v1.0.0
```

The release workflow verifies the tag and publishes a GitHub Release with automatically generated release notes. It can also be started manually from **Actions > Publish release** for an existing tag.

## Privacy and safety

- **Local processing:** Scanned document pixels are processed in browser memory. The included application has no upload endpoint, account system, telemetry, or analytics.
- **External dependencies:** On first use, the browser requests OpenCV.js from `docs.opencv.org` and jsPDF from `cdn.jsdelivr.net`. The service worker caches successful responses for later use. Those providers can observe ordinary request metadata such as IP address and user agent, but OpDiScan does not send document images to them.
- **Use a trusted instance:** A modified or compromised deployment could behave differently. For sensitive documents, self-host the reviewed source, keep the host updated, and verify that you are using the expected HTTPS domain.
- **Review every export:** Automatic edge detection, perspective correction, thresholding, compression, glare, shadows, and camera focus can crop or obscure information. Compare exported files with the originals before relying on them.
- **Not an archival guarantee:** OpDiScan is a convenience tool, not a certified records-management, identity-verification, evidence-preservation, medical, legal, or regulatory-compliance system.
- **Protect sensitive files:** Downloads are saved wherever the browser and operating system place them. Secure the device, delete unwanted copies, and avoid scanning confidential material on shared or untrusted devices.
- **Camera permissions:** Grant camera access only to the expected domain. Permissions can be revoked in browser or operating-system settings.
- **No warranty:** The software is provided as-is under the MIT License. You are responsible for evaluating whether it is appropriate for your use case.

## Technology

- Vanilla HTML, CSS, and JavaScript
- OpenCV.js for contour detection and perspective transforms
- jsPDF for client-side PDF generation
- Service Worker and Web App Manifest for PWA behavior
- Nginx Alpine for static hosting
- Optional Cloudflare Tunnel sidecar

## Project structure

```text
.
|-- icons/                  PWA and application icons
|-- app.js                  Camera, pages, filters, and exports
|-- cv-pipeline.js          Edge detection and perspective correction
|-- index.html              Application markup
|-- style.css               Responsive interface
|-- manifest.webmanifest    PWA metadata
|-- sw.js                   Offline cache
|-- nginx.conf              Static-server configuration
|-- Dockerfile
|-- docker-compose.yml       Local build deployment
`-- docker-compose.gitops.yml Portainer automatic updates
```

## Contributing

Issues and pull requests are welcome. Keep changes focused, avoid introducing document uploads or tracking without prominent disclosure, and test camera/import, all filters, multi-page PDF export, and PWA installation before submitting.

## License

OpDiScan is open-source software released under the [MIT License](LICENSE).
