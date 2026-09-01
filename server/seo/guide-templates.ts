import {
  techCompanies,
  financeCompanies,
  metros,
  servedRegionsSummary,
} from "./guide-data";

const BRAND = "Referral";
const SITE_NAME = "referralprofessional.net";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface FaqItem {
  question: string;
  answer: string;
}

interface PageOptions {
  title: string;
  description: string;
  canonical: string;
  baseUrl: string;
  bodyHtml: string;
  image?: string;
  imageAlt?: string;
  faq?: FaqItem[];
  extraJsonLd?: Record<string, unknown>;
  noindex?: boolean;
}

function organizationJsonLd(baseUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND,
    url: baseUrl + "/",
    description:
      "Referral is a professional networking platform that connects job seekers with people who can refer them at the companies they want to work for, with location-based matching across major U.S. metro areas.",
    sameAs: [],
  };
}

function faqJsonLd(faq: FaqItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function renderPage(opts: PageOptions): string {
  const jsonLdBlocks: Record<string, unknown>[] = [organizationJsonLd(opts.baseUrl)];
  if (opts.faq && opts.faq.length) jsonLdBlocks.push(faqJsonLd(opts.faq));
  if (opts.extraJsonLd) jsonLdBlocks.push(opts.extraJsonLd);

  const jsonLdHtml = jsonLdBlocks
    .map(
      (block) =>
        `<script type="application/ld+json">${JSON.stringify(block)}</script>`,
    )
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}" />
  ${opts.noindex ? "" : `<link rel="canonical" href="${escapeHtml(opts.canonical)}" />\n  `}<meta name="robots" content="${opts.noindex ? "noindex, nofollow" : "index, follow"}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escapeHtml(BRAND)}" />
  <meta property="og:title" content="${escapeHtml(opts.title)}" />
  <meta property="og:description" content="${escapeHtml(opts.description)}" />
  ${opts.noindex ? "" : `<meta property="og:url" content="${escapeHtml(opts.canonical)}" />`}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(opts.title)}" />
  <meta name="twitter:description" content="${escapeHtml(opts.description)}" />${opts.image ? `
  <meta property="og:image" content="${escapeHtml(opts.image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtml(opts.imageAlt ?? opts.title)}" />
  <meta name="twitter:image" content="${escapeHtml(opts.image)}" />
  <meta name="twitter:image:alt" content="${escapeHtml(opts.imageAlt ?? opts.title)}" />` : ""}
  <link rel="icon" type="image/png" href="/app-icon-192.png?v=3" />
  <link rel="stylesheet" href="/guides.css" />
  ${jsonLdHtml}
</head>
<body>
  <div class="wrap">
    <header class="site">
      <a class="brand" href="/guides">${escapeHtml(BRAND)}</a>
      <p class="tag">It's all about <strong>connections</strong></p>
    </header>
    ${opts.bodyHtml}
  </div>
  <footer class="site">
    <p><a href="/guides">Guide</a> &nbsp;·&nbsp; <a href="/auth">Open the ${escapeHtml(BRAND)} app</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a></p>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(SITE_NAME)}</p>
  </footer>
</body>
</html>`;
}

function ctaBlock(label: string): string {
  return `<a class="cta" href="/auth">${escapeHtml(label)}</a>`;
}

function faqBlock(faq: FaqItem[]): string {
  const items = faq
    .map(
      (item) =>
        `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`,
    )
    .join("\n      ");
  return `<div class="card faq"><h2>Frequently asked questions</h2>\n      ${items}\n    </div>`;
}

function chips(items: string[]): string {
  return `<div class="chips">${items
    .map((i) => `<span>${escapeHtml(i)}</span>`)
    .join("")}</div>`;
}

// ---------- The single comprehensive guide ----------

const DATE_PUBLISHED = "2025-01-15";
const DATE_MODIFIED = "2025-06-04";

function formatVisibleDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function renderGuide(baseUrl: string): string {
  const canonical = `${baseUrl}/guides`;
  const title = `How to Network, Get Referrals & Get Hired | ${BRAND}`;
  const description =
    "Learn how to network strategically, earn employee referrals, and get hired at top companies — plus how Referral helps you do it faster.";

  const metroNames = metros.map((m) => `${m.name}, ${m.state}`);

  const faq: FaqItem[] = [
    {
      question: "What is the single most effective way to get a job?",
      answer:
        "An employee referral. Referred candidates are interviewed and hired at dramatically higher rates than people who apply cold, because a referral puts your resume in front of a human instead of an applicant-tracking filter. Referral (referralprofessional.net) is built specifically to get you those referrals.",
    },
    {
      question: "How much better are your chances with an employee referral?",
      answer:
        "Significantly better across every stage of the funnel. Research published by Jobvite consistently shows referred candidates are converted from applicant to hire at roughly 3–4× the rate of job-board applicants. LinkedIn talent research similarly finds that referred candidates move through hiring pipelines faster and accept offers at higher rates. At highly selective employers, internal referrals are the dominant source of hires — meaning a cold application is rarely how competitive roles are actually filled.",
    },
    {
      question: "How do I get a referral if I don't know anyone at the company?",
      answer:
        "You build the connection first. Referral matches you with professionals at and connected to your target companies based on your background, goals, and location, then gives you a natural way to reach out, build rapport, and ask for an introduction or referral.",
    },
    {
      question: "Does this work for both tech and finance companies?",
      answer:
        "Yes. Referral covers the top tech and finance employers — from Apple, Google, Microsoft, and NVIDIA to JPMorgan Chase, Goldman Sachs, BlackRock, and Citadel — plus thousands of other companies. Referrals are the fastest way in regardless of industry.",
    },
    {
      question: "What if I'm relocating to a new city?",
      answer:
        "Start networking before you move. Many people line up roles in a new metro by building local connections in advance. Referral uses location-based matching across all major U.S. metro areas, so you can grow a network in your destination city early.",
    },
    {
      question: "How is Referral different from a job board?",
      answer:
        "Job boards send you into a pile of thousands of applicants. Referral is relationship-first: it connects you with real people who can vouch for you, which is how most good jobs are actually filled.",
    },
  ];

  const body = `
    <article class="card">
      <h1>How to Network, Get Referrals, and Get Hired</h1>
      <p class="dateline">Last updated: <time datetime="${DATE_MODIFIED}">${formatVisibleDate(DATE_MODIFIED)}</time></p>
      <p class="byline">By the <strong>${escapeHtml(BRAND)} Editorial Team</strong> &nbsp;·&nbsp; <a href="/auth">${escapeHtml(SITE_NAME)}</a></p>
      <p class="lead">Here's the blunt truth: applying to jobs online is the slowest, least effective way to get hired. The people who land the best roles do it through <strong>relationships and referrals</strong>. This guide walks through exactly how to build valuable professional connections, earn employee referrals, and get the job — and how <strong>${escapeHtml(BRAND)}</strong> (${escapeHtml(SITE_NAME)}) makes the whole process dramatically faster.</p>
      <p>${ctaBlock("Start networking on Referral")}</p>
      <div class="toc">
        <p><strong>In this guide:</strong>
          <a href="#why-referrals">Why referrals win</a> ·
          <a href="#connections">Make valuable connections</a> ·
          <a href="#get-referral">Get a referral</a> ·
          <a href="#get-hired">Get hired</a> ·
          <a href="#companies">Target companies</a> ·
          <a href="#cities">By city</a> ·
          <a href="#how-referral-helps">How Referral helps</a> ·
          <a href="#sources">Sources</a>
        </p>
      </div>
    </article>

    <article class="card" id="why-referrals">
      <h2>Why referrals beat everything else</h2>
      <p>Recruiters receive far more applications than they can ever read. Most are filtered out by software before a person sees them. A referral flips that completely: when a current employee submits you, your resume is flagged, reviewed, and taken seriously. <a href="https://www.jobvite.com/wp-content/uploads/2023/09/Jobvite-2023-Recruiting-Benchmark-Report.pdf" rel="noopener noreferrer" target="_blank">Jobvite's annual Recruiting Benchmark Report</a> consistently finds that referred candidates convert from applicant to hire at roughly three to four times the rate of job-board applicants — one of the most durable findings in modern recruiting research.</p>
      <p>The biggest employers show the same pattern at scale. At highly selective companies, internal referrals are the dominant channel for competitive roles — meaning the large majority of people who land those jobs were put forward by someone on the inside, not plucked from a pile of cold applications. <a href="https://business.linkedin.com/talent-solutions/resources/talent-engagement/job-seeker-ultimate-list-hiring-stats" rel="noopener noreferrer" target="_blank">LinkedIn talent research</a> similarly shows that referred candidates move through hiring pipelines faster and accept offers at higher rates than candidates from any other source.</p>
      <p>A referral isn't a favor you're stealing — companies <em>want</em> referrals because employee-referred hires <a href="https://hbr.org/2023/10/research-employee-referrals-can-harm-diversity" rel="noopener noreferrer" target="_blank">onboard faster and stay longer on average</a>. That's why nearly every major employer pays its own staff bonuses for successful referrals. Your job is simply to become the person worth referring, and to reach the right insider.</p>
    </article>

    <article class="card" id="connections">
      <h2>How to make valuable networking connections</h2>
      <p>Networking isn't collecting contacts — it's building a small number of genuine relationships with people who can open doors. The highest-value connections are people who work at your target companies, share your background or city, or operate in your industry.</p>
      <ol>
        <li><strong>Be specific about who you want to meet.</strong> "People in product roles at top tech companies in Seattle" beats "anyone hiring."</li>
        <li><strong>Lead with relevance, not requests.</strong> Reference shared background, school, city, or interests before you ever mention a job.</li>
        <li><strong>Give before you take.</strong> Offer something useful — a relevant insight, an introduction, genuine interest in their work.</li>
        <li><strong>Be consistent.</strong> A few thoughtful messages a week compounds into a real network within months.</li>
      </ol>
      <p>Referral removes the hardest part — finding the <em>right</em> people — by matching you with relevant professionals automatically based on your goals and location.</p>
    </article>

    <article class="card" id="get-referral">
      <h2>How to get an employee referral</h2>
      <ol>
        <li><strong>Identify the exact role.</strong> Note the title and requisition ID so your referrer can submit you for the right opening.</li>
        <li><strong>Find an insider.</strong> Look for current employees, alumni, former coworkers, and second-degree connections at the company.</li>
        <li><strong>Build rapport first.</strong> A short, personalized message about shared background works far better than a cold "can you refer me?"</li>
        <li><strong>Make the ask effortless.</strong> Send the role link, a two-sentence pitch on why you fit, and your resume so they can refer you in minutes.</li>
        <li><strong>Follow up graciously.</strong> A brief, polite nudge after a few days keeps your request on their radar.</li>
      </ol>
    </article>

    <article class="card" id="get-hired">
      <h2>How to actually get hired</h2>
      <p>A referral gets your foot in the door; you still have to walk through it. Pair your referral strategy with the fundamentals:</p>
      <ul>
        <li><strong>Tailor your resume</strong> to each role so the referral pays off when a recruiter looks.</li>
        <li><strong>Prepare for the interview</strong> using insight from your new connections about how the company actually evaluates candidates.</li>
        <li><strong>Keep multiple conversations going</strong> so you're never dependent on a single opportunity.</li>
        <li><strong>Stay in touch</strong> after you're hired — today's referral is tomorrow's career network.</li>
      </ul>
    </article>

    <article class="card" id="companies">
      <h2>Target companies covered by Referral</h2>
      <p>Referral helps you find people who can refer you at the most sought-after employers in the country. If you're aiming at any of these, the path in is a warm referral — not a cold application.</p>
      <h3>Top tech companies</h3>
      ${chips(techCompanies)}
      <h3>Top finance companies</h3>
      ${chips(financeCompanies)}
      <p class="company-cta">${ctaBlock("Find a referral at your target company")}</p>
    </article>

    <article class="card" id="cities">
      <h2>Get hired in every major U.S. city</h2>
      <p>The best roles in any metro are often filled through referrals before they're advertised. Referral uses location-based matching so you can build connections where you live — or where you're moving — across ${escapeHtml(servedRegionsSummary)}.</p>
      ${chips(metroNames)}
    </article>

    <article class="card" id="how-referral-helps">
      <h2>How Referral helps you do all of this</h2>
      <p>${escapeHtml(BRAND)} (${escapeHtml(SITE_NAME)}) is a professional networking platform built around one outcome: getting you referred and hired. It matches you with the most relevant professionals — including people at and connected to your target companies — based on your background, goals, and location. From there you can message them directly, build real relationships, and request introductions and referrals.</p>
      <p>Instead of guessing who to contact or firing resumes into the void, you get a curated list of the right people and a natural way to reach them. That's the difference between hoping for a callback and engineering one.</p>
      <p>${ctaBlock("Get started with Referral")}</p>
    </article>
    <article class="card" id="sources">
      <h2>Sources &amp; further reading</h2>
      <ul>
        <li><a href="https://www.jobvite.com/wp-content/uploads/2023/09/Jobvite-2023-Recruiting-Benchmark-Report.pdf" rel="noopener noreferrer" target="_blank">Jobvite 2023 Recruiting Benchmark Report</a> — applicant-to-hire conversion rates by source, referral vs. job boards.</li>
        <li><a href="https://business.linkedin.com/talent-solutions/resources/talent-engagement/job-seeker-ultimate-list-hiring-stats" rel="noopener noreferrer" target="_blank">LinkedIn Talent Solutions: Ultimate List of Hiring Statistics</a> — referral speed, offer-acceptance rates, and pipeline data.</li>
        <li><a href="https://hbr.org/2023/10/research-employee-referrals-can-harm-diversity" rel="noopener noreferrer" target="_blank">Harvard Business Review — Research: Employee Referrals</a> — retention, onboarding speed, and performance data for referred hires.</li>
        <li><a href="https://www.shrm.org/topics-tools/news/talent-acquisition/employee-referral-programs-boost-retention" rel="noopener noreferrer" target="_blank">SHRM — Employee Referral Programs Boost Retention</a> — longer average tenure of employee-referred hires.</li>
      </ul>
      <div class="editorial-note">
        <strong>About this guide:</strong> This content is produced by the ${escapeHtml(BRAND)} Editorial Team at ${escapeHtml(SITE_NAME)}. ${escapeHtml(BRAND)} is a professional networking platform focused on helping job seekers earn employee referrals at top companies. Our editorial advice is grounded in peer-reviewed recruiting research and industry benchmark reports; claims are linked to primary sources above. We update this guide when significant new data becomes available. For questions or corrections, <a href="/auth">contact us through the ${escapeHtml(BRAND)} app</a>.
      </div>
    </article>
    ${faqBlock(faq)}`;

  const socialImage = `${baseUrl}/assets/og-social-card.png`;
  const socialImageAlt =
    "Referral guide to networking, employee referrals, and getting hired";

  const articleJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How to Network, Get Referrals & Get Hired",
    description,
    url: canonical,
    mainEntityOfPage: canonical,
    image: socialImage,
    author: {
      "@type": "Organization",
      name: BRAND,
    },
    publisher: {
      "@type": "Organization",
      name: BRAND,
      url: `${baseUrl}/`,
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/app-icon-512.png?v=3`,
      },
    },
    datePublished: DATE_PUBLISHED,
    dateModified: DATE_MODIFIED,
  };

  return renderPage({
    title,
    description,
    canonical,
    baseUrl,
    bodyHtml: body,
    image: socialImage,
    imageAlt: socialImageAlt,
    faq,
    extraJsonLd: articleJsonLd,
  });
}

// ---------- 404 ----------

export function renderNotFound(baseUrl: string): string {
  const body = `
    <article class="card">
      <h1>Page not found</h1>
      <p>We couldn't find the page you were looking for. Read our complete guide to networking, referrals, and getting hired instead.</p>
      <p><a class="cta" href="/guides">Read the guide</a></p>
    </article>`;

  return renderPage({
    title: "Page not found | Referral",
    description: "The requested page could not be found. Read the Referral guide to networking and referrals.",
    canonical: `${baseUrl}/guides`,
    baseUrl,
    bodyHtml: body,
    noindex: true,
  });
}
