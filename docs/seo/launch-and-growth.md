# OpenBed search launch and growth

Prepared 10 October 2026. Ranking is an outcome measured in Search Console, not a promise made by this implementation.

## What the live audit found

The homepage returned HTTP 200, a title of OpenBed, no description and an empty app root. robots.txt allowed the home, About and How-it-works pages but blocked the assets needed to render them. A request for sitemap.xml returned the dashboard HTML rather than a sitemap. The current repository has a newer home canonical and search controls than that live HTML. Live deployment must therefore be read back, not inferred from a merged commit.

Google explains that blocked JavaScript is not rendered and recommends static content for discovery: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics

The verified openbed.ng domain property was accessible in the owner's Chrome session. Its Page indexing report said it was processing data. This is not evidence of an indexed homepage or a ranking position.

## Query coverage and the page that answers each intent

The companion JSON is a generated candidate map: 127 base phrases in 11 intent groups, expanded with geographic modifiers. It is not keyword-volume research and its combinations are not separate pages to publish. Natural queries are unbounded; new terms should be added from Search Console rather than claiming to enumerate every possible sentence.

| Intent | Destination | Coverage |
|---|---|---|
| Available beds, hospital bed space, bedspace, inpatient capacity, real-time reports | Home and Nigeria guide | Hospital reports, freshness, call to confirm |
| Nigeria, states, cities, nearby and near me | Nigeria guide | Explicit Lagos launch; other locations require actual participating facilities |
| Lagos and all 20 Lagos LGAs | Lagos guide and existing area controls | Search starting points, not claims of a hospital in each area |
| Emergency, A&E, casualty, admission now, no bed syndrome | Nigeria guide | Reporting limits, call before travel, emergency strip retained |
| Adult ICU, intensive care, critical care | ICU guide | Adult ICU filter; no claim of equipment or staffing |
| PICU, children's ICU, paediatric/pediatric intensive care | ICU guide | Actual PICU category and link |
| NICU, neonatal/newborn intensive care, SCBU | ICU guide | Separate NICU and SCBU categories |
| Adult medical, surgical, children's ward, maternity, theatre | Nigeria guide | Every actual ward category has a direct search link |
| Referral, receiving hospital, interhospital transfer | Nigeria guide | Clinical teams confirm admission and coordinate transfers |
| Free access, account, app, reservation, cost, insurance/HMO | Nigeria guide | Free public use; unsupported booking, prices and HMO filters explained |
| Hospital portal, ward reporting, capacity dashboard, onboarding | Hospital reporting guide | Existing hospital enquiry channel and precise product boundaries |
| HDU, ventilators, oxygen, incubators, dialysis and specialist requests | Nigeria and ICU guides | Clearly stated as unsupported inventory filters, with facility confirmation required |
| Operator, trustworthy reports, update age and privacy | About and How-it-works | Existing approved texts retained |
| Brand and misspellings | Home | OpenBed, Open Bed Nigeria, OpenBed NG and domain variants are research terms, not text to repeat unnaturally |

English content covers common local expressions such as bed space, bedspace and admission space. Yoruba, Hausa, Igbo and Nigerian Pidgin pages require fluent review; no unreviewed translations are shipped. Searches for hospital bed purchase, rental, equipment suppliers, jobs and training are outside this product's intent.

## Indexing after deployment

- Deploy only the reviewed commit on main using the repository's Pages deployment script.
- Read the live version.json, home title/description/canonical, robots.txt and sitemap.xml. Confirm each guide returns its own heading, rather than the SPA fallback.
- Submit https://openbed.ng/sitemap.xml in the verified domain property in Google Search Console. Inspect and request indexing for the homepage and four guides. Google may still decline or delay indexing.
- Use the URL Inspection live test to check rendering, resources and Google-selected canonical. Confirm snapshots and query URLs remain outside the submitted sitemap.
- Check the Page indexing and Performance reports after Google has processed data. Record baseline date, impressions, clicks, CTR and average position by page and query, with Nigeria as the country filter.
- Set up Bing Webmaster Tools separately if access exists. Do not use Google's Indexing API: these pages are neither job postings nor live-streaming event pages.

Google's submission guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

## Growth work that earns relevance and links

Each participating hospital is an opportunity for a legitimate link from its own referral/contact page to OpenBed. The hospital should approve the description and link. Prepare this short proposed copy for the hospital's review: “Our hospital publishes indicative bed availability on OpenBed. Check the report, then call us to confirm before travelling.” No messages have been sent and no endorsements are invented.

Ask hospital partners, professional associations and referral networks to publish useful, accurate references where they already explain referrals. Prepare a factual operator/media page and an approved launch announcement with actual participating coverage. Do not buy link packages, automate comments, manufacture reviews or publish fake local listings.

Hospital reports need to be reliable enough that visitors find the service useful. Track participating coverage and stale/no-report rates operationally, without collecting patient data. Only publish an additional city guide when real coverage, useful local information and an owner responsible for updates exist. Individual hospital SEO pages would require a separate data-publication decision because duty contacts are deliberately protected here.

At 30 days, use Search Console queries to improve titles and answers where impressions show relevant demand. At 60 and 90 days, assess non-brand clicks and which ward/location terms need better content or actual hospital participation. A page that attracts users seeking bed rentals is targeting the wrong intent even if its traffic grows.

## Access and spending

This change requires no paid subscriptions, paid ads or purchased links. Search Console submission requires the verified owner session. Deployment requires the existing Cloudflare Pages credentials. No private hospital records, staff names, duty phones, patient data or historical counts are included in guides or the sitemap.
