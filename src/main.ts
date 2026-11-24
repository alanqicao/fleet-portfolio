import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/saira/300.css";
import "@fontsource/saira/500.css";
import "@fontsource/saira-condensed/600.css";
import "./style.css";
import projectList from "./content/projects.json";
import site from "./content/global.json";
import mediaLibrary from "./content/project-media.json";
import type { Station } from "./kit.js";
import { createStage, type Placement } from "./stage.js";
import type { ShipSpec } from "./ship.js";
import { createFuzz } from "./stations/fuzz.js";
import { createScan } from "./stations/scan.js";
import { createArm } from "./stations/arm.js";
import { createSprite } from "./stations/sprite.js";
import { createSnake } from "./stations/snake.js";
import { createFlow } from "./stations/flow.js";

type Project = (typeof projectList)[number];
interface Asset {
  id: string; projectId: string; src: string; kind: string; alt?: string; caption: string;
  width?: number; height?: number; poster?: string; label?: string;
}

/** The ship that stands for each project, where it flies in the formation, and how to play with it. */
const models: Record<string, { build: () => Station; x: number; y: number; z: number; ship: ShipSpec; carries?: boolean; mouse: string; touch: string }> = {
  "pcsx2": {
    build: createFuzz, x: -30, y: 0, z: -12,
    ship: { file: "/models/harbinger.glb", length: 14, turn: [0, 0, 0], at: [0.8, 1.0, -5.0], drives: [0.18, 0.35, 0.5, 0.65, 0.82].map((z) => ({ z, y: 0.6, r: 0.05 })), driveColor: 0xff8a3c },
    mouse: "The panel beside the cruiser shows its memory. Probes strike the hull and overwrite cells: move over the panel to aim, click for a salvo, and keep going until the ship faults and restarts.",
    touch: "The panel beside the cruiser shows its memory. Probes strike the hull and overwrite cells: tap the panel for a salvo, and keep going until the ship faults and restarts.",
  },
  "yolo-fishing-bot": {
    build: createScan, x: -4, y: 4, z: -18,
    ship: { file: "/models/colaid.glb", length: 5.5, turn: [0, Math.PI / 2, 0], at: [-4.4, 0.2, 0], drives: [{ z: 0.32, y: 0.44, r: 0.045 }, { z: 0.67, y: 0.44, r: 0.045 }, { z: 0.5, y: 0.5, r: 0.035 }], driveColor: 0x9fe2ff },
    mouse: "The survey ship's detector boxes and names everything drifting ahead of it. Move the lure onto a piece of ore for a bite, then click to reel it in.",
    touch: "The survey ship's detector boxes and names everything drifting ahead of it. Tap a piece of ore to cast the lure, and tap again to reel it in.",
  },
  "robot-arm": {
    build: createArm, carries: true, x: 24, y: -2, z: -10,
    ship: { file: "/models/transporter.glb", length: 8.5, turn: [0, Math.PI / 2, 0], at: [0, 0, 0], seatTop: true, drives: [{ z: 0.32, y: 0.57, r: 0.045 }, { z: 0.68, y: 0.57, r: 0.045 }], driveColor: 0x9fe2ff },
    mouse: "The tug's arm follows your pointer and the knobs beside it follow the joints. Click over a crate to pick it up, and again to let it go.",
    touch: "Tap where the tug's arm should reach. Tap a crate to pick it up, and again to let it go.",
  },
  "sprite-editor": {
    build: createSprite, carries: true, x: 30, y: 2, z: 14,
    ship: { file: "/models/colony.glb", length: 13, turn: [0, -Math.PI / 2, 0], at: [-0.6, -0.35, 0], seatTop: true, drives: [{ z: 0.19, y: 0.54, r: 0.028 }, ...[0.34, 0.46, 0.58, 0.69].map((z) => ({ z, y: 0.54, r: 0.042 })), { z: 0.82, y: 0.54, r: 0.028 }], driveColor: 0x7fe8ff },
    mouse: "Drag across the display set into the carrier's deck to paint. Click a paint well to change colour; the dark one erases.",
    touch: "Tap a paint well to choose a colour, then tap the deck display to paint.",
  },
  "multiplayer-snake": {
    build: createSnake, x: 4, y: -3, z: 16,
    ship: { file: "/models/corinth.glb", length: 9, turn: [0, -Math.PI / 2, 0], at: [0.5, 2.6, -8.5], drives: [{ z: 0.08, y: 0.29, r: 0.06, tall: 1.9 }, { z: 0.92, y: 0.29, r: 0.06, tall: 1.9 }], driveColor: 0x6aa8ff },
    mouse: "Three container convoys share one patch of space. The orange one is yours: it follows your pointer, or turn it with A and D. Each beacon adds a container.",
    touch: "Three container convoys share one patch of space. The orange one is yours: tap and it heads there. Each beacon adds a container.",
  },
  "viotti-amazon": {
    build: createFlow, carries: true, x: -24, y: 1, z: 12,
    ship: { file: "/models/cargo.glb", length: 12, turn: [0, -Math.PI / 2, 0], at: [2.2, -0.15, 0], seatTop: true, drives: [{ z: 0.08, y: 0.25, r: 0.06 }, { z: 0.9, y: 0.25, r: 0.06 }], driveInset: 0.04, driveColor: 0x9fe2ff },
    mouse: "Three feeder craft send crates to the freighter. A bay with a red lamp is short on stock. Click to run a sync. All figures here are made up.",
    touch: "Three feeder craft send crates to the freighter. A bay with a red lamp is short on stock. Tap to run a sync. All figures here are made up.",
  },
};

/** The ships and props are other people's work, used under CC BY 4.0, which asks for this credit. */
const shipCredits = [
  { title: "D.S.S. Harbinger battle cruiser", author: "Comrade1280", href: "https://sketchfab.com/3d-models/dss-harbinger-battle-cruiser-474f62d00ed54212b37f93ce91569c53" },
  { title: "Spaceship COLAID1 50k", author: "Jungle Jim", href: "https://sketchfab.com/3d-models/spaceship-colaid1-50k-34acc30c89364a668ab1025686a686bc" },
  { title: "Space Cargo Ship Transporter", author: "Inditrion Dradnon", href: "https://sketchfab.com/3d-models/space-cargo-ship-transporter-76c18dcb6a0043d6ab05ed9f9c26330b" },
  { title: "Colony Tactical Ship", author: "Rakshaan", href: "https://sketchfab.com/3d-models/colony-tactical-ship-050dae751a404f3087aac9241958e2b1" },
  { title: "Corinth Cargo Transporter", author: "Yvo Pors", href: "https://sketchfab.com/3d-models/corinth-cargo-transporter-7614d85856f6477ba2a603970dcbb0dd" },
  { title: "Cargo Spaceship", author: "blaice", href: "https://sketchfab.com/3d-models/cargo-spaceship-a53147cc2da943e7ae07f1e0b0a31518" },
  { title: "Industrial robot arm", author: "olofunot", href: "https://sketchfab.com/3d-models/industrial-robot-arm-b4b5931851754747a734f72234c87e38" },
  { title: "Asteroids Pack (rocky version)", author: "SebastianSosnowski", href: "https://sketchfab.com/3d-models/asteroids-pack-rocky-version-adde1ecf129e4509be8af61b84bafa85" },
  { title: "Ore and crystals", author: "leha_pu", href: "https://sketchfab.com/3d-models/ore-and-crystals-dea7557c1db14b5fad3dd3911063f146" },
  { title: "Sci-fi cargo crate", author: "andreas9343", href: "https://sketchfab.com/3d-models/sci-fi-cargo-crate-ac36898521304e51a8e305aa602f1f5b" },
  { title: "Futuristic cargo container Low-Poly", author: "Begle", href: "https://sketchfab.com/3d-models/futuristic-cargo-container-low-poly-015f32ec950744c4898e17af07d43f65" },
  { title: "Sci-Fi Personal Space Pod Ship", author: "futaba@blender", href: "https://sketchfab.com/3d-models/sci-fi-personal-space-pod-shipweekly-challenge-b158f01dd4a9416fb689ca4401856e7a" },
];

const projects = [...projectList].sort((a, b) => a.order - b.order).filter((project) => models[project.id]);
const assets = mediaLibrary.assets as Asset[];
const coarse = window.matchMedia("(pointer: coarse)").matches;

const escape = (text: string) => text.replace(/[&<>"]/g, (mark) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[mark]!);
/** Plain text with `code` spans and blank-line paragraphs. */
const prose = (text: string) => text.split(/\n{2,}/).map((part) => `<p>${escape(part).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`).join("");

function projectStop(project: Project, index: number) {
  const model = models[project.id];
  const summary = "featuredCopy" in project && project.featuredCopy ? project.featuredCopy.body : project.indexCopy;
  return `
    <section class="stop project" id="${project.slug}"${index === 0 ? ' data-first="projects"' : ""}>
      <article class="panel" data-ui>
        <h2>${escape(project.title)}</h2>
        <p class="kind">${escape([project.primaryCategory, ...project.supportingCategories].join(", "))}</p>
        ${prose(summary)}
        <p class="part"><strong>My part.</strong> ${escape(project.contributionSignal)}</p>
        <p class="try">${escape(coarse ? model.touch : model.mouse)}</p>
        <button class="button" type="button" data-case="${project.slug}">Read the case study</button>
      </article>
    </section>`;
}

function aboutStop() {
  const { about, skills, education, experience, contact } = site;
  return `
    <section class="stop closing" id="about">
      <div class="panel wide" data-ui>
        <h2>About</h2>
        ${prose(about.copy)}
        ${prose(about.engineeringApproach)}
        <h3>What I work on</h3>
        <dl>${about.interests.map((item) => `<dt>${escape(item.name)}</dt><dd>${escape(item.description)}</dd>`).join("")}</dl>
        <h3>Tools</h3>
        <dl class="compact">${skills.map((group) => `<dt>${escape(group.category)}</dt><dd>${escape(group.items.join(", "))}</dd>`).join("")}</dl>
        <h3>Experience</h3>
        ${experience.map((job) => `<p><strong>${escape(job.title)}, ${escape(job.organization)}</strong><br>${escape(job.dates)}</p>${prose(job.description)}`).join("")}
        <h3>Education</h3>
        <dl class="compact">${education.map((school) => `<dt>${escape(school.institution)}</dt><dd>${escape(school.credential)}</dd>`).join("")}</dl>
        <h3 id="contact">Contact</h3>
        <p>${escape(contact.introduction)}</p>
        <ul class="links">${contact.destinations.map((place) => `<li><a href="${escape(place.href)}">${escape(place.label)}</a></li>`).join("")}
          <li><a href="${escape(site.resume.href)}">${escape(site.resume.label)}</a></li></ul>
        <h3>3D models</h3>
        <p>The ships, the arm, and the rocks, crates and craft around them are 3D models by other artists, resized and compressed for this site, and used under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
        <ul class="credits">${shipCredits.map((ship) => `<li><a href="${ship.href}">${escape(ship.title)}</a> by ${escape(ship.author)}</li>`).join("")}</ul>
      </div>
    </section>`;
}

const page = document.getElementById("page")!;
page.innerHTML = `
  <section class="stop opening" id="top">
    <div class="opening-copy" data-ui>
      <h1>${escape(site.identity.name)}</h1>
      <p class="lede">${escape(site.identity.positioning)}</p>
      <p>${escape(site.identity.heroSupport)}</p>
      <ul class="actions">
        <li><a class="button" href="#${projects[0].slug}">Meet the fleet</a></li>
        <li><a href="${escape(site.resume.href)}">${escape(site.resume.label)}</a></li>
      </ul>
    </div>
  </section>
  ${projects.map(projectStop).join("")}
  ${aboutStop()}`;
document.querySelector<HTMLAnchorElement>('.bar a[href="#projects"]')!.href = `#${projects[0].slug}`;

// The case study: every word and figure of the project record, on a sheet over the scene.
const sheet = document.getElementById("sheet") as HTMLDialogElement;
const chapters: [keyof Project["detail"], string][] = [
  ["overview", "Overview"], ["contribution", "My role and contribution"], ["technicalApproach", "Technical approach"],
  ["engineeringDecisions", "Engineering decisions"], ["challengesLessons", "Challenges and lessons"],
  ["resultsStatus", "Results and status"], ["evidence", "Evidence"],
];

function figure(asset: Asset) {
  const size = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : "";
  const media = asset.kind === "video"
    ? `<video controls preload="none" playsinline${asset.poster ? ` poster="${escape(asset.poster)}"` : ""} aria-label="${escape(asset.label ?? asset.alt ?? "")}"><source src="${escape(asset.src)}"></video>`
    : `<img src="${escape(asset.src)}" alt="${escape(asset.alt ?? "")}" loading="lazy"${size}>`;
  return `<figure>${media}<figcaption>${escape(asset.caption)}</figcaption></figure>`;
}

function caseStudy(project: Project) {
  // The media record lists which figures open a case study and which support it as evidence.
  const surface = (mediaLibrary.surfaces as Record<string, Record<string, string[]>>)[project.id] ?? {};
  const wanted = [...new Set(Object.entries(surface).filter(([name]) => name !== "home" && name !== "index").flatMap(([, ids]) => ids))];
  const figures = wanted.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => Boolean(asset));
  return `
    <div class="sheet-bar"><button type="button" data-close>Close</button></div>
    <article>
      <h2 id="sheet-title" tabindex="-1">${escape(project.title)}</h2>
      <p class="kind">${escape([project.primaryCategory, ...project.supportingCategories].join(", "))}</p>
      ${chapters.slice(0, 2).map(([key, heading]) => `<h3>${heading}</h3>${prose(project.detail[key])}`).join("")}
      ${figures.map(figure).join("")}
      ${chapters.slice(2).map(([key, heading]) => `<h3>${heading}</h3>${prose(project.detail[key])}`).join("")}
      ${project.evidenceLinks.length ? `<ul class="links">${project.evidenceLinks.map((link) => `<li><a href="${escape(link.href)}">${escape(link.label)}</a></li>`).join("")}</ul>` : ""}
      <h3>Built with</h3>
      <p>${escape(project.technologies.join(", "))}</p>
    </article>`;
}

// Start the scene once the lettering its tags use has loaded.
await document.fonts.load('600 44px "Barlow Condensed"');
const placements: Placement[] = projects.map((project) => {
  const model = models[project.id];
  return { station: model.build(), x: model.x, y: model.y, z: model.z, ship: model.ship, carries: model.carries ?? false };
});
const stage = createStage(document.getElementById("scene") as HTMLCanvasElement, placements);

const stops = [...page.querySelectorAll<HTMLElement>(".stop")];
let marks: number[] = [];
function measure() {
  // On a wide screen a stop's panel sits beside the scene, so the camera settles as the stop
  // fills the window. On a narrow one the panel comes last in its stop, under the scene, so
  // the camera settles when the panel has scrolled into place.
  const narrow = window.matchMedia("(max-width: 860px)").matches;
  marks = stops.map((stop, index) => narrow && index < stops.length - 1
    ? stop.offsetTop + stop.offsetHeight - window.innerHeight / 2
    : stop.offsetTop + Math.min(stop.offsetHeight, window.innerHeight) / 2);
  follow();
}
function follow() {
  const eye = window.scrollY + window.innerHeight / 2;
  let index = 0;
  while (index < marks.length - 2 && eye >= marks[index + 1]) index++;
  const span = marks[index + 1] - marks[index];
  stage.setProgress(index + Math.min(Math.max((eye - marks[index]) / span, 0), 1));
}
window.addEventListener("scroll", follow, { passive: true });
window.addEventListener("resize", measure);
new ResizeObserver(measure).observe(page);
measure();

const lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const toggle = document.getElementById("motion")!;
let paused = lessMotion.matches;
function applyMotion() {
  stage.setPaused(paused || sheet.open);
  stage.setInstant(lessMotion.matches);
  toggle.textContent = paused ? "Resume motion" : "Pause motion";
}
toggle.addEventListener("click", () => { paused = !paused; applyMotion(); });
lessMotion.addEventListener("change", () => { paused = lessMotion.matches; applyMotion(); });

function openCase(slug: string) {
  const project = projects.find((entry) => entry.slug === slug);
  if (!project) return;
  sheet.innerHTML = caseStudy(project);
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  sheet.querySelector<HTMLElement>("#sheet-title")!.focus();
  applyMotion();
}
function route() {
  const match = /^#(.+)\/case$/.exec(location.hash);
  if (match) openCase(match[1]);
  else if (sheet.open) sheet.close();
}
page.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-case]");
  if (button) location.hash = `#${button.dataset.case}/case`;
});
sheet.addEventListener("click", (event) => {
  if (event.target === sheet || (event.target as Element).closest("[data-close]")) sheet.close();
});
sheet.addEventListener("close", () => {
  const match = /^#(.+)\/case$/.exec(location.hash);
  if (match) history.replaceState(null, "", `#${match[1]}`);
  applyMotion();
});
window.addEventListener("hashchange", route);
applyMotion();
route();
