/* eslint-disable object-property-newline */
const Apify = require('apify');

const placesCrawler = require('./places_crawler');
const resultJsonSchema = require('./result_item_schema');
const { Stats } = require('./stats');
const { prepareSearchUrls } = require('./search');
const { createStartRequestsWithWalker } = require('./walker');
const makeInputBackwardsCompatible = require('./backwards-compatible-input');

const cachedPlacesName = 'Places-cached-locations';

const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    const stats = new Stats(300);

    makeInputBackwardsCompatible(input);

    // The rest of inputs are passed to the crawler as a whole
    const {
        // Search and Start URLs
        startUrls, searchString, searchStringsArray,
        // Localization
        lat, lng, country, state, city, zoom = 10,
        // browser and request options
        pageLoadTimeoutSec = 60, useChrome = false, maxConcurrency, maxPagesPerBrowser = 1, maxPageRetries = 6,
        // Misc
        proxyConfig, regularTestRun, debug, language = 'en',
        // walker is undocumented feature added by jakubdrobnik, we need to test it and document it
        walker,

        // Scraping options
        includeHistogram = false, includeOpeningHours = false, includePeopleAlsoSearch = false,
        maxReviews, maxImages, exportPlaceUrls = false, forceEng = false, additionalInfo = false, maxCrawledPlaces,
        maxAutomaticZoomOut, cachePlaces = false, reviewsSort = 'mostRelevant',
    } = input;

    const scrapingOptions = {
        includeHistogram, includeOpeningHours, includePeopleAlsoSearch,
        maxReviews, maxImages, exportPlaceUrls, forceEng, additionalInfo, maxCrawledPlaces,
        maxAutomaticZoomOut, cachePlaces, reviewsSort, language,
    };

    if (debug) {
        log.setLevel(log.LEVELS.DEBUG);
    }
    if (!searchString && !searchStringsArray && !startUrls) {
        throw 'You have to provide startUrls or searchString or searchStringsArray in input!';
    }
    if (Apify.isAtHome() && (!proxyConfig || !(proxyConfig.useApifyProxy || proxyConfig.proxyUrls))) {
        throw 'You have to use Apify proxy or custom proxies when running on Apify platform!';
    }
    if (proxyConfig.apifyProxyGroups
        && (proxyConfig.apifyProxyGroups.includes('GOOGLESERP') || proxyConfig.apifyProxyGroups.includes('GOOGLE_SERP'))) {
        throw 'It is not possible to crawl google places with GOOGLE SERP proxy group. Please use a different one and rerun  the crawler!';
    }

    let allPlaces = {};
    if (cachePlaces) {
        log.debug('Load cached places');
        const allPlacesStore = await Apify.openKeyValueStore(cachedPlacesName);
        allPlaces = await allPlacesStore.getValue('places') || {};
        log.debug('allPlaces', allPlaces);
        Apify.events.on('migrating', async () => {
            log.debug('Saving places before migration');
            const reloadedPlaces = await allPlacesStore.getValue('places') || {};
            const newPlaces = { ...allPlaces, ...reloadedPlaces };
            await allPlacesStore.setValue('places', newPlaces);
        });
    }

    // Requests that are used in the queue
    const startRequests = [];

    // Start URLs have higher preference than search
    if (Array.isArray(startUrls) && startUrls.length > 0) {
        if (searchString || searchStringsArray) {
            log.warning('\n\n------\nUsing Start URLs disables search. You can use either search or Start URLs.\n------\n');
        }
        const rlist = await Apify.openRequestList('STARTURLS', startUrls);
        let req;
        while (req = await rlist.fetchNextRequest()) { // eslint-disable-line no-cond-assign
            if (!req.url
                || !/www\.google\.com\/maps\/(@|search|place)\//.test(req.url)
            ) {
                log.warning(`\n------\nURL ${req.url} isn't a valid startUrl\n------`);
                continue; // eslint-disable-line no-continue
            }

            startRequests.push({
                ...req,
                userData: { label: 'startUrl', searchString: null },
            });
        }
    } else if (searchString || searchStringsArray) {
        if (searchStringsArray && !Array.isArray(searchStringsArray)) {
            throw 'searchStringsArray has to be an array!';
        }
        const searches = searchStringsArray || [searchString];
        for (const search of searches) {
            // TODO: walker is not documented!!! We should figure out if it is useful at all
            if (walker) {
                const walkerGeneratedRequests = createStartRequestsWithWalker({ walker, searchString });
                for (const req of walkerGeneratedRequests) {
                    startRequests.push(req);
                }
            } else if (search.includes('place_id:')) {
                /**
                 * User can use place_id:<Google place ID> as search query
                 * TODO: Move place id to separate fields, once we have dependent fields. Than user can fill placeId or search query.
                 */
                log.info(`Place ID found in search query. We will extract data from ${search}.`);
                const cleanSearch = search.replace(/\s+/g, '');
                const placeId = cleanSearch.match(/place_id:(.*)/)[1];
                startRequests.push({
                    url: `https://www.google.com/maps/search/?api=1&query=${cleanSearch}&query_place_id=${placeId}`,
                    uniqueKey: placeId,
                    userData: { label: 'detail', searchString: search },
                });
            } else {
                // This call is async because it persists a state into KV
                const { startUrlSearches, geo } = await prepareSearchUrls({ lat, lng, zoom, country, state, city });
                for (const startUrlSearch of startUrlSearches) {
                    startRequests.push({
                        url: startUrlSearch,
                        uniqueKey: `${startUrlSearch}+${search}`,
                        userData: { label: 'startUrl', searchString: search, geo },
                    });
                }
            }
        }
    }

    await stats.loadInfo();
    log.info('Start urls are:');
    console.dir(startRequests.map((r) => r.url));

    const requestQueue = await Apify.openRequestQueue();

    for (const request of startRequests) {
        await requestQueue.addRequest(request);
    }

    /**
     * @type {Apify.PuppeteerPoolOptions}}
     */
    const puppeteerPoolOptions = {
        launchPuppeteerOptions: {
            headless: !useChrome,
            useChrome,
            args: [
                // this is needed to access cross-domain iframes
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
        },
        maxOpenPagesPerInstance: maxPagesPerBrowser,
        // Not sure why this is here
        retireInstanceAfterRequestCount: 100,
    };

    const proxyConfiguration = await Apify.createProxyConfiguration({ ...proxyConfig });

    /**
     * @type {Apify.PuppeteerCrawlerOptions}
     */
    const crawlerOptions = {
        requestQueue,
        proxyConfiguration,
        puppeteerPoolOptions,
        maxConcurrency,
        useSessionPool: true,
        // This is just passed to gotoFunction
        pageLoadTimeoutSec,
        // long timeout, because of long infinite scroll
        handlePageTimeoutSecs: 30 * 60,
        maxRequestRetries: maxPageRetries,
    };

    // workaround for the maxCrawledPlaces when using multiple queries/startUrls
    scrapingOptions.multiplier = startRequests.length || 1;

    // Create and run crawler
    const crawler = placesCrawler.setUpCrawler(crawlerOptions, scrapingOptions, stats, allPlaces);

    await crawler.run();
    await stats.saveStats();

    if (cachePlaces) {
        log.debug('Saving places before migration');
        const allPlacesStore = await Apify.openKeyValueStore(cachedPlacesName);
        const reloadedPlaces = await allPlacesStore.getValue('places') || {};
        const newPlaces = { ...allPlaces, ...reloadedPlaces };
        await allPlacesStore.setValue('places', newPlaces);
    }

    if (regularTestRun) {
        const { defaultDatasetId: datasetId } = Apify.getEnv();
        await Apify.call('drobnikj/check-crawler-results', {
            datasetId,
            options: {
                minOutputtedPages: 5,
                jsonSchema: resultJsonSchema,
                notifyTo: 'lukas@apify.com',
            },
        });
    }

    log.info('Scraping finished!');
});
